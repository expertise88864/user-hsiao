const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });

// Owner requests 2026-10-17:
// 1. 首頁最新文章／所有文章置頂一張「眼科專科醫師考試重點整理與考題解析」卡片（連到 /exam），
//    但它不是文章：不算進篩選、計數與日期排序。
// 2. 專科考試首頁可以搜尋病名（全名／縮寫），依章節列出段落，點下去直接跳到那一段。
// 3. 專科考試首頁順序：搜尋 → 工具 → 公開／登入說明 → 考古卷 → 依 BCSC 章節瀏覽 → 出題頻率
//    （先顯示 25 章，表格右下角「載入更多」每次再顯示 25 章）。

async function signedOut(page) {
  await page.route('**/api/exam/data**', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
}

test('homepage pins the board-exam card above the latest articles', async ({ page }) => {
  await page.goto('/');
  const first = page.locator('#hs-article-list > *').first();
  await expect(first).toHaveClass(/hs-pin-card/);
  await expect(first).toHaveAttribute('href', '/exam');
  await expect(first.locator('h3')).toHaveText('眼科專科醫師考試重點整理與考題解析');
  await expect(first.locator('.chip.pin')).toHaveText('置頂');
  await expect(first).toBeVisible();
  // Still five newest articles, sorted by date, after the pinned card.
  await expect(page.locator('#hs-article-list .article-list-item:visible')).toHaveCount(5);
  const dates = await page.locator('#hs-article-list .article-list-item:visible time').allTextContents();
  expect(dates).toEqual([...dates].sort().reverse());
  await expect(page.locator('#hs-article-list > *').first()).toHaveClass(/hs-pin-card/);
});

test('the pinned card is visible on a phone, where the header link is hidden', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('header a[href="/exam"]').first()).toBeHidden();
  await page.locator('.hs-pin-card').scrollIntoViewIfNeeded();
  await expect(page.locator('.hs-pin-card')).toBeVisible();
  const box = await page.locator('.hs-pin-card').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  await Promise.all([page.waitForURL('**/exam'), page.locator('.hs-pin-card').click()]);
  await context.close();
});

test('blog index pins the card; category filters and counts ignore it', async ({ page }) => {
  await page.goto('/blog/');
  const pin = page.locator('.article-list > *').first();
  await expect(pin).toHaveClass(/hs-pin-card/);
  const articles = await page.locator('.article-list-item').count();
  const all = page.locator('#hs-blog-filter button[data-cat=""] .count');
  await expect(all).toHaveText(String(articles));
  const research = page.locator('#hs-blog-filter button[data-cat="research"]');
  await expect(research).toBeEnabled();
  const expected = Number(await research.locator('.count').textContent());
  await research.click();
  await expect(page.locator('.article-list-item:visible')).toHaveCount(expected);
  await expect(pin).toBeVisible();
});

test('English mirrors show the pinned card in English', async ({ page }) => {
  await page.goto('/en');
  await expect(page.locator('.hs-pin-card h3')).toHaveText('Ophthalmology Board Exam: BCSC Notes and Question Explanations');
  await page.goto('/en/blog');
  await expect(page.locator('.hs-pin-card .chip.pin')).toHaveText('Pinned');
});

test('hub order: search, tools, access note, 考古卷, chapters, frequency', async ({ page }) => {
  await signedOut(page);
  await page.goto('/exam');
  const order = await page.evaluate(() => {
    const pick = [
      ['h1', document.querySelector('main h1')],
      ['search', document.querySelector('form[data-hub-search]')],
      ['tools', document.querySelector('.ex-tools')],
      ['note', [...document.querySelectorAll('main .ex-meta')].find(p => p.textContent.startsWith('課本重點整理公開'))],
      ['practice', document.querySelector('a[href="/exam/practice"]')],
      ['chapters', [...document.querySelectorAll('main h2')].find(h => h.textContent === '依 BCSC 章節瀏覽')],
      ['books', document.querySelector('details.ex-part')],
      ['rank', [...document.querySelectorAll('main h2')].find(h => h.textContent === '出題頻率：最常考')],
      ['table', document.querySelector('table.ex-rank')],
    ];
    return pick.map(([name, node]) => [name, node ? node.getBoundingClientRect().top + scrollY : null]);
  });
  const tops = order.map(([, top]) => top);
  expect(tops.every(t => t !== null)).toBe(true);
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
  await expect(page.locator('a[href="/exam/practice"]')).toHaveText('考古卷：自選範圍／隨機出題');
  await page.goto('/exam/practice');
  await expect(page.locator('.ex-kicker')).toHaveText('考古卷');
  await expect(page).toHaveTitle(/考古卷/);
});

