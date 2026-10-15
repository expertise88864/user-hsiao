/**
 * Exam question-bank session helpers (Node runtime only — uses `crypto`).
 *
 * The site owner sets one shared password in the Vercel env var EXAM_PASSWORD.
 * A successful /api/exam/login sets the HttpOnly cookie `hs_exam_session` =
 * `<expiry-ms>.<hmac>`, where the HMAC (SHA-256, keyed by EXAM_PASSWORD) covers
 * `exam:<expiry-ms>`. Changing the password therefore invalidates every session.
 * Without EXAM_PASSWORD nothing verifies (fail closed).
 */
import crypto from 'crypto';

export const EXAM_COOKIE = 'hs_exam_session';
export const EXAM_SESSION_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days

function sign(exp, secret) {
  return crypto.createHmac('sha256', secret).update(`exam:${exp}`).digest('hex');
}

export function examSecret() {
  const secret = process.env.EXAM_PASSWORD;
  return typeof secret === 'string' && secret.length > 0 ? secret : null;
}

export function makeExamToken(secret, now = Date.now()) {
  const exp = now + EXAM_SESSION_MS;
  return `${exp}.${sign(exp, secret)}`;
}

export function verifyExamToken(token, secret, now = Date.now()) {
  if (!token || !secret) return false;
  const parts = String(token).split('.');
  if (parts.length !== 2 || !/^\d{13}$/.test(parts[0]) || !/^[0-9a-f]{64}$/.test(parts[1])) return false;
  const exp = Number(parts[0]);
  if (exp <= now || exp > now + EXAM_SESSION_MS) return false;
  const expected = Buffer.from(sign(exp, secret), 'hex');
  return crypto.timingSafeEqual(Buffer.from(parts[1], 'hex'), expected);
}

export function examTokenFromReq(req) {
  const header = (req.headers && req.headers.cookie) || '';
  const m = String(header).match(/(?:^|;\s*)hs_exam_session=([^;]+)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch (e) { return null; }
}

export function isExamSignedIn(req) {
  return verifyExamToken(examTokenFromReq(req), examSecret());
}

export function examCookie(token) {
  return [`${EXAM_COOKIE}=${encodeURIComponent(token)}`, 'HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/',
    `Max-Age=${Math.floor(EXAM_SESSION_MS / 1000)}`].join('; ');
}

export function clearedExamCookie() {
  return `${EXAM_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

// Only same-site /exam pages (optionally a question anchor) are valid redirect
// targets, so the login form cannot be used as an open redirect.
export function safeNext(value) {
  const next = typeof value === 'string' ? value : '';
  return /^\/exam(?:\/[a-z0-9-]+)?(?:#q-\d{1,5})?$/.test(next) ? next : '/exam';
}

// Login and logout are plain form POSTs from /exam/login. Refuse cross-site
// submissions (no forced logout or login from another site). Browsers send
// Sec-Fetch-Site; older ones send Origin; requests with neither are refused.
export function isSameOriginPost(req) {
  const h = req.headers || {};
  const site = h['sec-fetch-site'];
  if (site) return site === 'same-origin';
  const origin = h.origin;
  return Boolean(origin && h.host && origin === `https://${h.host}`);
}

export function formBody(req) {
  const body = req.body;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body;
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : (typeof body === 'string' ? body : '');
  if (!text) return {};
  try { return Object.fromEntries(new URLSearchParams(text)); } catch (e) { return {}; }
}
