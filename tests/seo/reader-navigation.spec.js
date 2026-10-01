const { test, expect } = require('@playwright/test');
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
test.use({ serviceWorkers: 'block' });

for (const slug of ['dry-eye-myths', 'pediatric-myopia-control', 'glaucoma-comprehensive-guide']) {
  for (const prefix of ['', '/en']) {
    test(`static contents native links work without JavaScript: ${prefix}/${slug}`, async ({ browser }) => {
      const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
      try {
        const page = await context.newPage();
        await page.goto(test.info().project.use.baseURL + prefix + '/blog/' + slug);
        const toc = page.locator('#hs-inline-toc');
        await expect(toc).toHaveCount(1);
        await expect(toc).toBeVisible();
        await expect(toc.locator('summary')).toContainText(prefix ? 'In this article' : '本篇大綱');
        for (const link of await toc.locator('a').all()) {
          const id = decodeURIComponent((await link.getAttribute('href')).slice(1));
          await link.click();
          await expect(page.locator(`[id=${JSON.stringify(id)}]`)).toBeInViewport();
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      } finally { await context.close(); }
    });
  }
  test(`contents exists before a delayed shared runtime and survives language changes: ${slug}`, async ({ page }) => {
    let release;
    const ready = new Promise(resolve => { release = resolve; });
    await page.route('**/blog/blog-shared.min.js*', async route => { await ready; await route.continue(); });
    await page.goto('/blog/' + slug, { waitUntil: 'commit' });
    const toc = page.locator('#hs-inline-toc');
    try {
      await expect(toc).toBeVisible();
      expect(await page.evaluate(() => typeof window.DN)).toBe('undefined');
    } finally { release(); }
    await page.waitForLoadState('load');
    await expect(toc).toHaveCount(1);
    for (const language of ['en', 'zh', 'en']) {
      await page.locator('#langToggle').selectOption(language);
      await expect(toc.locator('summary')).toContainText(language === 'en' ? 'In this article' : '本篇大綱');
      for (const link of await toc.locator('a').all()) {
        const id = decodeURIComponent((await link.getAttribute('href')).slice(1));
        await link.click();
        await expect(page.locator(`[id=${JSON.stringify(id)}]`)).toBeInViewport();
      }
    }
    expect(await page.evaluate(() => DN.telemetryAllowed())).toBe(false);
  });
}

for (const prefix of ['', '/en']) {
  test(`all generated contents labels match visible authored headings without JavaScript: ${prefix || 'zh'}`, async ({ browser }) => {
    const blog = path.resolve(__dirname, '../../blog');
    const slugs = readdirSync(blog).filter(file => file.endsWith('.html') &&
      readFileSync(path.join(blog, file), 'utf8').includes('<!-- hs-static-toc:start -->'));
    expect(slugs.length).toBeGreaterThan(0);
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    try {
      const page = await context.newPage();
      for (const file of slugs) {
        await page.goto(test.info().project.use.baseURL + prefix + '/blog/' + file.replace(/\.html$/, ''));
        await expect(page.locator('#hs-inline-toc')).toHaveCount(1);
        for (const link of await page.locator('#hs-inline-toc a').all()) {
          const id = decodeURIComponent((await link.getAttribute('href')).slice(1));
          const target = page.locator(`[id=${JSON.stringify(id)}]`);
          await expect(target).toBeVisible();
          expect((await link.textContent()).replace(/\s+/g, ' ').trim()).toBe(
            (await target.textContent()).replace(/\s+/g, ' ').trim());
        }
      }
    } finally { await context.close(); }
  });
}
