/**
 * GET /api/exam/data — the exam question bank (questions, answers, explanations,
 * concept groups). Public since 2026-11-18 (owner: 「題庫公開」); before that it was
 * served only to readers signed in with a shared password.
 *
 *   ?check=1  → 204 (kept for pages cached before the bank was opened, which probe it)
 *   otherwise → 200 JSON bank
 *
 * exam.js asks for it with the site's asset version (?v=...), so a shared cache may keep
 * it; a new deployment serves the new bank under a new version.
 */
import { EXAM_BANK_JSON } from './_exam_bank.js';

export default function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=86400, stale-while-revalidate=86400');
  // The JSON itself is data for the exam pages, not a page to list in search results.
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.query && req.query.check) return res.status(204).end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).send(EXAM_BANK_JSON);
}
