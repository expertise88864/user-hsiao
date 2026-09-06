import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
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

test('Web Push credentials remain in private, independently writable KV fields', async () => {
  for (const path of [
    'api/push/_subscribe.js',
    'api/push/_send.js',
    'api/admin/_push-stats.js',
  ]) {
    const source = await read(path);
    assert.doesNotMatch(source, /ghGetFile|ghPutFile|push-subscribers\.json/, path);
    assert.match(source, /pushStorageAvailable|loadSubscriptions|upsertSubscription/, path);
  }
  const store = await read('api/push/_store.js');
  assert.match(store, /push:subscribers:v2/);
  assert.match(store, /kvHSet/);
  assert.match(store, /kvHDel/);
  assert.doesNotMatch(store, /assets\/|ghPutFile/);
});

test('admin batch writes are serialized and validate explicit slugs', async () => {
  const batch = await import('../../api/admin/_batch.js');
  const source = await read('api/admin/_batch.js');
  assert.equal(batch.validateSlugs(['dry-eye-myths', 'glaucoma-warnings']), null);
  assert.match(batch.validateSlugs(['../admin']), /slug/);
  assert.match(source, /for \(const slug of slugs\)/);
  assert.doesNotMatch(source, /Promise\.all\(workers\)|for \(let w = 0; w < 3/);
  assert.match(source, /runWithRetry/);
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
  const preflight = await read('preflight.py');
  const budget = await read('.github/workflows/size-budget.yml');
  assert.doesNotMatch(preflight, /Exit code 0 == safe to run codex review then push|# full gate|PREFLIGHT PASS\. Next:.*then push/);
  assert.match(budget, /python _check_size_budget\.py/);
  const visual = await read('.github/workflows/visual-regression.yml');
  assert.doesNotMatch(visual, /Auto-recover|continue-on-error|bootstrap mode/i);
  assert.match(visual, /workflow_dispatch/);
  assert.match(visual, /test "\$ACTUAL" -eq "\$EXPECTED"/);

  const size = await read('_check_size_budget.py');
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

test('Markdown and A/B content reject stored-XSS execution surfaces', async () => {
  const md = await import('../../api/admin/_md.js');
  const ab = await import('../../api/admin/_ab-config.js');
  const rendered = md.markdownToHtml('Hello <img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))');
  assert.doesNotMatch(rendered, /<img|javascript:/i);
  assert.match(rendered, /&lt;img/);
  assert.equal(
    md.sanitizeRawHtml('<iframe srcdoc="<script>alert(1)</script>"></iframe><p>safe</p>'),
    '<p>safe</p>'
  );
  assert.equal(
    md.sanitizeRawHtml('<a href="java&#x73;cript:alert(1)">bad</a>'),
    '<a href="#">bad</a>'
  );
  assert.match(
    ab.validateAbConfig({
      id: 'unsafe',
      selector: '#hero',
      variants: [
        { name: 'A', html: '<p>A</p>' },
        { name: 'B', html: '<img src=x onerror = alert(1)>' },
      ],
    }),
    /event handlers/
  );
  assert.match(
    ab.validateAbConfig({
      id: 'unsafe-entity',
      selector: '#hero',
      variants: [
        { name: 'A', html: '<p>A</p>' },
        { name: 'B', html: '<a href="java&#115;cript:alert(1)">B</a>' },
      ],
    }),
    /unsafe URL/
  );
  assert.match(
    ab.validateAbConfig({
      id: 'unsafe-selector',
      selector: 'body',
      variants: [
        { name: 'A', html: '<p>A</p>' },
        { name: 'B', html: '<p>B</p>' },
      ],
    }),
    /selector/
  );
  assert.equal(
    ab.validateAbConfig({
      id: 'safe-selector',
      selector: '#hs-cover-story .hs-cta-btn',
      variants: [
        { name: 'A', html: '<span>A</span>' },
        { name: 'B', html: '<span>B</span>' },
      ],
    }),
    null
  );
});

test('CMS serialization strips nested runtime DOM without damaging the footer', async () => {
  const save = await import('../../api/admin/_save.js');
  const input = [
    '<!doctype html><html data-theme="dark"><body>',
    '<article><p>content</p></article>',
    '<div id="hs-cmdk-overlay"><div id="hs-cmdk-modal"><div>results</div></div></div>',
    '<div id="hs-reading-meta"><span><svg><circle></circle></svg><span>5 min</span></span></div>',
    '<section id="hs-feedback"><div><div>feedback</div></div></section>',
    '<section id="hs-related"><div><a href="/blog/other">related</a></div></section>',
    '<footer><div><strong>footer stays intact</strong></div></footer>',
    '</body></html>',
  ].join('');
  const result = save.stripRuntimeHelpers(input);
  assert.equal(result.count, 2);
  assert.doesNotMatch(result.html, /hs-cmdk|hs-reading-meta/);
  assert.match(result.html, /id="hs-feedback"/);
  assert.match(result.html, /id="hs-related"/);
  assert.match(result.html, /<footer><div><strong>footer stays intact<\/strong><\/div><\/footer>/);

  const client = await read('blog/blog-admin.js');
  for (const id of ['hs-cmdk-overlay', 'hs-breadcrumb-runtime', 'hs-reading-meta', 'hsMobileDrawer', 'hs-article-hero']) {
    assert.match(client, new RegExp(`['"]${id}['"]`), id);
  }
  const shared = await read('blog/blog-shared.js');
  assert.match(shared, /s\.id = 'hs-admin-runtime'/);
  assert.match(shared, /styleEl\.id = 'hs-reveal-css'/);
  assert.match(shared, /existingNav\.setAttribute\('aria-label', 'Breadcrumb'\)/);
  const abApply = shared.slice(shared.indexOf('DN.applyAbConfig'), shared.indexOf('DN.abConvert'));
  assert.match(abApply, /DN\.isAdminMode.*DN\.isAdminMode\(\)/s);
});

test('canonical articles do not persist runtime-only DOM', async () => {
  const blogDir = new URL('../../blog/', import.meta.url);
  const articleFiles = (await readdir(blogDir)).filter(name => name.endsWith('.html'));
  const runtimeIds = [
    'hs-theme-style',
    'hs-breadcrumb-runtime',
    'hs-reading-meta',
    'hsMobileDrawer',
    'hs-inline-toc',
    'hs-img-css',
    'hs-admin-runtime',
  ];

  for (const name of articleFiles) {
    const html = await readFile(new URL(name, blogDir), 'utf8');
    for (const id of runtimeIds) {
      assert.doesNotMatch(html, new RegExp(`id=["']${id}["']`), `${name}: ${id}`);
    }
    assert.doesNotMatch(
      html,
      /<script\b[^>]*\bsrc=["']\/blog\/blog-admin\.js(?:\?[^"']*)?["'][^>]*>/i,
      `${name}: admin runtime script`
    );
  }
});

test('A/B config persistence fails closed when the authoritative store rejects writes', async () => {
  const ab = await import('../../api/admin/_ab-config.js');
  const previous = {
    edge: process.env.EDGE_CONFIG,
    edgeId: process.env.EDGE_CONFIG_ID,
    vercelToken: process.env.VERCEL_API_TOKEN,
    kvUrl: process.env.KV_REST_API_URL,
    kvToken: process.env.KV_REST_API_TOKEN,
  };
  const originalFetch = globalThis.fetch;
  const calls = [];
  process.env.EDGE_CONFIG = 'vercel://edge-config/test?token=read-token';
  process.env.EDGE_CONFIG_ID = 'test';
  process.env.VERCEL_API_TOKEN = 'write-token';
  process.env.KV_REST_API_URL = 'https://kv.example.test';
  process.env.KV_REST_API_TOKEN = 'kv-token';
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' });
    return {
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => 'write failed',
    };
  };
  try {
    await assert.rejects(
      ab.saveAbConfig({ tests: {}, _source: 'edge-config' }),
      /Edge Config write failed/
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({
      EDGE_CONFIG: previous.edge,
      EDGE_CONFIG_ID: previous.edgeId,
      VERCEL_API_TOKEN: previous.vercelToken,
      KV_REST_API_URL: previous.kvUrl,
      KV_REST_API_TOKEN: previous.kvToken,
    })) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.equal(calls.filter(call => call.url.startsWith('https://kv.example.test')).length, 0);
});

test('srcset uploads reject path-like and duplicate suffixes before GitHub access', async () => {
  const source = await read('api/admin/_upload-srcset.js');
  assert.match(source, /\^\(\?:\|-\[1-9\]/);
  assert.match(source, /duplicate variant/);
});

test('new drafts use the Taipei calendar date', async () => {
  const drafts = await import('../../api/admin/_new.js');
  assert.equal(drafts.todayISO(new Date('2026-06-12T16:30:00.000Z')), '2026-06-13');
});

test('medical dictionary content is validated and HTML-escaped', async () => {
  const dictionary = await import('../../api/admin/_dictionary.js');
  assert.match(
    dictionary.validateDictionary({
      '<img src=x>': { en: 'unsafe', def: 'unsafe', anchor: '' },
    }),
    /term/
  );
  assert.equal(
    dictionary.validateDictionary({
      '乾眼症': { en: 'dry eye', def: '<img src=x onerror=alert(1)>', anchor: 'dry-eye-myths' },
    }),
    null
  );
  const linked = dictionary.autolinkOnce(
    '<html><head></head><body><p>乾眼症需要評估。</p></body></html>',
    { '乾眼症': { en: 'dry eye', def: '<img src=x onerror=alert(1)>', anchor: '' } }
  );
  assert.doesNotMatch(linked, /title="<img/);
  assert.match(linked, /title="&lt;img src=x onerror=alert\(1\)&gt;"/);

  const client = await read('blog/blog-shared.js');
  const tooltip = client.slice(
    client.indexOf('DN.injectDictTooltips'),
    client.indexOf('DN.PWA_DISMISS_KEY')
  );
  assert.doesNotMatch(tooltip, /popup\.innerHTML/);
  assert.match(tooltip, /document\.createTextNode\(def\)/);
});

test('Push UI does not report success when private storage rejects registration', async () => {
  const client = await read('blog/blog-shared.js');
  assert.match(client, /if \(!saveResponse\.ok\)/);
  assert.match(client, /await sub\.unsubscribe\(\)\.catch/);
});

test('admin status panels escape dynamic errors before using innerHTML', async () => {
  const admin = await read('admin.html');
  assert.doesNotMatch(admin, /innerHTML\s*=\s*[^;\n]*\+\s*e\.message\s*\+/);
  assert.match(admin, /escapeHTML\(\(j\.error \|\| r\.status\)\.toString\(\)\.slice\(0, 60\)\)/);
});

test('CWV page labels are coerced before truncation', async () => {
  const source = await read('api/cwv-ingest.js');
  assert.match(source, /String\(page \|\| ''\)\.slice\(0, 80\)/);
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
  assert.match(sw, /sourceSlug === payload\.slug/);
  assert.match(sw, /X-Hsiao-Offline-Token/);
  assert.match(sw, /payload\.token/);
  assert.match(sw, /deleteQueuedSave/);
  const drain = sw.slice(
    sw.indexOf('async function drainSavesOnce()'),
    sw.indexOf('function drainSaves()')
  );
  assert.doesNotMatch(drain, /db\.transaction/);
  assert.match(drain, /await fetch\('\/api\/admin\/save'/);
  assert.match(save, /verifyOfflineSaveToken/);
  assert.match(save, /x-hsiao-offline-replay/);
});

test('rate limits do not trust unsigned session cookie names', async () => {
  const publicLimiter = await read('api/_rate_limit.js');
  const dispatcher = await read('api/admin/[op].js');
  assert.doesNotMatch(publicLimiter, /hs_admin_session/);
  assert.match(dispatcher, /c && isAdminRequest\(req\)/);
});

test('admin editor messages are same-origin, frame-bound, and slug-bound', async () => {
  const admin = await read('admin.html');
  const editor = await read('blog/blog-admin.js');
  assert.match(editor, /window\.parent\.postMessage\([\s\S]*window\.location\.origin/);
  assert.match(admin, /e\.origin === window\.location\.origin/);
  assert.match(admin, /e\.source === frame\.contentWindow/);
  assert.match(admin, /e\.data\.slug === expectedSlug/);
});

test('generation and baseline workflows retain checks without publishing unvalidated commits', async () => {
  const workflow = await read('.github/workflows/regen-en.yml');
  const visual = await read('.github/workflows/visual-regression.yml');
  const quality = await read('.github/workflows/quality.yml');
  for (const source of [workflow, visual]) {
    assert.doesNotMatch(source, /git\s+(push|commit)\b|contents:\s*write|persist-credentials:\s*true|\[skip ci\]/);
    assert.match(source, /actions\/upload-artifact@/);
  }
  assert.match(workflow, /git diff --cached --quiet/);
  assert.match(workflow, /generated-artifacts\.patch/);
  assert.match(workflow, /exit 1/);
  assert.match(visual, /npx playwright test tests\/visual\/ --reporter=list/);
  assert.match(quality, /group: quality-\$\{\{ github\.ref \}\}/);
  assert.match(quality, /cancel-in-progress: true/);
});

test('CMS saves atomically update published modified dates', async () => {
  const save = await read('api/admin/_save.js');
  const articleCommit = await read('api/admin/_article-commit.js');
  const github = await read('api/admin/_github.js');
  assert.match(save, /commitArticleWithModifiedDate/);
  assert.match(articleCommit, /updateCatalogModified/);
  assert.match(articleCommit, /ghCommitFiles/);
  assert.match(articleCommit, /expectedSha:\s*articleSha/);
  assert.match(github, /file\.expectedSha/);
  assert.match(github, /file\.expectedSha === null/);
});

test('draft creation cannot overwrite a concurrent article or manifest update', async () => {
  const create = await read('api/admin/_new.js');
  assert.match(create, /path: `blog\/\$\{slug\}\.html`, content: html, expectedSha: null/);
  assert.match(create, /expectedSha: draftFile \? draftFile\.sha : null/);
});

test('all article mutation tools share the atomic modified-date commit path', async () => {
  for (const path of [
    'api/admin/_md.js',
    'api/admin/_seo-fix.js',
    'api/admin/_schema-helper.js',
    'api/admin/_dictionary.js',
    'api/admin/_rollback.js',
  ]) {
    const source = await read(path);
    assert.match(source, /commitArticleWithModifiedDate/, path);
  }
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
