const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });

for (const prefix of ['', '/en']) {
  test(`equal audience entry points work without JavaScript ${prefix || 'zh'}`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled:false, viewport:{width:390,height:844} });
    const page = await context.newPage();
    const base = test.info().project.use.baseURL;
    await page.goto(base + prefix + '/');
    const links = page.locator('.hs-reader-ctas a');
    await expect(links).toHaveCount(2);
    await expect(page.locator('.hs-reading-lanes')).toHaveAccessibleName(
      prefix ? 'Patient education Research notes' : '一般衛教 醫師研究筆記');
    for (const audience of ['patient', 'research']) {
      const link = page.locator(`.hs-reader-ctas [data-reader-route="${audience}"]`);
      await link.click();
      await expect(page).toHaveURL(new RegExp('#' + audience + '-reading$'));
      await expect(page.locator('#' + audience + '-reading h2')).toBeInViewport();
    }
    await context.close();
  });
}

for (const prefix of ['', '/en']) {
 for (const slug of ['glaucoma-comprehensive-guide','cataract-surgery-selection','dry-eye-symptom-sign-discordance-dream']) {
  test(`mobile question shortcuts reach visible sections: ${prefix}/${slug}`, async ({ page }) => {
    await page.setViewportSize({width:390,height:844});
    await page.goto(prefix + '/blog/' + slug);
    const nav = page.locator('.hs-reading-path');
    await expect(nav).toBeVisible();
    await expect(nav).toHaveAccessibleName(prefix ? 'Choose what you want to understand' : '依照你的問題閱讀');
    const breadcrumb = page.getByRole('navigation', {name:'Breadcrumb',exact:true});
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb.locator('a').first()).toHaveAttribute('href', prefix ? '/en' : '/');
    expect((await nav.boundingBox()).y).toBeLessThan(750);
    const links = nav.locator('a');
    await expect(links).toHaveCount(4);
    for (const link of await links.all()) {
      const id = (await link.getAttribute('href')).slice(1);
      await link.click();
      await expect(page.locator(`[id="${id}"]`)).toBeInViewport();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
 }
}

test('related reads lead to the same disease; automated local visits do not collect vitals', async ({ page }) => {
  await page.goto('/blog/glaucoma-comprehensive-guide');
  await expect(page.locator('#hs-related a').first()).toHaveAttribute('href','/blog/glaucoma-treatment-selection');
  await expect.poll(() => page.evaluate(() => !!window.DN?._engagementBound)).toBe(true);
  expect(await page.evaluate(() => window.DN.telemetryAllowed())).toBe(false);
  await expect(page.locator('script[src*="assets/vitals.min.js"]')).toHaveCount(0);
});

test('search synonyms and a useful empty state work in the shipped bundle', async ({ page }) => {
  await page.route('**/api/search-log', route => route.fulfill({status:204}));
  await page.goto('/');
  await page.getByRole('button',{name:'搜尋',exact:true}).first().click();
  await page.locator('#hs-cmdk-input').fill('眼睛乾');
  await expect(page.locator('#hs-cmdk-results a.row').first()).toBeVisible();
  await page.locator('#hs-cmdk-input').fill('zzzznonexistent');
  await expect(page.locator('#hs-cmdk-empty a')).toHaveCount(2);
});


for (const [route, selector] of [['/', '.hs-reading-lanes'], ['/blog/glaucoma-comprehensive-guide', '.hs-reading-path']]) {
  test(`reading links remain accessible in dark mode: ${route}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(route);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator(selector).scrollIntoViewIfNeeded();
    const AxeBuilder = require('@axe-core/playwright').default;
    const result = await new AxeBuilder({ page }).include(selector)
      .withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(result.violations).toEqual([]);
  });
}

test('a related-card click emits exactly one contextual analytics event', async ({ page }) => {
  await page.route('**/*googletagmanager.com/**', route => route.abort());
  await page.goto('/blog/glaucoma-comprehensive-guide');
  await expect.poll(() => page.evaluate(() => !!window.DN?._engagementBound)).toBe(true);
  await page.evaluate(() => {
    // Isolate contextual event deduplication from collection eligibility;
    // telemetry-eligibility.spec.js exercises the real production policy.
    window.HsiaoTelemetry.allowed = () => true;
    window.readerTestEvents = [];
    window.gtag = (...args) => window.readerTestEvents.push(args);
    document.addEventListener('click', event => event.preventDefault());
  });
  await page.locator('#hs-related a').first().click();
  const events = await page.evaluate(() => window.readerTestEvents.filter(args => args[0] === 'event' && args[1] === 'related_click'));
  expect(events).toHaveLength(1);
  expect(events[0][2]).toMatchObject({
    destination: '/blog/glaucoma-treatment-selection', placement: 'related',
    target_slug: 'glaucoma-treatment-selection', article_slug: 'glaucoma-comprehensive-guide'
  });
});
