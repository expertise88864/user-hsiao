/**
 * /api/admin/login — admin password gate
 *
 * Required Vercel env var:
 *   ADMIN_PASSWORD — the password (set in Vercel Dashboard → Project → Settings → Env Vars)
 *
 * On success, sets a signed httpOnly cookie `hs_admin_session` valid 8 hours.
 * Subsequent /api/admin/* routes verify this cookie before allowing edits.
 *
 * The "signature" is a HMAC of `admin-{expiry-ms}` using ADMIN_PASSWORD as the
 * secret. A valid cookie value is `<expiry-ms>.<sig>`. This is a simple
 * stateless session — no DB needed.
 */
import crypto from 'crypto';
import { rateLimitOk, sendRateLimit } from '../_rate_limit.js';

const SESSION_COOKIE = 'hs_admin_session';
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;  // 8 hours

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex').slice(0, 32);
}

export function makeSessionToken(secret) {
  const exp = Date.now() + SESSION_DURATION_MS;
  return `${exp}.${sign(String(exp), secret)}`;
}

export function verifySessionToken(token, secret) {
  if (!token || !secret) return false;
  const [expStr, sig] = token.split('.');
  const exp = parseInt(expStr, 10);
  if (!exp || exp < Date.now()) return false;
  const expectedSig = sign(String(exp), secret);
  // Timing-safe compare
  if (sig.length !== expectedSig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
}

export function getSessionFromReq(req) {
  const cookieHeader = req.headers.cookie || '';
  const m = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export default async function handler(req, res) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD env var not configured. Set it in Vercel Dashboard.' });
  }

  // DELETE = logout
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie',
      `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!rateLimitOk(req, { key: 'admin-login', max: 6, windowMs: 60_000 })) {
    return sendRateLimit(res, 60);
  }

  // Parse JSON body
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { password } = body || {};

  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }

  // Constant-time comparison
  const provided = Buffer.from(password);
  const expected = Buffer.from(adminPassword);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    // Add a small delay to discourage brute-force (still rate-limited by Vercel)
    await new Promise(r => setTimeout(r, 500));
    return res.status(401).json({ error: 'Invalid password' });
  }

  const token = makeSessionToken(adminPassword);
  const cookieOpts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}`,
  ].join('; ');
  res.setHeader('Set-Cookie', cookieOpts);
  return res.status(200).json({ ok: true });
}
