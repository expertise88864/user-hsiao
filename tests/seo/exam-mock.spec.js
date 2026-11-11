const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });

// Owner order 2026-11-10: a public mock exam of self-written questions, usable without
// logging in. Nothing here may read the question bank or write the bank's stores (stats,
// wrong list, stored answers, paper).
// Owner order 2026-11-11 (second): one page, /exam/mock, where the reader picks how many
// questions (10, 25, 50, 100 or all 200) and the order (random, or the bank's order), as
// on the past-paper page. The page is complete as served: all 200 cards are in a hidden
// pool; exam.js moves the cards drawn into the paper, times it, grades it and keeps it
// under its own storage key. An attempt saved under one of the four fixed papers this
// page replaced (hs:exam:mock:<paper id>) is carried over.
const KEY = 'hs:exam:mock-paper';
const OLD = 'hs:exam:mock:';
const BANK = 200;
const MOVED = '這份試卷已經在另一個分頁更換或清除，這個動作沒有執行。';
const stored = (page, key = KEY) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), key);
const signedOut = page => page.route('**/api/exam/data**', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
const form = page => page.locator('[data-mock-form]');
const sizeEl = page => form(page).locator('select[name="ex-count"]');
const orderEl = (page, order) => form(page).locator(`input[name="ex-order"][value="${order}"]`);
const buildBtn = page => form(page).locator('.ex-build');
const note = page => form(page).locator('.ex-build-note');
const pending = page => page.locator('[data-mock-list] > .ex-pending');
// The paper: the cards drawn, in paper order. The rest of the bank stays in the pool.
const cards = page => page.locator('[data-mock-list] > .ex-mq');
const pooled = page => page.locator('[data-mock-pool] > .ex-mq');
const card = (page, no) => cards(page).nth(no - 1);
const idsOf = page => cards(page).evaluateAll(list => list.map(c => c.getAttribute('data-mq')));
// The first n question ids of fixed paper `paper` (the bank is papers 1 to 4, in order).
const fixed = (paper, n) => Array.from({ length: n }, (_, i) => `p${paper}-${String(i + 1).padStart(2, '0')}`);
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
// Choose the size (0: the whole bank) and the order, then draw a paper and wait for it.
// `confirm`: the paper on the page has answers or a score, so the page asks first; the
// question it asked is returned.
async function build(page, size, order, confirm = false) {
  const before = ((await stored(page)) || {}).a || '';
  await sizeEl(page).selectOption(String(size));
  await orderEl(page, order).check();
  const asked = confirm ? nextDialog(page, true) : null;
  await buildBtn(page).click();
  const message = asked ? await asked : null;
  await expect.poll(async () => ((await stored(page)) || {}).a || '').not.toBe(before);
  await expect(cards(page)).toHaveCount(size || BANK);
  await expect(note(page)).toHaveText(`共 ${size || BANK} 題，計時開始。`);
  return message;
}

test('signed out: draw a paper, answer, time, hand in, read the explanations, resume and draw again', async ({ page }) => {
  const api = [];
  page.on('request', r => { if (r.url().includes('/api/exam/')) api.push(r.url()); });
  await freeze(page);
  await signedOut(page);
  await page.goto('/exam/mock');
  // nothing is asked, timed or stored until a paper is drawn
  await expect(page.locator('h1')).toHaveText('自選題數／隨機出題');
  await expect(sizeEl(page)).toHaveValue('50');
  await expect(orderEl(page, 'random')).toBeChecked();
  await expect(buildBtn(page)).toBeVisible();
  await expect(pending(page)).toBeVisible();
  await expect(bar(page)).toBeHidden();
  await expect(result(page)).toBeHidden();
  await expect(cards(page)).toHaveCount(0);
  await expect(pooled(page)).toHaveCount(BANK);
  await expect(page.locator('.ex-mock-pool')).toBeHidden();
  await expect(page.locator('.ex-mock-nojs')).toBeHidden();
  await expect(page.locator('.ex-auth')).toHaveCount(0);
  await page.clock.runFor(5000);
  expect(await stored(page)).toBeNull();

  // 依序: the first 50 questions of the bank, numbered by their place in the paper
  await build(page, 50, 'number');
  const TOTAL = 50;
  expect(await idsOf(page)).toEqual(fixed(1, TOTAL));
  await expect(pooled(page)).toHaveCount(BANK - TOTAL);
  await expect(pending(page)).toBeHidden();
  await expect(bar(page)).toBeVisible();
  await expect(count(page)).toHaveText(`已作答 0 / ${TOTAL}`);
  await expect(finish(page)).toBeDisabled();
  await expect(reset(page)).toHaveText('放棄這份試卷');
  await expect(result(page)).toBeHidden();
  await expect(card(page, 1).locator('.ex-q-no')).toHaveText('第 1 題');
  await expect(card(page, TOTAL).locator('.ex-q-no')).toHaveText(`第 ${TOTAL} 題`);
  await expect(card(page, 1).locator('.ex-mq-exp')).toBeHidden();
  await expect(card(page, 1).locator('input').first()).toBeFocused();
  // the first question is not left under the sticky bar
  const top = await card(page, 1).evaluate(el => el.getBoundingClientRect().top);
  const barBottom = await bar(page).evaluate(el => el.getBoundingClientRect().bottom);
  expect(top).toBeGreaterThanOrEqual(barBottom);
  const drawn = await stored(page);
  expect(drawn).toMatchObject({ ids: fixed(1, TOTAL), set: { c: 50, o: 'number' }, sel: {}, el: 0, done: false });
  expect(drawn.a).toMatch(/^[a-z0-9]{8,}$/);
  // the timer runs from the moment the paper is drawn
  await expect(timer(page)).toHaveText('00:00');
  await page.clock.runFor(5000);
  await expect(timer(page)).toHaveText('00:05');

  const a1 = await answerOf(page, 1);
  const a2 = await answerOf(page, 2);
  const a3 = await answerOf(page, 3);
  await pick(page, 1, wrongKey(a1));
  await expect(count(page)).toHaveText(`已作答 1 / ${TOTAL}`);
  await expect(finish(page)).toBeEnabled();
  await page.clock.runFor(60000);
  await expect(timer(page)).toHaveText('01:05');
  // an answer can be changed until the paper is handed in; nothing is revealed meanwhile
  await pick(page, 1, a1);
  await pick(page, 2, wrongKey(a2));
  await expect(count(page)).toHaveText(`已作答 2 / ${TOTAL}`);
  await expect(card(page, 1).locator('.ex-mq-exp')).toBeHidden();
  await expect(card(page, 1).locator('.ex-mq-result')).toHaveText('');
  await expect(card(page, 1).locator('.ex-right, .ex-wrong')).toHaveCount(0);
  // a save waits for the cross-tab lock, so storage follows the page a moment later
  await expect.poll(() => stored(page)).toMatchObject({ a: drawn.a, sel: { 'p1-01': a1, 'p1-02': wrongKey(a2) }, el: 65000, done: false });

  // a later visit continues the paper; time off the screen is not counted
  await page.reload();
  await expect(cards(page)).toHaveCount(TOTAL);
  expect(await idsOf(page)).toEqual(fixed(1, TOTAL));
  await expect(sizeEl(page)).toHaveValue('50');
  await expect(orderEl(page, 'number')).toBeChecked();
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
  await expect(result(page).locator('.ex-mock-missed a').first()).toHaveText('第 2 題');
  await expect(result(page).locator('.ex-mock-missed a').first()).toHaveAttribute('href', '#mq-p1-02');
  await expect(finish(page)).toBeHidden();
  await expect(reset(page)).toHaveText('再出一份試卷');
  await expect(page.locator('[data-mock-list] input:not(:disabled)')).toHaveCount(0);
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
  // the link to a question missed leads to its card
  await result(page).locator('.ex-mock-missed a').first().click();
  await expect(card(page, 2)).toBeInViewport();
  // the clock stops at the hand-in
  await page.clock.runFor(30000);
  await expect(timer(page)).toHaveText('01:10');

  // the graded paper is kept
  await page.reload();
  await expect(bar(page).locator('.ex-score')).toHaveText(`得分 1 / ${TOTAL}（未作答 ${TOTAL - 2} 題）`);
  await expect(card(page, 2)).toHaveAttribute('data-outcome', 'wrong');
  await expect(result(page)).toBeVisible();

  // 再出一份試卷: the paper and its score are cleared and the form is ready again
  asked = nextDialog(page, true);
  await reset(page).click();
  expect(await asked).toBe('確定要清除這份試卷的作答與成績，再出一份嗎？');
  await expect(bar(page)).toBeHidden();
  await expect(result(page)).toBeHidden();
  await expect(cards(page)).toHaveCount(0);
  await expect(pooled(page)).toHaveCount(BANK);
  await expect(pending(page)).toBeVisible();
  await expect(note(page)).toHaveText('已清除上一份試卷，選好題數與順序後可以再出一份。');
  await expect(buildBtn(page)).toBeFocused();
  await expect(buildBtn(page)).toBeInViewport();
  expect(await stored(page)).toBeNull();
  // the bank is back in its own order, whatever order the paper had
  expect((await pooled(page).evaluateAll(list => list.map(c => c.getAttribute('data-mq')))).slice(0, 3)).toEqual(fixed(1, 3));

  // the same questions drawn again start clean
  await build(page, 10, 'number');
  await expect(timer(page)).toHaveText('00:00');
  await expect(count(page)).toHaveText('已作答 0 / 10');
  await expect(page.locator('[data-mock-list] input:checked')).toHaveCount(0);
  await expect(page.locator('[data-mock-list] input:disabled')).toHaveCount(0);
  await expect(page.locator('[data-mock-list] .ex-done, [data-mock-list] [data-outcome], [data-mock-list] .ex-right, [data-mock-list] .ex-wrong')).toHaveCount(0);
  await expect(card(page, 2).locator('.ex-mq-exp')).toBeHidden();
  await expect(card(page, 2).locator('.ex-mq-result')).toHaveText('');
  await expect(finish(page)).toBeVisible();
  await expect(finish(page)).toBeDisabled();
  // the page never asked the bank for anything
  expect(api).toEqual([]);
});

test('a paper of the size asked for is drawn from the whole bank, at random or in order', async ({ page }) => {
  await signedOut(page);
  await page.goto('/exam/mock');
  const bank = await pooled(page).evaluateAll(list => list.map(c => c.getAttribute('data-mq')));
  expect(bank).toEqual([1, 2, 3, 4].flatMap(paper => fixed(paper, 50)));
  // the sizes offered
  expect(await sizeEl(page).locator('option').evaluateAll(list => list.map(o => [o.value, o.textContent])))
    .toEqual([['10', '10 題'], ['25', '25 題'], ['50', '50 題'], ['100', '100 題'], ['0', `全部（${BANK} 題）`]]);

  // drawing over a paper with nothing answered asks nothing
  for (const size of [10, 25, 100, 0]) {
    const n = size || BANK;
    await build(page, size, 'random');
    const ids = await idsOf(page);
    expect(new Set(ids).size).toBe(n);
    expect(ids.every(id => bank.includes(id))).toBe(true);
    await expect(pooled(page)).toHaveCount(BANK - n);
    await expect(count(page)).toHaveText(`已作答 0 / ${n}`);
    await expect(card(page, 1).locator('.ex-q-no')).toHaveText('第 1 題');
    await expect(card(page, n).locator('.ex-q-no')).toHaveText(`第 ${n} 題`);
    await expect(card(page, n).locator('legend')).toHaveText(`第 ${n} 題的選項`);
    expect(await stored(page)).toMatchObject({ ids, set: { c: size, o: 'random' }, sel: {}, done: false });
    if (n >= 100) {
      // not the bank's order, and not one fixed paper (the chance of either is nil)
      expect(ids).not.toEqual(bank.slice(0, n));
      expect(new Set(ids.map(id => id.slice(0, 2))).size).toBe(4);
    }
  }
  // every radio group of the paper is its own: picking in one card leaves the others
  await pick(page, 1, 'A');
  await pick(page, 2, 'B');
  await expect(card(page, 1).locator('input[value="A"]')).toBeChecked();
  await expect(count(page)).toHaveText(`已作答 2 / ${BANK}`);

  // 依序: the bank's own order from question 1
  expect(await build(page, 100, 'number', true)).toBe('確定要放棄這份未交卷的試卷，另出一份嗎？已作答的內容會清除。');
  expect(await idsOf(page)).toEqual(bank.slice(0, 100));
  await build(page, 0, 'number');
  expect(await idsOf(page)).toEqual(bank);
  await expect(pooled(page)).toHaveCount(0);
  expect(await stored(page)).toMatchObject({ ids: bank, set: { c: 0, o: 'number' } });
  // a later visit shows the paper and what it was drawn with
  await page.reload();
  await expect(cards(page)).toHaveCount(BANK);
  await expect(sizeEl(page)).toHaveValue('0');
  await expect(orderEl(page, 'number')).toBeChecked();
  await expect(card(page, BANK).locator('.ex-q-no')).toHaveText(`第 ${BANK} 題`);
});

test('drawing another paper or giving one up asks first when answers or a score would be lost', async ({ page }) => {
  await freeze(page);
  await signedOut(page);
  await page.goto('/exam/mock');
  // nothing answered: given up without a question (an unanswered dialog would be dismissed)
  await build(page, 10, 'number');
  await reset(page).click();
  await expect(bar(page)).toBeHidden();
  await expect(note(page)).toHaveText('已放棄這份試卷。');
  await expect(buildBtn(page)).toBeFocused();
  expect(await stored(page)).toBeNull();

  await build(page, 10, 'number');
  const first = await stored(page);
  const a1 = await answerOf(page, 1);
  await pick(page, 1, wrongKey(a1));
  await page.clock.runFor(7000);
  await expect(timer(page)).toHaveText('00:07');
  // declined: the paper stays as it is
  let asked = nextDialog(page, false);
  await buildBtn(page).click();
  expect(await asked).toBe('確定要放棄這份未交卷的試卷，另出一份嗎？已作答的內容會清除。');
  asked = nextDialog(page, false);
  await reset(page).click();
  expect(await asked).toBe('確定要放棄這份未交卷的試卷嗎？已作答的內容會清除。');
  await expect(count(page)).toHaveText('已作答 1 / 10');
  expect(await stored(page)).toMatchObject({ a: first.a, ids: fixed(1, 10), sel: { 'p1-01': wrongKey(a1) }, done: false });

  // accepted: a new paper, with its own clock and no answers
  await sizeEl(page).selectOption('25');
  expect(await build(page, 25, 'number', true)).toBe('確定要放棄這份未交卷的試卷，另出一份嗎？已作答的內容會清除。');
  const second = await stored(page);
  expect(second.a).not.toBe(first.a);
  expect(second).toMatchObject({ ids: fixed(1, 25), sel: {}, el: 0, done: false });
  await expect(timer(page)).toHaveText('00:00');
  await expect(count(page)).toHaveText('已作答 0 / 25');
  await expect(page.locator('[data-mock-list] input:checked')).toHaveCount(0);

  // a graded paper: both buttons say that the score goes too
  await pick(page, 1, wrongKey(a1));
  await handIn(page);
  await expect(card(page, 1).locator('.ex-mq-exp .ex-items')).toBeVisible();
  asked = nextDialog(page, false);
  await reset(page).click();
  expect(await asked).toBe('確定要清除這份試卷的作答與成績，再出一份嗎？');
  await expect(result(page)).toBeVisible();
  expect(await build(page, 10, 'number', true)).toBe('確定要清除這份試卷的作答與成績，另出一份嗎？');
  // the card graded a moment ago is an open question again
  await expect(result(page)).toBeHidden();
  await expect(card(page, 1)).not.toHaveAttribute('data-outcome', /.*/);
  await expect(card(page, 1).locator('.ex-mq-exp')).toBeHidden();
  await expect(card(page, 1).locator('.ex-mq-result')).toHaveText('');
  await expect(card(page, 1).locator('.ex-right, .ex-wrong, .ex-picked')).toHaveCount(0);
  await expect(page.locator('[data-mock-list] input:checked, [data-mock-list] input:disabled')).toHaveCount(0);
  await expect(reset(page)).toHaveText('放棄這份試卷');

  // given up with an answer on it: asked, then cleared
  await pick(page, 2, 'A');
  asked = nextDialog(page, true);
  await reset(page).click();
  expect(await asked).toBe('確定要放棄這份未交卷的試卷嗎？已作答的內容會清除。');
  await expect(bar(page)).toBeHidden();
  await expect(cards(page)).toHaveCount(0);
  await expect(note(page)).toHaveText('已放棄這份試卷。');
  expect(await stored(page)).toBeNull();
});

test('a paper answered correctly gets full marks, opens no explanation and lists only its own books', async ({ page }) => {
  const N = 10;
  await signedOut(page);
  await page.goto('/exam/mock');
  await build(page, N, 'random');
  for (let no = 1; no <= N; no += 1) await pick(page, no, await answerOf(page, no));
  await expect(count(page)).toHaveText(`已作答 ${N} / ${N}`);
  expect(await handIn(page)).toBe('確定要交卷嗎？交卷後不能再修改答案。');
  await expect(bar(page).locator('.ex-score')).toHaveText(`得分 ${N} / ${N}`);
  await expect(result(page).locator('.ex-mock-total')).toContainText(`答對 ${N} / ${N} 題（100%）；作答時間`);
  await expect(result(page).locator('.ex-mock-missed')).toHaveText('全部答對。');
  await expect(cards(page).and(page.locator('[data-outcome="right"]'))).toHaveCount(N);
  await expect(page.locator('.ex-mq-exp[open]')).toHaveCount(0);
  // the table counts the questions of this paper, book by book
  const perBook = {};
  for (const book of await cards(page).evaluateAll(list => list.map(c => c.getAttribute('data-book')))) perBook[book] = (perBook[book] || 0) + 1;
  const rows = await result(page).locator('tbody tr').evaluateAll(list => list.map(tr => ({
    book: tr.getAttribute('data-book'), hidden: tr.hidden, shown: getComputedStyle(tr).display !== 'none',
    cells: [...tr.querySelectorAll('td')].map(td => td.textContent),
  })));
  expect(rows).toHaveLength(13);
  for (const row of rows) {
    const n = perBook[row.book] || 0;
    expect(row.cells).toEqual([String(n), String(n)]);
    expect(row.hidden).toBe(n === 0);
    expect(row.shown).toBe(n > 0);
  }
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
    // hand-edited or foreign state: a question that is not in the bank, a repeated one, a
    // non-string id, an unusable draw setting, an unknown option, a pick for a question
    // that is not on the paper, a non-numeric time and a truthy-but-not-true hand-in flag
    localStorage.setItem(key, JSON.stringify({
      a: 'seed1', ids: ['p1-03', 'zz-99', 'p1-03', 'p2-07', 5], set: { c: 'x', o: 'random' },
      sel: { 'p1-03': 'E', 'p2-07': 'C', 'p1-01': 'A', 'zz-99': 'A' }, el: 'x', done: 'yes',
    }));
    sessionStorage.setItem('seeded', '1');
  }, [bank, KEY]);
  await freeze(page);
  await signedOut(page);
  await page.goto('/exam/mock');
  await expect(cards(page)).toHaveCount(2);
  expect(await idsOf(page)).toEqual(['p1-03', 'p2-07']);
  await expect(card(page, 2).locator('.ex-q-no')).toHaveText('第 2 題');
  await expect(count(page)).toHaveText('已作答 1 / 2');
  await expect(card(page, 2).locator('input[value="C"]')).toBeChecked();
  await expect(timer(page)).toHaveText('00:00');
  await expect(result(page)).toBeHidden();
  // the form keeps what the page was served with
  await expect(sizeEl(page)).toHaveValue('50');
  await expect(orderEl(page, 'random')).toBeChecked();
  const before = await page.evaluate(keys => keys.map(k => localStorage.getItem(k)), bank.map(([k]) => k));
  expect(before).toEqual(bank.map(([, v]) => JSON.stringify(v)));
  const a1 = await answerOf(page, 1);
  await pick(page, 1, a1);
  await handIn(page);
  await expect(result(page)).toBeVisible();
  const kept = await stored(page);
  expect(kept).toMatchObject({ a: 'seed1', ids: ['p1-03', 'p2-07'], set: null, done: true });
  expect(kept.sel).toEqual({ 'p1-03': a1, 'p2-07': 'C' });
  const after = await page.evaluate(keys => keys.map(k => localStorage.getItem(k)), bank.map(([k]) => k));
  expect(after).toEqual(before);
  expect(await page.evaluate(() => localStorage.getItem('hs:exam:paper'))).toBeNull();

  // not a paper at all: not an object, no attempt id, no question of the bank
  for (const junk of ['"oops"', '{"ids":["p1-01"],"sel":{"p1-01":"A"}}', '{"a":"x1","ids":["zz-1"]}', '{"a":"x1","ids":"p1-01"}']) {
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, junk]);
    await page.reload();
    await expect(buildBtn(page)).toBeVisible();
    await expect(pending(page)).toBeVisible();
    await expect(bar(page)).toBeHidden();
    await expect(result(page)).toBeHidden();
    await expect(cards(page)).toHaveCount(0);
    await expect(pooled(page)).toHaveCount(BANK);
  }
  // and a paper can be drawn over it
  await build(page, 10, 'number');
  expect(await stored(page)).toMatchObject({ ids: fixed(1, 10), sel: {}, done: false });
});

