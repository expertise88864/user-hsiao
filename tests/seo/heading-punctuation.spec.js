const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

for (const slug of ['dry-eye-myths', 'floaters-retinal-detachment', 'pediatric-myopia-control']) {
  for (const width of [390, 1350]) {
    test(`heading stays consistent through delayed language startup: ${slug}/${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 940 });
      const origin = new URL(test.info().project.use.baseURL).origin;
      await page.route('**/*', route => new URL(route.request().url()).origin === origin
        ? route.continue() : route.abort());
      let release;
      const held = new Promise(resolve => { release = resolve; });
      await page.route('**/blog/blog-shared.min.js*', async route => {
        await held;
        await route.continue();
      });
      const heading = page.locator('main h1');
      const sample = () => heading.evaluate(node => ({
        text: node.textContent,
        height: node.getBoundingClientRect().height,
        width: node.getBoundingClientRect().width,
      }));
      let before;
      try {
        await page.goto('/blog/' + slug, { waitUntil: 'commit' });
        await expect(heading).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => typeof window.DN)).toBe('undefined');
        before = await sample();
        expect(before.text).toContain('？');
      } finally { release(); }
      await page.waitForLoadState('load');
      expect(await page.evaluate(() => DN.detectLang())).toBe('zh');
      const after = await sample();
      expect(after.text).toBe(before.text);
      expect(after.height).toBe(before.height);
      expect(after.width).toBe(before.width);
      const bilingual = heading.locator('[data-en]');
      const english = await bilingual.evaluateAll(nodes => nodes.map(node => node.dataset.en));
      await page.locator('#langToggle').selectOption('en');
      await expect(bilingual).toHaveText(english);
      await page.locator('#langToggle').selectOption('zh');
      await expect(heading).toHaveText(before.text);
      expect((await sample()).height).toBe(before.height);
      expect(await page.evaluate(() => DN.telemetryAllowed())).toBe(false);
    });
  }
}
