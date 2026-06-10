import { makeOfflineSaveToken, requireAdmin } from './_auth.js';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const slug = String((body && body.slug) || '');
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: 'Invalid slug' });
  }

  const token = makeOfflineSaveToken(slug);
  if (!token) return res.status(500).json({ error: 'Unable to create offline token' });
  return res.status(200).json({
    token,
    expiresAt: Number(token.split('.')[0]),
    expiresIn: 28800,
  });
}
