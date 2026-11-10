const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });

// Owner order 2026-11-10: a public mock exam of self-written questions, usable without
// logging in. /exam/mock is complete as served; exam.js adds the timer, the hand-in and
// the score, and keeps an attempt under its own storage key. Nothing here may read the
// question bank or write the bank's stores (stats, wrong list, stored answers, paper).
const KEY = 'hs:exam:mock:pilot1';
const TOTAL = 50;
const stored = (page, key = KEY) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), key);
const signedOut = page => page.route('**/api/exam/data**', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
const card = (page, no) => page.locator(`#mq-${no}`);
const answerOf = (page, no) => card(page, no).getAttribute('data-answer');
const pick = (page, no, key) => card(page, no).locator(`.ex-mopt[data-key="${key}"]`).click();
const wrongKey = answer => (answer === 'A' ? 'B' : 'A');
const bar = page => page.locator('[data-mock-bar]');
const timer = page => bar(page).locator('.ex-timer');
const count = page => bar(page).locator('.ex-mock-count');
const finish = page => bar(page).locator('.ex-mock-finish');
const reset = page => bar(page).locator('.ex-mock-reset');
const result = page => page.locator('[data-mock-result]');
// A paused fake clock: only runFor moves it, so the timer text is exact.
const T0 = new Date('2026-11-10T09:00:00+08:00').getTime();
async function freeze(page) {
  await page.clock.install({ time: T0 });
  await page.clock.pauseAt(T0 + 1000);
}
async function setHidden(page, hidden) {
  await page.evaluate(h => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}
// Answer the next confirm() and return its message.
function nextDialog(page, accept) {
  return new Promise(resolve => page.once('dialog', async d => {
    const message = d.message();
    if (accept) await d.accept(); else await d.dismiss();
    resolve(message);
  }));
}
async function handIn(page) {
  const asked = nextDialog(page, true);
  await finish(page).click();
  return asked;
}

test('signed out: answer, time, hand in, read the explanations, resume and start over', async ({ page }) => {
  const api = [];
  page.on('request', r => { if (r.url().includes('/api/exam/')) api.push(r.url()); });
  await freeze(page);
  await signedOut(page);
  await page.goto('/exam/mock');
  await expect(page.locator('[data-mock-paper] > .ex-mq')).toHaveCount(TOTAL);
  await expect(count(page)).toHaveText(`已作答 0 / ${TOTAL}`);
  await expect(finish(page)).toBeDisabled();
  await expect(reset(page)).toBeHidden();
  await expect(result(page)).toBeHidden();
  await expect(card(page, 1).locator('.ex-mq-exp')).toBeHidden();
  await expect(page.locator('.ex-auth')).toHaveCount(0);
  // the timer waits for the first answer
  await page.clock.runFor(5000);
  await expect(timer(page)).toHaveText('00:00');
  expect(await stored(page)).toBeNull();

  const a1 = await answerOf(page, 1);
  const a2 = await answerOf(page, 2);
  const a3 = await answerOf(page, 3);
  await pick(page, 1, wrongKey(a1));
  await expect(count(page)).toHaveText(`已作答 1 / ${TOTAL}`);
  await expect(finish(page)).toBeEnabled();
  await expect(reset(page)).toBeVisible();
  await page.clock.runFor(65000);
  await expect(timer(page)).toHaveText('01:05');
  // an answer can be changed until the paper is handed in; nothing is revealed meanwhile
  await pick(page, 1, a1);
  await pick(page, 2, wrongKey(a2));
  await expect(count(page)).toHaveText(`已作答 2 / ${TOTAL}`);
  await expect(card(page, 1).locator('.ex-mq-exp')).toBeHidden();
  await expect(card(page, 1).locator('.ex-mq-result')).toHaveText('');
  await expect(card(page, 1).locator('.ex-right, .ex-wrong')).toHaveCount(0);
  // a save waits for the cross-tab lock, so storage follows the page a moment later
  await expect.poll(() => stored(page)).toMatchObject({ sel: { 'p1-01': a1, 'p1-02': wrongKey(a2) }, el: 65000, done: false });
  expect((await stored(page)).a).toMatch(/^[a-z0-9]{8,}$/);

  // a later visit continues the attempt; time off the screen is not counted
  await page.reload();
  await expect(count(page)).toHaveText(`已作答 2 / ${TOTAL}`);
  await expect(card(page, 1).locator(`input[value="${a1}"]`)).toBeChecked();
  await expect(timer(page)).toHaveText('01:05');
  await page.clock.runFor(5000);
  await expect(timer(page)).toHaveText('01:10');
  await setHidden(page, true);
  await page.clock.runFor(60000);
  await setHidden(page, false);
  await expect(timer(page)).toHaveText('01:10');

  // declining the confirmation changes nothing
  let asked = nextDialog(page, false);
  await finish(page).click();
  expect(await asked).toBe(`還有 ${TOTAL - 2} 題沒有作答。確定要交卷嗎？交卷後不能再修改答案。`);
  await expect(result(page)).toBeHidden();
  expect((await stored(page)).done).toBe(false);

  await handIn(page);
  await expect(bar(page).locator('.ex-score')).toHaveText(`得分 1 / ${TOTAL}（未作答 ${TOTAL - 2} 題）`);
  await expect(result(page).locator('.ex-mock-total')).toHaveText(`答對 1 / ${TOTAL} 題（2%），未作答 ${TOTAL - 2} 題；作答時間 01:10`);
  await expect(result(page).locator('h2')).toBeFocused();
  await expect(result(page).locator('tr[data-book="1"] [data-right]')).toHaveText('1');
  await expect(result(page).locator('tr[data-book="13"] [data-right]')).toHaveText('0');
  await expect(result(page).locator('.ex-mock-missed a')).toHaveCount(TOTAL - 1);
  await expect(result(page).locator('.ex-mock-missed a').first()).toHaveAttribute('href', '#mq-2');
  await expect(finish(page)).toBeHidden();
  await expect(page.locator('[data-mock-paper] input:not(:disabled)')).toHaveCount(0);
  // right: explanation offered but closed; wrong and blank: opened
  await expect(card(page, 1)).toHaveAttribute('data-outcome', 'right');
  await expect(card(page, 1).locator('.ex-mq-result')).toHaveText('答對');
  await expect(card(page, 1).locator('.ex-mq-exp > summary')).toBeVisible();
  await expect(card(page, 1).locator('.ex-mq-exp')).not.toHaveAttribute('open', /.*/);
  await expect(card(page, 2)).toHaveAttribute('data-outcome', 'wrong');
  await expect(card(page, 2).locator('.ex-mq-result')).toHaveText(`答錯：你選 ${wrongKey(a2)}，正確答案是 ${a2}`);
  await expect(card(page, 2).locator('.ex-mq-exp .ex-items')).toBeVisible();
  await expect(card(page, 2).locator(`.ex-mopt[data-key="${a2}"]`)).toHaveClass(/ex-right/);
  await expect(card(page, 2).locator(`.ex-mopt[data-key="${wrongKey(a2)}"]`)).toHaveClass(/ex-wrong/);
  await expect(card(page, 3)).toHaveAttribute('data-outcome', 'blank');
  await expect(card(page, 3).locator('.ex-mq-result')).toHaveText(`未作答：正確答案是 ${a3}`);
  await expect(card(page, 3).locator('.ex-mq-exp .ex-answer')).toBeVisible();
  // the clock stops at the hand-in
  await page.clock.runFor(30000);
  await expect(timer(page)).toHaveText('01:10');

  // the graded paper is kept, and what the reader closed is not reopened by a repaint
  await page.reload();
  await expect(bar(page).locator('.ex-score')).toHaveText(`得分 1 / ${TOTAL}（未作答 ${TOTAL - 2} 題）`);
  await expect(card(page, 2)).toHaveAttribute('data-outcome', 'wrong');
  await expect(result(page)).toBeVisible();

  asked = nextDialog(page, true);
  await reset(page).click();
  expect(await asked).toBe('確定要清除這次的作答與成績，重新開始嗎？');
  await expect(count(page)).toHaveText(`已作答 0 / ${TOTAL}`);
  await expect(timer(page)).toHaveText('00:00');
  await expect(result(page)).toBeHidden();
  await expect(reset(page)).toBeHidden();
  await expect(page.locator('[data-mock-paper] input:checked')).toHaveCount(0);
  await expect(page.locator('[data-mock-paper] input:disabled')).toHaveCount(0);
  await expect(card(page, 2).locator('.ex-mq-exp')).toBeHidden();
  await expect(card(page, 2).locator('.ex-mq-result')).toHaveText('');
  await expect(card(page, 1).locator('input').first()).toBeFocused();
  // the first question is not left under the sticky bar
  const top = await card(page, 1).evaluate(el => el.getBoundingClientRect().top);
  const barBottom = await bar(page).evaluate(el => el.getBoundingClientRect().bottom);
  expect(top).toBeGreaterThanOrEqual(barBottom);
  expect(await stored(page)).toBeNull();
  // the page never asked the bank for anything
  expect(api).toEqual([]);
});

test('a full paper answered correctly scores 50 / 50 and opens no explanation', async ({ page }) => {
  await signedOut(page);
  await page.goto('/exam/mock');
  for (let no = 1; no <= TOTAL; no += 1) await pick(page, no, await answerOf(page, no));
  await expect(count(page)).toHaveText(`已作答 ${TOTAL} / ${TOTAL}`);
  expect(await handIn(page)).toBe('確定要交卷嗎？交卷後不能再修改答案。');
  await expect(bar(page).locator('.ex-score')).toHaveText(`得分 ${TOTAL} / ${TOTAL}`);
  await expect(result(page).locator('.ex-mock-total')).toContainText(`答對 ${TOTAL} / ${TOTAL} 題（100%）；作答時間`);
  await expect(result(page).locator('.ex-mock-missed')).toHaveText('全部答對。');
  await expect(page.locator('.ex-mq[data-outcome="right"]')).toHaveCount(TOTAL);
  await expect(page.locator('.ex-mq-exp[open]')).toHaveCount(0);
  const rows = await result(page).locator('tbody tr').evaluateAll(list => list.map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent)));
  expect(rows.every(([n, right]) => n === right)).toBe(true);
  expect(rows.reduce((sum, [n]) => sum + Number(n), 0)).toBe(TOTAL);
});