// Review finding on PR #100: with the paper open in two windows, a save from the window that
// had not heard of the other's hand-in yet wrote its whole old snapshot back (done: false).
test('two windows on one paper: the paper and its answers reach both, a hand-in is final, clearing reaches both', async ({ context }) => {
  const N = 10;
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
    await expect(buildBtn(page)).toBeVisible();
  }
  // a paper drawn in one window is the paper of the other, with what it was drawn with
  await build(a, N, 'random');
  const ids = await idsOf(a);
  await expect(cards(b)).toHaveCount(N);
  expect(await idsOf(b)).toEqual(ids);
  await expect(bar(b)).toBeVisible();
  await expect(count(b)).toHaveText(`已作答 0 / ${N}`);
  await expect(sizeEl(b)).toHaveValue(String(N));
  await expect(orderEl(b, 'random')).toBeChecked();
  const a1 = await answerOf(a, 1);
  const a2 = await answerOf(a, 2);
  const a3 = await answerOf(a, 3);

  // answers picked in either window reach the other one
  await pick(a, 1, a1);
  await expect(count(b)).toHaveText(`已作答 1 / ${N}`);
  await pick(b, 2, wrongKey(a2));
  await expect(count(a)).toHaveText(`已作答 2 / ${N}`);
  await expect(card(a, 2).locator(`input[value="${wrongKey(a2)}"]`)).toBeChecked();
  const picks = { [ids[0]]: a1, [ids[1]]: wrongKey(a2) };

  // A hands in; B has not heard of it when it saves on leaving the screen
  await deaf(b, true);
  await handIn(a);
  await expect(result(a)).toBeVisible();
  await expect(finish(b)).toBeVisible();
  await setHidden(b, true);
  expect(await stored(a)).toMatchObject({ ids, sel: picks, done: true });
  await setHidden(b, false);
  await expect(result(b)).toBeVisible();
  await expect(bar(b).locator('.ex-score')).toHaveText(`得分 1 / ${N}（未作答 ${N - 2} 題）`);
  await deaf(b, false);

  // a snapshot from before the hand-in that lands in storage afterwards does not undo it
  const graded = await stored(a);
  await b.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [KEY, { ...graded, sel: { [ids[0]]: a1 }, done: false }]);
  await expect.poll(() => stored(a)).toMatchObject({ a: graded.a, sel: picks, done: true });
  await expect(result(a)).toBeVisible();
  await expect(card(a, 2)).toHaveAttribute('data-outcome', 'wrong');

  // clearing the paper in A clears it in B too
  const asked = nextDialog(a, true);
  await reset(a).click();
  await asked;
  await expect(bar(a)).toBeHidden();
  await expect(bar(b)).toBeHidden();
  await expect(result(b)).toBeHidden();
  await expect(cards(b)).toHaveCount(0);
  await expect(pending(b)).toBeVisible();
  expect(await stored(a)).toBeNull();

  // second paper: A hands in, and B, not told yet, picks one more answer
  await build(a, N, 'number');
  await expect(cards(b)).toHaveCount(N);
  expect(await idsOf(b)).toEqual(fixed(1, N));
  await expect(b.locator('[data-mock-list] input:disabled, [data-mock-list] input:checked')).toHaveCount(0);
  const c1 = await answerOf(a, 1);
  await pick(a, 1, c1);
  await expect(count(b)).toHaveText(`已作答 1 / ${N}`);
  await deaf(b, true);
  await handIn(a);
  await expect(result(a)).toBeVisible();
  await expect(finish(b)).toBeVisible();
  await pick(b, 3, await answerOf(b, 3));
  await expect(result(b)).toBeVisible();
  await expect(card(b, 3)).toHaveAttribute('data-outcome', 'blank');
  await expect(bar(b).locator('.ex-score')).toHaveText(`得分 1 / ${N}（未作答 ${N - 1} 題）`);
  const second = await stored(a);
  expect(second).toMatchObject({ sel: { 'p1-01': c1 }, done: true });
  expect(Object.keys(second.sel)).toHaveLength(1);
  expect(second.a).not.toBe(graded.a);
  await expect(result(a)).toBeVisible();
  expect(a3).toMatch(/^[A-D]$/);
});

