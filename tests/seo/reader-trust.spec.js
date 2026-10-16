const { test, expect, chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { prepareA11yPage } = require('../../scripts/a11y-rendering.cjs');
test.use({ serviceWorkers: 'block' });

async function fit(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const prefix of ['', '/en']) {
  for (const width of [360, 390, 768, 1440]) {
    for (const colorScheme of ['light', 'dark']) {
      test(`published notes route ${prefix || 'zh'} ${width} ${colorScheme}`, async ({ browser, baseURL }) => {
        const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, locale: 'zh-TW', serviceWorkers: 'block' });
        try {
          const page = await context.newPage();
          await page.goto(baseURL + (prefix || '') + '/');
          const notes = page.locator(`main a[href="${prefix}/notes"]`).first();
          await notes.press('Enter');
          await expect(page).toHaveURL(baseURL + prefix + '/notes');
          await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
          await expect(page.locator('#published-notes-title')).toContainText(prefix ? 'published research notes' : '已發布的研究筆記');
          await fit(page);
          for (const slug of ['dry-eye-symptom-sign-discordance-dream', 'monitoring-myopia-ser-vs-axial-length']) {
            await page.locator(`main a[href="${prefix}/blog/${slug}"]`).press('Enter');
            await expect(page).toHaveURL(baseURL + prefix + '/blog/' + slug);
            await expect(page.locator('h1')).toBeVisible();
            await page.goto(baseURL + prefix + '/notes');
          }
          // Owner decision 2026-10-17: the about page no longer carries the
          // 「內容來源、更新與更正」 section.
          await page.goto(baseURL + prefix + '/about');
          await expect(page.locator('#editorial-policy')).toHaveCount(0);
          await fit(page);
        } finally { await context.close(); }
      });
    }
    test(`reading routes remain usable without JS ${prefix || 'zh'} ${width}`, async ({ browser, baseURL }) => {
      const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 900 }, serviceWorkers: 'block' });
      try {
        const page = await context.newPage();
        await page.goto(baseURL + prefix + '/notes');
        await page.locator(`main a[href="${prefix}/blog/monitoring-myopia-ser-vs-axial-length"]`).click();
        await expect(page.locator('h1')).toBeVisible();
        await page.goto(baseURL + prefix + '/about');
        await expect(page.locator('h1')).toBeVisible(); await fit(page);
        await page.goto(baseURL + prefix + '/blog/topics');
        await page.locator(`main a[href="${prefix}/blog/cataract-comprehensive-guide"]`).first().click();
        await expect(page).toHaveURL(new RegExp(prefix + '/blog/cataract-comprehensive-guide$'));
        await page.goto(page.url() + '#postop');
        await expect(page.locator('#postop')).toBeInViewport(); await fit(page);
        await page.goto(baseURL + prefix + '/blog');
        // The authored index uses canonical links; JS localizes them when enabled.
        await page.locator('.article-list-item[href="/blog/dry-eye-myths"]').click();
        await expect(page.locator('h1')).toBeVisible();
      } finally { await context.close(); }
    });
  }
  test(`existing search still finds dry-eye education ${prefix || 'zh'}`, async ({ page }) => {
    await page.goto(prefix + '/blog');
    await page.locator('#hs-blog-search').fill(prefix ? 'Dry Eye' : '乾眼');
    await page.locator('.article-list-item[href$="/blog/dry-eye-myths"]').click();
    await expect(page).toHaveURL(/\/blog\/dry-eye-myths$/);
    await expect(page.locator('h1')).toContainText(prefix ? 'Dry-Eye Myths' : '乾眼');
  });
  for (const colorScheme of ['light', 'dark']) {
    test(`changed information pages pass rendered axe ${prefix || 'zh'} ${colorScheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      for (const route of ['/notes', '/about', '/blog/topics']) {
        await page.goto(prefix + route);
        await prepareA11yPage(page);
        const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'best-practice']).analyze();
        expect(result.violations).toEqual([]);
        const footerLink = page.locator('.mag-foot-cols a').first();
        await footerLink.hover();
        await footerLink.evaluate(async el => {
          await Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {})));
        });
        const hover = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
        expect(hover.violations).toEqual([]);
      }
    });
  }
  test(`native 200 percent zoom preserves notes and information pages ${prefix || 'zh'}`, async ({ baseURL }) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hsiaoeye-trust-zoom-'));
    fs.mkdirSync(path.join(profile, 'Default'));
    fs.writeFileSync(path.join(profile, 'Default/Preferences'), JSON.stringify({ partition: { default_zoom_level: { x: Math.log(2) / Math.log(1.2) } } }));
    let context;
    try {
      context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined, args: ['--window-size=1440,1000'], serviceWorkers: 'block' });
      const page = await context.newPage();
      for (const route of ['/notes', '/about', '/blog/topics']) {
        await page.goto(baseURL + prefix + route);
        const cdp = await context.newCDPSession(page);
        const layout = await cdp.send('Page.getLayoutMetrics');
        expect(layout.cssVisualViewport.zoom).toBe(2); expect(layout.cssVisualViewport.scale).toBe(1); await cdp.detach();
        await fit(page);
        // /about has no in-content links since the 2026-10-17 removal of its
        // corrections section; its keyboard entry point is the shared header.
        const link = (await page.locator('main a').count()) ? page.locator('main a').first() : page.locator('header a').first();
        await link.focus(); await expect(link).toBeFocused();
      }
    } finally {
      if (context) await context.close();
      const resolved = path.resolve(profile);
      if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('hsiaoeye-trust-zoom-')) throw Error('Unsafe profile cleanup');
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  });
}
