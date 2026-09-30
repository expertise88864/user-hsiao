const { test, expect } = require('@playwright/test');

const pilots = ['lacrimal-gland-tumor', 'dry-eye-myths',
  'floaters-retinal-detachment', 'pediatric-myopia-control', 'glaucoma-comprehensive-guide'];
test.use({ serviceWorkers: 'block' });

for (const language of ['zh', 'en']) {
  test(`default reader size is available without JavaScript in ${language}`, async ({ browser }, info) => {
    const context = await browser.newContext({ javaScriptEnabled: false,
      viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      for (const slug of pilots) {
        await page.goto(info.project.use.baseURL + (language === 'en' ? '/en' : '') + '/blog/' + slug);
        await expect(page.locator('html')).toHaveAttribute('lang', language === 'en' ? 'en' : 'zh-Hant-TW');
        // Full English mirrors retain proseZh; translation stubs use proseEn.
        const prose = page.locator('.prose:visible');
        await expect(prose).toHaveCount(1);
        await expect(prose).toBeVisible();
        await expect(prose).toHaveCSS('font-size', '16.5px');
        await expect(prose.locator('p').first()).toHaveCSS('font-size', '16.5px');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    } finally { await context.close(); }
  });
}

for (const width of [390, 1440]) {
  for (const size of ['S', 'M', 'L']) {
    test(`saved ${size} and keyboard size changes at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript(size => localStorage.setItem('hs-font-size', size), size);
      await page.goto('/blog/glaucoma-comprehensive-guide');
      const expected = { S: '15px', M: '16.5px', L: '18.5px' };
      const paragraph = page.locator('#proseZh p').first();
      const chosen = page.locator('#hs-font-size-' + size);
      await expect(chosen).toHaveAttribute('aria-pressed', 'true');
      await expect(paragraph).toHaveCSS('font-size', expected[size]);
      await page.evaluate(() => scrollTo(0, 650));
      for (const next of ['L', 'S', 'M']) {
        const button = page.locator('#hs-font-size-' + next);
        // Visibility alone does not mean the scroll-triggered region is interactive.
        await expect(page.locator('#hs-font-sizer')).toHaveAttribute('aria-hidden', 'false');
        await expect(page.locator('#hs-font-sizer')).toHaveJSProperty('inert', false);
        await button.focus();
        await expect(button).toBeFocused();
        await button.press('Enter');
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await expect(paragraph).toHaveCSS('font-size', expected[next]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    });
  }
}

test('static screen default does not change print typography', async ({ browser }, info) => {
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    await page.goto(info.project.use.baseURL + '/blog/glaucoma-comprehensive-guide');
    await page.emulateMedia({ media: 'print' });
    const before = await page.locator('#proseZh p').first().evaluate(p => getComputedStyle(p).fontSize);
    // Remove only the new screen default to compare the actual print cascade.
    await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        if (!sheet.href || !new URL(sheet.href).pathname.endsWith('/article.css')) continue;
        for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
          const rule = sheet.cssRules[i];
          if (rule.conditionText === 'screen' && rule.cssText.includes('16.5px')) sheet.deleteRule(i);
        }
      }
    });
    const after = await page.locator('#proseZh p').first().evaluate(p => getComputedStyle(p).fontSize);
    expect(before).toBe(after);
  } finally { await context.close(); }
});
