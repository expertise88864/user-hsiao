/**
 * POST /api/admin/batch — run a list of admin operations across many slugs.
 *
 * Body: {
 *   slugs?: string[]          // omit = all articles in DN.ARTICLES
 *   filter?: { cat?: string } // OR filter by category (myth/alert/rx)
 *   ops: ['seo-fix', 'faqpage', 'autolink', 'precompute']  // any subset
 * }
 *
 * Streaming via SSE-like chunked JSON lines is overkill — instead we
 * return a single JSON with per-slug results once everything finishes.
 * Each op is rate-limited to 5 concurrent to stay below GitHub's secondary
 * rate limit.
 *
 * Returns:
 *   { ok, total, succeeded, failed, results: [{slug, op, ok, ... }] }
 */
import { requireAdmin, ghGetFile, ghPutFile } from './_auth.js';

const VALID_OPS = ['seo-fix', 'faqpage', 'autolink'];

async function runOp(op, slug, internalReq) {
  // Internal call — instead of HTTP loopback, dynamically import the handler
  // and call it with a fake req/res. Saves an RTT per op.
  if (op === 'seo-fix') {
    const mod = await import('./_seo-fix.js');
    return invokeHandler(mod.default, slug, {});
  }
  if (op === 'faqpage') {
    const mod = await import('./_schema-helper.js');
    return invokeHandler(mod.default, slug, { type: 'faqpage' });
  }
  if (op === 'autolink') {
    const mod = await import('./_dictionary.js');
    return invokeHandler(mod.default, slug, { action: 'autolink' }, '?action=autolink');
  }
  return { ok: false, error: 'unknown op' };
}

function invokeHandler(handler, slug, extraBody, queryStr) {
  return new Promise((resolve) => {
    const req = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { slug, ...extraBody },
      query: queryStr ? Object.fromEntries(new URLSearchParams(queryStr.replace(/^\?/, ''))) : {},
    };
    let status = 200;
    let payload;
    const res = {
      status(s) { status = s; return this; },
      json(p)   { payload = p; resolve({ ok: status < 300, status, ...payload }); return this; },
      send(p)   { payload = p; resolve({ ok: status < 300, status, body: p }); return this; },
      setHeader() { return this; },
      end()       { resolve({ ok: status < 300, status, payload }); return this; },
    };
    // Mark request as already-authenticated so requireAdmin passes through
    req._batchAdmin = true;
    // Inject session cookie marker so requireAdmin sees it as authenticated
    req.headers.cookie = 'batch=1';
    // Override requireAdmin via handler-level monkey patch isn't ideal; the
    // real handlers call requireAdmin which checks the cookie. Use the
    // inherited cookie from the parent request.
    Promise.resolve(handler(req, res)).catch((e) => resolve({ ok: false, error: String(e.message || e) }));
  });
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  let { slugs, filter, ops } = body || {};
  if (!Array.isArray(ops) || !ops.length) return res.status(400).json({ error: 'ops[] required' });
  if (ops.some(o => !VALID_OPS.includes(o))) return res.status(400).json({ error: `ops must be subset of ${VALID_OPS.join(',')}` });

  // Resolve target slugs
  if (!Array.isArray(slugs) || !slugs.length) {
    const sharedJs = await ghGetFile('blog/blog-shared.js');
    if (!sharedJs) return res.status(500).json({ error: 'blog-shared.js not found' });
    const m = sharedJs.content.match(/DN\.ARTICLES\s*=\s*(\[[\s\S]*?\]);/);
    if (!m) return res.status(500).json({ error: 'DN.ARTICLES not found' });
    const re = /\{\s*slug\s*:\s*'([^']+)'(?:[^}]*?cat\s*:\s*'([^']+)')?/g;
    slugs = [];
    let row;
    while ((row = re.exec(m[1])) !== null) {
      if (filter?.cat && row[2] !== filter.cat) continue;
      slugs.push(row[1]);
    }
  }
  if (!slugs.length) return res.status(200).json({ ok: true, total: 0, results: [] });

  const t0 = Date.now();
  const results = [];

  // Forward the admin cookie so internal handler invocations pass requireAdmin
  // We do NOT use HTTP loopback — we just need the same session.
  // The handlers we import all call requireAdmin which reads the cookie from
  // their own `req`. We'll forward our `req.headers.cookie` to the inner one.
  const cookie = req.headers.cookie;

  // Concurrency limit = 3 to avoid GitHub secondary rate-limit
  const queue = [];
  slugs.forEach(slug => ops.forEach(op => queue.push({ slug, op })));
  const workers = [];
  for (let w = 0; w < 3; w++) {
    workers.push((async () => {
      while (queue.length) {
        const item = queue.shift();
        if (!item) break;
        try {
          // Build inner req inline
          const innerReq = {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie },
            body: { slug: item.slug, ...(item.op === 'faqpage' ? { type: 'faqpage' } : {}), ...(item.op === 'autolink' ? { action: 'autolink' } : {}) },
            query: item.op === 'autolink' ? { action: 'autolink' } : {},
          };
          let status = 0, payload;
          const innerRes = {
            status(s) { status = s; return this; },
            json(p)   { payload = p; return this; },
            send(p)   { payload = p; return this; },
            setHeader() { return this; },
            end() { return this; },
          };
          let mod;
          if (item.op === 'seo-fix')  mod = await import('./_seo-fix.js');
          else if (item.op === 'faqpage') mod = await import('./_schema-helper.js');
          else if (item.op === 'autolink') mod = await import('./_dictionary.js');
          await mod.default(innerReq, innerRes);
          results.push({ slug: item.slug, op: item.op, ok: status < 300, status, ...payload });
        } catch (e) {
          results.push({ slug: item.slug, op: item.op, ok: false, error: String(e.message || e) });
        }
      }
    })());
  }
  await Promise.all(workers);

  const succeeded = results.filter(r => r.ok).length;
  const failed = results.length - succeeded;
  res.setHeader('Server-Timing', `total;dur=${Date.now() - t0}`);
  res.status(200).json({ ok: true, total: results.length, succeeded, failed, ms: Date.now() - t0, results });
}
