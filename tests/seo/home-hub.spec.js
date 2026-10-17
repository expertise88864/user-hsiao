const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
test.use({ serviceWorkers: 'block' });

// Owner requests 2026-10-17: homepage like chendermatologist.com — one
// 「快速查找眼科主題」 hub (search with live count, topic chips, topic cards)
// and a 最新文章 bento grid (pinned exam card full width, newest article as the
// large feature card). No 量表 header link, no 閱讀進度, no body disclaimer.

const visibleArticles = page => page.locator('#hs-article-list .article-list-item:visible');

test('hub chips and search filter the article grid with a live count', async ({ page }) => {
  await page.goto('/');
  const status = page.locator('#hs-hub-status');
  await expect(status).toHaveText('最新 5 篇・共 20 篇文章');
  await expect(visibleArticles(page)).toHaveCount(5);

  const glaucoma = page.locator('[data-hub-topic="青光眼"]');
  await expect(glaucoma).toBeEnabled();
  const n = Number(await glaucoma.locator('.hub-n').textContent());
  await glaucoma.click();
  await expect(glaucoma).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-hub-all]')).toHaveAttribute('aria-pressed', 'false');
  await expect(status).toHaveText(`青光眼：${n} 篇文章`);
  await expect(visibleArticles(page)).toHaveCount(n);
  await expect(page.locator('.hs-pin-card')).toBeHidden();
  const tags = await visibleArticles(page).evaluateAll(cards => cards.map(c => c.querySelector('.chip.tag').dataset.zh));
  expect(tags).toEqual(Array(n).fill('青光眼'));

  await glaucoma.click();   // pressing the active chip again clears it
  await expect(page.locator('[data-hub-all]')).toHaveAttribute('aria-pressed', 'true');
  await expect(visibleArticles(page)).toHaveCount(5);
  await expect(page.locator('.hs-pin-card')).toBeVisible();

  const research = page.locator('[data-hub-cat="research"]');
  const r = Number(await research.locator('.hub-n').textContent());
  await research.click();
  await expect(visibleArticles(page)).toHaveCount(r);
  await page.locator('[data-hub-all]').click();

  const search = page.locator('#hs-search-input');
  await search.fill('乾眼');
  await expect(status).toHaveText(/^找到 \d+ 篇文章$/);
  const hits = await visibleArticles(page).count();
  expect(hits).toBeGreaterThan(1);
  await expect(page.locator('#dn-search-empty')).toBeHidden();
  await search.fill('zzzz-no-such-article');
  await expect(status).toHaveText('找到 0 篇文章');
  await expect(page.locator('#dn-search-empty')).toBeVisible();
  await search.press('Escape');
  await expect(status).toHaveText('最新 5 篇・共 20 篇文章');
  await search.fill('乾眼');
  await search.press('Enter');   // stays on the homepage
  await expect(page).toHaveURL(/\/$/);
});

test('desktop: pinned card spans the grid, the newest article is the feature card', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const pin = await page.locator('.hs-pin-card').boundingBox();
  const cards = visibleArticles(page);
  const boxes = await Promise.all([0, 1, 2, 3, 4].map(i => cards.nth(i).boundingBox()));
  const list = await page.locator('#hs-article-list').boundingBox();
  expect(Math.abs(pin.width - list.width)).toBeLessThan(2);
  const [feature, second, third, fourth, fifth] = boxes;
  expect(feature.y).toBeGreaterThan(pin.y + pin.height - 1);
  expect(feature.width).toBeGreaterThan(second.width);       // 1.3fr vs 1fr
  expect(second.x).toBeGreaterThan(feature.x + feature.width - 1);
  expect(third.y).toBeGreaterThan(second.y);                  // stacked beside the feature
  expect(feature.height).toBeGreaterThan(second.height + third.height);
  expect(fourth.y).toBeGreaterThanOrEqual(feature.y + feature.height - 1);
  expect(Math.abs(fourth.y - fifth.y)).toBeLessThan(2);
  const dates = await cards.locator('time').allTextContents();
  expect(dates).toEqual([...dates].sort().reverse());
});

test('phone: one column, 44px chips, no tools link in the menu', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto('/');
  const cards = visibleArticles(page);
  const a = await cards.nth(0).boundingBox(), b = await cards.nth(1).boundingBox();
  expect(Math.abs(a.x - b.x)).toBeLessThan(2);
  expect(b.y).toBeGreaterThan(a.y + a.height - 1);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  const chip = await page.locator('[data-hub-topic="青光眼"]').boundingBox();
  expect(chip.height).toBeGreaterThanOrEqual(44);
  await page.locator('#hsMobileMenuBtn').click();
  await expect(page.locator('#hsMobileDrawer a[href="/exam"]')).toBeVisible();
  await expect(page.locator('#hsMobileDrawer a[href="/tools"]')).toHaveCount(0);
  await expect(page.locator('header a[href="/tools"]')).toHaveCount(0);
  await context.close();
});

test('English hub works in English', async ({ page }) => {
  await page.goto('/en');
  await expect(page.locator('#hs-hub-status')).toHaveText('Latest 5 of 20 articles');
  await page.locator('[data-hub-topic="白內障"]').click();
  await expect(page.locator('#hs-hub-status')).toHaveText(/^Cataract: \d+ articles?$/);
});

test('homepage has no reading-progress widget and no body disclaimer', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.DN && document.readyState === 'complete');
  await page.evaluate(() => new Promise(r => (window.requestIdleCallback || setTimeout)(r, { timeout: 2000 })));
  await expect(page.locator('#hs-read-progress')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('閱讀進度');
  await expect(page.locator('main')).not.toContainText('免責聲明');
  await expect(page.locator('footer .mag-foot-disclaimer')).toContainText('不構成個別醫療建議');
});

for (const colorScheme of ['light', 'dark']) {
  test(`hub and article grid pass axe (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForFunction(() => window.DN && document.querySelector('[data-hub-all]') && !document.querySelector('[data-hub-all]').disabled);
    const results = await new AxeBuilder({ page }).include('#hs-hub').include('#articles').include('#hs-support-section')
      .withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}
