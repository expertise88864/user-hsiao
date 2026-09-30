const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
test.use({ serviceWorkers: 'block' });

const pilots = {
  'lacrimal-gland-tumor': ['overview', 'myth-1', 'myth-3', 'myth-6'],
  'dry-eye-myths': ['myth-1', 'myth-2', 'myth-6', 'self-care'],
  'floaters-retinal-detachment': ['myth-1', 'myth-2', 'myth-3', 'myth-5'],
  'pediatric-myopia-control': ['myth-1', 'myth-3', 'myth-4', 'self-care'],
};

async function checkLinks(page, slug, language) {
  const nav = page.locator('.hs-reading-path');
  await expect(nav).toHaveCount(1);
  await expect(nav).toBeVisible();
  await expect(nav).toHaveAccessibleName(language === 'en'
    ? 'Choose what you want to understand' : '依照你的問題閱讀');
  const links = nav.locator('a');
  await expect(links).toHaveCount(4);
  for (const [index, anchor] of pilots[slug].entries()) {
    const target = anchor + (language === 'en' ? '-en' : '');
    const link = links.nth(index);
    await expect(link).toHaveAttribute('href', '#' + target);
    await link.click();
    await expect(page.locator(`[id="${target}"]`)).toBeVisible();
    await expect(page.locator(`[id="${target}"]`)).toBeInViewport();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const slug of Object.keys(pilots)) {
  for (const prefix of ['', '/en']) {
    const language = prefix ? 'en' : 'zh';
    for (const width of [360, 390, 768, 1440]) {
      test(`pilot question links ${slug} ${language} ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${prefix}/blog/${slug}`);
        await checkLinks(page, slug, language);
      });
    }

    test(`pilot question links work without JavaScript ${slug} ${language}`, async ({ browser }) => {
      const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
      try {
        const page = await context.newPage();
        await page.goto(test.info().project.use.baseURL + `${prefix}/blog/${slug}`);
        await checkLinks(page, slug, language);
      } finally { await context.close(); }
    });

    test(`pilot question links support dark mode and keyboard ${slug} ${language}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${prefix}/blog/${slug}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      const nav = page.locator('.hs-reading-path');
      await nav.scrollIntoViewIfNeeded();
      expect((await new AxeBuilder({ page }).include('.hs-reading-path')
        .withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
      const first = nav.locator('a').first();
      await first.focus();
      await expect(first).toBeFocused();
      await first.press('Tab');
      const second = nav.locator('a').nth(1);
      await expect(second).toBeFocused();
      const target = (await second.getAttribute('href')).slice(1);
      await second.press('Enter');
      await expect(page.locator(`[id="${target}"]`)).toBeInViewport();
    });
  }

  test(`pilot question targets follow runtime language changes ${slug}`, async ({ page }) => {
    await page.goto(`/blog/${slug}`);
    await expect(page.locator('#langToggle')).toBeVisible();
    await page.locator('#langToggle').selectOption('en');
    await checkLinks(page, slug, 'en');
    await page.locator('#langToggle').selectOption('zh');
    await checkLinks(page, slug, 'zh');
  });
}
