const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });

// Owner decision 2026-10-17: the 「依照你的問題閱讀」 reading-path block was
// removed from every article. The sections it pointed to must still exist and
// stay reachable by in-page links (TOC, FAQ, shared URLs with a hash).
const pilots = {
  'lacrimal-gland-tumor': ['overview', 'myth-1', 'myth-3', 'myth-6'],
  'dry-eye-myths': ['myth-1', 'myth-2', 'myth-6', 'self-care'],
  'floaters-retinal-detachment': ['myth-1', 'myth-2', 'myth-3', 'myth-5'],
  'pediatric-myopia-control': ['myth-1', 'myth-3', 'myth-4', 'self-care'],
};

async function checkSections(page, slug, language) {
  await expect(page.locator('.hs-reading-path')).toHaveCount(0);
  for (const anchor of pilots[slug]) {
    const target = anchor + (language === 'en' ? '-en' : '');
    const section = page.locator(`[id="${target}"]`);
    await expect(section).toHaveCount(1);
    await section.scrollIntoViewIfNeeded();
    await expect(section).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const slug of Object.keys(pilots)) {
  for (const prefix of ['', '/en']) {
    const language = prefix ? 'en' : 'zh';
    for (const width of [390, 1440]) {
      test(`pilot sections remain without the reading path ${slug} ${language} ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${prefix}/blog/${slug}`);
        await checkSections(page, slug, language);
      });
    }

    test(`pilot sections are reachable by hash without JavaScript ${slug} ${language}`, async ({ browser }) => {
      const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
      try {
        const page = await context.newPage();
        const target = pilots[slug][1] + (language === 'en' ? '-en' : '');
        await page.goto(test.info().project.use.baseURL + `${prefix}/blog/${slug}#${target}`);
        await expect(page.locator(`[id="${target}"]`)).toBeInViewport();
        await checkSections(page, slug, language);
      } finally { await context.close(); }
    });
  }

  test(`pilot sections follow runtime language changes ${slug}`, async ({ page }) => {
    await page.goto(`/blog/${slug}`);
    await expect(page.locator('#langToggle')).toBeVisible();
    await page.locator('#langToggle').selectOption('en');
    await checkSections(page, slug, 'en');
    await page.locator('#langToggle').selectOption('zh');
    await checkSections(page, slug, 'zh');
  });
}
