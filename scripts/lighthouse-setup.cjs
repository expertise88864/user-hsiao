const { request } = require('playwright');
const { previewCookies, verifyContent } = require('./preview-access.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { collectFontEnvironment } = require('./font-environment.cjs');
let reportNumber = 0;

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
    const response = await page.goto(context.url, { waitUntil: 'load' });
    await verifyContent(page, base, context.url, response);
    const session = await page.createCDPSession();
    let fonts;
    try { fonts = await collectFontEnvironment(page, session); }
    finally { await session.detach(); }
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
