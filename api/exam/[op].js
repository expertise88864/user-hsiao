/**
 * Dispatcher for the exam question-bank endpoint.
 *
 * Vercel Hobby caps Serverless Functions at 12 per deployment, so the exam endpoints
 * share this one function (same pattern as api/admin/[op].js):
 *
 *   GET /api/exam/data → api/_exam_data.js (public since 2026-11-18)
 *
 * The shared-password login and logout (/api/exam/login, /api/exam/logout) were removed
 * when the owner opened the bank; those addresses now answer 404.
 * The handler is imported lazily so an unknown op never parses the question bank.
 */
const HANDLERS = {
  data: () => import('../_exam_data.js'),
};

export default async function handler(req, res) {
  const op = req.query && typeof req.query.op === 'string' ? req.query.op : '';
  const load = Object.prototype.hasOwnProperty.call(HANDLERS, op) ? HANDLERS[op] : null;
  if (!load) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ error: 'not found' });
  }
  const mod = await load();
  return mod.default(req, res);
}
