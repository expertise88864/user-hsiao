const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });

// Owner decision 2026-10-28: 「本章考點」 on chapter pages and one 考點總覽 page
// (/exam/concepts) with keyword search, chapter filter, sort and 「載入更多」 every 25,
// mirrored in ?kw=&ch=&sort=, and the whole list visible without JavaScript.
// Question numbers are plain text, never links.

async function signedOut(page) {
  await page.route('**/api/exam/data**', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
}
const items = page => page.locator('#ex-cpt-all > details.ex-cpt');
const visible = page => page.locator('#ex-cpt-all > details.ex-cpt:visible');

test('overview: 25 at a time, 載入更多 adds 25', async ({ page }) => {
  await signedOut(page);
  await page.goto('/exam/concepts');
  const total = await items(page).count();
  expect(total).toBeGreaterThan(400);
  await expect(page.locator('form[data-concept-filter]')).toBeVisible();
  await expect(visible(page)).toHaveCount(25);
  await expect(page.locator('.ex-cpt-status')).toHaveText(`共 ${total} 個考點`);
  const more = page.locator('[data-cpt-more] .ex-more-btn');
  await expect(more).toHaveText('載入更多');
  await more.click();
  await expect(visible(page)).toHaveCount(50);
  await expect(page.locator('[data-cpt-more] .ex-more-status')).toHaveText(`已顯示 50 / ${total} 個`);
  const counts = (await visible(page).evaluateAll(ds => ds.map(d => Number(d.dataset.n))));
  expect(counts).toEqual([...counts].sort((a, b) => b - a));
});

test('overview: keyword, chapter filter and sort are mirrored in the URL', async ({ page }) => {
  await signedOut(page);
  await page.goto('/exam/concepts');
  await page.fill('#cpt-kw', 'HIV');
  await expect(page).toHaveURL(/\?kw=HIV$/);
  const hits = await visible(page).locator('.ex-cpt-t').allTextContents();
  expect(hits.length).toBeGreaterThan(0);
  for (const t of hits) expect(t.toLowerCase()).toContain('hiv');
  await expect(page.locator('.ex-cpt-status')).toContainText('符合');

  await page.fill('#cpt-kw', '');
  await page.selectOption('#cpt-ch', '8-6');
  await expect(page).toHaveURL(/\?ch=8-6$/);
  const chs = await visible(page).evaluateAll(ds => ds.map(d => d.dataset.ch.split(' ')));
  expect(chs.length).toBeGreaterThan(0);
  for (const c of chs) expect(c).toContain('8-6');

  await page.selectOption('#cpt-ch', '');
  await page.selectOption('#cpt-sort', 'chapter');
  await expect(page).toHaveURL(/\?sort=chapter$/);
  const homes = await visible(page).evaluateAll(ds => ds.map(d => d.dataset.home));
  const order = await page.locator('#cpt-ch option').evaluateAll(os => os.map(o => o.value).filter(Boolean));
  const idx = homes.map(h => order.indexOf(h));
  expect(idx).toEqual([...idx].sort((a, b) => a - b));

  // A question number finds its concept.
  await page.selectOption('#cpt-sort', 'count');
  const q = (await items(page).first().locator('.ex-qno').first().textContent()).trim();
  await page.fill('#cpt-kw', q);
  await expect(visible(page)).toHaveCount(1);
  // A bare number alone is a question number too…
  await page.fill('#cpt-kw', q.slice(1));
  await expect(visible(page)).toHaveCount(1);
  // …but inside a longer query a number is ordinary text (PR #70 review round 1).
  await page.fill('#cpt-kw', 'MNV Type 1');
  await expect(visible(page).filter({ hasText: 'MNV Type 1/2 影像特徵' })).toHaveCount(1);
  await page.fill('#cpt-kw', 'zzzz-no-such-concept');
  await expect(visible(page)).toHaveCount(0);
  await expect(page.locator('.ex-cpt-empty')).toBeVisible();
  await expect(page.locator('[data-cpt-more]')).toBeHidden();
});

test('overview: state in the URL is restored on load', async ({ page }) => {
  await signedOut(page);
  await page.goto('/exam/concepts?kw=%E9%9D%92%E5%85%89%E7%9C%BC&ch=10-8&sort=chapter');
  await expect(page.locator('#cpt-kw')).toHaveValue('青光眼');
  await expect(page.locator('#cpt-ch')).toHaveValue('10-8');
  await expect(page.locator('#cpt-sort')).toHaveValue('chapter');
  const rows = await visible(page).evaluateAll(ds => ds.map(d => [d.textContent, d.dataset.ch]));
  for (const [text, ch] of rows) {
    expect(text).toContain('青光眼');
    expect(ch.split(' ')).toContain('10-8');
  }
  // Unknown values are ignored.
  await page.goto('/exam/concepts?ch=99-1&sort=nope');
  await expect(page.locator('#cpt-ch')).toHaveValue('');
  await expect(page.locator('#cpt-sort')).toHaveValue('count');
  await expect(visible(page)).toHaveCount(25);
});

test('overview: question numbers are plain text; chips link to chapter pages', async ({ page }) => {
  await signedOut(page);
  await page.goto('/exam/concepts');
  const first = items(page).first();
  await first.locator('summary').click();
  await expect(first.locator('.ex-qno').first()).toBeVisible();
  expect(await first.locator('.ex-qno a, a.ex-qno').count()).toBe(0);
  const chip = first.locator('a.ex-chip').first();
  const href = await chip.getAttribute('href');
  expect(href).toMatch(/^\/exam\/bcsc\d+-\d+$/);
  await Promise.all([page.waitForURL('**' + href), chip.click()]);
});

test('overview without JavaScript shows every concept and no controls', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto('/exam/concepts');
  const total = await items(page).count();
  expect(total).toBeGreaterThan(400);
  await expect(visible(page)).toHaveCount(total);
  await expect(page.locator('form[data-concept-filter]')).toBeHidden();
  await expect(page.locator('[data-cpt-more]')).toBeHidden();
  await context.close();
});

