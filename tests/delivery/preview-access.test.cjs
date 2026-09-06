const { test } = require('node:test');
const assert = require('node:assert/strict');
const { previewCookies, targetUrl, verifyContent, PRODUCTION } = require('../../scripts/preview-access.cjs');
const base = 'https://user-hsiao-candidate.vercel.app';

function fixture({ status = 307, location = '/', cookies } = {}) {
  const calls = [];
  const client = {
    async get(url, options) { calls.push({ url, options }); return { status: () => status, headers: () => ({ location }) }; },
    async storageState() { return { cookies: cookies || [{ name: 'auth', value: 'ephemeral', domain: new URL(base).hostname, secure: true }] }; },
    async dispose() { calls.push('disposed'); },
  };
  return { calls, request: { async newContext() { return client; } } };
}

test('authentication sends a header to one verified origin, with redirects disabled', async () => {
  const { calls, request } = fixture();
  const cookies = await previewCookies(base, request, 'test-secret');
  assert.equal(calls[0].url, base + '/');
  assert.equal(calls[0].options.maxRedirects, 0);
  assert.deepEqual(calls[0].options.headers, { 'x-vercel-protection-bypass': 'test-secret', 'x-vercel-set-bypass-cookie': 'true' });
  assert.equal(cookies.length, 1);
  assert.equal(cookies[0].httpOnly, true);
  assert.equal(cookies[0].domain, new URL(base).hostname);
  assert.equal(calls[1], 'disposed');
});

test('off-origin redirects never receive a second authenticated request', async () => {
  const { calls, request } = fixture({ location: 'https://vercel.com/login' });
  await assert.rejects(previewCookies(base, request, 'test-secret'), /redirected off origin/);
  assert.equal(calls.length, 2);
  assert.equal(calls[1], 'disposed');
});

test('missing secrets, rejected authentication, absent cookies and broad cookies fail closed', async () => {
  await assert.rejects(previewCookies(base, fixture().request, ''), /requires repository secret/);
  await assert.rejects(previewCookies(base, fixture({ status: 401 }).request, 's'), /rejected/);
  for (const cookies of [[], [{ domain: '.vercel.app', secure: true }], [{ domain: new URL(base).hostname, secure: false }]]) {
    await assert.rejects(previewCookies(base, fixture({ cookies }).request, 's'), /scoped secure cookie/);
  }
});

test('production never sends the Preview secret', async () => {
  const { calls, request } = fixture();
  assert.deepEqual(await previewCookies(PRODUCTION, request, 'test-secret'), []);
  assert.deepEqual(calls, []);
});

test('transport errors do not expose authentication headers in call logs', async () => {
  let disposed = false;
  const request = { newContext: async () => ({
    get: async () => { throw new Error('Call log: x-vercel-protection-bypass: test-secret'); },
    dispose: async () => { disposed = true; },
  }) };
  await assert.rejects(previewCookies(base, request, 'test-secret'), error =>
    error.message === 'Preview authentication request failed' && !error.cause);
  assert.equal(disposed, true);
});

test('untrusted origins and credential-bearing URLs are rejected', () => {
  for (const url of ['http://a.vercel.app', 'https://vercel.app.evil.test', 'https://user:pass@a.vercel.app',
    'https://a.vercel.app:444', base + '/?secret=x', base + '/#secret', base + '/blog']) {
    assert.throws(() => targetUrl(url));
  }
});

test('content validation rejects login redirects, HTTP errors and wrong routes', async () => {
  const page = { url: () => 'https://vercel.com/login', waitForFunction: async () => {} };
  await assert.rejects(verifyContent(page, base, '/', { status: () => 200 }), /redirected/);
  page.url = () => base + '/';
  await assert.rejects(verifyContent(page, base, '/', { status: () => 403 }), /HTTP 200/);
  await assert.rejects(verifyContent(page, base, '/tools', { status: () => 200 }), /page path/);
});