test('the bank\'s stores are left alone and unusable stored state is dropped', async ({ page }) => {
  const bank = [
    ['hs:exam:stats', { 12: [1, 2, 1760000000000] }],
    ['hs:exam:wrong', ['34']],
    ['hs:exam:ans', { 12: { c: 'B', t: 1760000000000 } }],
    ['hs:exam:read', ['1-1']],
  ];
  await page.addInitScript(([list, key]) => {
    if (sessionStorage.getItem('seeded')) return;
    list.forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
    // hand-edited or foreign state: an unknown option, an unknown question, a non-string
    // pick, a non-numeric time and a truthy-but-not-true hand-in flag
    localStorage.setItem(key, JSON.stringify({ sel: { 'p1-01': 'E', 'zz-99': 'A', 'p1-02': 'C', 'p1-03': 5 }, el: 'x', done: 'yes' }));
    sessionStorage.setItem('seeded', '1');
  }, [bank, KEY]);
  await freeze(page);
  await signedOut(page);
  await page.goto('/exam/mock');
  await expect(count(page)).toHaveText(`已作答 1 / ${TOTAL}`);
  await expect(card(page, 2).locator('input[value="C"]')).toBeChecked();
  await expect(timer(page)).toHaveText('00:00');
  await expect(result(page)).toBeHidden();
  const before = await page.evaluate(keys => keys.map(k => localStorage.getItem(k)), bank.map(([k]) => k));
  expect(before).toEqual(bank.map(([, v]) => JSON.stringify(v)));
  await pick(page, 4, await answerOf(page, 4));
  await handIn(page);
  await expect(result(page)).toBeVisible();
  expect(await stored(page)).toMatchObject({ sel: { 'p1-02': 'C', 'p1-04': await answerOf(page, 4) }, done: true });
  expect(Object.keys((await stored(page)).sel)).toHaveLength(2);
  const after = await page.evaluate(keys => keys.map(k => localStorage.getItem(k)), bank.map(([k]) => k));
  expect(after).toEqual(before);
  expect(await page.evaluate(() => localStorage.getItem('hs:exam:paper'))).toBeNull();

  // not an object at all
  await page.evaluate(k => localStorage.setItem(k, '"oops"'), KEY);
  await page.reload();
  await expect(count(page)).toHaveText(`已作答 0 / ${TOTAL}`);
  await expect(finish(page)).toBeDisabled();
});

