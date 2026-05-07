/**
 * GET /api/events — Server-Sent Events stream of admin-relevant events.
 *
 * Authenticated (admin cookie required). Streams real-time:
 *   - new article published     (emit when /api/admin/new succeeds)
 *   - new push subscriber       (emit when /api/push/subscribe succeeds)
 *   - new SEO violation         (emit by /api/csp-report)
 *   - heartbeat every 25 sec    (keeps connection alive past proxy timeouts)
 *
 * Events are kept in a tiny KV ring buffer (cwv:events list, last 50);
 * client polls KV via the SSE stream every 5 sec rather than maintaining
 * a real pub/sub channel. Vercel serverless can't hold a persistent
 * connection forever — Vercel cuts at 10 min — so the client auto-reconnects.
 *
 * Lower complexity than WebTransport while serving the same UX:
 * "real-time admin notifications without polling /api/admin/list".
 *
 * Use:
 *   const es = new EventSource('/api/events', { withCredentials: true });
 *   es.addEventListener('new_article', e => { ... });
 */
import { requireAdmin } from './admin/_auth.js';
import { kvAvailable, kvGet } from './_kv.js';

export const config = { runtime: 'nodejs', maxDuration: 600 };

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  let lastSeenIdx = -1;
  // Quick read so client can replay missed events from the last few seconds
  if (kvAvailable()) {
    try {
      const raw = await kvGet('events:cursor');
      lastSeenIdx = parseInt(raw || '-1', 10);
    } catch (e) { /* ignore */ }
  }

  // Send a hello so EventSource fires the 'open' event
  res.write(`event: hello\ndata: {"ts":${Date.now()},"cursor":${lastSeenIdx}}\n\n`);

  let alive = true;
  req.on('close', () => { alive = false; });

  // Heartbeat every 25 seconds (Vercel's proxy idle timeout is 30s)
  const heartbeat = setInterval(() => {
    if (!alive) return;
    res.write(`event: heartbeat\ndata: ${Date.now()}\n\n`);
  }, 25_000);

  // Poll KV ring buffer every 5 seconds for new events
  async function poll() {
    if (!alive || !kvAvailable()) return;
    try {
      const raw = await kvGet('events:list');
      let arr = [];
      if (raw) { try { arr = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) {} }
      if (Array.isArray(arr)) {
        const fresh = arr.filter(e => e.idx > lastSeenIdx);
        for (const ev of fresh) {
          res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
          lastSeenIdx = ev.idx;
        }
      }
    } catch (e) { /* skip */ }
  }
  const pollInterval = setInterval(poll, 5_000);

  // Auto-disconnect after 9 minutes (Vercel cuts at 10) — client reconnects
  setTimeout(() => {
    if (!alive) return;
    res.write(`event: bye\ndata: {"reason":"max-duration"}\n\n`);
    clearInterval(heartbeat);
    clearInterval(pollInterval);
    res.end();
  }, 9 * 60 * 1000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(pollInterval);
  });
}
