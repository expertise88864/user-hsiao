const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
test.use({ serviceWorkers: 'block' });

// Owner request 2026-11-03: question-card features ported from the dermatology exam
// section — doubt category label, 「只看未作答」, the date of a restored answer,
// re-grading stored answers after an answer-key correction, the current chapter's chip
// highlighted and not a link, and the 錯題本 count following 「移出錯題本」.
// Same bank mocking as exam-study-tools.spec.js: "signed in" means /api/exam/data
// answers with the generated bank.

let bankJson;
async function bank() {
  if (!bankJson) {
    const mod = await import(pathToFileURL(path.resolve(__dirname, '../../api/_exam_bank.js')).href);
    bankJson = mod.EXAM_BANK_JSON;
  }
  return bankJson;
}
async function signIn(page, body) {
  const json = body || await bank();
  await page.route('**/api/exam/data**', route => (route.request().url().includes('check=1')
    ? route.fulfill({ status: 204 })
    : route.fulfill({ status: 200, contentType: 'application/json', body: json })));
}
const stored = (page, key) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), key);
const CHAPTER = '/exam/bcsc12-4';
// Rendered by exam.js (the static page has a no-JavaScript placeholder that also starts 目前沒有錯題).
const EMPTY = '目前沒有錯題。到章節頁';
const quizMode = page => page.addInitScript(() => localStorage.setItem('hs:exam:mode', JSON.stringify('quiz')));

test('signed in: the doubt box names the doubt category', async ({ page }) => {
  await signIn(page);
  await page.goto('/exam/bcsc1-4');
  await expect(page.locator('#q-4 .ex-doubt .ex-doubt-h')).toHaveText('⚠ 疑義題 · 舊版觀念');
  await expect(page.locator('#q-4 .ex-doubt > :first-child')).toHaveClass('ex-doubt-h');
  await page.goto('/exam/bcsc1-10');
  await expect(page.locator('#q-63 .ex-doubt .ex-doubt-h')).toHaveText('⚠ 疑義題 · 題目誤植');
});

test('signed in: 只看未作答 hides answered cards and empty 考點 groups (quiz mode only)', async ({ page }) => {
  await signIn(page);
  await quizMode(page);
  await page.goto(CHAPTER);
  const box = page.locator('#ex-chapter-qs');
  const cards = box.locator('.ex-q');
  await expect(cards.first()).toBeVisible();
  const only = page.locator('.ex-ans-bar').getByRole('button', { name: '只看未作答' });
  await expect(only).toHaveAttribute('aria-pressed', 'false');

  const first = cards.nth(0);
  const second = cards.nth(1);
  const a1 = await first.getAttribute('data-answer');
  await first.locator(`.ex-opt[data-key="${a1}"]`).click();
  await first.getByRole('button', { name: '送出答案' }).click();
  await only.click();
  await expect(only).toHaveAttribute('aria-pressed', 'true');
  await expect(first).toBeHidden();
  await expect(second).toBeVisible();
  // Answered while the filter is on: the result stays on screen until it is toggled.
  const a2 = await second.getAttribute('data-answer');
  await second.locator(`.ex-opt[data-key="${a2}"]`).click();
  await second.getByRole('button', { name: '送出答案' }).click();
  await expect(second).toBeVisible();
  await expect(second.locator('.ex-result')).toHaveText('答對了');
  await only.click();
  await expect(first).toBeVisible();
  await only.click();
  await expect(first).toBeHidden();
  await expect(second).toBeHidden();
  // 重新作答 on a card brings it back right away.
  await only.click();
  await second.getByRole('button', { name: '重新作答' }).click();
  await only.click();
  await expect(second).toBeVisible();
  await only.click();

  // Every question of the first 考點 answered: its heading hides with them.
  const heading = box.locator('.ex-concept').first();
  const group = await box.evaluate(node => {
    const ids = [];
    let el = node.querySelector('.ex-concept').nextElementSibling;
    while (el && !el.classList.contains('ex-concept')) {
      if (el.classList.contains('ex-q')) ids.push([el.dataset.qid, el.dataset.answer]);
      el = el.nextElementSibling;
    }
    return ids;
  });
  expect(group.length).toBeGreaterThan(1);
  await page.evaluate(list => {
    const ans = {};
    list.forEach(([n, c]) => { ans[n] = { c, t: Date.now() }; });
    localStorage.setItem('hs:exam:ans', JSON.stringify(ans));
  }, group);
  await page.reload();
  await expect(cards.first()).toHaveClass(/ex-done/);
  await only.click();
  await expect(heading).toBeHidden();
  await expect(box.locator('.ex-concept').nth(1)).toBeVisible();
  // Browse mode shows everything (the filter is a quiz-mode view).
  await page.getByRole('button', { name: '瀏覽模式' }).click();
  await expect(heading).toBeVisible();
  await expect(cards.first()).toBeVisible();
});

