/**
 * POST /api/exam/logout — clears the exam question-bank session on this device.
 */
import { clearedExamCookie, isSameOriginPost } from './_exam_session.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  if (!isSameOriginPost(req)) return res.status(403).end();
  res.setHeader('Set-Cookie', clearedExamCookie());
  res.statusCode = 303;
  res.setHeader('Location', '/exam/login?out=1');
  return res.end();
}