test('a hand-in, a give-up or a new draw confirmed for one paper leaves the next paper alone', async ({ context }) => {
  const N = 10;
  const a = await context.newPage();
  const b = await context.newPage();
  for (const page of [a, b]) {
    await signedOut(page);
    await page.goto('/exam/mock');
    await expect(buildBtn(page)).toBeVisible();
  }
  await build(a, N, 'number');
  await expect(cards(b)).toHaveCount(N);
  const keys = [];
  for (let no = 1; no <= 4; no += 1) keys.push(await answerOf(a, no));
  // Press `button` in A and, while A waits at its confirmation, give the paper up in B,
  // draw another there and answer its question `no`; then accept A's confirmation. B
  // holds the save lock until A has shown B's answer, so A hears of the new paper before
  // its own save runs (the order a browser may choose by itself).
  async function whileAsking(button, no) {
    const key = keys[no - 1];
    const opened = a.waitForEvent('dialog');
    const clicked = button.click();
    const dialog = await opened;
    const asked = nextDialog(b, true);
    await reset(b).click();
    await asked;
    await expect(bar(b)).toBeHidden();
    await build(b, N, 'number');
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
    // A says that what it was asked to do was not done
    await expect(note(a)).toHaveText(MOVED);
    return begun;
  }

  await pick(a, 1, keys[0]);
  await expect(count(b)).toHaveText(`已作答 1 / ${N}`);
  const first = await stored(a);

  // the hand-in was confirmed for the first paper: the second one stays open
  const second = await whileAsking(finish(a), 2);
  expect(second.a).not.toBe(first.a);
  await expect(count(a)).toHaveText(`已作答 1 / ${N}`);
  await expect(result(a)).toBeHidden();
  await expect(result(b)).toBeHidden();
  await expect(a.locator('[data-mock-list] input:disabled')).toHaveCount(0);
  expect(await stored(a)).toMatchObject({ a: second.a, sel: { 'p1-02': keys[1] }, done: false });

  // the give-up was confirmed for the second paper: the third one keeps its answer
  const third = await whileAsking(reset(a), 3);
  expect(third.a).not.toBe(second.a);
  await expect(bar(a)).toBeVisible();
  await expect(count(a)).toHaveText(`已作答 1 / ${N}`);
  await expect(count(b)).toHaveText(`已作答 1 / ${N}`);
  expect(await stored(a)).toMatchObject({ a: third.a, sel: { 'p1-03': keys[2] }, done: false });

  // the new draw (25 questions) was confirmed over the third paper: the fourth one stays
  await sizeEl(a).selectOption('25');
  const fourth = await whileAsking(buildBtn(a), 4);
  expect(fourth.a).not.toBe(third.a);
  await expect(cards(a)).toHaveCount(N);
  await expect(sizeEl(a)).toHaveValue(String(N));
  await expect(count(a)).toHaveText(`已作答 1 / ${N}`);
  expect(await stored(a)).toMatchObject({ a: fourth.a, ids: fixed(1, N), sel: { 'p1-04': keys[3] }, done: false });

  // with no other window in the way, each still does what it says
  await handIn(a);
  await expect(result(a)).toBeVisible();
  await expect(result(b)).toBeVisible();
  expect(await stored(a)).toMatchObject({ a: fourth.a, done: true });
  await build(a, 25, 'number', true);
  await expect(cards(b)).toHaveCount(25);
  await expect(result(b)).toBeHidden();
  await reset(a).click();
  await expect(bar(a)).toBeHidden();
  await expect(bar(b)).toBeHidden();
  expect(await stored(a)).toBeNull();
});