// Review finding on PR #100: with the paper open in two windows, a save from the window that
// had not heard of the other's hand-in yet wrote its whole old snapshot back (done: false).
test('two windows on one paper: answers merge, a hand-in is final, starting over reaches both', async ({ context }) => {
  // A window can be made deaf to storage events: the state of a tab that has not been
  // told about another tab's change yet.
  await context.addInitScript(() => {
    window.addEventListener('storage', ev => { if (window.__deaf) ev.stopImmediatePropagation(); }, true);
  });
  const a = await context.newPage();
  const b = await context.newPage();
  const deaf = (page, on) => page.evaluate(v => { window.__deaf = v; }, on);
  await freeze(a);
  for (const page of [a, b]) {
    await signedOut(page);
    await page.goto('/exam/mock');
    await expect(count(page)).toHaveText(`已作答 0 / ${TOTAL}`);
  }
  const a1 = await answerOf(a, 1);
  const a2 = await answerOf(a, 2);
  const a3 = await answerOf(a, 3);

  // answers picked in either window reach the other one
  await pick(a, 1, a1);
  await expect(count(b)).toHaveText(`已作答 1 / ${TOTAL}`);
  await pick(b, 2, wrongKey(a2));
  await expect(count(a)).toHaveText(`已作答 2 / ${TOTAL}`);
  await expect(card(a, 2).locator(`input[value="${wrongKey(a2)}"]`)).toBeChecked();
  const picks = { 'p1-01': a1, 'p1-02': wrongKey(a2) };

  // A hands in; B has not heard of it when it saves on leaving the screen
  await deaf(b, true);
  await handIn(a);
  await expect(result(a)).toBeVisible();
  await expect(finish(b)).toBeVisible();
  await setHidden(b, true);
  expect(await stored(a)).toMatchObject({ sel: picks, done: true });
  await setHidden(b, false);
  await expect(result(b)).toBeVisible();
  await expect(bar(b).locator('.ex-score')).toHaveText(`得分 1 / ${TOTAL}（未作答 ${TOTAL - 2} 題）`);
  await deaf(b, false);

  // a snapshot from before the hand-in that lands in storage afterwards does not undo it
  const graded = await stored(a);
  await b.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [KEY, { ...graded, sel: { 'p1-01': a1 }, done: false }]);
  await expect.poll(() => stored(a)).toMatchObject({ a: graded.a, sel: picks, done: true });
  await expect(result(a)).toBeVisible();
  await expect(card(a, 2)).toHaveAttribute('data-outcome', 'wrong');

  // starting over in A clears B too
  const asked = nextDialog(a, true);
  await reset(a).click();
  await asked;
  await expect(count(a)).toHaveText(`已作答 0 / ${TOTAL}`);
  await expect(count(b)).toHaveText(`已作答 0 / ${TOTAL}`);
  await expect(result(b)).toBeHidden();
  await expect(b.locator('[data-mock-paper] input:disabled')).toHaveCount(0);
  expect(await stored(a)).toBeNull();

  // second attempt: A hands in, and B, not told yet, picks one more answer
  await pick(a, 1, a1);
  await expect(count(b)).toHaveText(`已作答 1 / ${TOTAL}`);
  await deaf(b, true);
  await handIn(a);
  await expect(result(a)).toBeVisible();
  await expect(finish(b)).toBeVisible();
  await pick(b, 3, a3);
  await expect(result(b)).toBeVisible();
  await expect(card(b, 3)).toHaveAttribute('data-outcome', 'blank');
  await expect(bar(b).locator('.ex-score')).toHaveText(`得分 1 / ${TOTAL}（未作答 ${TOTAL - 1} 題）`);
  const second = await stored(a);
  expect(second).toMatchObject({ sel: { 'p1-01': a1 }, done: true });
  expect(Object.keys(second.sel)).toHaveLength(1);
  expect(second.a).not.toBe(graded.a);
  await expect(result(a)).toBeVisible();
});

