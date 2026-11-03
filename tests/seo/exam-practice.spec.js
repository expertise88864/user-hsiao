const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
test.use({ serviceWorkers: 'block' });

// Owner request 2026-11-03 (group 2 of the dermatology exam ports): the 考古卷 practice
// paper is as robust as the dermatology section's.
// - An unfinished paper (questions, picks, submitted answers, time counted, settings)
//   survives a reload, leaving the page and a later visit; 交卷 or 放棄 clears it and
//   產生試卷 replaces it. Signed out, it is kept and resumes once the bank loads.
// - Two tabs on the same paper never write a stale copy over a newer one; a hand-in or a
//   new paper in one tab ends the other's copy.
// - The timer counts only while the page is shown (hidden tab, other pages, back-forward
//   cache and a sleeping computer do not count) and keeps the counted time, not a start time.
// - 已作答 x／y with 只看未作答 and 跳到下一題未作答 sits in the timer bar.
// Answers are still recorded in hs:exam:stats when submitted (and on 交卷), never again
// when a paper is resumed.

const PAPER = 'hs:exam:paper';
let bankJson;
async function bank() {
  if (!bankJson) {
    const mod = await import(pathToFileURL(path.resolve(__dirname, '../../api/_exam_bank.js')).href);
    bankJson = mod.EXAM_BANK_JSON;
  }
  return bankJson;
}
async function signIn(target) {
  const body = await bank();
  await target.route('**/api/exam/data**', route => (route.request().url().includes('check=1')
    ? route.fulfill({ status: 204 })
    : route.fulfill({ status: 200, contentType: 'application/json', body })));
}
async function signOut(target) {
  await target.route('**/api/exam/data**', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
}
const stored = (page, key = PAPER) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), key);
const seedOnce = (page, entries) => page.addInitScript(list => {
  if (sessionStorage.getItem('seeded')) return;
  list.forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
  sessionStorage.setItem('seeded', '1');
}, entries);
const cards = page => page.locator('#ex-practice-list .ex-q');
const card = (page, i) => cards(page).nth(i);
const timer = page => page.locator('.ex-exam-bar .ex-timer');
const note = page => page.locator('.ex-build-note');
async function build(page, count = '10') {
  await page.locator('select[name=ex-count]').selectOption(count);
  await page.locator('input[name=ex-order][value=number]').check();
  await page.getByRole('button', { name: '產生試卷並開始計時' }).click();
  await expect(cards(page)).toHaveCount(Number(count));
}
async function answerOf(c) { return c.getAttribute('data-answer'); }
async function wrongOf(c) {
  const ans = await answerOf(c);
  return ['A', 'B', 'C', 'D'].find(k => k !== ans);
}
async function pick(c, key) { await c.locator(`input[type=radio][value="${key}"]`).check(); }
async function submit(c, key) { await pick(c, key); await c.getByRole('button', { name: '送出答案' }).click(); }
async function setHidden(page, hidden) {
  await page.evaluate(h => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}
// A paused fake clock: only runFor / fastForward move it, so the timer text is exact.
const T0 = new Date('2026-11-03T09:00:00+08:00').getTime();
async function freeze(page) {
  await page.clock.install({ time: T0 });
  await page.clock.pauseAt(T0 + 1000);
}
const RESUMED = n => `已接續上次未交卷的試卷（共 ${n} 題）。按「產生試卷並開始計時」會改出一份新的試卷。`;

test('an unfinished paper survives reload and a later visit: picks, submits, time and settings', async ({ page }) => {
  await freeze(page);
  await signIn(page);
  await page.goto('/exam/practice');
  await build(page);
  const ids = await cards(page).evaluateAll(cs => cs.map(c => Number(c.dataset.qid)));
  const first = card(page, 0);
  const firstAns = await answerOf(first);
  await submit(first, firstAns);
  const second = card(page, 1);
  const secondPick = await wrongOf(second);
  await pick(second, secondPick);
  await page.clock.runFor(65000);
  await expect(timer(page)).toHaveText('01:05');
  const saved = await stored(page);
  expect(saved).toMatchObject({ ids, done: { [ids[0]]: firstAns }, sel: { [ids[1]]: secondPick },
    set: { c: 10, o: 'number' } });
  expect(saved.id).toMatch(/^[a-z0-9]+$/);
  expect(saved.el).toBeGreaterThanOrEqual(60000);
  expect(saved.set.b.length).toBeGreaterThan(5);
  const stats = await stored(page, 'hs:exam:stats');
  expect(stats[ids[0]].slice(0, 2)).toEqual([1, 1]);

  // Away to another page and back later.
  await page.goto('/exam');
  await page.clock.fastForward(20 * 60000);
  await page.goto('/exam/practice');
  await expect(note(page)).toHaveText(RESUMED(10));
  expect(await cards(page).evaluateAll(cs => cs.map(c => Number(c.dataset.qid)))).toEqual(ids);
  await expect(first).toHaveClass(/ex-done/);
  await expect(first).toHaveAttribute('data-outcome', 'right');
  await expect(first.locator('.ex-result')).toHaveText('答對了');
  await expect(second.locator(`input[value="${secondPick}"]`)).toBeChecked();
  await expect(second).not.toHaveClass(/ex-done/);
  await expect(timer(page)).toHaveText('01:05');
  await expect(page.locator('select[name=ex-count]')).toHaveValue('10');
  await expect(page.locator('input[name=ex-order][value=number]')).toBeChecked();
  await expect(page.locator('.ex-exam-bar .ex-ans-text')).toHaveText('已作答 1／10 題・未作答 9 題');
  // A resumed answer is shown again, not recorded again.
  expect((await stored(page, 'hs:exam:stats'))[ids[0]].slice(0, 2)).toEqual([1, 1]);
  // Reload: the timer goes on from the time counted.
  await page.clock.runFor(10000);
  await expect(timer(page)).toHaveText('01:15');
  await page.reload();
  await expect(note(page)).toHaveText(RESUMED(10));
  await expect(timer(page)).toHaveText('01:15');
  await page.clock.runFor(5000);
  await expect(timer(page)).toHaveText('01:20');
});

test('time away is not counted: hidden tab, back-forward cache, a sleeping computer', async ({ page }) => {
  await freeze(page);
  await signIn(page);
  await page.goto('/exam/practice');
  await build(page);
  await page.clock.runFor(30000);
  await expect(timer(page)).toHaveText('00:30');
  await setHidden(page, true);
  await page.clock.fastForward(5 * 60000);
  await expect(timer(page)).toHaveText('00:30');
  expect((await stored(page)).el).toBe(30000);
  await setHidden(page, false);
  await page.clock.runFor(5000);
  await expect(timer(page)).toHaveText('00:35');
  // A sleeping computer: the interval stalls, then fires once and adds at most 5 s.
  await page.clock.fastForward(10 * 60000);
  await page.clock.runFor(1000);
  await expect(timer(page)).toHaveText('00:41');
  const before = '00:41';
  // Back-forward cache: leaving pauses and saves; the restored page (it had the bank,
  // so it reloads) continues from the saved time.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect.poll(async () => (await stored(page)).el).toBe(41000);
  await page.clock.fastForward(5 * 60000);
  await Promise.all([
    page.waitForEvent('load'),
    page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))),
  ]);
  await expect(note(page)).toHaveText(RESUMED(10));
  await expect(timer(page)).toHaveText(before);
});

