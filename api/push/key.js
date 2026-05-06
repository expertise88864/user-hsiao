/**
 * GET /api/push/key — returns the VAPID public key as JSON.
 *
 * Public endpoint (no auth) — needed by browsers to subscribe.
 * If VAPID_PUBLIC_KEY env var is missing, returns 503 so the client knows
 * push isn't enabled and hides the subscribe button.
 *
 * Cached for 1 hour at the edge — the key changes only when admin rotates it.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(503).json({ error: 'VAPID not configured' });
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.status(200).json({ key });
}
