const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
test.use({ serviceWorkers: 'block' });

// Owner requests 2026-10-15:
// - chapter notes stay public; questions, answers and explanations need a login;
// - same-concept questions sit together under 「考點」 headings;
// - explanations carry no "回去看重點" / "同考點" lines;
// - flagged questions show 考試答案 / 現行觀念;
// - a per-chapter progress overview.
// The static test server has no API, so "signed in" means /api/exam/data is
// answered with the generated bank; "signed out" means it answers 401.

let bankJson;
async function bank() {
  if (!bankJson) {
    const mod = await import(pathToFileURL(path.resolve(__dirname, '../../api/_exam_bank.js')).href);
    bankJson = mod.EXAM_BANK_JSON;
  }
  return bankJson;
}
async function signIn(page) {
  const body = await bank();
  await page.route('**/api/exam/data**', route => route.fulfill({ status: 200, contentType: 'application/json', body }));
}
async function signOut(page) {
  await page.route('**/api/exam/data**', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"login required"}' }));
}

test('signed out: chapter pages show the notes but no questions', async ({ page, request }) => {
  const html = await (await request.get('/exam/bcsc12-4')).text();
  expect(html).not.toContain('<article class="ex-q');
  const sample = JSON.parse(await bank()).questions.find(q => q.ch.includes('12-4')).stem.slice(0, 40);
  expect(html).not.toContain(sample);
  await signOut(page);
  await page.goto('/exam/bcsc12-4');
  await expect(page.locator('.ex-note')).toBeVisible();
  await expect(page.locator('#ex-chapter-qs .ex-locked')).toContainText('登入');
  await expect(page.locator('.ex-q')).toHaveCount(0);
  await expect(page.locator('.ex-qs-tools')).toBeHidden();
  await expect(page.locator('.ex-hit a').first()).toHaveAttribute('href', /^\/exam\/login\?next=\/exam\/bcsc12-4%23q-\d+$/);
});

test('signed out: the public notes data carries no question text', async ({ request }) => {
  expect((await request.get('/exam/exam-data.json')).status()).toBe(404);
  const notes = await (await request.get('/exam/notes-data.json')).json();
  expect(Object.keys(notes).sort()).toEqual(['books', 'chapters', 'notes', 'qs', 'taxa']);
  expect(notes.qs[0]).toEqual([expect.any(Number), expect.any(Array)]);
});

test('signed out: practice, review and question search ask for a login; note search still works', async ({ page }) => {
  await signOut(page);
  await page.goto('/exam/practice');
  await page.getByRole('button', { name: '產生試卷並開始計時' }).click();
  await expect(page.locator('#ex-practice-list .ex-locked a')).toHaveAttribute('href', '/exam/login?next=%2Fexam%2Fpractice');
  await page.goto('/exam/review');
  await expect(page.locator('#ex-review-list .ex-locked')).toBeVisible();
  await page.goto('/exam/search?q=AREDS2');
  await expect(page.locator('#ex-search-results .ex-hitbox').first()).toBeVisible();
  await expect(page.locator('#ex-search-results .ex-search-qs .ex-locked')).toBeVisible();
  await expect(page.locator('#ex-search-results .ex-q')).toHaveCount(0);
});

test('login page keeps a safe return path and explains errors', async ({ page }) => {
  await page.goto('/exam/login?error=wrong&next=' + encodeURIComponent('/exam/bcsc6-27#q-873'));
  await expect(page.locator('.ex-login-msg')).toHaveText('密碼不正確，請再試一次。');
  await expect(page.locator('form.ex-login input[name=next]')).toHaveValue('/exam/bcsc6-27#q-873');
  await expect(page.locator('form.ex-login')).toHaveAttribute('action', '/api/exam/login');
  await page.goto('/exam/login?next=' + encodeURIComponent('https://evil.example/'));
  await expect(page.locator('form.ex-login input[name=next]')).toHaveValue('/exam');
});

test('signed in: chapter questions render grouped by concept, without link lines', async ({ page }) => {
  await signIn(page);
  await page.goto('/exam/bcsc12-4');
  await expect(page.locator('.ex-concept').first()).toContainText('考點：');
  await expect(page.locator('#ex-chapter-qs .ex-q').first()).toBeVisible();
  await expect(page.locator('.ex-qs-tools')).toBeVisible();
  await expect(page.locator('.ex-hit a').first()).toHaveAttribute('href', /^#q-\d+$/);
  await expect(page.locator('.ex-goto, .ex-sibs')).toHaveCount(0);
});

test('signed in: answering and marking a chapter read shows up on the progress page', async ({ page }) => {
  await signIn(page);
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

test('signed in: flagged questions separate the exam answer from the current concept', async ({ page }) => {
  await signIn(page);
  await page.goto('/exam/bcsc1-4');
  const doubt = page.locator('#q-4 .ex-doubt');
  await expect(doubt.locator('.ex-doubt-exam')).toContainText('考試答案 A');
  await expect(doubt.locator('.ex-doubt-now')).toContainText('現行觀念');
  const cite = doubt.locator('.ex-cites a').first();
  await expect(cite).toHaveAttribute('href', /^https:\/\//);
  await expect(cite).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.locator('#q-4 .ex-warn')).toHaveCount(0);
});

test('signed in: question search renders cards without link lines', async ({ page }) => {
  await signIn(page);
  await page.goto('/exam/search?q=' + encodeURIComponent('130/80'));
  const doubt = page.locator('#ex-search-results #q-4 .ex-doubt');
  await expect(doubt.locator('.ex-doubt-tag').first()).toHaveText('考試答案 A');
  await expect(page.locator('#ex-search-results .ex-goto, #ex-search-results .ex-sibs')).toHaveCount(0);
});
