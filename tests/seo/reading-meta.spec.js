const { test, expect } = require('@playwright/test');
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');

test.use({ serviceWorkers: 'block' });
const root = path.resolve(__dirname, '../..');
const files = readdirSync(path.join(root, 'blog')).filter(file => file.endsWith('.html') &&
  readFileSync(path.join(root, 'blog', file), 'utf8').includes('<!-- hs-static-reading-meta:start -->'));

for (const prefix of ['', '/en']) {
  test(`all registered articles expose truthful reader information without JavaScript: ${prefix || 'zh'}`, async ({ browser }, info) => {
    expect(files.length).toBeGreaterThan(0);
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
    try {
      const page = await context.newPage();
      for (const file of files) {
        await page.goto(info.project.use.baseURL + prefix + '/blog/' + file.replace(/\.html$/, ''));
        const bar = page.locator('#hs-reading-meta');
        await expect(bar).toHaveCount(1);
        await expect(bar).toBeVisible();
        await expect(bar).toContainText(prefix ? /\d+(?:\.\d+)? min read/ : /閱讀約 \d+(?:\.\d+)? 分鐘/);
        await expect(bar).toContainText(prefix ? 'Last updated ·' : '最後更新');
        await expect(bar).not.toContainText(prefix ? 'Last reviewed' : '審閱');
        await expect(bar.locator('a')).toHaveAttribute('href', prefix + '/about');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    } finally { await context.close(); }
  });
}

for (const slug of ['dry-eye-myths', 'pediatric-myopia-control', 'floaters-retinal-detachment']) {
  for (const width of [390, 1350]) {
    test(`initial reading information survives delayed runtime and language switches: ${slug}/${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 940 });
      let release;
      const ready = new Promise(resolve => { release = resolve; });
      await page.route('**/blog/blog-shared.min.js*', async route => { await ready; await route.continue(); });
      await page.goto('/blog/' + slug, { waitUntil: 'commit' });
      const bar = page.locator('#hs-reading-meta');
      try {
        await expect(bar).toBeVisible();
        expect(await page.evaluate(() => typeof window.DN)).toBe('undefined');
        await page.evaluate(() => { window.__testInitialReadingMeta = document.getElementById('hs-reading-meta'); });
      } finally { release(); }
      await page.waitForLoadState('load');
      await expect(bar).toHaveCount(1);
      expect(await page.evaluate(() => window.__testInitialReadingMeta === document.getElementById('hs-reading-meta'))).toBe(true);
      for (const language of ['en', 'zh', 'en']) {
        await page.locator('#langToggle').selectOption(language);
        await expect(bar).toContainText(language === 'en' ? /\d+(?:\.\d+)? min read/ : /閱讀約 \d+(?:\.\d+)? 分鐘/);
        await expect(bar).toContainText(language === 'en' ? 'Last updated ·' : '最後更新');
        await expect(bar).toHaveCount(1);
      }
      expect(await page.evaluate(() => DN.telemetryAllowed())).toBe(false);
    });
  }
}
