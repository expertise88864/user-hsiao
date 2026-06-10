/**
 * Admin auth helper — verifies the HMAC-signed session cookie set by
 * /api/admin/login. Throws 401 if invalid. Use as the first line of every
 * protected route.
 *
 * v31.5: GitHub helpers moved to ./_github.js (edge-runtime safe). This
 * file imports Node `crypto` and is therefore Node-only — Edge Functions
 * (og, csp-report, middleware) must NOT import from here.
 *
 * Re-exports getRepoConfig / ghGetFile / ghPutFile so existing admin routes
 * that import from './_auth.js' keep working without touching every file.
 */
import crypto from 'crypto';
export { getRepoConfig, ghGetFile, ghPutFile, ghCommitFiles } from './_github.js';

const SESSION_COOKIE = 'hs_admin_session';

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex').slice(0, 32);
}

function getSessionFromReq(req) {
  const cookieHeader = req.headers.cookie || '';
  const m = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function verifySessionToken(token, secret) {
  if (!token || !secret) return false;
  const [expStr, sig] = String(token).split('.');
  const exp = parseInt(expStr, 10);
  if (!exp || exp < Date.now()) return false;
  const expectedSig = sign(String(exp), secret);
  if (!sig || sig.length !== expectedSig.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
  } catch (e) { return false; }
}

export function isAdminRequest(req) {
  const secret = process.env.ADMIN_PASSWORD;
  return Boolean(secret && verifySessionToken(getSessionFromReq(req), secret));
}

export function makeOfflineSaveToken(slug, ttlMs = 8 * 60 * 60 * 1000) {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret || !/^[a-z0-9-]+$/.test(slug || '')) return null;
  const exp = Date.now() + ttlMs;
  return `${exp}.${slug}.${sign(`offline:${exp}:${slug}`, secret)}`;
}

export function verifyOfflineSaveToken(token, slug) {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret || !token || !/^[a-z0-9-]+$/.test(slug || '')) return false;
  const [expStr, tokenSlug, sig] = String(token).split('.');
  const exp = parseInt(expStr, 10);
  if (!exp || exp < Date.now() || tokenSlug !== slug) return false;
  const expectedSig = sign(`offline:${exp}:${slug}`, secret);
  if (!sig || sig.length !== expectedSig.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
  } catch (e) {
    return false;
  }
}

/**
 * Returns true if request is authenticated, otherwise sends 401 and returns false.
 * Usage:
 *   import { requireAdmin } from './_auth.js';
 *   if (!requireAdmin(req, res)) return;
 */
export function requireAdmin(req, res) {
  if (!process.env.ADMIN_PASSWORD) {
    res.status(500).json({ error: 'ADMIN_PASSWORD env var not configured' });
    return false;
  }
  if (!isAdminRequest(req)) {
    res.status(401).json({ error: 'Unauthorized — please login at /admin' });
    return false;
  }
  return true;
}
