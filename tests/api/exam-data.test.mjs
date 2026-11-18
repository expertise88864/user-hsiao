// Exam question bank endpoint. The bank was behind a shared-password login from
// 2026-10-15; the owner opened it to everyone on 2026-11-18 (「題庫公開」).
import test from 'node:test';
import assert from 'node:assert/strict';

function mockRes() {
  const headers = {};
  const res = {
    statusCode: 200, body: undefined, ended: false,
    setHeader(k, v) { headers[k.toLowerCase()] = v; return res; },
    getHeader(k) { return headers[k.toLowerCase()]; },
    status(code) { res.statusCode = code; return res; },
    json(obj) { res.body = obj; res.ended = true; return res; },
    send(text) { res.body = text; res.ended = true; return res; },
    end() { res.ended = true; return res; },
    headers,
  };
  return res;
}

function mockReq({ method = 'GET', cookie = '', query = {} } = {}) {
  return { method, query, headers: { cookie, host: 'hsiao.chendermatologist.com' } };
}

// Go through the deployed dispatcher (/api/exam/<op>), not the private module.
async function via(op) {
  const dispatch = (await import('../../api/exam/[op].js')).default;
  return (req, res) => dispatch({ ...req, query: { ...(req.query || {}), op } }, res);
}

test('the bank is served to everyone, with or without a cookie or a password', async () => {
  const data = await via('data');
  delete process.env.EXAM_PASSWORD;
  for (const cookie of ['', 'hs_exam_session=garbage', 'hs_admin_session=x']) {
    const res = mockRes();
    await data(mockReq({ cookie }), res);
    assert.equal(res.statusCode, 200, cookie);
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    assert.match(res.headers['cache-control'], /^public, /);
    assert.equal(res.headers.vary, undefined);
    assert.equal(res.headers['set-cookie'], undefined);
    assert.match(res.headers['x-robots-tag'], /noindex/);
    const bank = JSON.parse(res.body);
    assert.ok(bank.questions.length > 1000 && bank.questions[0].stem && bank.concepts.length > 100);
  }
});

test('the old sign-in probe still answers 204, so pages cached before the change load the bank', async () => {
  const data = await via('data');
  const check = mockRes();
  await data(mockReq({ query: { check: '1' } }), check);
  assert.equal(check.statusCode, 204);
  const head = mockRes();
  await data(mockReq({ method: 'HEAD' }), head);
  assert.equal(head.statusCode, 200);
  const post = mockRes();
  await data(mockReq({ method: 'POST' }), post);
  assert.equal(post.statusCode, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
});

test('login and logout are gone, and unknown /api/exam ops are 404', async () => {
  const dispatch = (await import('../../api/exam/[op].js')).default;
  for (const op of ['', 'login', 'logout', 'bank', '__proto__', 'constructor', '../_exam_bank']) {
    const res = mockRes();
    await dispatch(mockReq({ method: op.startsWith('log') ? 'POST' : 'GET', query: { op } }), res);
    assert.equal(res.statusCode, 404, op);
    assert.equal(res.headers['set-cookie'], undefined);
  }
});

test('the service worker drops caches that may hold old question pages', async () => {
  const { readFile } = await import('node:fs/promises');
  const sw = await readFile(new URL('../../sw.js', import.meta.url), 'utf8');
  const cache = sw.match(/const CACHE = '(hs-v\d+)'/)[1];
  const runtime = sw.match(/const RUNTIME = '(hs-runtime-v\d+)'/)[1];
  // Versions that cached /exam chapter HTML and /exam/exam-data.json with question text.
  assert.ok(Number(cache.slice(4)) > 72, cache);
  assert.ok(Number(runtime.slice(12)) > 35, runtime);
  assert.match(sw, /keys\.filter\(\(k\) => k !== CACHE && k !== RUNTIME\)\.map\(\(k\) => caches\.delete\(k\)\)/);
});

test('the deployment stays within the Vercel Hobby limit of 12 serverless functions', async () => {
  const { readdir } = await import('node:fs/promises');
  const root = new URL('../../api/', import.meta.url);
  async function walk(dir) {
    let n = 0;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.name === 'node_modules') continue;
      if (entry.isDirectory()) n += await walk(new URL(entry.name + '/', dir));
      else if (/\.(?:js|mjs|ts)$/.test(entry.name)) n += 1;
    }
    return n;
  }
  assert.ok(await walk(root) <= 12);
});
