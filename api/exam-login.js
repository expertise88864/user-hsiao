/**
 * POST /api/exam-login — shared-password gate for the exam question bank.
 *
 * Form fields: `password`, `next` (an /exam path to return to). Always answers
 * with a 303 redirect: to `next` with the session cookie on success, otherwise
 * back to /exam/login with `error=wrong|rate|config`. Rate-limited per IP; the
 * comparison hashes both sides so neither length nor content leaks via timing.
 */
import crypto from 'crypto';
import { rateLimitOk } from './_rate_limit.js';
import { examSecret, makeExamToken, examCookie, safeNext, formBody, isSameOriginPost } from './_exam_session.js';

function redirect(res, location) {
  res.statusCode = 303;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

function sameDigest(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(405).end();
  }
  if (!isSameOriginPost(req)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(403).end();
  }
  const body = formBody(req);
  const next = safeNext(body.next);
  const back = code => redirect(res, `/exam/login?error=${code}&next=${encodeURIComponent(next)}`);
  const secret = examSecret();
  if (!secret) return back('config');
  if (!rateLimitOk(req, { key: 'exam-login', max: 8, windowMs: 10 * 60_000 })) return back('rate');
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password || !sameDigest(password, secret)) {
    await new Promise(r => setTimeout(r, 400));
    return back('wrong');
  }
  res.setHeader('Set-Cookie', examCookie(makeExamToken(secret)));
  return redirect(res, next);
}