test('signed in: 清除本章作答紀錄 switches 只看未作答 off', async ({ page }) => {
  await signIn(page);
  await quizMode(page);
  await page.goto(CHAPTER);
  const first = page.locator('#ex-chapter-qs .ex-q').first();
  const a = await first.getAttribute('data-answer');
  await first.locator(`.ex-opt[data-key="${a}"]`).click();
  await first.getByRole('button', { name: '送出答案' }).click();
  const only = page.getByRole('button', { name: '只看未作答' });
  await only.click();
  await expect(first).toBeHidden();
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: '清除本章作答紀錄' }).click();
  await expect(only).toHaveAttribute('aria-pressed', 'false');
  await expect(first).toBeVisible();
});

test('signed in: a restored answer shows the day it was given', async ({ page }) => {
  const data = JSON.parse(await bank());
  const q = data.questions.find(x => x.answer && x.ch.includes('12-4'));
  const wrong = data.questions.filter(x => x.answer && x.ch.includes('12-4'))[1];
  const wrongKey = Object.keys(wrong.options).find(k => k !== wrong.answer);
  const t = new Date(2026, 0, 5, 12).getTime();
  await signIn(page);
  await page.addInitScript(([n, c, n2, c2, ms]) => {
    localStorage.setItem('hs:exam:mode', JSON.stringify('quiz'));
    localStorage.setItem('hs:exam:stats', JSON.stringify({ [n]: [1, 1, ms], [n2]: [0, 1, ms] }));
    localStorage.setItem('hs:exam:ans', JSON.stringify({ [n]: { c, t: ms }, [n2]: { c: c2, t: ms } }));
  }, [q.n, q.answer, wrong.n, wrongKey, t]);
  await page.goto(CHAPTER);
  await expect(page.locator(`#q-${q.n} .ex-result`).first()).toHaveText('答對了（2026/1/5 作答）');
  await expect(page.locator(`#q-${wrong.n} .ex-result`).first())
    .toHaveText(`答錯了，答案是 ${wrong.answer}（2026/1/5 作答）`);
  // A fresh answer has no date; 重新作答 then a new answer drops it.
  const card = page.locator(`#q-${q.n}`).first();
  await card.getByRole('button', { name: '重新作答' }).click();
  await card.locator(`.ex-opt[data-key="${q.answer}"]`).click();
  await card.getByRole('button', { name: '送出答案' }).click();
  await expect(card.locator('.ex-result')).toHaveText('答對了');
});

test('signed in: an answer-key correction re-grades stored answers, accuracy and 錯題本', async ({ page }) => {
  const real = JSON.parse(await bank());
  const q = real.questions.find(x => x.answer && x.ch.includes('12-4') && x.ch.length === 1);
  const oldKey = Object.keys(q.options).find(k => k !== q.answer);
  // The bank as it was before the correction: oldKey was the answer then.
  const before = JSON.parse(JSON.stringify(real));
  before.questions.find(x => x.n === q.n).answer = oldKey;
  await signIn(page, JSON.stringify(before));
  await quizMode(page);
  await page.goto(CHAPTER);
  const card = page.locator(`#q-${q.n}`).first();
  await card.locator(`.ex-opt[data-key="${oldKey}"]`).click();
  await card.getByRole('button', { name: '送出答案' }).click();
  await expect(card.locator('.ex-result')).toHaveText('答對了');
  expect((await stored(page, 'hs:exam:stats'))[q.n][0]).toBe(1);
  expect(await stored(page, 'hs:exam:wrong')).toEqual([]);

  // The key is corrected: the stored record follows the bank on the next load.
  await page.unrouteAll();
  await signIn(page);
  await page.reload();
  await expect(card).toHaveAttribute('data-outcome', 'wrong');
  await expect(card.locator('.ex-result')).toHaveText(new RegExp(`^答錯了，答案是 ${q.answer}（`));
  const stats = await stored(page, 'hs:exam:stats');
  expect(stats[q.n][0]).toBe(0);
  expect(stats[q.n][1]).toBe(1);
  expect(await stored(page, 'hs:exam:wrong')).toEqual([q.n]);
  await expect(page.locator('[data-progress-chapter] .ex-strip-text')).toContainText('正確率 0%');
  await page.goto('/exam/review');
  await expect(page.locator('#ex-review-list .ex-meta')).toHaveText('共 1 題錯題');
  await expect(page.locator(`#ex-review-list #q-${q.n}`)).toBeVisible();

});