test('frequency table shows 25 chapters and loads 25 more per click', async ({ page }) => {
  await signedOut(page);
  await page.goto('/exam');
  const rows = page.locator('table.ex-rank tbody tr');
  const total = await rows.count();
  expect(total).toBeGreaterThan(50);
  const visible = page.locator('table.ex-rank tbody tr:visible');
  await expect(visible).toHaveCount(25);
  const more = page.getByRole('button', { name: '載入更多' });
  await expect(more).toBeVisible();
  // Bottom-right of the table.
  const t = await page.locator('table.ex-rank').boundingBox();
  const b = await more.boundingBox();
  expect(b.y).toBeGreaterThan(t.y + t.height - 1);
  expect(b.x + b.width).toBeGreaterThan(t.x + t.width - 4);
  await expect(page.locator('.ex-more-status')).toHaveText(`已顯示 25 / ${total} 章`);
  await more.click();
  await expect(visible).toHaveCount(50);
  await expect(visible.nth(25).locator('a')).toBeVisible();
  let shown = 50;
  while (shown < total) {
    await more.click();
    shown = Math.min(shown + 25, total);
    await expect(visible).toHaveCount(shown);
  }
  await expect(more).toBeHidden();
  await expect(rows.nth(Math.floor((total - 1) / 25) * 25).locator('a')).toBeFocused();
});

test('without JavaScript the hub lists every ranked chapter and the search posts to /exam/search', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/exam');
  const rows = page.locator('table.ex-rank tbody tr');
  await expect(page.locator('table.ex-rank tbody tr:visible')).toHaveCount(await rows.count());
  await expect(page.locator('.ex-more')).toBeHidden();
  await page.getByLabel('搜尋疾病（全名或縮寫）').fill('PVRL');
  await Promise.all([page.waitForURL(/\/exam\/search\?q=PVRL$/), page.locator('form[data-hub-search] button[type=submit]').click()]);
  await context.close();
});