test('a hand-in or start-over confirmed for one attempt leaves the next attempt alone', async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  for (const page of [a, b]) {
    await signedOut(page);
    await page.goto('/exam/mock');
    await expect(count(page)).toHaveText(`已作答 0 / ${TOTAL}`);
  }
  const a1 = await answerOf(a, 1);
  const a2 = await answerOf(a, 2);
  const a3 = await answerOf(a, 3);
  // Press `button` in A and, while A waits at its confirmation, start over in B and
  // answer question `no` there; then accept A's confirmation. B holds the save lock
  // until A has shown B's answer, so A hears of the new attempt before its own save runs
  // (the order a browser may choose by itself).
  async function whileAsking(button, no, key) {
    const opened = a.waitForEvent('dialog');
    const clicked = button.click();
    const dialog = await opened;
    const asked = nextDialog(b, true);
    await reset(b).click();
    await asked;
    await pick(b, no, key);
    await expect.poll(async () => Object.keys(((await stored(b)) || { sel: {} }).sel)).toEqual([`p1-0${no}`]);
    const begun = await stored(b);
    await b.evaluate(k => new Promise(granted => {
      navigator.locks.request(k, () => { granted(); return new Promise(free => { window.__free = free; }); });
    }), KEY);
    await dialog.accept();
    await clicked;
    await expect(card(a, no).locator(`input[value="${key}"]`)).toBeChecked();
    await b.evaluate(() => window.__free());
    return begun;
  }

  await pick(a, 1, a1);
  await expect(count(b)).toHaveText(`已作答 1 / ${TOTAL}`);
  const first = await stored(a);

  // the hand-in was confirmed for the first attempt: the second one stays open
  const second = await whileAsking(finish(a), 2, a2);
  expect(second.a).not.toBe(first.a);
  await expect(card(a, 2).locator(`input[value="${a2}"]`)).toBeChecked();
  await expect(count(a)).toHaveText(`已作答 1 / ${TOTAL}`);
  await expect(result(a)).toBeHidden();
  await expect(result(b)).toBeHidden();
  await expect(a.locator('[data-mock-paper] input:disabled')).toHaveCount(0);
  expect(await stored(a)).toMatchObject({ a: second.a, sel: { 'p1-02': a2 }, done: false });

  // the start-over was confirmed for the second attempt: the third one keeps its answer
  const third = await whileAsking(reset(a), 3, a3);
  expect(third.a).not.toBe(second.a);
  await expect(card(a, 3).locator(`input[value="${a3}"]`)).toBeChecked();
  await expect(count(a)).toHaveText(`已作答 1 / ${TOTAL}`);
  await expect(count(b)).toHaveText(`已作答 1 / ${TOTAL}`);
  expect(await stored(a)).toMatchObject({ a: third.a, sel: { 'p1-03': a3 }, done: false });

  // with no other window in the way, both still do what they say
  await handIn(a);
  await expect(result(a)).toBeVisible();
  await expect(result(b)).toBeVisible();
  expect(await stored(a)).toMatchObject({ a: third.a, done: true });
  const asked = nextDialog(a, true);
  await reset(a).click();
  await asked;
  await expect(count(b)).toHaveText(`已作答 0 / ${TOTAL}`);
  expect(await stored(a)).toBeNull();
});

