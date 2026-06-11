/**
 * POST /api/admin/batch - run selected article maintenance operations.
 *
 * GitHub branch updates are serialized. Even writes to different files race
 * on the same branch ref, so parallel workers can lose with a stale head.
 */
import { requireAdmin, ghGetFile } from './_auth.js';

const VALID_OPS = ['seo-fix', 'faqpage', 'autolink'];
const VALID_CATEGORIES = new Set(['alert', 'rx', 'myth', 'notes', 'research']);
const MAX_TARGETS = 50;
const TRANSIENT_WRITE = /\b(?:409|422)\b|conflict|stale|branch (?:head|changed)|reference update|sha (?:mismatch|changed)/i;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function validateSlugs(slugs) {
  if (!Array.isArray(slugs)) return 'slugs must be an array';
  if (slugs.length > MAX_TARGETS) return `slugs cannot exceed ${MAX_TARGETS} items`;
  if (slugs.some(slug => typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug))) {
    return 'each slug must contain only lowercase letters, numbers, and hyphens';
  }
  return null;
}

async function invokeOperation(op, slug, cookie) {
  let module;
  if (op === 'seo-fix') module = await import('./_seo-fix.js');
  else if (op === 'faqpage') module = await import('./_schema-helper.js');
  else module = await import('./_dictionary.js');

  const innerReq = {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: {
      slug,
      ...(op === 'faqpage' ? { type: 'faqpage' } : {}),
      ...(op === 'autolink' ? { action: 'autolink' } : {}),
    },
    query: op === 'autolink' ? { action: 'autolink' } : {},
  };
  let status = 200;
  let payload = {};
  const innerRes = {
    status(value) { status = value; return this; },
    json(value) { payload = value; return this; },
    send(value) { payload = value; return this; },
    setHeader() { return this; },
    end() { return this; },
  };

  await module.default(innerReq, innerRes);
  const details = payload && typeof payload === 'object' ? payload : { body: payload };
  return { slug, op, ...details, ok: status < 300, status };
}

async function runWithRetry(op, slug, cookie) {
  let lastResult;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      lastResult = await invokeOperation(op, slug, cookie);
      const message = String(lastResult.error || '');
      if (lastResult.ok || !TRANSIENT_WRITE.test(`${lastResult.status} ${message}`)) return lastResult;
    } catch (e) {
      lastResult = { slug, op, ok: false, error: String(e.message || e) };
      if (!TRANSIENT_WRITE.test(lastResult.error)) return lastResult;
    }
    await sleep(250 * (attempt + 1));
  }
  return lastResult;
}

export { validateSlugs };

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  let { slugs, filter, ops } = body || {};
  if (!Array.isArray(ops) || !ops.length) return res.status(400).json({ error: 'ops[] required' });
  ops = [...new Set(ops)];
  if (ops.some(op => !VALID_OPS.includes(op))) {
    return res.status(400).json({ error: `ops must be a subset of ${VALID_OPS.join(', ')}` });
  }
  if (filter?.cat && !VALID_CATEGORIES.has(filter.cat)) {
    return res.status(400).json({ error: 'invalid category filter' });
  }

  if (Array.isArray(slugs) && slugs.length) {
    const error = validateSlugs(slugs);
    if (error) return res.status(400).json({ error });
    slugs = [...new Set(slugs)];
  } else {
    const sharedJs = await ghGetFile('blog/blog-shared.js');
    if (!sharedJs) return res.status(500).json({ error: 'blog-shared.js not found' });
    const catalog = sharedJs.content.match(/DN\.ARTICLES\s*=\s*(\[[\s\S]*?\]);/);
    if (!catalog) return res.status(500).json({ error: 'DN.ARTICLES not found' });

    slugs = [];
    const article = /\{\s*slug\s*:\s*'([^']+)'(?:[^}]*?cat\s*:\s*'([^']+)')?/g;
    let match;
    while ((match = article.exec(catalog[1])) !== null) {
      if (filter?.cat && match[2] !== filter.cat) continue;
      slugs.push(match[1]);
    }
  }

  if (!slugs.length) return res.status(200).json({ ok: true, total: 0, succeeded: 0, failed: 0, results: [] });
  const started = Date.now();
  const results = [];
  const cookie = req.headers.cookie || '';

  for (const slug of slugs) {
    for (const op of ops) {
      results.push(await runWithRetry(op, slug, cookie));
    }
  }

  const succeeded = results.filter(result => result.ok).length;
  const failed = results.length - succeeded;
  const elapsed = Date.now() - started;
  res.setHeader('Server-Timing', `total;dur=${elapsed}`);
  return res.status(200).json({
    ok: failed === 0,
    total: results.length,
    succeeded,
    failed,
    ms: elapsed,
    results,
  });
}
