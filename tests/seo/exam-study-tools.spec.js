const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });

// Owner request 2026-10-15: same-concept questions sit together under 「考點」
// headings and a per-chapter progress overview. Follow-up the same day:
// explanations carry no "回去看重點" / "同考點" lines (the notes' own 「考過」
// markers are enough), so they must not reappear.

test('chapter pages group same-concept questions without link lines in explanations', async ({ page }) => {
  await page.goto('/exam/bcsc12-4');
  await expect(page.locator('.ex-concept').first()).toContainText('考點：');
  await expect(page.locator('.ex-note .ex-hit a').first()).toBeAttached();
  await expect(page.locator('.ex-note h3[id]').first()).toBeAttached();
  await expect(page.locator('.ex-goto, .ex-sibs')).toHaveCount(0);
  await expect(page.locator('.ex-reveal').filter({ hasText: '回去看重點' })).toHaveCount(0);
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

test('client-rendered cards carry no note or same-concept link lines', async ({ page }) => {
  await page.goto('/exam/search?q=AREDS2');
  await expect(page.locator('#ex-search-results .ex-q').first()).toBeVisible();
  await expect(page.locator('#ex-search-results .ex-goto, #ex-search-results .ex-sibs')).toHaveCount(0);
});

// Owner request 2026-10-15: flagged questions show the exam answer's rationale
// separately from the current concept, which cites verified sources.
test('flagged questions separate the exam answer from the current concept', async ({ page }) => {
  await page.goto('/exam/bcsc1-4');
  const doubt = page.locator('#q-4 .ex-doubt');
  await expect(doubt.locator('.ex-doubt-exam')).toContainText('考試答案 A');
  await expect(doubt.locator('.ex-doubt-now')).toContainText('現行觀念');
  const cite = doubt.locator('.ex-cites a').first();
  await expect(cite).toHaveAttribute('href', /^https:\/\//);
  await expect(cite).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.locator('#q-4 .ex-warn')).toHaveCount(0);
});

test('client-rendered flagged cards carry the same two parts', async ({ page }) => {
  await page.goto('/exam/search?q=' + encodeURIComponent('130/80'));
  const doubt = page.locator('#ex-search-results #q-4 .ex-doubt');
  await expect(doubt.locator('.ex-doubt-tag').first()).toHaveText('考試答案 A');
  await expect(doubt.locator('.ex-cites a').first()).toHaveAttribute('href', /^https:\/\//);
});
