import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('KV telemetry uses a POST pipeline with bounded list storage', async () => {
  const source = await read('api/_kv.js');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const kv = await import(moduleUrl);

  process.env.KV_REST_API_URL = 'https://kv.example.test';
  process.env.KV_REST_API_TOKEN = 'test-token';
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return {
      ok: true,
      json: async () => [{ result: 1 }, { result: 'OK' }, { result: 1 }],
      text: async () => '',
    };
  };

  try {
    assert.equal(await kv.kvPushTrimExpire('cwv:test', '{"v":1}', 1000, 60), true);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://kv.example.test/pipeline');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(calls[0].body, [
    ['LPUSH', 'cwv:test', '{"v":1}'],
    ['LTRIM', 'cwv:test', '0', '999'],
    ['EXPIRE', 'cwv:test', '60'],
  ]);
});

test('public telemetry cannot fall back to GitHub writes', async () => {
  const source = await read('api/admin/_ab-stats.js');
  assert.doesNotMatch(source, /ghPutFile|ghGetFile|recordEventGH/);
  assert.match(source, /source:\s*'noop'/);
  assert.match(source, /rateLimitOk/);
});

test('new article creation is an atomic unpublished draft', async () => {
  const source = await read('api/admin/_new.js');
  assert.match(source, /ghCommitFiles/);
  assert.match(source, /noindex,nofollow,noarchive/);
  assert.match(source, /_cms\/admin-drafts\.json/);
  assert.doesNotMatch(source, /ghPutFile/);

  const admin = await read('admin.html');
  const handler = admin.slice(
    admin.indexOf('async function doCreate()'),
    admin.indexOf('// ───────────────── History')
  );
  assert.match(handler, /fetch\(API \+ '\/new'/);
  assert.doesNotMatch(handler, /api\.github\.com|localStorage.*pat/i);
});

test('CI gates fail closed', async () => {
  const visual = await read('.github/workflows/visual-regression.yml');
  assert.doesNotMatch(visual, /Auto-recover|continue-on-error|bootstrap mode/i);
  assert.match(visual, /workflow_dispatch/);
  assert.match(visual, /test "\$ACTUAL" -eq "\$EXPECTED"/);

  const size = await read('.github/workflows/size-budget.yml');
  assert.match(size, /raise SystemExit\(1\)/);
  assert.doesNotMatch(size, /Soft-fail for now/);
});

test('API content snapshot covers every published Chinese search entry', async () => {
  const index = JSON.parse(await read('assets/search-index.json'));
  const source = await read('api/_content_snapshot.js');
  const match = source.match(/Object\.freeze\((\[[\s\S]*\])\);/);
  assert.ok(match, 'snapshot payload not found');
  const snapshot = JSON.parse(match[1]);

  const expected = index.filter(item => item.lang === 'zh-Hant-TW').map(item => item.slug).sort();
  const actual = snapshot.map(item => item.slug).sort();
  assert.deepEqual(actual, expected);
});

test('CSP is route-scoped and emitted once', async () => {
  const middleware = await read('middleware.js');
  assert.match(middleware, /INLINE_SCRIPT_HASHES_BY_ROUTE/);
  assert.doesNotMatch(middleware, /Content-Security-Policy-Report-Only/);
  assert.match(middleware, /hashesForRequest\(req\)/);
  for (const route of ['/', '/blog', '/blog/', '/en', '/en/', '/en/blog', '/en/blog/']) {
    assert.match(middleware, new RegExp(`"${route.replaceAll('/', '\\/')}"\\s*:`));
  }
});

test('Trusted Types bootstrap runs before inline page scripts', async () => {
  const bootstrap = await read('assets/trusted-types.js');
  assert.match(bootstrap, /createPolicy\('hs-policy'/);
  assert.match(bootstrap, /createPolicy\('default'/);
  assert.match(bootstrap, /script URL not in allow-list/);

  for (const page of ['index.html', 'blog/index.html', 'en/index.html', 'en/blog/index.html']) {
    const html = await read(page);
    const bootstrapAt = html.indexOf('/assets/trusted-types.js');
    const firstInlineAt = html.search(/<script(?![^>]*\bsrc=)[^>]*>/i);
    assert.ok(bootstrapAt >= 0, `${page}: missing Trusted Types bootstrap`);
    assert.ok(bootstrapAt < firstInlineAt, `${page}: bootstrap must precede inline scripts`);
  }
});

test('admin session inspection verifies the signature', async () => {
  const previous = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = 'contract-test-password';
  const auth = await import('../../api/admin/_auth.js');
  const login = await import('../../api/admin/_login.js');
  try {
    const valid = login.makeSessionToken(process.env.ADMIN_PASSWORD);
    assert.equal(auth.isAdminRequest({ headers: { cookie: `hs_admin_session=${valid}` } }), true);
    assert.equal(auth.isAdminRequest({ headers: { cookie: 'hs_admin_session=fake' } }), false);
    assert.equal(auth.isAdminRequest({ headers: {} }), false);
  } finally {
    if (previous == null) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previous;
  }
});

test('A/B admin reads require a verified session', async () => {
  const source = await read('api/admin/_ab-config.js');
  assert.match(source, /isAdminRequest\(req\)/);
  assert.doesNotMatch(source, /includes\(['"]hs_admin_session=/);
});

test('unsafe server-side English regenerators are retired', async () => {
  const dispatcher = await read('api/admin/[op].js');
  assert.doesNotMatch(dispatcher, /regen-en/);
  await assert.rejects(access(new URL('../../api/admin/_regen-en.js', import.meta.url)));
  await assert.rejects(access(new URL('../../api/admin/_regen-en-stream.js', import.meta.url)));
});

test('legacy PAT admin is retired and redirected', async () => {
  const config = JSON.parse(await read('vercel.json'));
  assert.ok(config.redirects.some(route =>
    route.source === '/admin/mobile' && route.destination === '/admin'
  ));
  await assert.rejects(access(new URL('../../admin/admin.js', import.meta.url)));
  await assert.rejects(access(new URL('../../admin/mobile.html', import.meta.url)));
});

test('offline admin replay is source-bound and capability-protected', async () => {
  const sw = await read('sw.js');
  const save = await read('api/admin/_save.js');
  assert.match(sw, /sourceUrl\.searchParams\.get\('admin'\) === '1'/);
  assert.match(sw, /X-Hsiao-Offline-Token/);
  assert.match(sw, /payload\.token/);
  assert.match(save, /verifyOfflineSaveToken/);
  assert.match(save, /x-hsiao-offline-replay/);
});

test('CMS saves atomically update published modified dates', async () => {
  const save = await read('api/admin/_save.js');
  const github = await read('api/admin/_github.js');
  assert.match(save, /updateCatalogModified/);
  assert.match(save, /ghCommitFiles/);
  assert.match(save, /expectedSha:\s*existing\.sha/);
  assert.match(github, /file\.expectedSha/);
});

test('mutable OG images and clean HTML routes use revalidating caches', async () => {
  const config = JSON.parse(await read('vercel.json'));
  const headers = new Map(config.headers.map(rule => [rule.source, rule.headers]));
  const og = Object.fromEntries(headers.get('/assets/og/(.*)').map(h => [h.key, h.value]));
  assert.doesNotMatch(og['Cache-Control'], /immutable/);
  assert.match(og['Cache-Control'], /s-maxage=86400/);
  assert.ok(headers.has('/blog/:slug([a-z0-9-]+)'));
  assert.ok(headers.has('/en/blog/:slug([a-z0-9-]+)'));
});

test('documented pipeline extracts critical CSS before CSP hashing', async () => {
  const agents = await read('AGENTS.md');
  assert.ok(agents.indexOf('python _extract_critical_css.py') < agents.indexOf('python _gen_csp_hashes.py'));
});