test('hub disease search groups note paragraphs by chapter and lands on the paragraph', async ({ page }) => {
  await signedOut(page);
  await page.goto('/exam');
  const input = page.getByLabel('搜尋疾病（全名或縮寫）');
  await input.fill('pvrl');
  const status = page.locator('.ex-find-status');
  await expect(status).toContainText('「pvrl」出現在');
  // Chapters are ordered by number of matching paragraphs; the notes batch of
  // f901590 gave BCSC 4 Ch.19 more PVRL paragraphs, so find 12-11 by name.
  const group = page.locator('.ex-find-group').filter({ has: page.locator('.ex-find-h a', { hasText: 'BCSC 12 Ch.11' }) });
  await expect(group.locator('.ex-find-h .ex-count')).toHaveText(/^\d+ 段$/);
  const counts = (await page.locator('.ex-find-group .ex-find-h .ex-count').allTextContents()).map(s => parseInt(s, 10));
  expect(counts).toEqual([...counts].sort((a, b) => b - a));
  await expect(group.locator('.ex-find-list mark').first()).toHaveText(/^pvrl$/i);
  // Long result lists start with five paragraphs per chapter.
  await expect(group.locator('.ex-find-list li:visible')).toHaveCount(5);
  await group.getByRole('button', { name: /^再顯示 \d+ 段$/ }).click();
  await expect(group.locator('.ex-find-list li:visible')).not.toHaveCount(5);
  expect(page.url()).toMatch(/\/exam\?q=pvrl$/);

  const hit = group.locator('.ex-find-list a').nth(2);
  const href = await hit.getAttribute('href');
  expect(href).toMatch(/^\/exam\/bcsc12-11\?hl=pvrl#np-\d+$/);
  await hit.click();
  await page.waitForURL('**/exam/bcsc12-11?hl=pvrl#np-*');
  const id = href.split('#')[1];
  const target = page.locator('#' + id);
  await expect(target).toBeInViewport();
  await expect(target).toHaveCSS('outline-style', 'solid');
  await expect(target.locator('mark.ex-find-hl').first()).toHaveText(/^PVRL$/);
  expect(await page.evaluate(() => document.querySelector(':target').id)).toBe(id);
  // Existing chapter features still work.
  await expect(page.locator('.ex-toc')).toBeVisible();
  await expect(page.locator('#ex-chapter-qs .ex-locked')).toContainText('登入');
});

test('hub search: abbreviations stand alone, full names ignore hyphens, Chinese names work', async ({ page }) => {
  await signedOut(page);
  await page.goto('/exam?q=' + encodeURIComponent('Vogt Koyanagi Harada'));
  await expect(page.getByLabel('搜尋疾病（全名或縮寫）')).toHaveValue('Vogt Koyanagi Harada');
  await expect(page.locator('.ex-find-results mark').first()).toHaveText(/^Vogt-Koyanagi-Harada$/i);
  await page.getByLabel('搜尋疾病（全名或縮寫）').fill('RP');
  await expect(page.locator('.ex-find-status')).toContainText('「RP」出現在');
  const marks = await page.locator('.ex-find-results mark').allTextContents();
  expect(marks.length).toBeGreaterThan(0);
  expect(marks.every(m => /^rps?$/i.test(m))).toBe(true);
  const snippets = await page.locator('.ex-find-snip').allTextContents();
  expect(snippets.every(s => /(^|[^A-Za-z0-9])RPs?([^A-Za-z0-9]|$)/i.test(s))).toBe(true);
  // RP must not match inside a gene name such as RP1L1 (bcsc12-12 occult macular dystrophy).
  expect(snippets.some(s => /RP1L1/i.test(s) && !/(^|[^A-Za-z0-9])RPs?([^A-Za-z0-9]|$)/i.test(s))).toBe(false);
  await page.getByLabel('搜尋疾病（全名或縮寫）').fill('圓錐角膜');
  await expect(page.locator('.ex-find-status')).toContainText('「圓錐角膜」出現在');
  await expect(page.locator('.ex-find-group').first().locator('a').first()).toHaveAttribute('href', /\?hl=%E5%9C%93%E9%8C%90%E8%A7%92%E8%86%9C#np-\d+$/);
  await page.getByLabel('搜尋疾病（全名或縮寫）').fill('zzqq nothing here');
  await expect(page.locator('.ex-find-status')).toContainText('找不到');
  await expect(page.locator('.ex-find-results a[href^="/exam/search?q="]')).toBeVisible();
  await page.getByLabel('搜尋疾病（全名或縮寫）').press('Escape');
  await expect(page.locator('.ex-find-group')).toHaveCount(0);
});

for (const scheme of ['light', 'dark']) {
  test(`hub search results and the landing highlight are readable (${scheme})`, async ({ page }) => {
    await signedOut(page);
    await page.emulateMedia({ colorScheme: scheme });
    const AxeBuilder = require('@axe-core/playwright').default;
    await page.goto('/exam?q=VKH');
    await expect(page.locator('.ex-find-group').first()).toBeVisible();
    let result = await new AxeBuilder({ page }).include('main').withRules(['color-contrast', 'heading-order', 'label']).analyze();
    expect(result.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).join(', '))).toEqual([]);
    await page.locator('.ex-find-list a').first().click();
    await expect(page.locator(':target mark.ex-find-hl').first()).toBeVisible();
    result = await new AxeBuilder({ page }).include('.ex-note').withRules(['color-contrast']).analyze();
    expect(result.violations.map(v => v.nodes.map(n => n.target.join(' ')).join(', '))).toEqual([]);
  });
}
