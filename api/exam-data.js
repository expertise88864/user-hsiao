/**
 * GET /api/exam-data — the exam question bank (questions, answers, explanations,
 * concept groups) for signed-in readers only.
 *
 *   ?check=1  → 204 when signed in (cheap status probe for page scripts)
 *   otherwise → 200 JSON bank
 *   401 when not signed in; 503 when EXAM_PASSWORD is not configured.
 *
 * Responses are never cacheable by shared caches, and never indexable.
 */
import { examSecret, isExamSignedIn } from './_exam_session.js';
import { EXAM_BANK_JSON } from './_exam_bank.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }
  if (!examSecret()) return res.status(503).json({ error: 'exam login is not configured' });
  if (!isExamSignedIn(req)) return res.status(401).json({ error: 'login required' });
  if (req.query && req.query.check) return res.status(204).end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).send(EXAM_BANK_JSON);
}