test('with storage unavailable the paper still works on the page', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('denied', 'QuotaExceededError'); };
  });
  await signedOut(page);
  await page.goto('/exam/mock');
  const a1 = await answerOf(page, 1);
  await pick(page, 1, a1);
  await pick(page, 2, wrongKey(await answerOf(page, 2)));
  await expect(count(page)).toHaveText(`已作答 2 / ${TOTAL}`);
  await handIn(page);
  await expect(bar(page).locator('.ex-score')).toHaveText(`得分 1 / ${TOTAL}（未作答 ${TOTAL - 2} 題）`);
  await expect(card(page, 1)).toHaveAttribute('data-outcome', 'right');
  expect(await stored(page)).toBeNull();
  const asked = nextDialog(page, true);
  await reset(page).click();
  await asked;
  await expect(count(page)).toHaveText(`已作答 0 / ${TOTAL}`);
  await expect(result(page)).toBeHidden();
});

test('no sideways scroll on a phone, before and after the hand-in', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signedOut(page);
  await page.goto('/exam/mock');
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await pick(page, 1, 'A');
  await handIn(page);
  // every explanation open: the widest content the page can show
  await page.evaluate(() => document.querySelectorAll('.ex-mq-exp').forEach(d => { d.open = true; }));
  await expect(card(page, TOTAL).locator('.ex-mq-exp .ex-items')).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
});

test('the graded paper is readable in dark mode', async ({ page }) => {
  await signedOut(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/exam/mock');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const a1 = await answerOf(page, 1);
  const a2 = await answerOf(page, 2);
  await pick(page, 1, a1);
  await pick(page, 2, wrongKey(a2));
  await handIn(page);
  await expect(card(page, 2)).toHaveAttribute('data-outcome', 'wrong');
  await page.evaluate(() => document.querySelectorAll('.ex-mq-exp').forEach(d => { d.open = true; }));
  const AxeBuilder = require('@axe-core/playwright').default;
  const scan = await new AxeBuilder({ page }).include('main').withRules(['color-contrast']).analyze();
  expect(scan.violations.map(v => v.nodes.map(n => n.target.join(' ')).join(', '))).toEqual([]);
});

test('without scripts the questions and their explanations can still be read', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(baseURL + '/exam/mock');
    await expect(page.locator('[data-mock-paper] > .ex-mq')).toHaveCount(TOTAL);
    await expect(page.locator('.ex-mock-nojs')).toBeVisible();
    await expect(bar(page)).toBeHidden();
    await expect(page.locator('.ex-mock-how')).toBeHidden();
    const exp = card(page, 1).locator('.ex-mq-exp');
    await expect(exp.locator('summary')).toBeVisible();
    await expect(exp.locator('.ex-answer')).toBeHidden();
    await exp.locator('summary').click();
    await expect(exp.locator('.ex-answer')).toBeVisible();
    await expect(exp.locator('.ex-items li')).toHaveCount(4);
  } finally {
    await context.close();
  }
});
