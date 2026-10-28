const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });

// Owner request 2026-10-18: chapter notes styled like the dermatology exam section
// (chendermatologist.com/exam): superscript question labels after the tested phrase,
// a sticky 「本章目錄」 left column that follows the reader, and soft 易錯 / 易混淆 boxes.
// Plus: no 「8. 醫療免責」 on the privacy policy, no 「Schiffman 2000」 chip on /tools.

async function signedOut(page) {
  await page.route('**/api/exam/data**', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
}

test('superscript question labels are plain text that never jumps (owner 2026-10-28)', async ({ page }) => {
  await signedOut(page);
  await page.goto('/exam/bcsc8-6');
  await expect(page.locator('.ex-note sup.ex-qref a')).toHaveCount(0);
  const link = page.locator('.ex-note sup.ex-qref span', { hasText: /^Q960$/ }).first();
  await expect(link).toHaveText('Q960');
  // It sits right after the highlighted (tested) phrase, as a small superscript.
  expect(await link.evaluate(a => {
    const sup = a.closest('sup.ex-qref');
    let prev = sup.previousSibling;
    while (prev && prev.nodeType === 3 && !prev.nodeValue.replace('⁠', '')) prev = prev.previousSibling;
    // Raised above the phrase's baseline (the site's CSS reset sets sup via position/top).
    const raised = a.getBoundingClientRect().bottom < prev.getBoundingClientRect().bottom - 3;
    return [prev && prev.nodeName, prev && prev.className, raised, parseFloat(getComputedStyle(a).fontSize) < 12];
  })).toEqual(['MARK', 'ex-key', true, true]);
  await expect(page.locator('.ex-hit')).toHaveCount(0);
  // Clicking it stays on the page.
  await link.click();
  await expect(page).toHaveURL(/\/exam\/bcsc8-6$/);
});

test('desktop: the chapter outline is a sticky left column that follows the reader', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await signedOut(page);
  await page.goto('/exam/bcsc8-6');
  const side = page.getByRole('navigation', { name: '本章目錄' });
  await expect(side).toBeVisible();
  await expect(page.locator('nav.ex-toc')).toBeHidden();
  const note = await page.locator('.ex-note').boundingBox();
  const start = await side.boundingBox();
  expect(start.x + start.width).toBeLessThan(note.x);
  // Scroll deep into the notes: the outline stays in view below the sticky header
  // and marks the section being read.
  await page.evaluate(() => {
    const h = document.getElementById('ch6-s8');
    window.scrollTo(0, h.getBoundingClientRect().top + window.pageYOffset - 90);
  });
  await expect(side.locator('a[aria-current="location"]')).toHaveAttribute('href', '#ch6-s8');
  const box = await side.boundingBox();
  const headerBottom = await page.evaluate(() => document.querySelector('header').getBoundingClientRect().bottom);
  expect(box.y).toBeGreaterThanOrEqual(headerBottom);
  expect(box.y + box.height).toBeLessThanOrEqual(800);
  await expect(side.locator('a[aria-current="location"]')).toBeInViewport();
  // A long outline scrolls on its own, without horizontal page scroll.
  expect(await side.evaluate(n => getComputedStyle(n).overflowY)).toBe('auto');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Clicking an entry jumps to that section.
  await side.getByRole('link', { name: /^二、/ }).click();
  await expect(page.locator('#ch6-s2')).toBeInViewport();
  await expect(side.locator('a[aria-current="location"]')).toHaveAttribute('href', '#ch6-s2');
  await context.close();
});

test('phone: the inline outline stays, the sticky column is hidden, no horizontal scroll', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await signedOut(page);
  await page.goto('/exam/bcsc8-6');
  await expect(page.locator('.ex-toc-side')).toBeHidden();
  await expect(page.locator('nav.ex-toc')).toBeVisible();
  await expect(page.locator('.ex-note sup.ex-qref span', { hasText: /^Q960$/ }).first()).toBeAttached();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await context.close();
});

for (const scheme of ['light', 'dark']) {
  test(`易錯 and 易混淆 boxes, superscripts and page chips are soft but readable (${scheme})`, async ({ page }) => {
    await signedOut(page);
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/exam/bcsc1-10');
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    const trap = page.locator('.ex-note .ex-trap').first();
    const tip = page.locator('.ex-note .hs-tip-box').first();
    await expect(trap).toHaveCSS('border-left-width', '3px');
    await expect(trap).toHaveCSS('border-top-width', '0px');
    await expect(trap.locator('h3').first()).toHaveText('易錯陷阱');
    await expect(trap.locator('h3').first()).toHaveCSS('display', 'inline-block');
    await expect(trap.locator('li').first()).toHaveCSS('font-weight', '400');
    await expect(tip).toHaveCSS('border-left-width', '3px');
    await expect(tip.locator('h3, h4').first()).toHaveCSS('display', 'inline-block');
    await expect(page.locator('.ex-note .ref-ext').first()).toBeVisible();
    const AxeBuilder = require('@axe-core/playwright').default;
    const result = await new AxeBuilder({ page })
      .include('.ex-legend').include('.ex-note .ex-trap').include('.ex-note .hs-tip-box').include('.ex-toc-side')
      .include('.ex-note sup.ex-qref').include('.ex-note .ref').withRules(['color-contrast']).analyze();
    expect(result.violations.map(v => v.nodes.map(n => n.target.join(' ')).join(', '))).toEqual([]);
    expect(result.passes.length).toBeGreaterThan(0);
  });
}

test('privacy policy has no 醫療免責 section; /tools has no Schiffman 2000 chip', async ({ page }) => {
  await page.goto('/privacy');
  const headings = await page.locator('main h2').allTextContents();
  expect(headings.some(h => h.includes('醫療免責'))).toBe(false);
  expect(headings.filter(h => /^\d+\. /.test(h)).map(h => parseInt(h, 10))).toEqual([1, 2, 3, 4, 5, 6, 7]);
  await page.goto('/tools');
  await expect(page.locator('main')).not.toContainText('Schiffman 2000');
  await expect(page.locator('#osdi [data-calc="osdi"]')).toBeAttached();
  await expect(page.locator('#osdi .ref')).toHaveText(['DEWS II 2017']);
});