test('an attempt saved under one of the fixed papers continues as a paper of those questions', async ({ page }) => {
  await page.addInitScript(prefix => {
    if (sessionStorage.getItem('seeded')) return;
    const put = (paper, v) => localStorage.setItem(prefix + paper, JSON.stringify(v));
    put('pilot1', { a: 'old1', sel: { 'p1-01': 'A' }, el: 30000, done: false, t: 1000 });
    // the newest attempt with answers; a pick for another paper's question and an unknown option are dropped
    put('paper2', { a: 'old2', sel: { 'p2-03': 'B', 'p2-05': 'C', 'p1-01': 'D', 'p2-06': 'X' }, el: 125000, done: false, t: 2000 });
    // newer, but nothing answered: not an attempt to keep
    put('paper3', { a: 'old3', sel: {}, el: 5000, done: false, t: 3000 });
    sessionStorage.setItem('seeded', '1');
  }, OLD);
  await freeze(page);
  await signedOut(page);
  await page.goto('/exam/mock');
  await expect(cards(page)).toHaveCount(50);
  expect(await idsOf(page)).toEqual(fixed(2, 50));
  await expect(count(page)).toHaveText('已作答 2 / 50');
  await expect(card(page, 3).locator('input[value="B"]')).toBeChecked();
  await expect(card(page, 5).locator('input[value="C"]')).toBeChecked();
  await expect(card(page, 1).locator('.ex-q-no')).toHaveText('第 1 題');
  await expect(timer(page)).toHaveText('02:05');
  await expect(result(page)).toBeHidden();
  // it was not drawn with the form, which stays as served
  await expect(sizeEl(page)).toHaveValue('50');
  await expect(orderEl(page, 'random')).toBeChecked();
  const kept = await stored(page);
  expect(kept).toMatchObject({ ids: fixed(2, 50), set: null, el: 125000, done: false });
  expect(kept.sel).toEqual({ 'p2-03': 'B', 'p2-05': 'C' });
  expect(kept.a).toMatch(/^[a-z0-9]{8,}$/);
  for (const paper of ['pilot1', 'paper2', 'paper3', 'paper4']) expect(await stored(page, OLD + paper)).toBeNull();
  // and it goes on like any paper
  await page.clock.runFor(5000);
  await expect(timer(page)).toHaveText('02:10');
  let asked = nextDialog(page, true);
  await reset(page).click();
  await asked;
  await expect(bar(page)).toBeHidden();

  // a handed-in attempt comes over graded
  await page.evaluate(k => localStorage.setItem(k, JSON.stringify({ a: 'old4', sel: { 'p4-01': 'A', 'p4-02': 'B' }, el: 61000, done: true, t: 5 })), OLD + 'paper4');
  await page.reload();
  await expect(cards(page)).toHaveCount(50);
  expect(await idsOf(page)).toEqual(fixed(4, 50));
  await expect(result(page)).toBeVisible();
  await expect(result(page).locator('.ex-mock-total')).toContainText('未作答 48 題；作答時間 01:01');
  await expect(card(page, 1)).toHaveAttribute('data-outcome', /^(right|wrong)$/);
  await expect(card(page, 3)).toHaveAttribute('data-outcome', 'blank');
  await expect(page.locator('[data-mock-list] input:not(:disabled)')).toHaveCount(0);
  await expect(reset(page)).toHaveText('再出一份試卷');
  await expect.poll(() => stored(page, OLD + 'paper4')).toBeNull();
  const graded = await stored(page);

  // a paper already here stays; the old attempt is not kept beside it
  await page.evaluate(k => localStorage.setItem(k, JSON.stringify({ a: 'old5', sel: { 'p1-01': 'A' }, el: 1000, done: false, t: Date.now() })), OLD + 'pilot1');
  await page.reload();
  await expect(cards(page)).toHaveCount(50);
  await expect.poll(() => stored(page, OLD + 'pilot1')).toBeNull();
  expect(await idsOf(page)).toEqual(fixed(4, 50));
  expect(await stored(page)).toMatchObject({ a: graded.a, done: true });
});

