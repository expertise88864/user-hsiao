/* Read-only preview acceptance; never submits forms or changes visual baselines. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const base = new URL(process.env.PW_BASE_URL);
  assert.equal(base.protocol, 'https:');
  assert.ok(base.hostname.endsWith('.vercel.app'));
  const policy = JSON.parse(fs.readFileSync('_delivery_policy.json', 'utf8'));
  fs.mkdirSync('delivery-preview', { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'zh-TW' });
      try {
        for (const [index, route] of policy.preview_paths.entries()) {
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', e => errors.push(e.message));
          const response = await page.goto(new URL(route, base).href, { waitUntil: 'load' });
          assert.ok(response && response.status() === 200, route + ' must return HTTP 200');
          assert.equal(new URL(page.url()).hostname, base.hostname, 'Preview must not redirect to production/login');
          assert.ok((await page.title()).trim().length > 0, 'Document title missing');
          assert.ok(await page.locator('main').count() > 0, 'Main content missing');
          await page.screenshot({ path: 'delivery-preview/' + width + '-' + index + '.png', fullPage: true });
          assert.deepEqual(errors, [], 'Page JavaScript errors');
          await page.close();
        }
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
