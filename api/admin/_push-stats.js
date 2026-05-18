/**
 * GET /api/admin/push-stats — count + recency for Web Push subscribers.
 *
 * Reads the same KV key (`push:subscribers`) that POST /api/push/subscribe
 * writes to. Avoids exposing individual endpoints / keys (those are
 * secrets — a leak would let an attacker push notifications as us);
 * returns only aggregate counters and an anonymised browser breakdown.
 *
 * Falls back to the GitHub-blob backing (assets/push-subscribers.json)
 * if KV isn't configured.
 */
import { requireAdmin } from './_auth.js';
import { ghGetFile } from './_auth.js';
import { kvAvailable, kvGetJSON } from '../_kv.js';

const KV_KEY = 'push:subscribers';
const SUBSCRIBERS_PATH = 'assets/push-subscribers.json';

async function loadSubs() {
  if (kvAvailable()) {
    const subs = await kvGetJSON(KV_KEY);
    return { subs: Array.isArray(subs) ? subs : [], source: 'kv' };
  }
  const file = await ghGetFile(SUBSCRIBERS_PATH);
  if (!file) return { subs: [], source: 'gh' };
  try {
    const arr = JSON.parse(file.content);
    return { subs: Array.isArray(arr) ? arr : [], source: 'gh' };
  } catch (e) { return { subs: [], source: 'gh' }; }
}

function classify(ua) {
  if (!ua) return '(unknown)';
  const u = ua.toLowerCase();
  // Order matters: edge before chrome, opera before chrome, etc.
  if (/edg\b|edge/.test(u)) return 'Edge';
  if (/opr\/|opera/.test(u)) return 'Opera';
  if (/firefox/.test(u)) return 'Firefox';
  if (/chrome|chromium/.test(u)) {
    if (/android/.test(u)) return 'Chrome Android';
    return 'Chrome Desktop';
  }
  if (/safari/.test(u)) {
    if (/iphone|ipad|ipod/.test(u)) return 'Safari iOS';
    return 'Safari macOS';
  }
  return 'Other';
}

function endpointHost(endpoint) {
  try { return new URL(endpoint).host; } catch (e) { return '(invalid)'; }
}

export default async function handler(req, res) {
  if (!(await requireAdmin(req, res))) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { subs, source } = await loadSubs();

  const byBrowser = {};
  const byHost = {};
  let oldest = Infinity, newest = 0;
  for (const s of subs) {
    const cls = classify(s.ua || '');
    byBrowser[cls] = (byBrowser[cls] || 0) + 1;
    const host = endpointHost(s.endpoint || '');
    byHost[host] = (byHost[host] || 0) + 1;
    if (s.ts) {
      const t = Date.parse(s.ts);
      if (!isNaN(t)) {
        if (t < oldest) oldest = t;
        if (t > newest) newest = t;
      }
    }
  }
  const topN = (obj, n = 6) =>
    Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([key, count]) => ({ key, count }));

  // Recency buckets (relative to now)
  const now = Date.now();
  const DAY = 86400_000;
  const buckets = { 'last 7d': 0, 'last 30d': 0, 'last 90d': 0, 'older': 0 };
  for (const s of subs) {
    if (!s.ts) { buckets.older++; continue; }
    const age = (now - Date.parse(s.ts)) / DAY;
    if (age <= 7) buckets['last 7d']++;
    else if (age <= 30) buckets['last 30d']++;
    else if (age <= 90) buckets['last 90d']++;
    else buckets.older++;
  }

  res.status(200).json({
    ok: true,
    source,
    count: subs.length,
    oldest_iso: isFinite(oldest) ? new Date(oldest).toISOString() : null,
    newest_iso: newest ? new Date(newest).toISOString() : null,
    by_browser: topN(byBrowser, 8),
    by_push_host: topN(byHost, 6),
    by_age: Object.entries(buckets).map(([key, count]) => ({ key, count })),
  });
}