test('signed in: a wrong record whose stored option is right under the current key leaves 錯題本', async ({ page }) => {
  const q = JSON.parse(await bank()).questions.find(x => x.answer && x.ch.includes('12-4'));
  await signIn(page);
  await page.addInitScript(([n, c]) => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    localStorage.setItem('hs:exam:stats', JSON.stringify({ [n]: [0, 3, 1] }));
    localStorage.setItem('hs:exam:ans', JSON.stringify({ [n]: { c, t: 1 } }));
    localStorage.setItem('hs:exam:wrong', JSON.stringify([n]));
  }, [q.n, q.answer]);
  await page.goto('/exam/review');
  await expect(page.locator('#ex-review-list .ex-pending')).toContainText(EMPTY);
  expect((await stored(page, 'hs:exam:stats'))[q.n]).toEqual([1, 3, 1]);
  expect(await stored(page, 'hs:exam:wrong')).toEqual([]);
  // A result without a stored option (重新作答 forgot it) is left alone.
  await page.evaluate(n => {
    localStorage.setItem('hs:exam:stats', JSON.stringify({ [n]: [0, 1, 1] }));
    localStorage.setItem('hs:exam:ans', JSON.stringify({}));
    localStorage.setItem('hs:exam:wrong', JSON.stringify([n]));
  }, q.n);
  await page.reload();
  await expect(page.locator('#ex-review-list .ex-meta')).toHaveText('共 1 題錯題');
  expect((await stored(page, 'hs:exam:stats'))[q.n][0]).toBe(0);
});

test('signed in: the current chapter chip is highlighted and not a link', async ({ page }) => {
  await signIn(page);
  await page.goto(CHAPTER);
  const card = page.locator('#q-19').first();
  await expect(card).toBeVisible();
  const on = card.locator('.ex-chip-on');
  await expect(on).toHaveCount(1);
  await expect(on).toHaveText('BCSC 12 · Ch.4');
  expect(await on.evaluate(n => n.tagName)).toBe('SPAN');
  await expect(card.locator('a.ex-chip')).toHaveCount(3);
  await expect(card.locator('a.ex-chip').first()).toHaveAttribute('href', '/exam/bcsc1-9#q-19');
  // Every card on the page marks this chapter once.
  const counts = await page.locator('#ex-chapter-qs .ex-q').evaluateAll(list => list.map(c => c.querySelectorAll('.ex-chip-on').length));
  expect(new Set(counts)).toEqual(new Set([1]));
  // Pages without a current chapter keep every chip a link.
  await page.evaluate(() => localStorage.setItem('hs:exam:wrong', JSON.stringify([19])));
  await page.goto('/exam/review');
  await expect(page.locator('#ex-review-list #q-19 a.ex-chip')).toHaveCount(4);
  await expect(page.locator('#ex-review-list .ex-chip-on')).toHaveCount(0);
});

test('signed in: 移出錯題本 updates the 共 N 題錯題 count', async ({ page }) => {
  const ns = JSON.parse(await bank()).questions.filter(q => q.answer).slice(0, 2).map(q => q.n);
  await signIn(page);
  await page.addInitScript(list => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    localStorage.setItem('hs:exam:mode', JSON.stringify('quiz'));
    localStorage.setItem('hs:exam:wrong', JSON.stringify(list));
  }, ns);
  await page.goto('/exam/review');
  const meta = page.locator('#ex-review-list .ex-meta');
  await expect(meta).toHaveText('共 2 題錯題');
  await page.locator(`#q-${ns[0]}`).getByRole('button', { name: '移出錯題本' }).click();
  await expect(meta).toHaveText('共 1 題錯題');
  expect(await stored(page, 'hs:exam:wrong')).toEqual([ns[1]]);
  await page.locator(`#q-${ns[1]}`).getByRole('button', { name: '移出錯題本' }).click();
  await expect(page.locator('#ex-review-list .ex-pending')).toContainText(EMPTY);
  await expect(meta).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#ex-review-list .ex-pending')).toContainText(EMPTY);
});
