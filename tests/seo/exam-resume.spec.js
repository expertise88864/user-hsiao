const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
test.use({ serviceWorkers: 'block' });

// Owner request 2026-10-17: a chapter page reopens at the section of the notes the
// reader last reached on this device (unless a link names its own target), and in
// 作答模式 the questions show what was answered last time and what is still open.
// Same bank mocking as exam-study-tools.spec.js: "signed in" means /api/exam/data
// answers with the generated bank, "signed out" means it answers 401.

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
  await page.route('**/api/exam/data**', route => (route.request().url().includes('check=1')
    ? route.fulfill({ status: 204 })
    : route.fulfill({ status: 200, contentType: 'application/json', body })));
}
async function signOut(page) {
  await page.route('**/api/exam/data**', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"login required"}' }));
}
const stored = (page, key) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), key);
const CHAPTER = '/exam/bcsc12-4';

// Scroll a note element to just under the sticky header, the way a reader would.
async function readTo(page, id) {
  // Let the late sign-in bar and web fonts settle first, so nothing shifts afterwards.
  await expect(page.locator('.ex-auth')).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.mouse.move(400, 400);
  await page.mouse.wheel(0, 200);
  await page.waitForFunction(() => window.scrollY > 0);
  await page.waitForTimeout(300);
  await page.evaluate(i => document.getElementById(i).scrollIntoView({ block: 'start', behavior: 'instant' }), id);
}

