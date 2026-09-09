const fs = require('node:fs');
const { chromium, request } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const { previewCookies, verifyContent } = require('./preview-access.cjs');
const { prepareA11yPage } = require('./a11y-rendering.cjs');

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
        // These controls mount in idle callbacks. Auditing only the initial
        // document can falsely pass before inaccessible controls even exist.
        const controls = {
          '/blog/dry-eye-myths': ['#hs-font-sizer', '#hs-osdi', '#hs-deq5'],
          '/blog/pediatric-myopia-control': ['#hs-font-sizer', '#hs-se'],
          '/blog/floaters-retinal-detachment': ['#hs-font-sizer', '#hs-floater-rf'],
          '/blog/lacrimal-gland-tumor': ['#hs-font-sizer'],
          '/tools': ['#hs-osdi', '#hs-deq5', '#hs-snellen', '#hs-se', '#hs-floater-rf'],
        };
        for (const selector of controls[route] || []) {
          await page.locator(selector).waitFor({ state: 'attached' });
        }
        // Paint the content-visibility:auto footer before measuring colors.
        // Otherwise an offscreen footer can be measured against the white page
        // instead of its actual dark background (reproduced with en-US).
        await prepareA11yPage(page);
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
