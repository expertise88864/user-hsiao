// Exam question-bank gate: shared-password login, signed session cookie, and the
// signed-in-only data endpoint (owner request 2026-10-15).
import test from 'node:test';
import assert from 'node:assert/strict';

const PASSWORD = 'fixture-exam-password';

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

function mockReq({ method = 'GET', body, cookie, query = {}, ip = '203.0.113.' + Math.floor(Math.random() * 250),
  site = 'same-origin', origin } = {}) {
  const headers = { cookie: cookie || '', 'x-forwarded-for': ip, host: 'hsiao.chendermatologist.com' };
  if (site) headers['sec-fetch-site'] = site;
  if (origin) headers.origin = origin;
  return { method, body, query, headers };
}

async function load() {
  process.env.EXAM_PASSWORD = PASSWORD;
  const session = await import('../../api/_exam_session.js');
  // Go through the deployed dispatcher (/api/exam/<op>), not the private modules.
  const dispatch = (await import('../../api/exam/[op].js')).default;
  const via = op => (req, res) => dispatch({ ...req, query: { ...(req.query || {}), op } }, res);
  const login = via('login');
  const logout = via('logout');
  const data = via('data');
  return { session, login, logout, data };
}

test('a correct password sets an HttpOnly session cookie and redirects to a safe next', async () => {
  const { login } = await load();
  const res = mockRes();
  await login(mockReq({ method: 'POST', body: { password: PASSWORD, next: '/exam/bcsc12-4#q-1441' } }), res);
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/exam/bcsc12-4#q-1441');
  assert.match(res.headers['set-cookie'], /^hs_exam_session=\d{13}\.[0-9a-f]{64}; HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=2592000$/);
});

test('a wrong or missing password sets no cookie and returns to the login page', async () => {
  const { login } = await load();
  for (const body of [{ password: 'nope', next: '/exam' }, { next: '/exam' }, 'password=nope&next=%2Fexam']) {
    const res = mockRes();
    await login(mockReq({ method: 'POST', body }), res);
    assert.equal(res.statusCode, 303);
    assert.match(res.headers.location, /^\/exam\/login\?error=wrong&next=%2Fexam$/);
    assert.equal(res.headers['set-cookie'], undefined);
  }
});

test('next can only point back into /exam (no open redirect)', async () => {
  const { session } = await load();
  for (const bad of ['https://evil.example/', '//evil.example', '/exam/../admin', '/blog/x', '/exam?x=1', '/exam/bcsc12-4#x', 42, undefined]) {
    assert.equal(session.safeNext(bad), '/exam');
  }
  assert.equal(session.safeNext('/exam/practice'), '/exam/practice');
  assert.equal(session.safeNext('/exam/bcsc6-27#q-873'), '/exam/bcsc6-27#q-873');
});

test('login is rate limited per client', async () => {
  const { login } = await load();
  const ip = '198.51.100.7';
  let last;
  for (let i = 0; i < 9; i++) {
    last = mockRes();
    await login(mockReq({ method: 'POST', body: { password: 'nope', next: '/exam' }, ip }), last);
  }
  assert.match(last.headers.location, /error=rate/);
});

test('without EXAM_PASSWORD nothing can sign in or read the bank (fail closed)', async () => {
  const { login, data } = await load();
  delete process.env.EXAM_PASSWORD;
  try {
    const res = mockRes();
    await login(mockReq({ method: 'POST', body: { password: '', next: '/exam' } }), res);
    assert.match(res.headers.location, /error=config/);
    const d = mockRes();
    await data(mockReq({ cookie: 'hs_exam_session=1.abc' }), d);
    assert.equal(d.statusCode, 503);
  } finally {
    process.env.EXAM_PASSWORD = PASSWORD;
  }
});

test('the bank is served only with a valid, unexpired, untampered session', async () => {
  const { session, data } = await load();
  const good = session.makeExamToken(PASSWORD);
  const ok = mockRes();
  await data(mockReq({ cookie: 'x=1; hs_exam_session=' + encodeURIComponent(good) }), ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers['cache-control'], 'private, no-store');
  assert.match(ok.headers['x-robots-tag'], /noindex/);
  const bank = JSON.parse(ok.body);
  assert.ok(bank.questions.length > 1000 && bank.questions[0].stem && bank.concepts.length > 100);

  const check = mockRes();
  await data(mockReq({ cookie: 'hs_exam_session=' + good, query: { check: '1' } }), check);
  assert.equal(check.statusCode, 204);

  const expired = session.makeExamToken(PASSWORD, Date.now() - session.EXAM_SESSION_MS - 1000);
  const [exp, sig] = good.split('.');
  const tampered = exp + '.' + (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
  const otherKey = session.makeExamToken('another-password');
  for (const cookie of ['', 'hs_exam_session=' + expired, 'hs_exam_session=' + tampered,
    'hs_exam_session=' + otherKey, 'hs_exam_session=garbage', 'hs_admin_session=' + good]) {
    const res = mockRes();
    await data(mockReq({ cookie }), res);
    assert.equal(res.statusCode, 401, cookie);
    assert.equal(res.body.questions, undefined);
  }
});

test('logout clears the session cookie; non-POST methods are refused', async () => {
  const { logout, login } = await load();
  const res = mockRes();
  await logout(mockReq({ method: 'POST' }), res);
  assert.equal(res.statusCode, 303);
  assert.match(res.headers['set-cookie'], /^hs_exam_session=; .*Max-Age=0$/);
  const get = mockRes();
  await login(mockReq({ method: 'GET' }), get);
  assert.equal(get.statusCode, 405);
});

test('login and logout refuse cross-site form posts', async () => {
  const { login, logout, session } = await load();
  for (const opts of [{ site: 'cross-site' }, { site: 'same-site' }, { site: null },
    { site: null, origin: 'https://evil.example' }]) {
    const a = mockRes();
    await login(mockReq({ method: 'POST', body: { password: PASSWORD, next: '/exam' }, ...opts }), a);
    assert.equal(a.statusCode, 403);
    assert.equal(a.headers['set-cookie'], undefined);
    const b = mockRes();
    await logout(mockReq({ method: 'POST', ...opts }), b);
    assert.equal(b.statusCode, 403);
    assert.equal(b.headers['set-cookie'], undefined);
  }
  assert.equal(session.isSameOriginPost(mockReq({ site: null, origin: 'https://hsiao.chendermatologist.com' })), true);
});

test('the service worker drops caches that may hold pre-login question pages', async () => {
  const { readFile } = await import('node:fs/promises');
  const sw = await readFile(new URL('../../sw.js', import.meta.url), 'utf8');
  const cache = sw.match(/const CACHE = '(hs-v\d+)'/)[1];
  const runtime = sw.match(/const RUNTIME = '(hs-runtime-v\d+)'/)[1];
  // Versions that cached /exam chapter HTML and /exam/exam-data.json with question text.
  assert.ok(Number(cache.slice(4)) > 72, cache);
  assert.ok(Number(runtime.slice(12)) > 35, runtime);
  assert.match(sw, /keys\.filter\(\(k\) => k !== CACHE && k !== RUNTIME\)\.map\(\(k\) => caches\.delete\(k\)\)/);
});

test('unknown /api/exam ops are 404', async () => {
  const dispatch = (await import('../../api/exam/[op].js')).default;
  for (const op of ['', 'bank', '__proto__', 'constructor', '../_exam_bank']) {
    const res = mockRes();
    await dispatch(mockReq({ query: { op } }), res);
    assert.equal(res.statusCode, 404, op);
  }
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
