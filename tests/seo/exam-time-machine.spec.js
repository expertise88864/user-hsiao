const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
test.use({ serviceWorkers: 'block' });

// Owner decisions 2026-11-04 (dermatology-site ports, group 3):
// 1. Time machine: a doubt's 「何時改變」 and 「對答案的影響」 rows (doubts.json changed /
//    impact) render in the doubt box with a level badge (green 不影響 / red 依現行觀念答案會不同),
//    and quiz mode keeps them hidden until the question is graded, like the rest of the box.
//    The bank is patched with tests/fixtures examples, which replace the real Q4 / Q5
//    fields (real entries arrived 2026-11-05) so the assertions stay fixed.
// 2. Chinese chapter names: the hub search finds a chapter by its Chinese name and shows
//    the name after the English title; the chapter page shows it under the h1.

const FIXTURE = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/exam-time-machine.json'), 'utf8'));
let bankJson;
async function bank() {
  if (!bankJson) {
    const mod = await import(pathToFileURL(path.resolve(__dirname, '../../api/_exam_bank.js')).href);
    const data = JSON.parse(mod.EXAM_BANK_JSON);
    data.questions.forEach(q => {
      if (q.doubt && FIXTURE[String(q.n)]) {
        delete q.doubt.changed; delete q.doubt.impact;
        Object.assign(q.doubt, FIXTURE[String(q.n)]);
      }
    });
    bankJson = JSON.stringify(data);
  }
  return bankJson;
}
async function signIn(page) {
  const json = await bank();
  await page.route('**/api/exam/data**', route => (route.request().url().includes('check=1')
    ? route.fulfill({ status: 204 })
    : route.fulfill({ status: 200, contentType: 'application/json', body: json })));
}
const quizMode = page => page.addInitScript(() => localStorage.setItem('hs:exam:mode', JSON.stringify('quiz')));

test('signed in: the doubt box shows when the concept changed and its effect on the answer', async ({ page }) => {
  await signIn(page);
  await page.goto('/exam/bcsc1-4');
  const box = page.locator('#q-4 .ex-doubt');
  await expect(box).toBeVisible();
  const rows = box.locator('dl.ex-tm-rows');
  await expect(rows.locator('dt')).toHaveText(['何時改變', '對答案的影響']);
  await expect(rows.locator('dd').nth(0)).toHaveText(FIXTURE['4'].changed);
  const level = rows.locator('dd').nth(1).locator('.ex-tm-level');
  await expect(level).toHaveText('依現行觀念答案會不同');
  await expect(level).toHaveClass(/ex-tm-diff/);
  await expect(rows.locator('dd').nth(1)).toContainText(FIXTURE['4'].impact.note);
  // Rows follow 現行觀念 and come before its references.
  const order = await box.evaluate(b => Array.from(b.children).map(c => c.className));
  expect(order.indexOf('ex-tm-rows')).toBe(order.indexOf('ex-doubt-now') + 1);
  expect(order[order.indexOf('ex-tm-rows') + 1]).toBe('ex-cites');
  const red = await level.evaluate(e => getComputedStyle(e).backgroundColor);
  expect(red).toBe('rgb(254, 226, 226)');

  // Impact only: one row, green badge.
  await page.goto('/exam/bcsc1-6');
  const only = page.locator('#q-5 .ex-doubt dl.ex-tm-rows');
  await expect(only.locator('dt')).toHaveText(['對答案的影響']);
  await expect(only.locator('.ex-tm-level')).toHaveClass(/ex-tm-same/);
  await expect(only.locator('.ex-tm-level')).toHaveText('不影響');
  // Only questions whose doubt has the fields get rows.
  const withFields = new Set(JSON.parse(await bank()).questions
    .filter(q => q.doubt && (q.doubt.changed || q.doubt.impact)).map(q => 'q-' + q.n));
  const shown = await page.locator('.ex-q').evaluateAll(qs => qs.map(q => [q.id, !!q.querySelector('.ex-tm-rows')]));
  for (const [id, has] of shown) expect(has, id).toBe(withFields.has(id));
});

test('signed in, quiz mode: the time machine rows stay hidden until the question is graded', async ({ page }) => {
  await signIn(page);
  await quizMode(page);
  await page.goto('/exam/bcsc1-4');
  const card = page.locator('#q-4');
  const rows = card.locator('.ex-tm-rows');
  await expect(card).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(rows).toBeHidden();
  await expect(card.locator('.ex-doubt')).toBeHidden();
  const answer = await card.getAttribute('data-answer');
  await card.locator(`.ex-opt[data-key="${answer}"]`).click();
  await card.getByRole('button', { name: '送出答案' }).click();
  await expect(rows).toBeVisible();
  await expect(rows.locator('.ex-tm-level')).toHaveText('依現行觀念答案會不同');
});

test('Chinese chapter names: hub search finds them and shows them after the English title', async ({ page }) => {
  await page.route('**/api/exam/data**', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await page.goto('/exam');
  await expect(page.locator('li#ch-12-5 .ex-ch-zh')).toHaveText('糖尿病視網膜病變');
  const input = page.getByLabel('搜尋疾病（全名或縮寫）');
  await input.fill('早產兒視網膜病變');
  const first = page.getByRole('listbox', { name: '搜尋結果' }).getByRole('group').first();
  await expect(first.locator('.ex-find-h a')).toHaveAttribute('href', /^\/exam\/bcsc12-8/);
  await expect(first.locator('.ex-find-h a .ex-ch-zh')).toHaveText('早產兒視網膜病變');
  await page.goto('/exam/bcsc12-8');
  await expect(page.locator('h1 .ex-h1-zh')).toHaveText('早產兒視網膜病變');
  await expect(page.locator('section.ex-links a').first()).toHaveAttribute('target', '_blank');
});
