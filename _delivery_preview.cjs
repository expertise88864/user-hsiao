/* Read-only preview acceptance; never submits forms or changes visual baselines. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, request } = require('playwright');
const { previewCookies, verifyContent, verifyRuntimeIdentity } = require('./scripts/preview-access.cjs');
const { captureEditorTasks } = require('./scripts/preview-editor-tasks.cjs');
const { createMeter } = require('./scripts/vercel-request-meter.cjs');

const MAX_CAPTURE_HEIGHT = 16000;

(async () => {
  const base = new URL(process.env.PW_BASE_URL);
  assert.equal(base.protocol, 'https:');
  assert.ok(base.hostname.endsWith('.vercel.app'));
  const policy = JSON.parse(fs.readFileSync('_delivery_policy.json', 'utf8'));
  const meter = createMeter('delivery preview', base.href);
  const cookies = await previewCookies(base.href, request);
  fs.mkdirSync('delivery-preview', { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1440]) {
      for (const [index, route] of policy.preview_paths.entries()) {
        // Each route represents a first visit; prior routes must not seed preferences.
        // Content checks never need the service worker; scripts/sw-smoke.cjs tests it.
        const context = meter.attach(await browser.newContext({ viewport: { width, height: 900 }, locale: 'zh-TW',
          serviceWorkers: 'block' }));
        try {
          await context.addCookies(cookies);
          if (width === 390 && index === 0) {
            const identity = await verifyRuntimeIdentity(context.request, base.href,
              process.env.GITHUB_SHA, policy.repository);
            fs.writeFileSync('delivery-preview/runtime-identity.json', JSON.stringify({
              checkedAt: new Date().toISOString(), preview: base.origin, ...identity,
            }, null, 2));
          }
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', e => errors.push(e.message));
          const response = await page.goto(new URL(route, base).href, { waitUntil: 'load' });
          await verifyContent(page, base.href, route, response);
          assert.match(await page.locator('html').getAttribute('lang'),
            route.startsWith('/en/') ? /^en(?:-|$)/i : /^zh(?:-|$)/i,
            'Preview language must match the first-visit route');
          // Chromium cannot reliably capture past its ~16384 px texture limit: the
          // 23,707 px /en/blog/cataract page at 390 px intermittently failed with
          // "Unable to capture screenshot". The capture is evidence only (content is
          // asserted above), so keep it within the limit.
          const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
          await page.screenshot({ path: 'delivery-preview/' + width + '-' + index + '.png', fullPage: true,
            clip: { x: 0, y: 0, width, height: Math.min(pageHeight, MAX_CAPTURE_HEIGHT) } });
          assert.deepEqual(errors, [], 'Page JavaScript errors');
          await page.close();
        } finally { await context.close(); }
      }
    }
    await captureEditorTasks(browser, base, cookies, process.env.GITHUB_SHA, policy.repository, meter);
  } finally { await browser.close(); meter.report(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