test('reading position is saved, restored with a notice, and 從頭開始 clears it', async ({ page }) => {
  await signOut(page);
  await page.goto(CHAPTER);
  await page.waitForLoadState('load');
  await readTo(page, 'ch4-s3');
  await expect.poll(() => stored(page, 'hs:exam:pos')).toEqual({ '12-4': { id: 'ch4-s3', t: expect.any(Number) } });
  const title = (await page.locator('#ch4-s3').textContent()).replace(/\s+/g, ' ').trim();

  await page.goto('/exam');
  await page.goto(CHAPTER);
  const notice = page.locator('.ex-resume');
  await expect(notice).toHaveAttribute('role', 'status');
  await expect(notice.locator('.ex-resume-text')).toHaveText('已跳到上次讀到的位置：' + title);
  await page.waitForLoadState('load');
  // The section sits just below the sticky header and the notice, not under them.
  await expect.poll(async () => {
    const box = await page.locator('#ch4-s3').boundingBox();
    const bar = await notice.boundingBox();
    return box.y >= bar.y + bar.height && box.y < bar.y + bar.height + 60;
  }).toBe(true);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await notice.getByRole('button', { name: '從頭開始' }).click();
  await expect(notice).toHaveCount(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);   // instant under reduced motion
  await expect(page.locator('.ex-h1')).toBeFocused();
  await expect.poll(() => stored(page, 'hs:exam:pos')).toEqual({});

  await page.goto('/exam');
  await page.goto(CHAPTER);
  await page.waitForLoadState('load');
  await expect(page.locator('.ex-resume')).toHaveCount(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('closing the notice keeps the position; scrolling back above the notes forgets it', async ({ page }) => {
  await signOut(page);
  await page.goto(CHAPTER);
  await page.waitForLoadState('load');
  await readTo(page, 'np-40');
  await expect.poll(() => stored(page, 'hs:exam:pos').then(p => p && p['12-4'] && p['12-4'].id)).toBe('np-40');
  await page.goto('/exam');
  await page.goto(CHAPTER);
  await expect(page.locator('.ex-resume-text')).toContainText('已跳到上次讀到的位置：');
  await page.getByRole('button', { name: '關閉提示' }).click();
  await expect(page.locator('.ex-resume')).toHaveCount(0);
  await expect(page.locator('#np-40')).toBeFocused();
  expect((await stored(page, 'hs:exam:pos'))['12-4'].id).toBe('np-40');
  await page.mouse.wheel(0, -50);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect.poll(() => stored(page, 'hs:exam:pos')).toEqual({});
});

test('a #hash or ?hl= link overrides the saved position', async ({ page }) => {
  await signOut(page);
  await page.addInitScript(() => {
    try { localStorage.setItem('hs:exam:pos', JSON.stringify({ '12-4': { id: 'ch4-s8', t: 1 } })); } catch (e) { /* about:blank */ }
  });
  await page.goto(CHAPTER + '#np-5');
  await page.waitForLoadState('load');
  await expect(page.locator('#np-5')).toBeInViewport();
  await expect(page.locator('.ex-resume')).toHaveCount(0);
  await page.goto(CHAPTER + '?hl=AREDS');
  await page.waitForLoadState('load');
  await expect(page.locator('.ex-note mark.ex-find-hl').first()).toBeVisible();
  await expect(page.locator('.ex-resume')).toHaveCount(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.goto(CHAPTER);
  await expect(page.locator('.ex-resume')).toBeVisible();
  await expect(page.locator('#ch4-s8')).toBeInViewport();
});

test('signed in: quiz answers come back after a reload; browse mode stays unchanged', async ({ page }) => {
  await signIn(page);
  await page.goto(CHAPTER);
  await page.getByRole('button', { name: '作答模式' }).click();
  const cards = page.locator('#ex-chapter-qs .ex-q:not(.ex-unanswered)');
  const first = cards.nth(0);
  const second = cards.nth(1);
  const right = await first.getAttribute('data-answer');
  await first.locator(`.ex-opt[data-key="${right}"]`).click();
  await first.getByRole('button', { name: '送出答案' }).click();
  const answer2 = await second.getAttribute('data-answer');
  const wrongKey = await second.locator('.ex-opt').evaluateAll((opts, a) => opts.map(o => o.dataset.key).find(k => k !== a), answer2);
  await second.locator(`.ex-opt[data-key="${wrongKey}"]`).click();
  await second.getByRole('button', { name: '送出答案' }).click();
  const n1 = await first.getAttribute('data-qid');
  const n2 = await second.getAttribute('data-qid');
  const ans = await stored(page, 'hs:exam:ans');
  expect(ans[n1]).toEqual({ c: right, t: expect.any(Number) });
  expect(ans[n2]).toEqual({ c: wrongKey, t: expect.any(Number) });

  await page.reload();
  await expect(first).toHaveAttribute('data-outcome', 'right');
  await expect(first.locator(`.ex-opt[data-key="${right}"] input`)).toBeChecked();
  await expect(first.locator('.ex-result')).toHaveText('答對了');
  await expect(first.locator('.ex-reveal')).toBeVisible();
  await expect(second).toHaveAttribute('data-outcome', 'wrong');
  await expect(second.locator(`.ex-opt[data-key="${wrongKey}"]`)).toHaveClass(/ex-picked/);
  await expect(second.locator('.ex-result')).toHaveText('答錯了，答案是 ' + answer2);
  await expect(second.locator('input[type=radio]').first()).toBeDisabled();
  // Restoring does not count the answers again.
  const stats = await stored(page, 'hs:exam:stats');
  expect(stats[n1][1]).toBe(1);
  expect(await stored(page, 'hs:exam:wrong')).toEqual([Number(n2)]);
  await expect(page.locator('[data-progress-chapter] .ex-strip-text')).toContainText('已作答 2 /');

  // 重新作答 forgets that question's stored choice.
  await first.getByRole('button', { name: '重新作答' }).click();
  expect((await stored(page, 'hs:exam:ans'))[n1]).toBeUndefined();

  await page.getByRole('button', { name: '瀏覽模式' }).click();
  await page.reload();
  await expect(cards.first()).toBeVisible();
  await expect(page.locator('#ex-chapter-qs .ex-q.ex-done')).toHaveCount(0);
  await expect(page.locator('.ex-ans-bar')).toBeHidden();
  await expect(page.locator('.ex-ans-clear')).toBeHidden();
  await page.getByRole('button', { name: '作答模式' }).click();
  await expect(second).toHaveAttribute('data-outcome', 'wrong');
  await expect(first).not.toHaveClass(/ex-done/);
});

test('signed in: unanswered counter and 跳到下一題未作答 (wrapping)', async ({ page }) => {
  await signIn(page);
  await page.addInitScript(() => localStorage.setItem('hs:exam:mode', JSON.stringify('quiz')));
  await page.goto(CHAPTER);
  const cards = page.locator('#ex-chapter-qs .ex-q:not(.ex-unanswered)');
  await expect(cards.first()).toBeVisible();
  const ids = await cards.evaluateAll(list => [...new Set(list.map(c => c.dataset.qid))]);
  const total = ids.length;
  expect(total).toBeGreaterThan(3);
  const bar = page.locator('.ex-ans-bar');
  await expect(bar.locator('.ex-ans-text')).toHaveText(`已作答 0／${total} 題・未作答 ${total} 題`);
  await expect(cards.first().locator('.ex-q-no')).toBeVisible();
  expect(await cards.first().locator('.ex-q-no').evaluate(n => getComputedStyle(n, '::after').content)).toContain('未作答');

  const answer = await cards.first().getAttribute('data-answer');
  await cards.first().locator(`.ex-opt[data-key="${answer}"]`).click();
  await cards.first().getByRole('button', { name: '送出答案' }).click();
  await expect(bar.locator('.ex-ans-text')).toHaveText(`已作答 1／${total} 題・未作答 ${total - 1} 題`);
  expect(await cards.first().locator('.ex-q-no').evaluate(n => getComputedStyle(n, '::after').content)).toBe('none');

  const next = bar.getByRole('button', { name: '跳到下一題未作答' });
  await next.click();
  await expect(page.locator(`#q-${ids[1]}`)).toBeFocused();
  await expect(page.locator(`#q-${ids[1]}`)).toBeInViewport();
  await next.click();
  await expect(page.locator(`#q-${ids[2]}`)).toBeFocused();

  // Everything but the first question answered: from the bottom the jump wraps to it.
  const keys = await cards.evaluateAll(list => Object.fromEntries(list.map(c => [c.dataset.qid, c.dataset.answer])));
  await page.evaluate(([keep, all]) => {
    const ans = {};
    Object.keys(all).forEach(n => { if (n !== keep) ans[n] = { c: all[n], t: 1 }; });
    localStorage.setItem('hs:exam:ans', JSON.stringify(ans));
  }, [ids[0], keys]);
  await page.reload();
  await expect(bar.locator('.ex-ans-text')).toHaveText(`已作答 ${total - 1}／${total} 題・未作答 1 題`);
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
  await next.click();
  await expect(page.locator(`#q-${ids[0]}`)).toBeFocused();
  await expect(page.locator(`#q-${ids[0]}`)).toBeInViewport();
  const a0 = await page.locator(`#q-${ids[0]}`).getAttribute('data-answer');
  await page.locator(`#q-${ids[0]} .ex-opt[data-key="${a0}"]`).click();
  await page.locator(`#q-${ids[0]}`).getByRole('button', { name: '送出答案' }).click();
  await expect(bar.locator('.ex-ans-text')).toHaveText(`已作答 ${total}／${total} 題・未作答 0 題`);
  await expect(next).toBeDisabled();
});

test('signed in: 清除本章作答紀錄 resets only this chapter', async ({ page }) => {
  await signIn(page);
  const other = JSON.parse(await bank()).questions.find(q => q.answer && !q.ch.includes('12-4')).n;
  await page.addInitScript(n => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    localStorage.setItem('hs:exam:mode', JSON.stringify('quiz'));
    localStorage.setItem('hs:exam:stats', JSON.stringify({ [n]: [0, 2, 1] }));
    localStorage.setItem('hs:exam:ans', JSON.stringify({ [n]: { c: 'B', t: 1 } }));
    localStorage.setItem('hs:exam:wrong', JSON.stringify([n]));
  }, other);
  await page.goto(CHAPTER);
  const cards = page.locator('#ex-chapter-qs .ex-q:not(.ex-unanswered)');
  const first = cards.nth(0);
  const answer = await first.getAttribute('data-answer');
  const wrongKey = await first.locator('.ex-opt').evaluateAll((opts, a) => opts.map(o => o.dataset.key).find(k => k !== a), answer);
  await first.locator(`.ex-opt[data-key="${wrongKey}"]`).click();
  await first.getByRole('button', { name: '送出答案' }).click();
  const n1 = Number(await first.getAttribute('data-qid'));
  await expect(page.locator('[data-progress-chapter] .ex-strip-text')).toContainText('已作答 1 /');

  const clear = page.getByRole('button', { name: '清除本章作答紀錄' });
  page.once('dialog', d => d.dismiss());
  await clear.click();
  await expect(first).toHaveClass(/ex-done/);

  page.once('dialog', d => { expect(d.message()).toContain('清除本章'); d.accept(); });
  await clear.click();
  await expect(first).not.toHaveClass(/ex-done/);
  await expect(first.locator('input[type=radio]:checked')).toHaveCount(0);
  await expect(page.locator('.ex-ans-bar .ex-ans-text')).toHaveText(/^已作答 0／\d+ 題/);
  await expect(page.locator('[data-progress-chapter] .ex-strip-text')).toContainText('還沒有作答紀錄');
  expect(Object.keys(await stored(page, 'hs:exam:ans'))).toEqual([String(other)]);
  expect(Object.keys(await stored(page, 'hs:exam:stats'))).toEqual([String(other)]);
  expect((await stored(page, 'hs:exam:wrong')).sort()).toEqual([other, n1].sort());
  await page.reload();
  await expect(cards.first()).toBeVisible();
  await expect(page.locator('#ex-chapter-qs .ex-q.ex-done')).toHaveCount(0);
});

test('signed in: 清除作答紀錄 on /exam/progress also forgets the stored answers', async ({ page }) => {
  await signIn(page);
  await page.addInitScript(() => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    localStorage.setItem('hs:exam:mode', JSON.stringify('quiz'));
  });
  await page.goto(CHAPTER);
  const first = page.locator('#ex-chapter-qs .ex-q:not(.ex-unanswered)').first();
  await first.locator('.ex-opt').first().click();
  await first.getByRole('button', { name: '送出答案' }).click();
  await expect(first).toHaveClass(/ex-done/);
  expect(Object.keys(await stored(page, 'hs:exam:ans')).length).toBe(1);

  await page.goto('/exam/progress');
  page.once('dialog', d => d.accept());
  await page.locator('.ex-clear-progress').click();
  expect(await stored(page, 'hs:exam:ans')).toEqual({});
  expect(await stored(page, 'hs:exam:stats')).toEqual({});

  await page.goto(CHAPTER);
  await expect(page.locator('#ex-chapter-qs .ex-q').first()).toBeVisible();
  await expect(page.locator('#ex-chapter-qs .ex-q.ex-done')).toHaveCount(0);
  await expect(page.locator('.ex-ans-bar .ex-ans-text')).toHaveText(/^已作答 0／\d+ 題/);
});

test('signed out: no answer bar; storage disabled: pages still work', async ({ page, browser }) => {
  await signOut(page);
  await page.goto(CHAPTER);
  await expect(page.locator('#ex-chapter-qs .ex-locked')).toBeVisible();
  await expect(page.locator('.ex-ans-bar, .ex-ans-clear')).toHaveCount(0);

  const context = await browser.newContext({ serviceWorkers: 'block' });
  const blocked = await context.newPage();
  const errors = [];
  blocked.on('pageerror', e => errors.push(e.message));
  await blocked.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage disabled'); } });
  });
  await signIn(blocked);
  await blocked.goto(CHAPTER);
  await blocked.getByRole('button', { name: '作答模式' }).click();
  const card = blocked.locator('#ex-chapter-qs .ex-q:not(.ex-unanswered)').first();
  const answer = await card.getAttribute('data-answer');
  await card.locator(`.ex-opt[data-key="${answer}"]`).click();
  await card.getByRole('button', { name: '送出答案' }).click();
  await expect(card).toHaveAttribute('data-outcome', 'right');
  await expect(blocked.locator('.ex-ans-bar .ex-ans-text')).toHaveText(/^已作答 1／/);
  await blocked.mouse.wheel(0, 2000);
  await blocked.waitForTimeout(400);
  await blocked.reload();
  await expect(blocked.locator('.ex-resume')).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});
