/**
 * GET /api/ab-config — public read of active A/B test configurations.
 *
 * Forwards to /api/admin/ab-config GET handler so we keep one source of
 * truth. Cached at edge for 60s.
 *
 * Client (blog-shared.js) calls this on every page load to apply variant
 * swaps for any test whose selector matches an element on the page.
 */
import handler from './admin/_ab-config.js';

export default async function (req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  // Strip cookie so the inner handler treats it as anonymous (returns active-only)
  const safeReq = { ...req, headers: { ...req.headers, cookie: '' } };
  return handler(safeReq, res);
}
