/**
 * GET /api/admin/push-stats - aggregate Web Push subscriber statistics.
 *
 * Individual endpoints and keys are never returned.
 */
import { requireAdmin } from './_auth.js';
import { loadSubscriptions, pushStorageAvailable } from '../push/_store.js';

function classify(ua) {
  if (!ua) return '(unknown)';
  const value = ua.toLowerCase();
  if (/edg\b|edge/.test(value)) return 'Edge';
  if (/opr\/|opera/.test(value)) return 'Opera';
  if (/firefox/.test(value)) return 'Firefox';
  if (/chrome|chromium/.test(value)) {
    return /android/.test(value) ? 'Chrome Android' : 'Chrome Desktop';
  }
  if (/safari/.test(value)) {
    return /iphone|ipad|ipod/.test(value) ? 'Safari iOS' : 'Safari macOS';
  }
  return 'Other';
}

function endpointHost(endpoint) {
  try { return new URL(endpoint).host; } catch (e) { return '(invalid)'; }
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!pushStorageAvailable()) {
    return res.status(503).json({ error: 'Private push storage is not configured' });
  }

  let subs;
  try {
    subs = await loadSubscriptions();
  } catch (e) {
    return res.status(503).json({ error: 'Push subscription storage unavailable' });
  }

  const byBrowser = {};
  const byHost = {};
  let oldest = Infinity;
  let newest = 0;
  for (const sub of subs) {
    const browser = classify(sub.ua || '');
    byBrowser[browser] = (byBrowser[browser] || 0) + 1;
    const host = endpointHost(sub.endpoint || '');
    byHost[host] = (byHost[host] || 0) + 1;
    const timestamp = Date.parse(sub.ts || '');
    if (!Number.isNaN(timestamp)) {
      oldest = Math.min(oldest, timestamp);
      newest = Math.max(newest, timestamp);
    }
  }

  const now = Date.now();
  const day = 86400_000;
  const buckets = { 'last 7d': 0, 'last 30d': 0, 'last 90d': 0, older: 0 };
  for (const sub of subs) {
    const timestamp = Date.parse(sub.ts || '');
    if (Number.isNaN(timestamp)) {
      buckets.older++;
      continue;
    }
    const age = (now - timestamp) / day;
    if (age <= 7) buckets['last 7d']++;
    else if (age <= 30) buckets['last 30d']++;
    else if (age <= 90) buckets['last 90d']++;
    else buckets.older++;
  }

  const top = (values, limit) =>
    Object.entries(values)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([key, count]) => ({ key, count }));

  return res.status(200).json({
    ok: true,
    source: 'kv',
    count: subs.length,
    oldest_iso: Number.isFinite(oldest) ? new Date(oldest).toISOString() : null,
    newest_iso: newest ? new Date(newest).toISOString() : null,
    by_browser: top(byBrowser, 8),
    by_push_host: top(byHost, 6),
    by_age: Object.entries(buckets).map(([key, count]) => ({ key, count })),
  });
}