test('with storage unavailable a paper still works on the page', async ({ page }) => {
  const N = 10;
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('denied', 'QuotaExceededError'); };
  });
  await signedOut(page);
  await page.goto('/exam/mock');
  await sizeEl(page).selectOption(String(N));
  await orderEl(page, 'number').check();
  await buildBtn(page).click();
  await expect(cards(page)).toHaveCount(N);
  await expect(note(page)).toHaveText(`共 ${N} 題，計時開始。`);
  const a1 = await answerOf(page, 1);
  await pick(page, 1, a1);
  await pick(page, 2, wrongKey(await answerOf(page, 2)));
  await expect(count(page)).toHaveText(`已作答 2 / ${N}`);
  await handIn(page);
  await expect(bar(page).locator('.ex-score')).toHaveText(`得分 1 / ${N}（未作答 ${N - 2} 題）`);
  await expect(card(page, 1)).toHaveAttribute('data-outcome', 'right');
  expect(await stored(page)).toBeNull();
  const asked = nextDialog(page, true);
  await reset(page).click();
  await asked;
  await expect(bar(page)).toBeHidden();
  await expect(result(page)).toBeHidden();
  await expect(cards(page)).toHaveCount(0);
  // and another can be drawn
  await sizeEl(page).selectOption('25');
  await buildBtn(page).click();
  await expect(cards(page)).toHaveCount(25);
  await expect(count(page)).toHaveText('已作答 0 / 25');
  await expect(page.locator('[data-mock-list] input:checked, [data-mock-list] input:disabled')).toHaveCount(0);
});

