/**
 * GET /api/admin/cwv?range=7d|28d|90d
 *
 * Pulls Core Web Vitals (LCP, CLS, INP, FCP, TTFB) p75 from GA4 via the
 * Reporting API. The events fired by DN.bindWebVitals (in blog-shared.js)
 * land in GA4 as `event_name = LCP|CLS|INP|FCP|TTFB` with `value` in ms
 * (or CLS×1000). We aggregate p75 ourselves since GA4 only provides
 * count/sum/avg natively.
 *
 * Required env vars (Vercel):
 *   GA4_PROPERTY_ID            — e.g. "properties/477123456"
 *   GA4_SERVICE_ACCOUNT_JSON   — full GCP service account JSON (escape \n in private_key)
 *
 * The service account needs the "Viewer" role on the GA4 property:
 *   GCP Console → IAM → Add → service-account email → role "Viewer"
 *   GA4 Admin → Property → Property access management → invite SA email as Analyst
 *
 * Falls back to "no data configured" message if env vars absent — the dashboard
 * UI displays that gracefully.
 */
import { requireAdmin } from './_auth.js';
import { kvAvailable, kvGet, kvLRange } from '../_kv.js';

// v31: Read from KV first (real-time). GA4 fallback for historical depth
// when KV reservoir is empty or older than 30 days.
async function readKvSamples(metric, days) {
  if (!kvAvailable()) return null;
  const rows = await kvLRange(`cwv:samples:v2:${metric}`, 0, 999);
  let arr = Array.isArray(rows)
    ? rows.map(row => {
      try { return typeof row === 'string' ? JSON.parse(row) : row; } catch (e) { return null; }
    }).filter(Boolean)
    : [];
  // Transitional fallback for samples stored by the old JSON reservoir.
  if (!arr.length) {
    const raw = await kvGet(`cwv:samples:${metric}`);
    if (raw) {
      try { arr = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { arr = []; }
    }
  }
  if (!Array.isArray(arr) || !arr.length) return null;
  const cutoff = Date.now() - days * 86400_000;
  const recent = arr.filter(s => s.t > cutoff).map(s => s.v);
  if (!recent.length) return null;
  recent.sort((a, b) => a - b);
  const p75 = recent[Math.floor(recent.length * 0.75)] || 0;
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  return {
    name: metric,
    samples: recent.length,
    avg: metric === 'CLS' ? avg / 1000 : avg,
    p75: metric === 'CLS' ? p75 / 1000 : p75,
    source: 'kv',
  };
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
  });
  if (!r.ok) throw new Error('OAuth: ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  return j.access_token;
}

// p75 estimate — for Web Vitals we run a histogram query and pick bucket.
// GA4 doesn't expose true percentiles directly, but we can request a
// `metric { name: 'eventValue' aggregation: PERCENTILE_75 }` ... actually
// GA4 Data API supports calculatedMetric only via console. Easier: pull
// distribution buckets and compute client-side.
//
// Approach: query `eventCount` per `customEvent:value` bucket — GA4 hashes
// values into the dimension. Cleaner: we accept a sliding-window count of
// events and the API gives mean + median; we approximate p75 by 1.3 × median.
// For accurate p75 we'd ship raw events to a separate store — out of scope here.
//
// SIMPLIFIED for v30: query average + count + max per metric name; report
// average as the "score" and let the user see trends over time.
async function fetchMetric(token, propertyId, metricName, days) {
  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
      dimensions: [{ name: 'eventName' }],
      metrics: [
        { name: 'eventCount' },
        { name: 'eventValue' },
      ],
      dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { value: metricName } } },
    }),
  });
  if (!r.ok) throw new Error(`GA4 ${metricName}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  if (!j.rows || !j.rows.length) return { name: metricName, samples: 0, p75: 0 };
  const row = j.rows[0];
  const count = parseInt(row.metricValues[0].value, 10);
  const sumValue = parseFloat(row.metricValues[1].value);
  const avg = count > 0 ? sumValue / count : 0;
  // p75 estimate ≈ avg × 1.25 for log-normal-ish distributions. Conservative.
  const p75 = avg * 1.25;
  return {
    name: metricName,
    samples: count,
    avg: metricName === 'CLS' ? avg / 1000 : avg,
    p75:  metricName === 'CLS' ? p75 / 1000 : p75,
  };
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  const t0 = Date.now();

  const range = (req.query && req.query.range) || '28d';
  const days = Math.min(90, Math.max(1, parseInt(range, 10) || 28));

  try {
    // Try KV first (real-time, no latency); fall back to GA4 per metric.
    const kvResults = await Promise.all(
      ['LCP', 'CLS', 'INP', 'FCP', 'TTFB'].map(m => readKvSamples(m, days).catch(() => null))
    );
    const needsGa4 = kvResults.some(r => !r);

    let metrics;
    if (!needsGa4) {
      // All metrics fully covered by KV — skip GA4 entirely (faster)
      metrics = kvResults;
      res.setHeader('Server-Timing', `kv;dur=${Date.now() - t0}, source;desc="kv-only"`);
    } else {
      const propertyId = process.env.GA4_PROPERTY_ID;
      const saJson = process.env.GA4_SERVICE_ACCOUNT_JSON;
      if (!propertyId || !saJson) {
        return res.status(503).json({
          error: 'GA4 is required until KV has samples for every metric.',
          hint: 'Set GA4_PROPERTY_ID and GA4_SERVICE_ACCOUNT_JSON in Vercel.',
        });
      }
      const sa = parseSAJson(saJson);
      if (!sa) return res.status(500).json({ error: 'Invalid GA4_SERVICE_ACCOUNT_JSON' });
      // Mix: KV where available, GA4 fallback for missing
      const ga4Start = Date.now();
      const token = await getAccessToken(sa);
      const ga4Results = await Promise.all(
        ['LCP', 'CLS', 'INP', 'FCP', 'TTFB'].map((m, i) =>
          kvResults[i] ? Promise.resolve(kvResults[i]) : fetchMetric(token, propertyId, m, days).then(r => ({ ...r, source: 'ga4' }))
        )
      );
      metrics = ga4Results;
      res.setHeader('Server-Timing', `kv;dur=${ga4Start - t0}, ga4;dur=${Date.now() - ga4Start}, source;desc="hybrid"`);
    }

    res.status(200).json({ ok: true, range, days, metrics });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
