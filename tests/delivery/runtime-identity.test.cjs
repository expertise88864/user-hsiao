const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyRuntimeIdentity } = require('../../scripts/preview-access.cjs');
const base = 'https://user-hsiao-candidate.vercel.app';
const sha = 'a'.repeat(40), repository = 'expertise88864/user-hsiao';

function fixture({ status = 200, url = base + '/api/admin/site-version', identity,
  raw, headers = {}, failure } = {}) {
  const calls = [];
  const client = { async get(target, options) {
    calls.push({ target, options });
    if (failure) throw new Error(failure);
    return { status: () => status, url: () => url,
      headers: () => ({ 'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store, max-age=0', 'x-robots-tag': 'noindex, nofollow', ...headers }),
      body: async () => Buffer.from(raw === undefined
        ? JSON.stringify(identity === undefined ? { sha, repository, environment: 'preview' } : identity) : raw) };
  } };
  return { calls, client };
}

test('checks the deployed public dispatcher using only the existing scoped client', async () => {
  const { calls, client } = fixture();
  assert.deepEqual(await verifyRuntimeIdentity(client, base, sha, repository), { sha, repository, environment: 'preview' });
  assert.deepEqual(calls, [{ target: base + '/api/admin/site-version', options: { maxRedirects: 0 } }]);
});

test('rejects login redirects, non200 and changed response URL', async () => {
  for (const options of [{ status: 302 }, { status: 401 }, { status: 500 },
    { url: 'https://vercel.com/login' }, { url: base + '/api/admin/login' }]) {
    await assert.rejects(verifyRuntimeIdentity(fixture(options).client, base, sha, repository));
  }
});

test('unknown, production, different SHA/repository and extra public fields cannot become a receipt', async () => {
  for (const identity of [{ environment: 'unknown' }, { sha, repository, environment: 'production' },
    { sha: 'b'.repeat(40), repository, environment: 'preview' },
    { sha, repository: 'other/repository', environment: 'preview' },
    { sha, repository, environment: 'preview', token: 'must-not-expose' }, [], null]) {
    await assert.rejects(verifyRuntimeIdentity(fixture({ identity }).client, base, sha, repository));
  }
});

test('rejects malformed, oversized, cached or indexable responses', async () => {
  for (const options of [{ raw: '<html>login</html>' }, { raw: 'x'.repeat(4097) },
    { headers: { 'content-type': 'text/html' } }, { headers: { 'content-length': '4097' } },
    { headers: { 'cache-control': 'public, max-age=3600' } }, { headers: { 'x-robots-tag': 'index, follow' } }]) {
    await assert.rejects(verifyRuntimeIdentity(fixture(options).client, base, sha, repository));
  }
});

test('invalid origins or expected identity never send a request', async () => {
  const { client, calls } = fixture();
  for (const origin of ['https://hsiao.chendermatologist.com', 'https://user-hsiao.vercel.app.evil.test',
    'http://user-hsiao.vercel.app', base + '/other', 'https://secret@user-hsiao.vercel.app']) {
    await assert.rejects(verifyRuntimeIdentity(client, origin, sha, repository));
  }
  await assert.rejects(verifyRuntimeIdentity(client, base, 'short', repository));
  await assert.rejects(verifyRuntimeIdentity(client, base, sha, 'other/path/repo'));
  assert.deepEqual(calls, []);
});

test('transport errors do not leak protection cookies or request logs', async () => {
  const { client } = fixture({ failure: 'Request log: Cookie: bypass=private-secret' });
  await assert.rejects(verifyRuntimeIdentity(client, base, sha, repository), error =>
    error.message === 'Preview runtime identity request failed' && !String(error).includes('private-secret'));
});
