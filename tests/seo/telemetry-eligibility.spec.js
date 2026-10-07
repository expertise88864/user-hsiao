const { test, expect } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const HOST = 'hsiao.chendermatologist.com';
const ARTICLE = '/blog/glaucoma-comprehensive-guide';

// Serve repository files at a simulated canonical origin. All requests are
// intercepted: this suite never sends real analytics or visits production.
async function fixture(page, { human = true, prerender = false, optOut = false, privacy = false, ab = false,
  vitals = false, failVitalsOnce = false, sharedQuery } = {}) {
  const requests = [];
  requests.abEvents = [];
  requests.cwvEvents = [];
  requests.sharedAssets = [];
  let vitalsLoads = 0;
  if (optOut) await page.context().addCookies([{ name: 'hs_telemetry_optout', value: '1', domain: HOST, path: '/', secure: true }]);
  await page.addInitScript(({ human, prerender, privacy }) => {
    if (human) {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36' });
    }
    if (privacy) Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true });
    window.__fixturePrerender = prerender;
    Object.defineProperty(document, 'prerendering', { get: () => window.__fixturePrerender });
  }, { human, prerender, privacy });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'www.googletagmanager.com' || url.pathname.startsWith('/_vercel/')) {
      requests.push(url.href);
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    }
    if (url.pathname.startsWith('/api/')) {
      requests.push(url.pathname);
      if (url.pathname === '/api/admin/ab-stats') requests.abEvents.push(route.request().postDataJSON());
      if (url.pathname === '/api/cwv-ingest') requests.cwvEvents.push(route.request().postDataJSON());
      if (ab && url.pathname === '/api/ab-config') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tests: {
          'prerender-fixture': { selector: '.hs-reading-path', variants: [{ name: 'a', html: '<p>Fixture A</p>' }, { name: 'b', html: '<p>Fixture B</p>' }] },
        } }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    if (![HOST, 'candidate.vercel.app'].includes(url.hostname)) return route.abort();
    if (vitals && url.pathname === '/assets/vitals.min.js') {
      if (++vitalsLoads === 1 && failVitalsOnce) return route.abort();
      return route.fulfill({ contentType: 'application/javascript',
        body: 'window.HsiaoVitals={observeVitals:function(cb){window.__fixtureVitalsSend=cb;window.__fixtureObservers=(window.__fixtureObservers||0)+1;}};' });
    }
    if (/\/blog\/blog-shared(?:\.min)?\.js$/.test(url.pathname)) requests.sharedAssets.push(url.href);
    let relative = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html';
    if (!path.extname(relative)) relative += '.html';
    const file = path.resolve(ROOT, relative);
    if (!file.startsWith(ROOT + path.sep)) return route.abort();
    try {
      let body = await fs.readFile(file);
      if (path.extname(file) === '.html' && typeof sharedQuery === 'string') {
        body = Buffer.from(body.toString('utf8').replace(/\/blog\/blog-shared\.min\.js\?v=[0-9]{8}/g,
          '/blog/blog-shared.min.js' + sharedQuery));
      }
      const contentType = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' }[path.extname(file)] || 'application/octet-stream';
      return route.fulfill({ status: 200, contentType, body });
    } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  return requests;
}

for (const [name, config, url] of [
  ['Preview', {}, 'https://candidate.vercel.app' + ARTICLE],
  ['automation', { human: false }, 'https://' + HOST + ARTICLE],
  ['editing mode', {}, 'https://' + HOST + ARTICLE + '?admin=1'],
  ['logged-in editor browser', { optOut: true }, 'https://' + HOST + ARTICLE],
  ['privacy preference', { privacy: true }, 'https://' + HOST + ARTICLE],
]) {
  test(`${name} does not load collectors or transmit growth counters`, async ({ page }) => {
    const requests = await fixture(page, config);
    await page.goto(url);
    await expect.poll(() => page.evaluate(() => !!window.DN?._engagementBound)).toBe(true);
    await page.evaluate(() => {
      DN.bindWebVitals(); DN.gaEvent('fixture_event');
      DN.abTest('fixture', ['a', 'b']); DN.abConvert('fixture', 'click');
    });
    expect(await page.evaluate(() => HsiaoTelemetry.allowed(window))).toBe(false);
    expect(requests.filter(url => /googletagmanager|_vercel|cwv-ingest|ab-stats|search-log/.test(url))).toEqual([]);
    await expect(page.locator('script[src*="assets/vitals.min.js"]')).toHaveCount(0);
  });
}