test('signed out, the stored paper is kept and continues once the bank loads', async ({ page }) => {
  const qs = JSON.parse(await bank()).questions.slice(0, 3);
  const paper = { id: 'abc123', rev: 4, ids: qs.map(q => q.n), sel: { [qs[1].n]: 'B' }, done: { [qs[0].n]: qs[0].answer },
    el: 125000, t: 1, set: { b: ['1'], c: 25, o: 'random' } };
  await freeze(page);
  await seedOnce(page, [[PAPER, paper]]);
  await signOut(page);
  await page.goto('/exam/practice');
  await expect(note(page)).toHaveText('有一份未交卷的試卷（共 3 題），登入題庫後會接續作答。');
  await expect(page.locator('#ex-practice-list .ex-locked a')).toHaveAttribute('href', '/exam/login?next=%2Fexam%2Fpractice');
  await expect(page.locator('select[name=ex-count]')).toHaveValue('25');
  await expect(page.locator('input[name=ex-book]:checked')).toHaveCount(1);
  expect(await stored(page)).toEqual(paper);
  await page.unroute('**/api/exam/data**');
  await signIn(page);
  await page.reload();
  await expect(note(page)).toHaveText(RESUMED(3));
  await expect(card(page, 0)).toHaveAttribute('data-outcome', 'right');
  await expect(card(page, 1).locator('input[value=B]')).toBeChecked();
  await expect(timer(page)).toHaveText('02:05');
});

