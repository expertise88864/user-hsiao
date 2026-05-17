/**
 * GET  /api/admin/errors              — list last 200 client JS errors
 * POST /api/admin/errors?action=clear — wipe the list
 *
 * Browsers post unhandled errors / rejections to /api/errors via
 * DN.bindErrorReporting() in blog-shared.js. That endpoint logs to
 * Vercel stdout AND pushes the compacted record to KV list
 * `errors:reports` (cap 200). This endpoint reads it back for the
 * admin dashboard so production regressions surface without log diving.
 *
 * Each report has shape:
 *   { type, message, stack, url, line, col, ua, ts, ip }
 *
 * Aggregations returned:
 *   - by type (error vs unhandledrejection)
 *   - by message-prefix (first 80 chars after stripping line:col)
 *   - by URL (which page the error fired on)
 */
import { requireAdmin } from './_auth.js';
import { kvAvailable } from '../_kv.js';

const KEY = 'errors:reports';
const MAX_LEN = 200;

async function lrangeAll() {
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
  const byType = {};
  const byMessage = {};
  const byUrl = {};
  for (const r of reports) {
    const t = r.type || '(unknown)';
    byType[t] = (byType[t] || 0) + 1;
    // Strip "@line:col" trailing noise from the message for grouping.
    const m = (r.message || '').replace(/\s+at\s+.+$/g, '').slice(0, 80) || '(empty)';
    byMessage[m] = (byMessage[m] || 0) + 1;
    let u = r.url || '(no url)';
    try { u = new URL(u).pathname; } catch (e) { /* keep raw */ }
    byUrl[u] = (byUrl[u] || 0) + 1;
  }
  const topN = (obj, n = 10) =>
    Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([key, count]) => ({ key, count }));
  return {
    by_type: topN(byType),
    by_message: topN(byMessage),
    by_url: topN(byUrl),
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
      message: 'KV not configured — client errors go to Vercel function logs only.',
      reports: [],
      stats: { by_type: [], by_message: [], by_url: [] },
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