test('simulated human loads standard vitals once; later admin login blocks manual and automatic sends', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('https://' + HOST + ARTICLE);
  await expect.poll(() => page.evaluate(() => typeof window.HsiaoVitals?.observeVitals)).toBe('function');
  expect(requests.filter(url => url.includes('googletagmanager'))).toHaveLength(1);
  expect(requests.filter(url => url.includes('/_vercel/'))).toHaveLength(2);
  await page.evaluate(() => { DN.bindWebVitals(); DN.bindWebVitals(); });
  await expect(page.locator('script[src*="assets/vitals.min.js"]')).toHaveCount(1);
  const result = await page.evaluate(() => {
    const event = { type: 'pageview', url: location.href };
    const before = { flag: window['ga-disable-G-0ZKDQP9DNH'], va: vaq[0][1](event), si: siq[0][1](event) };
    const count = dataLayer.length;
    document.cookie = 'hs_telemetry_optout=1; Secure; Path=/';
    gtag('event', 'excluded'); DN.gaEvent('excluded');
    DN.abTest('excluded', ['a', 'b']); DN.abConvert('excluded', 'click');
    return { before, after: { flag: window['ga-disable-G-0ZKDQP9DNH'], va: vaq[0][1](event), si: siq[0][1](event) }, unchanged: dataLayer.length === count };
  });
  expect(result.before.flag).toBe(false);
  expect(result.before.va).not.toBeNull(); expect(result.before.si).not.toBeNull();
  expect(result.after).toEqual({ flag: true, va: null, si: null });
  expect(result.unchanged).toBe(true);
});

test('CWV uses the executing asset and first eligible width, with unchanged GA4 values and one observer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = await fixture(page, { vitals: true });
  await page.goto('https://' + HOST + ARTICLE);
  await expect.poll(() => page.evaluate(() => typeof __fixtureVitalsSend)).toBe('function');
  const epoch = new URL(requests.sharedAssets[0]).searchParams.get('v');
  await page.setViewportSize({ width: 1440, height: 900 });
  const ga = await page.evaluate(() => {
    localStorage.setItem('hs:siteVer', '20999999');
    DN.bindWebVitals(); DN.bindWebVitals();
    window.__fixtureVitalsSend('CLS', 0.125, 'context-sample');
    return dataLayer.filter(args => args[0] === 'event' && args[1] === 'CLS').map(args => args[2]);
  });
  await expect.poll(() => requests.cwvEvents.length).toBe(1);
  expect(requests.cwvEvents[0]).toEqual({ name: 'CLS', value: 125, page: ARTICLE,
    version: 'web-vitals-6', id: 'context-sample', contextVersion: 1, viewportBand: 'narrow', assetEpoch: epoch });
  expect(ga).toEqual([{ event_category: 'Web Vitals', event_label: 'context-sample', value: 125, non_interaction: true }]);
  expect(await page.evaluate(() => __fixtureObservers)).toBe(1);
  await page.evaluate(() => {
    document.cookie = 'hs_telemetry_optout=1; Secure; Path=/';
    __fixtureVitalsSend('LCP', 999, 'excluded');
  });
  expect(requests.cwvEvents).toHaveLength(1);
});

test('failed vitals script retry retains original width with only one successful observer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = await fixture(page, { vitals: true, failVitalsOnce: true });
  await page.goto('https://' + HOST + ARTICLE);
  await expect.poll(() => page.evaluate(() => DN._vitalsBound)).toBe(false);
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.evaluate(() => DN.bindWebVitals());
  await expect.poll(() => page.evaluate(() => typeof __fixtureVitalsSend)).toBe('function');
  await page.evaluate(() => __fixtureVitalsSend('LCP', 100, 'retry'));
  await expect.poll(() => requests.cwvEvents.length).toBe(1);
  expect(requests.cwvEvents[0].viewportBand).toBe('narrow');
  expect(await page.evaluate(() => __fixtureObservers)).toBe(1);
});

