/**
 * POST /api/errors — sink for client-side JS runtime errors.
 *
 * Receives:
 *   { type: 'error' | 'unhandledrejection',
 *     message: string,
 *     stack?: string,
 *     url: string,
 *     line?: number,
 *     col?: number,
 *     ua: string,
 *     ts: number }
 *
 * Logs to Vercel stdout (captured in deployment logs). No persistent
 * storage — relies on log retention. For long-term tracking, route to
 * Sentry / Logtail / similar via env var SENTRY_DSN.
 *
 * Rate-limit: 60 errors/min/IP (same-tab burst protection). Beyond that,
 * silently drops to avoid log spam attacks.
 */

const RL = new Map();
const RL_MAX = 60;
const RL_WINDOW_MS = 60 * 1000;

function ipOf(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.connection?.remoteAddress || 'unknown';
}

function checkRl(key) {
  const now = Date.now();
  let e = RL.get(key);
  if (!e || now - e.t > RL_WINDOW_MS) e = { c: 0, t: now };
  e.c++;
  RL.set(key, e);
  // Periodic cleanup
  if (RL.size > 1000) {
    for (const [k, v] of RL) if (now - v.t > RL_WINDOW_MS * 2) RL.delete(k);
  }
  return e.c <= RL_MAX;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Allow', 'POST');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }
  const ip = ipOf(req);
  if (!checkRl('ip:' + ip)) {
    return res.status(429).json({ error: 'rate limited' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'invalid json' }); }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'invalid body' });
  }

  // Sanitize/cap fields to bound log volume
  const safe = {
    type: String(body.type || 'unknown').slice(0, 32),
    message: String(body.message || '').slice(0, 500),
    stack: String(body.stack || '').slice(0, 2000),
    url: String(body.url || '').slice(0, 500),
    line: typeof body.line === 'number' ? body.line : null,
    col: typeof body.col === 'number' ? body.col : null,
    ua: String(body.ua || '').slice(0, 300),
    ts: typeof body.ts === 'number' ? body.ts : Date.now(),
    ip: ip.slice(0, 64),
  };

  // Log to Vercel stdout. Structured JSON so log queries can filter.
  console.error('[client-error]', JSON.stringify(safe));

  // v37.35 — also persist to KV list `errors:reports` (cap 200) so the
  // admin dashboard can show recent JS errors without trawling Vercel logs.
  // S-03: AWAIT so the serverless function doesn't get frozen/terminated
  // after res.end() with the KV write still pending (was under-persisting).
  await persistToKv(safe).catch(() => {});

  // Always 204 — don't echo internal state to client.
  return res.status(204).end();
}

// ── KV persistence (mirrors api/csp-report.js pattern) ──
const MAX_KV_ERRORS = 200;
const KV_LIST_KEY = 'errors:reports';

async function persistToKv(safe) {
  const url = process.env.KV_REST_API_URL;
  const tok = process.env.KV_REST_API_TOKEN;
  if (!url || !tok) return;
  const headers = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };
  const payload = JSON.stringify(safe);
  await fetch(`${url}/lpush/${encodeURIComponent(KV_LIST_KEY)}/${encodeURIComponent(payload)}`,
              { method: 'POST', headers, signal: AbortSignal.timeout(1200) }).catch(() => {});
  await fetch(`${url}/ltrim/${encodeURIComponent(KV_LIST_KEY)}/0/${MAX_KV_ERRORS - 1}`,
              { method: 'POST', headers, signal: AbortSignal.timeout(1200) }).catch(() => {});
}

export const config = { runtime: 'nodejs' };