test('交卷 and 放棄 clear the stored paper, and a new paper replaces it', async ({ page }) => {
  page.on('dialog', d => d.accept());
  await signIn(page);
  await page.goto('/exam/practice');
  await build(page);
  const ids = await cards(page).evaluateAll(cs => cs.map(c => Number(c.dataset.qid)));
  await submit(card(page, 0), await wrongOf(card(page, 0)));
  await pick(card(page, 2), await answerOf(card(page, 2)));
  await expect.poll(async () => (await stored(page) || {}).sel).toEqual({ [ids[2]]: await answerOf(card(page, 2)) });
  await page.getByRole('button', { name: '交卷並計分' }).click();
  await expect(page.locator('.ex-score')).toHaveText('得分 1 / 10（未作答 8 題）');
  await expect.poll(() => stored(page)).toBeNull();
  await expect(page.locator('.ex-discard')).toBeHidden();
  // Hand-in records the picked answer as before; blanks are not recorded.
  const stats = await stored(page, 'hs:exam:stats');
  expect(Object.keys(stats).map(Number).sort((a, b) => a - b)).toEqual([ids[0], ids[2]].sort((a, b) => a - b));
  expect(await stored(page, 'hs:exam:wrong')).toEqual([ids[0]]);
  // Blank cards count as not answered.
  await expect(page.locator('.ex-exam-bar .ex-ans-text')).toHaveText('已作答 2／10 題・未作答 8 題');
  await page.reload();
  await expect(note(page)).toHaveText('');
  await expect(page.locator('#ex-practice-list .ex-pending')).toContainText('選好範圍');
  await expect(page.locator('.ex-exam-bar')).toBeHidden();

  await build(page);
  await expect.poll(async () => (await stored(page) || {}).id).toBeTruthy();
  const firstId = (await stored(page)).id;
  await build(page, '25');
  await expect.poll(async () => (await stored(page) || {}).id).not.toBe(firstId);
  expect((await stored(page)).ids).toHaveLength(25);
  await page.getByRole('button', { name: '放棄這份試卷' }).click();
  await expect.poll(() => stored(page)).toBeNull();
  await expect(note(page)).toHaveText('已放棄這份試卷。');
  await expect(cards(page)).toHaveCount(0);
  await expect(page.locator('#ex-practice-list .ex-pending')).toContainText('選好範圍');
  await expect(page.locator('.ex-exam-bar')).toBeHidden();
  await page.reload();
  await expect(cards(page)).toHaveCount(0);
});

test('malformed stored papers are ignored; bad entries inside one are dropped', async ({ page }) => {
  const qs = JSON.parse(await bank()).questions.slice(0, 2);
  await signIn(page);
  await page.goto('/exam/practice');
  for (const bad of [[1, 2], { id: 'x', rev: 1, ids: [] }, { id: 'BAD!', rev: 1, ids: [qs[0].n] },
    { id: 'ok', rev: -1, ids: [qs[0].n] }, { id: 'ok', rev: 1, ids: [qs[0].n, qs[0].n] }, { id: 'ok', rev: 1, ids: ['5'] }]) {
    await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [PAPER, bad]);
    await page.reload();
    await expect(page.locator('#ex-practice-list .ex-pending')).toContainText('選好範圍');
    await expect(note(page)).toHaveText('');
  }
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [PAPER, '{not json']);
  await page.reload();
  await expect(note(page)).toHaveText('');
  await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [PAPER,
    { id: 'ok1', rev: 2, ids: qs.map(q => q.n), sel: { 99999: 'A', [qs[1].n]: '<b>' }, done: { [qs[0].n]: 7 }, el: -5, set: { b: 'x', c: 7, o: 'z' } }]);
  await page.reload();
  await expect(note(page)).toHaveText(RESUMED(2));
  await expect(page.locator('#ex-practice-list input:checked')).toHaveCount(0);
  await expect(timer(page)).toHaveText(/^00:0[0-1]$/);
  await expect(page.locator('select[name=ex-count]')).toHaveValue('50');
});

