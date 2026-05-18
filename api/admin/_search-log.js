/**
 * GET  /api/admin/search-log              — top searched queries (last 1000)
 * POST /api/admin/search-log?action=clear — wipe the list
 *
 * The author uses this to spot content gaps: terms patients are
 * searching but no article covers. See /api/search-log for the
 * collection side + privacy model. Returns aggregates only — never
 * individual visitor sessions.
 */
import { requireAdmin } from './_auth.js';
import { kvAvailable } from '../_kv.js';

const KEY = 'search:queries';
const MAX_LEN = 1000;

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
      try { return JSON.parse(s); } catch (e) { return null; }
    }).filter(Boolean);
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

function aggregate(entries) {
  // Group by lowercased + trimmed query so case-variants collapse.
  const byQuery = {};
  const byDay = {};
  for (const e of entries) {
    const q = (e.q || '').trim().toLowerCase();
    if (!q) continue;
    byQuery[q] = (byQuery[q] || 0) + 1;
    if (e.t) {
      const day = new Date(e.t).toISOString().slice(0, 10);
      byDay[day] = (byDay[day] || 0) + 1;
    }
  }
  const topN = (obj, n = 40) =>
    Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([key, count]) => ({ key, count }));
  return {
    by_query: topN(byQuery, 50),
    by_day: Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, count]) => ({ key, count })),
  };
}

export default async function handler(req, res) {
  if (!(await requireAdmin(req, res))) return;

  if (req.method === 'POST' && (req.query.action === 'clear' ||
      (req.body && req.body.action === 'clear'))) {
    const ok = await clearList();
    return res.status(200).json({ ok, cleared: true });
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!kvAvailable()) {
    return res.status(200).json({
      ok: true, kv: false,
      message: 'KV not configured — search queries are not logged.',
      count: 0, stats: { by_query: [], by_day: [] },
    });
  }

  const enabled = process.env.SEARCH_LOG_ENABLED === '1';
  const entries = await lrangeAll();
  const stats = aggregate(entries);
  res.status(200).json({
    ok: true,
    kv: true,
    enabled,
    count: entries.length,
    note: enabled
      ? null
      : 'SEARCH_LOG_ENABLED env var is not "1" — collection is OFF. Existing entries below are from a previous opt-in window.',
    stats,
  });
}
