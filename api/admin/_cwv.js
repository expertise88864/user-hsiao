/**
 * GET /api/admin/cwv?range=7d|28d|90d
 *
 * KV supplies raw, deduplicated page-metric samples and their nearest-rank p75.
 * GA4 supplies event count and event-value mean only; it cannot supply p75.
 * Keep missing data separate from measured zero, and preserve partial results
 * when a provider is unavailable. This bounded sample is not Google's CrUX.
 */
import { requireAdmin } from './_auth.js';
import { kvAvailable, kvPipeline, kvLRange } from '../_kv.js';
import { selectCwvSamples, summarizeCwvSamples } from '../_cwv_samples.js';

const METRICS = ['LCP', 'CLS', 'INP', 'FCP', 'TTFB'];
const MAX_REPORTS = 1000;
const KV_WINDOW_DAYS = 30;
const PROVIDER_TIMEOUT_MS = 5000;

function emptyMetric(name, source, status, windowDays) {
  return {
    name, source, status, windowDays,
    samples: status === 'no_samples' ? 0 : null,
    avg: null, p75: null, method: null, percentileMethod: null,
  };
}

async function readKvSamples(metric, days) {
  const options = { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) };
  const rows = await kvLRange(`cwv:samples:v2:${metric}`, 0, MAX_REPORTS - 1, options);
  if (!Array.isArray(rows)) throw new Error('KV read unavailable');
  let arr = rows.map(row => {
    try { return typeof row === 'string' ? JSON.parse(row) : row; } catch (e) { return null; }
  });
  // The legacy JSON reservoir appended newest reports at its end.
  if (!arr.length) {
    const result = await kvPipeline([['GET', `cwv:samples:${metric}`]], options);
    if (!result || !result[0] || !Object.hasOwn(result[0], 'result')) {
      throw new Error('Legacy KV read unavailable');
    }
    const raw = result[0].result;
    if (raw != null) {
      arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(arr)) throw new Error('Invalid legacy KV samples');
      arr = arr.slice(-MAX_REPORTS).reverse();
    }
  }
  // A nonempty corrupt reservoir is not a confirmed empty measurement window.
  // Validate before the date cutoff so expired but valid reports remain empty.
  if (arr.length && !selectCwvSamples(arr, -Infinity).length) {
    throw new Error('Invalid KV sample reservoir');
  }
  // Key TTL alone does not expire individual reports while new writes refresh
  // the list. Enforce the advertised rolling sample window at read time.
  const windowDays = Math.min(days, KV_WINDOW_DAYS);
  const cutoff = Date.now() - windowDays * 86400_000;
  const data = summarizeCwvSamples(metric, arr, cutoff);
  return data ? { ...data, windowDays } : emptyMetric(metric, 'kv', 'no_samples', windowDays);
}

// Parse a service account JSON string (handles real \n and escaped \\n)
function parseSAJson(s) {
  try {
    const j = JSON.parse(s);
    j.private_key = j.private_key.replace(/\\n/g, '\n');
    return j;
  } catch (e) { return null; }
}

// Sign JWT for OAuth2 token exchange (RS256)
async function signJwtRs256(header, payload, privateKeyPem) {
  const enc = new TextEncoder();
  const headerB64  = b64urlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const signingInput = headerB64 + '.' + payloadB64;

  // Convert PEM to ArrayBuffer (PKCS#8)
  const pem = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const pkcs8 = Uint8Array.from(atob(pem), c => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(signingInput));
  return signingInput + '.' + b64urlEncode(sig);
}

