/**
 * POST /api/search-log — capture in-site search queries for content-gap analysis.
 *
 * The Cmd+K / quick-find input in blog-shared.js calls this whenever
 * a user finishes typing a query of length >= 2. The author uses the
 * resulting aggregated list (via /api/admin/search-log) to spot topics
 * patients are searching for but no article covers yet.
 *
 * PRIVACY MODEL:
 *   - Opt-in via env var `SEARCH_LOG_ENABLED=1`. Default off; the
 *     endpoint returns 204 without persisting anything.
 *   - We log ONLY the query string and a millisecond timestamp.
 *     NO IP, NO User-Agent, NO cookie, NO session token.
 *   - Queries are truncated to 80 chars (length cap) and bounded to
 *     [2..80] chars (very short = no signal; very long = abuse).
 *   - 30-day rolling window via LTRIM(0, MAX_KV-1) and per-entry ts.
 *   - Author dashboard shows aggregates only (top-N counts), never
 *     a chronological log of individual visitors.
 *
 * Rate-limited to 30/min/IP via api/_rate_limit.js (shared bucket).
 */
import { rateLimitOk, sendRateLimit } from './_rate_limit.js';

const MAX_KV_ENTRIES = 1000;
const KV_LIST_KEY = 'search:queries';
const MAX_QUERY_LEN = 80;
const MIN_QUERY_LEN = 2;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Allow', 'POST');

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  // Always rate-limit, even when logging is disabled, to avoid being a
  // black hole that absorbs attacker traffic for free.
  if (!rateLimitOk(req, { key: 'search-log', max: 30, windowMs: 60_000 })) {
    return sendRateLimit(res, 60);
  }
  // Logging is opt-in. Returning 204 keeps the client code identical
  // regardless of whether the feature is enabled in this deploy.
  if (process.env.SEARCH_LOG_ENABLED !== '1') {
    return res.status(204).end();
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { return res.status(204).end(); }
  }
  const raw = String((body && body.q) || '').slice(0, MAX_QUERY_LEN).trim();
  if (raw.length < MIN_QUERY_LEN) return res.status(204).end();

  const payload = JSON.stringify({ q: raw, t: Date.now() });
  await persistToKv(payload).catch(() => {});
  return res.status(204).end();
}

async function persistToKv(payload) {
  const url = process.env.KV_REST_API_URL;
  const tok = process.env.KV_REST_API_TOKEN;
  if (!url || !tok) return;
  const headers = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };
  await fetch(`${url}/lpush/${encodeURIComponent(KV_LIST_KEY)}/${encodeURIComponent(payload)}`,
              { method: 'POST', headers }).catch(() => {});
  await fetch(`${url}/ltrim/${encodeURIComponent(KV_LIST_KEY)}/0/${MAX_KV_ENTRIES - 1}`,
              { method: 'POST', headers }).catch(() => {});
}

export const config = { runtime: 'nodejs' };
