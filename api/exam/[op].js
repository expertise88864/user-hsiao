/**
 * Single-function dispatcher for the exam question-bank endpoints.
 *
 * Vercel Hobby caps Serverless Functions at 12 per deployment, so login,
 * logout and data share this one function (same pattern as api/admin/[op].js):
 *
 *   POST /api/exam/login   → api/_exam_login.js
 *   POST /api/exam/logout  → api/_exam_logout.js
 *   GET  /api/exam/data    → api/_exam_data.js   (signed-in readers only)
 *
 * Handlers are imported lazily so login/logout never parse the question bank.
 */
const HANDLERS = {
  login: () => import('../_exam_login.js'),
  logout: () => import('../_exam_logout.js'),
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
