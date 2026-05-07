/**
 * Single-function dispatcher for /api/push/* endpoints.
 *
 * Catches /api/push/key, /api/push/subscribe, /api/push/send and routes
 * to the matching `_<op>.js` handler. Underscore-prefixed handlers are
 * NOT counted by Vercel as separate Serverless Functions, so the total
 * push impact drops from 3 functions to 1.
 */

const HANDLERS = {
  'key':       () => import('./_key.js'),
  'subscribe': () => import('./_subscribe.js'),
  'send':      () => import('./_send.js'),
};

export default async function handler(req, res) {
  const op = (req.query && req.query.op) || '';
  const loader = HANDLERS[op];
  if (!loader) {
    return res.status(404).json({ error: `Unknown push op: ${op}`, available: Object.keys(HANDLERS) });
  }
  try {
    const mod = await loader();
    return mod.default(req, res);
  } catch (e) {
    return res.status(500).json({ error: `Dispatcher failed for op=${op}: ${e.message || e}` });
  }
}