test('no sideways scroll on a phone: the form, the whole bank as a paper, and the graded paper', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signedOut(page);
  await page.goto('/exam/mock');
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await expect(buildBtn(page)).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  // On a phone the sticky bar wraps onto more lines. What the page scrolls to stops
  // below it: `gap` is the space between the bar and the element (negative: covered).
  const gap = target => target.evaluate(el => el.getBoundingClientRect().top
    - document.querySelector('[data-mock-bar]').getBoundingClientRect().bottom);
  await build(page, 0, 'number');
  expect(await overflow()).toBeLessThanOrEqual(0);
  expect(await gap(card(page, 1))).toBeGreaterThanOrEqual(0);
  expect(await gap(card(page, 1))).toBeLessThan(40);
  await pick(page, 1, await answerOf(page, 1));
  await handIn(page);
  // the hand-in waits its turn among the tabs; the bar now carries the score as well
  await expect(result(page)).toBeVisible();
  expect(await gap(result(page))).toBeGreaterThanOrEqual(0);
  await result(page).locator('.ex-mock-missed a').nth(1).click();
  await expect(card(page, 3)).toBeInViewport();
  expect(await gap(card(page, 3))).toBeGreaterThanOrEqual(0);
  // turned on its side the bar is one line again, and the margin follows it
  const margin = () => page.evaluate(() => parseFloat(document.documentElement.style.getPropertyValue('--ex-mock-top')));
  const tall = await margin();
  await page.setViewportSize({ width: 812, height: 375 });
  await expect.poll(margin).toBeLessThan(tall);
  await result(page).locator('.ex-mock-missed a').first().click();
  await expect.poll(() => gap(card(page, 2))).toBeGreaterThanOrEqual(0);
  expect(await gap(card(page, 2))).toBeLessThan(40);
  await page.setViewportSize({ width: 375, height: 812 });
  // every explanation open: the widest content the page can show
  await page.evaluate(() => document.querySelectorAll('.ex-mq-exp').forEach(d => { d.open = true; }));
  await expect(card(page, BANK).locator('.ex-mq-exp .ex-items')).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
});