function b64urlEncode(buf) {
  let s = '';
  const a = new Uint8Array(buf);
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signJwtRs256(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    sa.private_key
  );
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error('OAuth: ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  return j.access_token;
}

// GA4 returns aggregates. A mean is useful, but it cannot reconstruct p75.
async function fetchMetric(token, propertyId, metricName, days) {
  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    body: JSON.stringify({
      dateRanges: [{ startDate: `${days - 1}daysAgo`, endDate: 'today' }],
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }, { name: 'eventValue' }],
      dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { value: metricName } } },
    }),
  });
  if (!r.ok) throw new Error('GA4 report unavailable');
  const j = await r.json();
  if (j.rows == null) return emptyMetric(metricName, 'ga4', 'no_samples', days);
  if (!Array.isArray(j.rows)) throw new Error('Invalid GA4 rows');
  if (!j.rows.length) return emptyMetric(metricName, 'ga4', 'no_samples', days);
  const row = j.rows[0];
  const countValue = row.metricValues?.[0]?.value;
  const totalValue = row.metricValues?.[1]?.value;
  if (typeof countValue !== 'string' || !countValue.trim() ||
      typeof totalValue !== 'string' || !totalValue.trim()) throw new Error('Missing GA4 aggregates');
  const count = Number(countValue);
  const sumValue = Number(totalValue);
  if (!Number.isInteger(count) || count < 0 || !Number.isFinite(sumValue) || sumValue < 0) {
    throw new Error('Invalid GA4 aggregates');
  }
  if (!count) return emptyMetric(metricName, 'ga4', 'no_samples', days);
  return {
    ...emptyMetric(metricName, 'ga4', 'mean_only', days),
    samples: count,
    avg: sumValue / count / (metricName === 'CLS' ? 1000 : 1),
    method: 'ga4-event-mean',
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Allow', 'GET');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;
  const t0 = Date.now();
  const days = Math.min(90, Math.max(1, parseInt(req.query?.range, 10) || 28));
  const issues = [];
  const kvConfigured = kvAvailable();
  const ga4Configured = Boolean(process.env.GA4_PROPERTY_ID && process.env.GA4_SERVICE_ACCOUNT_JSON);
  const metrics = await Promise.all(METRICS.map(async name => {
    if (!kvConfigured) return emptyMetric(name, null, 'unavailable', null);
    try { return await readKvSamples(name, days); }
    catch (e) {
      issues.push({ source: 'kv', metric: name, code: 'unavailable' });
      return emptyMetric(name, 'kv', 'unavailable', Math.min(days, KV_WINDOW_DAYS));
    }
  }));
  const kvDone = Date.now();
  const missing = metrics.map((m, i) => m.status === 'measured' ? -1 : i).filter(i => i >= 0);
  let ga4Status = 'not_needed';
  if (missing.length) {
    ga4Status = ga4Configured ? 'available' : 'not_configured';
    if (ga4Configured) {
      const sa = parseSAJson(process.env.GA4_SERVICE_ACCOUNT_JSON);
      if (!sa) {
        ga4Status = 'invalid_config';
        issues.push({ source: 'ga4', code: 'invalid_config' });
      } else {
        try {
          const token = await getAccessToken(sa);
          const results = await Promise.allSettled(missing.map(i =>
            fetchMetric(token, process.env.GA4_PROPERTY_ID, METRICS[i], days)));
          results.forEach((result, n) => {
            const i = missing[n];
            if (result.status === 'fulfilled') {
              // Preserve a confirmed empty KV window if GA4 has no samples too.
              if (result.value.status !== 'no_samples' || metrics[i].source !== 'kv' ||
                  metrics[i].status !== 'no_samples') metrics[i] = result.value;
            } else {
              ga4Status = 'partial';
              issues.push({ source: 'ga4', metric: METRICS[i], code: 'unavailable' });
            }
          });
        } catch (e) {
          ga4Status = 'unavailable';
          issues.push({ source: 'ga4', code: 'unavailable' });
        }
      }
    }
  }
  res.setHeader('Server-Timing', `kv;dur=${kvDone - t0}, ga4;dur=${Date.now() - kvDone}`);
  return res.status(200).json({
    ok: true, range: `${days}d`, days, metrics, issues,
    collection: {
      kv: { configured: kvConfigured, maxReportsPerMetric: MAX_REPORTS,
        windowDays: Math.min(days, KV_WINDOW_DAYS), window: 'rolling-days' },
      ga4: { configured: ga4Configured, status: ga4Status,
        windowDays: days, window: 'calendar-days-including-today' },
    },
  });
}
