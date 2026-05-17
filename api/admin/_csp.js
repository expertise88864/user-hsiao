/**
 * GET  /api/admin/csp                 — list last 200 CSP violations from KV
 * POST /api/admin/csp?action=clear    — wipe the list
 *
 * Browsers post CSP violation reports to /api/csp-report; that endpoint
 * `console.log`s to Vercel function logs AND pushes the compacted report
 * to KV list `csp:reports` (cap 200). This endpoint reads it back for
 * the admin dashboard so you can spot policy regressions without
 * trawling raw logs.
 *
 * Each report has shape:
 *   { blocked, effective, violated, docUri, original (200), sourceFile,
 *     line, sample (80), ua (80), ts }
 *
 * Aggregations returned:
 *   - by violated-directive (script-src 'self' = 17 reports, ...)
 *   - by blocked-uri host
 *   - by source-file
 * Plus the raw list so the dashboard can render a table.
 */
import { requireAdmin } from './_auth.js';
import { kvAvailable, kvGet } from '../_kv.js';

const KEY = 'csp:reports';
const MAX_LEN = 200;

async function lrangeAll() {
  // _kv.js exposes kvGet/kvSet (string keys) but not lrange. Inline minimal
  // Upstash call here so we don't bloat the shared adapter for one consumer.
  if (!kvAvailable()) return [];
  const url = process.env.KV_REST_API_URL;
  const tok = process.env.KV_REST_API_TOKEN;
  try {
    const r = await fetch(`${url}/lrange/${encodeURIComponent(KEY)}/0/${MAX_LEN - 1}`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    if (!r.ok) return [];
    const body = await r.json();
    const arr = body && body.result;
    if (!Array.isArray(arr)) return [];
    return arr.map((s) => {
      try { return JSON.parse(s); } catch (e) { return { raw: s }; }
    });
  } catch (e) { return []; }
}

async function clearList() {
  if (!kvAvailable()) return false;
  const url = process.env.KV_REST_API_URL;
  const tok = process.env.KV_REST_API_TOKEN;
  try {
    await fetch(`${url}/del/${encodeURIComponent(KEY)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}` },
    });
    return true;
  } catch (e) { return false; }
}

function aggregate(reports) {
  const byDirective = {};
  const byBlockedHost = {};
  const bySource = {};
  for (const r of reports) {
    const d = r.violated || r.effective || '(unknown)';
    byDirective[d] = (byDirective[d] || 0) + 1;
    const u = r.blocked || '';
    let host = '(inline / eval / data:)';
    try {
      if (u && /^https?:/.test(u)) host = new URL(u).host;
      else if (u && u !== 'self') host = u;
    } catch (e) { host = u || '(unknown)'; }
    byBlockedHost[host] = (byBlockedHost[host] || 0) + 1;
    const s = (r.sourceFile || '').replace(/^https?:\/\/[^/]+/, '') || '(no source)';
    bySource[s] = (bySource[s] || 0) + 1;
  }
  const topN = (obj, n = 10) =>
    Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([key, count]) => ({ key, count }));
  return {
    by_directive: topN(byDirective),
    by_blocked_host: topN(byBlockedHost),
    by_source: topN(bySource),
  };
}

export default async function handler(req, res) {
  if (!(await requireAdmin(req, res))) return;

  if (req.method === 'POST' && (req.query.action === 'clear' || (req.body && req.body.action === 'clear'))) {
    const ok = await clearList();
    return res.status(200).json({ ok, cleared: true });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!kvAvailable()) {
    return res.status(200).json({
      ok: true,
      kv: false,
      message: 'KV not configured — CSP reports go to Vercel function logs only.',
      reports: [],
      stats: { by_directive: [], by_blocked_host: [], by_source: [] },
    });
  }

  const reports = await lrangeAll();
  const stats = aggregate(reports);
  res.status(200).json({
    ok: true,
    kv: true,
    count: reports.length,
    reports,
    stats,
  });
}