test('the form and the graded paper are readable in dark mode', async ({ page }) => {
  await signedOut(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/exam/mock');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const AxeBuilder = require('@axe-core/playwright').default;
  const contrast = async () => {
    const scan = await new AxeBuilder({ page }).include('main').withRules(['color-contrast']).analyze();
    return scan.violations.map(v => v.nodes.map(n => n.target.join(' ')).join(', '));
  };
  await expect(buildBtn(page)).toBeVisible();
  expect(await contrast()).toEqual([]);
  await build(page, 10, 'number');
  const a1 = await answerOf(page, 1);
  const a2 = await answerOf(page, 2);
  await pick(page, 1, a1);
  await pick(page, 2, wrongKey(a2));
  await handIn(page);
  await expect(card(page, 2)).toHaveAttribute('data-outcome', 'wrong');
  await page.evaluate(() => document.querySelectorAll('[data-mock-list] .ex-mq-exp').forEach(d => { d.open = true; }));
  expect(await contrast()).toEqual([]);
});

test('without scripts the whole bank and its explanations can still be read', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(baseURL + '/exam/mock');
    // no paper can be drawn: the form, the bar and the empty paper are not shown
    await expect(page.locator('.ex-mock-nojs')).toBeVisible();
    await expect(form(page)).toBeHidden();
    await expect(bar(page)).toBeHidden();
    await expect(page.locator('.ex-mock-how')).toBeHidden();
    await expect(page.locator('[data-mock-list]')).toBeHidden();
    await expect(page.locator('.ex-mock-pool > h2')).toHaveText(`題庫的全部題目（${BANK} 題）`);
    await expect(pooled(page)).toHaveCount(BANK);
    await expect(pooled(page).first()).toBeVisible();
    await expect(pooled(page).last().locator('.ex-q-no')).toHaveText(`第 ${BANK} 題`);
    const exp = pooled(page).first().locator('.ex-mq-exp');
    await expect(exp.locator('summary')).toBeVisible();
    await expect(exp.locator('.ex-answer')).toBeHidden();
    await exp.locator('summary').click();
    await expect(exp.locator('.ex-answer')).toBeVisible();
    await expect(exp.locator('.ex-items li')).toHaveCount(4);
  } finally {
    await context.close();
  }
});
