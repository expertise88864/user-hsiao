const { request } = require('playwright');
const { previewCookies, verifyContent } = require('./preview-access.cjs');

// Lighthouse uses this browser after setup; scoped cookies survive between runs.
module.exports = async (browser, context) => {
  const base = process.env.SITE_URL;
  const cookies = await previewCookies(base, request);
  if (cookies.length) await browser.setCookie(...cookies);
  const page = await browser.newPage();
  try {
    await page.setCacheEnabled(false);
    await page.setBypassServiceWorker(true);
    const response = await page.goto(context.url, { waitUntil: 'load' });
    await verifyContent(page, base, context.url, response);
  } finally { await page.close(); }
};
