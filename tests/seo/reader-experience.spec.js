const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });

for (const prefix of ['', '/en']) {
  // Owner decision 2026-10-15: the homepage hero keeps its title and lede but
  // has no audience buttons and no reading lanes.
  test(`homepage hero keeps the lede without audience lanes ${prefix || 'zh'}`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled:false, viewport:{width:390,height:844} });
    const page = await context.newPage();
    const base = test.info().project.use.baseURL;
    await page.goto(base + prefix + '/');
    await expect(page.locator('.mag-title')).toBeVisible();
    await expect(page.locator('.mag-lede')).toHaveCount(1);
    await expect(page.locator('.hs-reader-ctas, .hs-reading-lanes, #patient-reading, #research-reading')).toHaveCount(0);
    await context.close();
  });
}

for (const prefix of ['', '/en']) {
 for (const slug of ['glaucoma-comprehensive-guide','cataract-surgery-selection','dry-eye-symptom-sign-discordance-dream','cataract-comprehensive-guide']) {
  // Owner decision 2026-10-17: the 「依照你的問題閱讀」 reading path is gone.
  test(`mobile article opens without the reading path: ${prefix}/${slug}`, async ({ page }) => {
    await page.setViewportSize({width:390,height:844});
    await page.goto(prefix + '/blog/' + slug);
    await expect(page.locator('.hs-reading-path')).toHaveCount(0);
    const breadcrumb = page.getByRole('navigation', {name:'Breadcrumb',exact:true});
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb.locator('a').first()).toHaveAttribute('href', prefix ? '/en' : '/');
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

for (const prefix of ['', '/en']) {
 for (const width of [360, 390, 768, 1440]) {
  test(`cataract answers are keyboard reachable without JavaScript: ${prefix || 'zh'} ${width}`, async ({ browser }) => {
    const context = await browser.newContext({javaScriptEnabled:false, viewport:{width,height:900}});
    const page = await context.newPage();
    try {
      await page.goto(test.info().project.use.baseURL + prefix + '/blog/cataract-comprehensive-guide');
      await expect(page.locator('.hs-reading-path')).toHaveCount(0);
      for (const id of ['surgical-methods','iol','postop','complications']) {
        await page.goto(test.info().project.use.baseURL + prefix + '/blog/cataract-comprehensive-guide#' + id);
        await expect(page).toHaveURL(new RegExp('#' + id + '$'));
        await expect(page.locator('#' + id)).toBeInViewport();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await context.close();
    }
  });
 }
}

test('search synonyms and a useful empty state work in the shipped bundle', async ({ page }) => {
  await page.route('**/api/search-log', route => route.fulfill({status:204}));
  await page.goto('/');
  await page.getByRole('button',{name:'搜尋',exact:true}).first().click();
  await page.locator('#hs-cmdk-input').fill('眼睛乾');
  await expect(page.locator('#hs-cmdk-results a.row').first()).toBeVisible();
  await page.locator('#hs-cmdk-input').fill('zzzznonexistent');
  await expect(page.locator('#hs-cmdk-empty a')).toHaveCount(2);
});


for (const [route, selector] of [['/', '.mag-hero'],['/blog/glaucoma-comprehensive-guide', 'header.sticky'], ['/blog/cataract-comprehensive-guide', 'header.sticky'], ['/en/blog/cataract-comprehensive-guide', 'header.sticky']]) {
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
