const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });

// Owner request 2026-10-15: questions link back to the matching note section,
// same-concept questions sit together, and a per-chapter progress overview.

test('chapter questions link to their note sections and same-concept groups', async ({ page }) => {
  await page.goto('/exam/bcsc12-4');
  const goto = page.locator('.ex-goto a').first();
  await expect(goto).toBeAttached();
  const id = (await goto.getAttribute('href')).replace(/^#/, '');
  await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
  await expect(page.locator('.ex-concept').first()).toContainText('考點：');
  const sibling = page.locator('.ex-sibs a[href^="#q-"]').first();
  const target = (await sibling.getAttribute('href')).slice(1);
  await expect(page.locator(`[id="${target}"]`)).toHaveCount(1);
});

test('answering and marking a chapter read shows up on the progress page', async ({ page }) => {
  await page.goto('/exam/bcsc12-4');
  const strip = page.locator('[data-progress-chapter="12-4"]');
  await expect(strip).toBeVisible();
  await expect(strip.locator('.ex-strip-text')).toContainText('還沒有作答紀錄');
  await page.getByRole('button', { name: '作答模式' }).click();
  const card = page.locator('.ex-q:not(.ex-unanswered)').first();
  const answer = await card.getAttribute('data-answer');
  await card.locator(`.ex-opt[data-key="${answer}"]`).click();
  await card.getByRole('button', { name: '送出答案' }).click();
  await expect(strip.locator('.ex-strip-text')).toContainText('已作答 1 /');
  await expect(strip.locator('.ex-strip-text')).toContainText('正確率 100%');
  await strip.getByLabel('課本已讀完').check();

  await page.goto('/exam/progress');
  await expect(page.locator('.ex-summary-box')).toContainText('已作答 1 /');
  await expect(page.locator('.ex-summary-box')).toContainText('課本已讀完 1 /');
  const row = page.locator('.ex-prog tr', { has: page.locator('a[href="/exam/bcsc12-4"]') });
  await expect(row.locator('td').nth(2)).toHaveText(/^1 \/ \d+$/);
  await expect(row.locator('td').nth(3)).toHaveText('100%');
  await expect(row.getByRole('checkbox')).toBeChecked();
});

test('malformed stored progress counts as unanswered', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('hs:exam:stats', JSON.stringify({ 1: [], 2: ['x', 1, 1], 99999: [1, 1, 1] }));
  });
  await page.goto('/exam/progress');
  await expect(page.locator('.ex-summary-box')).toContainText('已作答 0 /');
});

test('toggling a progress checkbox keeps focus and expanded books', async ({ page }) => {
  await page.goto('/exam/progress');
  const book = page.locator('details[data-book="12"]');
  await book.locator('summary').click();
  await expect(book).toHaveAttribute('open', '');
  const box = book.locator('input[data-chapter="12-4"]');
  await box.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('details[data-book="12"]')).toHaveAttribute('open', '');
  await expect(page.locator('input[data-chapter="12-4"]')).toBeChecked();
  await expect(page.locator('input[data-chapter="12-4"]')).toBeFocused();
});

test('client-rendered cards carry the note and same-concept links', async ({ page }) => {
  await page.goto('/exam/search?q=AREDS2');
  const card = page.locator('#ex-search-results .ex-q').first();
  await expect(card).toBeVisible();
  await expect(page.locator('#ex-search-results .ex-goto a[href^="/exam/bcsc"]').first()).toBeAttached();
});