test('hub links the overview from the tools row', async ({ page }) => {
  await signedOut(page);
  await page.goto('/exam');
  const link = page.locator('.ex-tools a[href="/exam/concepts"]');
  await expect(link).toHaveText('考點總覽');
  await Promise.all([page.waitForURL('**/exam/concepts'), link.click()]);
  await expect(page.locator('h1')).toHaveText('考點總覽');
});

test('chapter page: 本章考點 sits between the notes and the questions and is in both outlines', async ({ page }) => {
  await signedOut(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/exam/bcsc8-6');
  const tops = await page.evaluate(() => ['notes-h', 'cpts-h', 'qs-h'].map(id => document.getElementById(id).getBoundingClientRect().top));
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
  await expect(page.locator('.ex-toc-side a[href="#cpts-h"]')).toContainText('本章考點');
  const block = page.locator('section.ex-cpts');
  await expect(block.locator(':scope > .ex-cpt-list > details.ex-cpt').first()).toBeVisible();
  const other = block.locator('details.ex-cpt-other');
  await expect(other).not.toHaveAttribute('open', '');
  await expect(other.locator(':scope > summary')).toContainText('本章考題也考到的其他章考點');
  await page.locator('.ex-toc-side a[href="#cpts-h"]').click();
  await expect(page).toHaveURL(/#cpts-h$/);
});

for (const scheme of ['light', 'dark']) {
  test(`concept lists are readable in ${scheme} mode`, async ({ page }) => {
    await signedOut(page);
    await page.emulateMedia({ colorScheme: scheme });
    for (const route of ['/exam/concepts', '/exam/bcsc8-6']) {
      await page.goto(route);
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      // Open a few concepts (and the other-chapter list) so axe checks their content too.
      await page.evaluate(() => {
        document.querySelectorAll('details.ex-cpt-other').forEach(d => { d.open = true; });
        [...document.querySelectorAll('details.ex-cpt')].slice(0, 6).forEach(d => { d.open = true; });
      });
      const AxeBuilder = require('@axe-core/playwright').default;
      const result = await new AxeBuilder({ page }).include('main').withRules(['color-contrast']).analyze();
      expect(result.violations.map(v => v.nodes.map(n => n.target.join(' ')).join(', '))).toEqual([]);
    }
  });
}
