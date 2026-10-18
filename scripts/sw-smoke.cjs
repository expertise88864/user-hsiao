/* Service-worker smoke check on the deployed home page only.
 *
 * Every other CI browser blocks the service worker (it never paints, and its
 * precache multiplied the requests of each fresh context). This one check
 * proves the worker itself against the real deployment, complementing the
 * static _check_pwa.py: registration, install/activation, a complete shell
 * precache without redirected entries, and the offline page for an uncached
 * navigation. Read-only; nothing is submitted and no baseline is touched.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The tiers come from the sw.js of this exact checkout, so the check follows
// the deployed revision instead of a copy that could drift.
function serviceWorkerContract(source = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8')) {
  const cache = source.match(/const CACHE = '([^']+)'/);
  const shell = source.match(/const SHELL = \[([\s\S]*?)\];/);
  assert.ok(cache && shell, 'sw.js CACHE/SHELL declarations not found');
  const entries = [...shell[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.ok(entries.includes('/offline'), 'SHELL must precache the offline page');
  return { cache: cache[1], shell: entries };
}

async function serviceWorkerSmoke(context, page, base, { contract = serviceWorkerContract(), verify } = {}) {
  const origin = new URL(base).origin;
  const homeRequests = [];
  context.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === origin && url.pathname === '/') homeRequests.push(request.url());
  });
  const response = await page.goto(new URL('/', base).href, { waitUntil: 'load' });
  assert.equal(response && response.status(), 200, 'Home page must load');
  if (verify) await verify(page, response);

  // 1. Registration and 2. install: wait for an activated worker (bounded).
  const worker = await page.evaluate(async () => {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker did not activate within 30 s')), 30000));
    const registration = await Promise.race([navigator.serviceWorker.ready, timeout]);
    const active = registration.active;
    if (active.state !== 'activated') {
      await Promise.race([new Promise(resolve => active.addEventListener('statechange', () => {
        if (active.state === 'activated') resolve();
      })), timeout]);
    }
    return { scope: registration.scope, script: active.scriptURL, state: active.state };
  });
  assert.equal(worker.scope, origin + '/', 'Service worker scope must be the whole site');
  assert.equal(worker.script, origin + '/sw.js', 'Unexpected service worker script');
  assert.equal(worker.state, 'activated', 'Service worker did not activate');

  // 3. Precache: every SHELL entry except the page that registered the worker
  // (already downloaded, deliberately not fetched twice) is cached as a direct
  // HTTP 200 response, never a redirect.
  const expected = contract.shell.filter(entry => entry !== '/');
  const cached = await page.evaluate(async ({ name, entries }) => {
    const cache = await caches.open(name);
    return Promise.all(entries.map(async entry => {
      const hit = await cache.match(entry);
      return { entry, cached: !!hit, status: hit ? hit.status : 0, redirected: hit ? hit.redirected : false };
    }));
  }, { name: contract.cache, entries: expected });
  for (const row of cached) {
    assert.ok(row.cached, 'Shell entry not precached: ' + row.entry);
    assert.equal(row.status, 200, 'Shell entry cached with HTTP ' + row.status + ': ' + row.entry);
    assert.equal(row.redirected, false, 'Shell entry cached as a redirect: ' + row.entry);
  }
  assert.equal(homeRequests.length, 1, 'The home page was downloaded again during install');

  // 4. Offline page: an uncached navigation while offline is answered by the
  // active worker with the precached offline page, at the requested URL.
  await context.setOffline(true);
  try {
    const offline = await page.goto(new URL('/about', base).href, { waitUntil: 'load' });
    assert.ok(offline && offline.fromServiceWorker(), 'Offline navigation was not answered by the service worker');
    assert.equal(new URL(page.url()).pathname, '/about', 'Offline navigation changed URL');
    await page.locator('#retryConnection').waitFor({ state: 'visible', timeout: 10000 });
  } finally { await context.setOffline(false); }
  return { ...worker, cache: contract.cache, precached: cached.map(row => row.entry), homeDownloads: homeRequests.length };
}

module.exports = { serviceWorkerContract, serviceWorkerSmoke };

if (require.main === module) {
  const { chromium, request } = require('playwright');
  const { previewCookies, verifyContent } = require('./preview-access.cjs');
  const { createMeter } = require('./vercel-request-meter.cjs');
  (async () => {
    const base = new URL(process.env.PW_BASE_URL);
    assert.equal(base.protocol, 'https:');
    assert.ok(base.hostname.endsWith('.vercel.app'), 'Service worker smoke check runs on the exact Preview');
    const meter = createMeter('service worker smoke', base.href);
    const cookies = await previewCookies(base.href, request);
    const browser = await chromium.launch();
    try {
      const context = meter.attach(await browser.newContext({ serviceWorkers: 'allow', locale: 'zh-TW' }));
      await context.addCookies(cookies);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      // The home page must be real site content (not a login page) before the worker counts.
      const result = await serviceWorkerSmoke(context, page, base.href,
        { verify: (loaded, response) => verifyContent(loaded, base.href, '/', response) });
      assert.deepEqual(errors, [], 'Page JavaScript errors');
      fs.mkdirSync('delivery-preview', { recursive: true });
      fs.writeFileSync('delivery-preview/service-worker-smoke.json', JSON.stringify({
        sha: process.env.GITHUB_SHA, checkedAt: new Date().toISOString(), ...result,
        scope: 'Home page only: registration, activation, shell precache and offline page on the exact Preview.',
      }, null, 2));
      console.log('Service worker smoke check passed: ' + result.precached.length + ' shell entries, offline page served.');
    } finally { await browser.close(); meter.report(); }
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
