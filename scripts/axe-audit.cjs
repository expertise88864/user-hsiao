const fs = require('node:fs');
const { chromium, request } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const { previewCookies, verifyContent } = require('./preview-access.cjs');

(async () => {
  const base = process.env.SITE_URL;
  const cookies = await previewCookies(base, request);
  const browser = await chromium.launch();
  const results = [];
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.addCookies(cookies);
    for (const route of ['/', '/blog/', '/blog/dry-eye-myths', '/blog/pediatric-myopia-control',
      '/blog/floaters-retinal-detachment', '/blog/lacrimal-gland-tumor', '/tools']) {
      const page = await context.newPage();
      try {
        const response = await page.goto(new URL(route, base).href, { waitUntil: 'load' });
        await verifyContent(page, base, route, response);
        const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'best-practice']).analyze();
        results.push(result);
        console.log(route + ': ' + result.violations.length + ' accessibility violations');
      } finally { await page.close(); }
    }
    if (results.some(result => result.violations.length)) throw new Error('Accessibility violations require correction');
  } finally {
    fs.writeFileSync('axe-report.json', JSON.stringify(results, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
