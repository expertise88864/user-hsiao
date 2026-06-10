/**
 * POST /api/cwv-ingest — receive Web Vitals beacons from blog-shared.js,
 * write rolling histograms to Vercel KV. The admin CWV dashboard reads
 * these directly so there's NO 24-48hr GA4 latency.
 *
 * Public endpoint (no auth) — called via navigator.sendBeacon when the
 * page becomes hidden. Rate-limited at the IP level by Vercel's default
 * DDoS protection.
 *
 * Body: { name: 'LCP'|'CLS'|'INP'|'FCP'|'TTFB', value: number, page?: string }
 *
 * Storage in KV (sliding window):
 *   key  `cwv:bucket:<name>:<minute>`  → ZSET of (value, count)
 *   key  `cwv:total:<name>:<day>`      → counter
 *   key  `cwv:samples:<name>`          → reservoir of last N samples for p75
 *
 * Simplified: we keep last-N reservoir (size 1000) per metric, rotated by
 * day. p75 computed at read time = sort + index.
 */
import { kvAvailable, kvPushTrimExpire } from './_kv.js';
import { rateLimitOk, sendRateLimit } from './_rate_limit.js';

const ALLOWED = new Set(['LCP', 'CLS', 'INP', 'FCP', 'TTFB']);
const MAX_SAMPLES = 1000;
const SAMPLE_TTL_DAYS = 30;
const SAMPLE_TTL_SECONDS = SAMPLE_TTL_DAYS * 86400;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Allow', 'POST');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  // v37.28 — rate-limit per IP: typical real users send 1 CWV beacon per
  // pageview (5 metrics fired close together). Cap at 30/min to absorb
  // multi-tab sessions while blocking flood abuse.
  if (!rateLimitOk(req, { key: 'cwv', max: 30, windowMs: 60_000 })) {
    return sendRateLimit(res, 60);
  }
  if (!kvAvailable()) {
    // Silently accept-and-drop if KV not configured (don't break the client)
    return res.status(200).json({ ok: true, source: 'noop' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { name, value, page } = body || {};
  if (!ALLOWED.has(name)) return res.status(400).json({ error: 'invalid metric name' });
  if (typeof value !== 'number' || !isFinite(value) || value < 0 || value > 60000) {
    return res.status(400).json({ error: 'invalid value' });
  }

  try {
    const key = `cwv:samples:v2:${name}`;
    const sample = { v: Math.round(value * 100) / 100, p: (page || '').slice(0, 80), t: Date.now() };
    const stored = await kvPushTrimExpire(
      key,
      JSON.stringify(sample),
      MAX_SAMPLES,
      SAMPLE_TTL_SECONDS
    );
    if (!stored) return res.status(503).json({ error: 'telemetry storage unavailable' });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
