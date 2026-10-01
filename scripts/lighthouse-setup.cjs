const { request } = require('playwright');
const { previewCookies, verifyContent } = require('./preview-access.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { collectFontEnvironment } = require('./font-environment.cjs');
let reportNumber = 0;

// The public cache-version guard can reload a fresh preparation page after
// goto(load) resolves. Recover only an observed extra main-frame navigation
// to the pinned route and a matching transient font/context error. All other
// errors, off-route redirects and repeated reloads remain failures.
async function collectPreparedFontEnvironment(page, base, route) {
  let navigations = 0;
  let notifyNavigation;
  const track = frame => {
    if (frame === page.mainFrame()) {
      navigations++;
      if (notifyNavigation) notifyNavigation();
    }
  };
  const awaitExtraNavigation = before => new Promise(resolve => {
    const finish = () => { clearTimeout(timer); notifyNavigation = undefined; resolve(); };
    const timer = setTimeout(finish, 1000);
    notifyNavigation = () => { if (navigations > before + 1) finish(); };
    notifyNavigation();
  });
  const sameRoute = value => {
    const actual = new URL(value), expected = new URL(route, base);
    const pathname = url => url.pathname.replace(/\/$/, '') || '/';
    return actual.origin === expected.origin && pathname(actual) === pathname(expected) &&
      actual.search === expected.search && actual.hash === expected.hash;
  };
  page.on('framenavigated', track);
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const before = navigations;
      let session;
      try {
        const response = await page.goto(route, { waitUntil:'load' });
        await verifyContent(page, base, route, response);
        session = await page.createCDPSession();
        const fonts = await collectFontEnvironment(page, session);
        return { ...fonts, preparationNavigationAttempts:attempt };
      } catch (error) {
        const transient = /Execution context was destroyed|^Font selection unavailable: /.test(error.message || '');
        if (attempt === 3 || !transient) throw error;
        // Context destruction may precede the new document's navigation event.
        // Waiting is bounded; retry still requires an actual extra navigation.
        if (navigations <= before + 1) await awaitExtraNavigation(before);
        if (navigations <= before + 1 || !sameRoute(page.url())) throw error;
      } finally {
        if (session) await session.detach();
      }
    }
  } finally {
    page.off('framenavigated', track);
  }
}

// Lighthouse uses this browser after setup; scoped cookies survive between runs.
module.exports = async (browser, context) => {
  const base = process.env.SITE_URL;
  const sha = process.env.CANDIDATE_SHA;
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Font report requires exact candidate SHA');
  const cookies = await previewCookies(base, request);
  if (cookies.length) await browser.setCookie(...cookies);
  const page = await browser.newPage();
  try {
    await page.setCacheEnabled(false);
    await page.setBypassServiceWorker(true);
    const fonts = await collectPreparedFontEnvironment(page, base, context.url);
    const dir = path.resolve('font-environment-results');
    fs.mkdirSync(dir, { recursive:true });
    const route = new URL(page.url()).pathname;
    const routeKey = route.replace(/[^a-z0-9-]+/gi, '-') || 'home';
    fs.writeFileSync(path.join(dir, 'fonts-' + routeKey + '-' + process.pid + '-' + (++reportNumber) + '.json'), JSON.stringify({
      sha, route, checkedAt:new Date().toISOString(), ...fonts,
      scope:'CI preparation page; font selection and fallback dimensions, not a Lighthouse CLS result or real-user metrics',
    }, null, 2), { flag:'wx' });
  } finally { await page.close(); }
};

module.exports.collectPreparedFontEnvironment = collectPreparedFontEnvironment;