test('prerender captures context only after activation and ignores duplicate version parameters', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = await fixture(page, { vitals: true, prerender: true, sharedQuery: '?v=20260711&v=20999999' });
  await page.goto('https://' + HOST + ARTICLE);
  await expect.poll(() => page.evaluate(() => !!DN._engagementBound)).toBe(true);
  expect(requests.cwvEvents).toHaveLength(0);
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.evaluate(() => {
    window.__fixturePrerender = false;
    document.dispatchEvent(new Event('prerenderingchange'));
  });
  await expect.poll(() => page.evaluate(() => typeof __fixtureVitalsSend)).toBe('function');
  await page.evaluate(() => __fixtureVitalsSend('LCP', 100, 'activated'));
  await expect.poll(() => requests.cwvEvents.length).toBe(1);
  expect(requests.cwvEvents[0].viewportBand).toBe('wide');
  expect(requests.cwvEvents[0].assetEpoch).toBe('unknown');
});

for (const [width, band] of [[360, 'narrow'], [768, 'medium'], [1199, 'medium'], [1440, 'wide']]) {
  test(`unversioned executing script stays unknown at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const requests = await fixture(page, { vitals: true, sharedQuery: '' });
    await page.goto('https://' + HOST + ARTICLE);
    await expect.poll(() => page.evaluate(() => typeof __fixtureVitalsSend)).toBe('function');
    await page.evaluate(() => __fixtureVitalsSend('INP', 0, 'width-fixture'));
    await expect.poll(() => requests.cwvEvents.length).toBe(1);
    expect(requests.cwvEvents[0].viewportBand).toBe(band);
    expect(requests.cwvEvents[0].assetEpoch).toBe('unknown');
  });
}

test('prerender sends nothing until activation; GA4 config and vitals registration happen once', async ({ page }) => {
  const requests = await fixture(page, { prerender: true, ab: true });
  await page.goto('https://' + HOST + ARTICLE);
  await expect.poll(() => page.evaluate(() => !!window.DN?._engagementBound)).toBe(true);
  await page.evaluate(() => { DN.bindWebVitals(); DN.applyAbConfig(); DN.applyAbConfig(); });
  expect(requests.filter(url => /googletagmanager|_vercel|cwv-ingest/.test(url))).toEqual([]);
  expect(requests.filter(url => url === '/api/ab-config')).toEqual([]);
  await page.evaluate(() => {
    window.__fixturePrerender = false;
    document.dispatchEvent(new Event('prerenderingchange'));
    document.dispatchEvent(new Event('prerenderingchange'));
  });
  await expect.poll(() => page.evaluate(() => typeof window.HsiaoVitals?.observeVitals)).toBe('function');
  expect(requests.filter(url => url.includes('googletagmanager'))).toHaveLength(1);
  expect(await page.evaluate(() => dataLayer.filter(args => args[0] === 'config').length)).toBe(1);
  await expect(page.locator('script[src*="assets/vitals.min.js"]')).toHaveCount(1);
  await expect.poll(() => requests.abEvents.filter(event => event.event === 'exposure').length).toBe(1);
  expect(requests.filter(url => url === '/api/ab-config')).toHaveLength(1);
  const extraConfigRequests = await page.evaluate(async () => {
    const original = window.fetch;
    let requests = 0;
    window.fetch = function (url, options) {
      if (new URL(url, location.href).pathname === '/api/ab-config') requests++;
      return original.call(this, url, options);
    };
    try {
      await Promise.all([DN.applyAbConfig(), DN.applyAbConfig()]);
      return requests;
    } finally { window.fetch = original; }
  });
  expect(extraConfigRequests).toBe(0);
  expect(requests.filter(url => url === '/api/ab-config')).toHaveLength(1);
  expect(requests.abEvents.filter(event => event.event === 'exposure')).toHaveLength(1);
  await page.evaluate(() => DN.abConvert('prerender-fixture', 'click'));
  await expect.poll(() => requests.abEvents.length).toBe(2);
  expect(requests.abEvents.map(event => event.event)).toEqual(['exposure', 'click']);
  expect(requests.abEvents[0].variantIndex).toBe(requests.abEvents[1].variantIndex);
});