test('the 已作答 bar: counts, 只看未作答 and 跳到下一題未作答', async ({ page }) => {
  await signIn(page);
  await page.goto('/exam/practice');
  await build(page);
  const bar = page.locator('.ex-exam-bar .ex-ans-bar');
  await expect(bar).toBeVisible();
  await expect(bar.locator('.ex-ans-text')).toHaveText('已作答 0／10 題・未作答 10 題');
  await submit(card(page, 0), await answerOf(card(page, 0)));
  await submit(card(page, 1), await wrongOf(card(page, 1)));
  await expect(bar.locator('.ex-ans-text')).toHaveText('已作答 2／10 題・未作答 8 題');
  await bar.getByRole('button', { name: '只看未作答' }).click();
  await expect(card(page, 0)).toBeHidden();
  await expect(card(page, 1)).toBeHidden();
  await expect(card(page, 2)).toBeVisible();
  await bar.getByRole('button', { name: '只看未作答' }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await bar.getByRole('button', { name: '跳到下一題未作答' }).click();
  await expect(card(page, 2)).toBeFocused();
  // The bar stays in view with the timer while scrolling the paper.
  await card(page, 8).scrollIntoViewIfNeeded();
  await expect(bar).toBeInViewport();
});

test('two tabs: answers show in the other tab and neither writes back a stale copy', async ({ context }) => {
  await signIn(context);
  const a = await context.newPage();
  await a.goto('/exam/practice');
  await build(a);
  const ids = await cards(a).evaluateAll(cs => cs.map(c => Number(c.dataset.qid)));
  await expect.poll(async () => (await stored(a) || {}).id).toBeTruthy();
  const b = await context.newPage();
  await b.goto('/exam/practice');
  await expect(note(b)).toHaveText(RESUMED(10));
  const ans0 = await answerOf(card(a, 0));
  await submit(card(a, 0), ans0);
  await expect(card(b, 0)).toHaveAttribute('data-outcome', 'right');
  await expect(b.locator('.ex-exam-bar .ex-ans-text')).toHaveText('已作答 1／10 題・未作答 9 題');
  const pick1 = await wrongOf(card(b, 1));
  await pick(card(b, 1), pick1);
  await expect(card(a, 1).locator(`input[value="${pick1}"]`)).toBeChecked();
  // A newer copy saved by a third tab whose storage event has not reached b yet: b's
  // next change is merged into it instead of replacing it.
  const ans2 = await answerOf(card(b, 2));
  await b.evaluate(([k, n, key]) => {
    const p = JSON.parse(localStorage.getItem(k));
    p.done[n] = key;
    p.rev += 1;
    localStorage.setItem(k, JSON.stringify(p));
  }, [PAPER, ids[2], ans2]);
  const pick3 = await answerOf(card(b, 3));
  await pick(card(b, 3), pick3);
  await expect.poll(async () => (await stored(b)).sel).toEqual({ [ids[1]]: pick1, [ids[3]]: pick3 });
  expect((await stored(b)).done).toEqual({ [ids[0]]: ans0, [ids[2]]: ans2 });
  await expect(card(b, 2)).toHaveAttribute('data-outcome', 'right');
  await expect(card(a, 2)).toHaveAttribute('data-outcome', 'right');
  // 交卷 in a: b stops and saves nothing more.
  await a.getByRole('button', { name: '交卷並計分' }).click();
  await expect(b.locator('.ex-score')).toHaveText('這份試卷已在其他分頁交卷或放棄，本頁不再計時或保存；請重新整理頁面。');
  await expect(b.getByRole('button', { name: '交卷並計分' })).toBeDisabled();
  await expect(b.locator('.ex-discard')).toBeHidden();
  const frozen = await timer(b).textContent();
  await pick(card(b, 5), await answerOf(card(b, 5)));
  await b.waitForTimeout(1500);
  expect(await stored(b)).toBeNull();
  await expect(timer(b)).toHaveText(frozen);
});

test('two tabs: a new paper in one tab ends the other tab\'s copy', async ({ context }) => {
  await signIn(context);
  const a = await context.newPage();
  await a.goto('/exam/practice');
  await build(a);
  await expect.poll(async () => (await stored(a) || {}).id).toBeTruthy();
  const b = await context.newPage();
  await b.goto('/exam/practice');
  await expect(note(b)).toHaveText(RESUMED(10));
  await build(a, '25');
  await expect(b.locator('.ex-score')).toHaveText('已在其他分頁產生新的試卷，本頁不再計時或保存；請重新整理頁面。');
  const fresh = await stored(a);
  expect(fresh.ids).toHaveLength(25);
  await pick(card(b, 0), await answerOf(card(b, 0)));
  await b.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  await b.waitForTimeout(500);
  expect(await stored(a)).toEqual(fresh);
  await b.reload();
  await expect(note(b)).toHaveText(RESUMED(25));
});

test('changes wait for the cross-tab lock, so a hand-in made meanwhile is not undone', async ({ page }) => {
  await signIn(page);
  await page.goto('/exam/practice');
  await build(page);
  await expect.poll(async () => (await stored(page) || {}).id).toBeTruthy();
  const before = await stored(page);
  // Another tab holds the paper lock.
  await page.evaluate(k => { navigator.locks.request(k, () => new Promise(res => { window.__release = res; })); }, PAPER);
  await page.waitForFunction(() => typeof window.__release === 'function');
  await submit(card(page, 0), await answerOf(card(page, 0)));
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  expect(await stored(page)).toEqual(before);
  // The other tab hands the paper in, then releases the lock.
  await page.evaluate(k => { localStorage.removeItem(k); window.__release(); }, PAPER);
  await expect(page.locator('.ex-score')).toHaveText('這份試卷已在其他分頁交卷或放棄，本頁不再計時或保存；請重新整理頁面。');
  expect(await stored(page)).toBeNull();
});
