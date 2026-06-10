/**
 * Shared in-memory rate limiter for public API endpoints.
 *
 * Container-scoped (each Vercel function container has its own Map).
 * Sufficient for accidental F5 spam and casual abuse; not a defence
 * against distributed attacks (use Vercel's WAF / Cloudflare for that).
 *
 * Usage:
 *   import { rateLimitOk } from './_rate_limit.js';
 *   if (!rateLimitOk(req, { key: 'csp-report', max: 20, windowMs: 60_000 })) {
 *     res.setHeader('Retry-After', '60');
 *     return res.status(429).json({ error: 'rate limited' });
 *   }
 */

const buckets = new Map();   // key: namespace:identity, value: { count, windowStart }

function identityOf(req) {
  // Public endpoints cannot trust an unverified cookie as an identity:
  // callers could rotate fake cookie values to bypass the limiter.
  const xff = req.headers['x-forwarded-for'];
  const ip = xff ? String(xff).split(',')[0].trim() : (req.connection?.remoteAddress || 'unknown');
  return 'ip:' + ip.slice(0, 64);
}

export function rateLimitOk(req, { key = 'default', max = 60, windowMs = 60_000 } = {}) {
  const id = identityOf(req);
  const bucket = key + ':' + id;
  const now = Date.now();
  let e = buckets.get(bucket);
  if (!e || now - e.windowStart > windowMs) {
    e = { count: 0, windowStart: now };
  }
  e.count++;
  buckets.set(bucket, e);
  // Periodic cleanup so Map doesn't grow unbounded
  if (buckets.size > 2000) {
    for (const [k, v] of buckets) {
      if (now - v.windowStart > windowMs * 2) buckets.delete(k);
    }
  }
  return e.count <= max;
}

/** Convenience: send 429 + Retry-After response */
export function sendRateLimit(res, retryAfterSec = 60) {
  res.setHeader('Retry-After', String(retryAfterSec));
  return res.status(429).json({ error: 'Too many requests — slow down' });
}
