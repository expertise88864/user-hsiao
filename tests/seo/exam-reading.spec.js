const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });

// Owner request 2026-11-02: reading rounds as on the dermatology exam section. A note
// section counts as read after it has been on screen long enough for its length; about
// 75% of a chapter's notes read is one finished round (✓N), and the next round starts
// from 0%. The /exam hub ticks chapters read at least once and the progress page shows
// the rounds and this round's coverage. Everything stays in this browser.

const KEY = 'hs:exam:reading';
const CHAPTER = '/exam/bcsc12-4';
const stored = page => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
const seed = (page, value) => page.addInitScript(([k, v]) => {
  if (!sessionStorage.getItem('seeded')) {
    localStorage.setItem(k, JSON.stringify(v));
    sessionStorage.setItem('seeded', '1');
  }
}, [KEY, value]);

async function signedOut(page) {
  await page.route('**/api/exam/data**', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
}
async function sections(page) {
  return page.$$eval('.ex-note h2[data-w]', hs => hs.map(h => ({ id: h.id, w: Number(h.dataset.w) })));
}
const need = w => Math.min(30000, Math.max(5000, 50 * w));
// Bring a section to the top of the window and let its intersection settle.
async function show(page, id) {
  await page.evaluate(i => document.getElementById(i).scrollIntoView({ block: 'start', behavior: 'instant' }), id);
  await page.waitForTimeout(250);
}

test('a section counts only after staying on screen long enough; coverage is shown', async ({ page }) => {
  await page.clock.install();
  await signedOut(page);
  await page.goto(CHAPTER);
  const status = page.locator('#ex-reading');
  await expect(status.locator('.ex-reading-text')).toHaveText('本章重點：第 1 輪，已讀 0%');
  const secs = await sections(page);
  const total = secs.reduce((a, s) => a + s.w, 0);
  const target = secs.reduce((a, s) => (s.w < a.w ? s : a));
  // A quick pass over the section is not reading it.
  await show(page, target.id);
  await page.clock.runFor(need(target.w) - 3000);
  await show(page, 'qs-h');
  await page.clock.runFor(10000);
  expect(await stored(page)).toBeNull();
  // Staying on it long enough is.
  await show(page, target.id);
  await page.clock.runFor(need(target.w) + 2000);
  const pct = Math.round(100 * target.w / total);
  await expect(status.locator('.ex-reading-text')).toHaveText(`本章重點：第 1 輪，已讀 ${pct}%`);
  const rec = (await stored(page))['12-4'];
  expect(rec).toEqual({ g: expect.stringMatching(/^[a-z0-9]+$/), r: 0, seen: { [target.id]: 1 }, pct, t: expect.any(Number), done: [] });
});

test('about 75% read finishes a round: ✓ count, toast, and the next round starts at 0%', async ({ page }) => {
  await page.clock.install();
  await signedOut(page);
  await page.goto(CHAPTER);
  const secs = await sections(page);
  const last = secs.reduce((a, s) => (s.w < a.w ? s : a));
  const seen = Object.fromEntries(secs.filter(s => s.id !== last.id).map(s => [s.id, 1]));
  await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [KEY, { '12-4': { g: 'abc', r: 1, seen, pct: 0, t: 1, done: [1] } }]);
  await page.reload();
  const text = page.locator('#ex-reading .ex-reading-text');
  await expect(text).toHaveText(/^本章重點：第 2 輪，已讀 \d+%（已讀完 1 次）$/);
  await show(page, last.id);
  await page.clock.runFor(need(last.w) + 2000);
  await expect(text).toHaveText('本章重點：第 3 輪，已讀 0%（已讀完 2 次）');
  const toast = page.locator('.ex-toast');
  await expect(toast).toHaveAttribute('role', 'status');
  await expect(toast.locator('.ex-resume-text')).toHaveText('本章重點第 2 輪讀完 ✓');
  const rec = (await stored(page))['12-4'];
  expect(rec).toMatchObject({ g: 'abc', r: 2, seen: {}, pct: 0 });
  expect(rec.done).toHaveLength(2);
  await page.clock.runFor(7000);
  await expect(toast).toHaveCount(0);
});

test('a hidden tab adds no reading time', async ({ page }) => {
  await page.clock.install();
  await signedOut(page);
  await page.goto(CHAPTER);
  const secs = await sections(page);
  const target = secs.reduce((a, s) => (s.w < a.w ? s : a));
  await show(page, target.id);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(need(target.w) + 5000);
  expect(await stored(page)).toBeNull();
});

test('重設本章閱讀紀錄 asks first and leaves other chapters and answers alone', async ({ page }) => {
  await signedOut(page);
  await seed(page, { '12-4': { g: 'abc', r: 3, seen: { 'ch4-s1': 1 }, pct: 10, t: 1, done: [1, 2, 3] },
    '8-6': { g: 'def', r: 1, seen: {}, pct: 0, t: 1, done: [1] } });
  await page.addInitScript(() => localStorage.setItem('hs:exam:stats', JSON.stringify({ 5: [1, 1, 1] })));
  await page.goto(CHAPTER);
  const text = page.locator('#ex-reading .ex-reading-text');
  await expect(text).toHaveText(/（已讀完 3 次）$/);
  page.once('dialog', d => { expect(d.message()).toBe('重設本章重點的閱讀次數與進度？作答紀錄與「課本已讀完」不受影響。'); d.dismiss(); });
  await page.locator('.ex-reading-reset').click();
  await expect(text).toHaveText(/（已讀完 3 次）$/);
  page.once('dialog', d => d.accept());
  await page.locator('.ex-reading-reset').click();
  await expect(text).toHaveText('本章重點：第 1 輪，已讀 0%');
  const all = await stored(page);
  expect(all['12-4']).toMatchObject({ r: 0, seen: {}, pct: 0, done: [] });
  expect(all['12-4'].g).not.toBe('abc');
  expect(all['8-6']).toEqual({ g: 'def', r: 1, seen: {}, pct: 0, t: 1, done: [1] });
  expect(await page.evaluate(() => localStorage.getItem('hs:exam:stats'))).toBe('{"5":[1,1,1]}');
});

test('a reset in another tab is not undone by reads pending in this one', async ({ context }) => {
  const a = await context.newPage();
  await signedOut(a);
  await a.clock.install();
  await a.goto(CHAPTER);
  const secs = await sections(a);
  const target = secs.reduce((x, s) => (s.w < x.w ? s : x));
  await a.evaluate(k => localStorage.setItem(k, JSON.stringify({ '12-4': { g: 'old', r: 2, seen: {}, pct: 0, t: 1, done: [1, 2] } })), KEY);
  await a.reload();
  // Another tab resets the chapter (new generation id).
  await a.evaluate(k => localStorage.setItem(k, JSON.stringify({ '12-4': { g: 'new', r: 0, seen: {}, pct: 0, t: 2, done: [] } })), KEY);
  await show(a, target.id);
  await a.clock.runFor(need(target.w) + 2000);
  // This tab adopts the reset record instead of writing its old round back.
  const rec = (await stored(a))['12-4'];
  expect(rec.g).toBe('new');
  expect(rec.r).toBe(0);
});

test('the hub ticks chapters whose notes were read, with the count', async ({ page }) => {
  await seed(page, { '12-4': { g: 'a', r: 2, seen: {}, pct: 30, t: 1, done: [1, 2] },
    '8-6': { g: 'b', r: 0, seen: { 'ch6-s1': 1 }, pct: 40, t: 1, done: [] },
    '6-2': { g: 'c', r: 'x', seen: {}, pct: 0, t: 1, done: [] } });
  await page.goto('/exam');
  for (const sel of ['.ex-chapter-list li[data-ch="12-4"]', 'table.ex-rank tr[data-ch="12-4"]']) {
    const badge = page.locator(sel + ' .ex-rd-badge');
    await expect(badge).toHaveCount(1);
    await expect(badge).toHaveText('✓2');
    await expect(badge).toHaveAttribute('role', 'img');
    await expect(badge).toHaveAttribute('aria-label', '重點讀完 2 次');
  }
  // Partly read, malformed or unread chapters get no tick.
  await expect(page.locator('[data-ch="8-6"] .ex-rd-badge, [data-ch="6-2"] .ex-rd-badge')).toHaveCount(0);
  await expect(page.locator('.ex-rd-badge')).toHaveCount(2);
  // Coming back to the hub (bfcache) does not duplicate the ticks.
  await page.goto(CHAPTER);
  await page.goBack();
  await expect(page.locator('.ex-rd-badge')).toHaveCount(2);
});

test('without JavaScript the hub shows no ticks', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto('/exam');
  await expect(page.locator('.ex-rd-badge')).toHaveCount(0);
  await expect(page.locator('.ex-chapter-list li[data-ch]').first()).toBeAttached();
  await context.close();
});

test('the progress page shows rounds and coverage per chapter', async ({ page }) => {
  await seed(page, { '12-4': { g: 'a', r: 2, seen: {}, pct: 30, t: 1, done: [1, 2] },
    '8-6': { g: 'b', r: 1, seen: {}, pct: 0, t: 1, done: [1] } });
  await page.goto('/exam/progress');
  const part = page.locator('details[data-book="12"]');
  await part.locator('summary').click();
  const heads = await part.locator('thead th').allTextContents();
  expect(heads).toEqual(['章節', '課本已讀', '重點閱讀', '已作答', '正確率', '最後讀']);
  const row = part.locator('tr', { has: page.locator('a[href="/exam/bcsc12-4"]') });
  const cell = row.locator('td.ex-rd');
  await expect(cell.locator('.ex-rd-badge')).toHaveText('✓2');
  await expect(cell.locator('.ex-rd-pct')).toHaveText('30%');
  await expect(cell.locator('.ex-rd-bar')).toHaveAttribute('aria-hidden', 'true');
  const unread = part.locator('tr', { has: page.locator('a[href="/exam/bcsc12-5"]') }).locator('td.ex-rd');
  await expect(unread).toHaveText('0%');
  const noNotes = part.locator('tr', { has: page.locator('a[href="/exam/bcsc12-1"]') }).locator('td.ex-rd');
  await expect(noNotes).toHaveText('—');
  await expect(noNotes).toHaveAttribute('title', '本章尚無重點整理');
  await expect(page.locator('.ex-summary-box p').first()).toContainText(/重點已讀完 2 \/ \d+ 章（其中 1 章 2 次以上）/);
});

test('phone: the progress table with a ✓ count stays inside the screen', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await seed(page, { '12-4': { g: 'a', r: 12, seen: {}, pct: 100, t: 1, done: [1] } });
  await page.goto('/exam/progress');
  await page.locator('details[data-book="12"] summary').click();
  await expect(page.locator('details[data-book="12"] .ex-rd-badge')).toHaveText('✓12');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await context.close();
});

test('reads wait for the cross-tab lock, so a reset made meanwhile wins (PR #80 review)', async ({ page }) => {
  await page.clock.install();
  await signedOut(page);
  await seed(page, { '12-4': { g: 'old', r: 2, seen: {}, pct: 0, t: 1, done: [1, 2] } });
  await page.goto(CHAPTER);
  const target = (await sections(page)).reduce((x, s) => (s.w < x.w ? s : x));
  // Another tab holds the reading lock.
  await page.evaluate(k => { navigator.locks.request(k, () => new Promise(res => { window.__release = res; })); }, KEY);
  await page.waitForFunction(() => typeof window.__release === 'function');
  await show(page, target.id);
  await page.clock.runFor(need(target.w) + 2000);
  // Nothing is written while the lock is held, not even on leaving the page (pagehide);
  // the other tab resets and releases it.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  expect((await stored(page))['12-4']).toEqual({ g: 'old', r: 2, seen: {}, pct: 0, t: 1, done: [1, 2] });
  await page.evaluate(k => {
    localStorage.setItem(k, JSON.stringify({ '12-4': { g: 'new', r: 0, seen: {}, pct: 0, t: 2, done: [] } }));
    window.__release();
  }, KEY);
  await expect(page.locator('#ex-reading .ex-reading-text')).toHaveText('本章重點：第 1 輪，已讀 0%');
  expect((await stored(page))['12-4']).toEqual({ g: 'new', r: 0, seen: {}, pct: 0, t: 2, done: [] });
});

test('a round finished in another tab does not take this tab\'s earlier reads (PR #80 review)', async ({ page }) => {
  await page.clock.install();
  await signedOut(page);
  await seed(page, { '12-4': { g: 'abc', r: 1, seen: {}, pct: 0, t: 1, done: [1] } });
  await page.goto(CHAPTER);
  const target = (await sections(page)).reduce((x, s) => (s.w < x.w ? s : x));
  await show(page, target.id);
  await page.clock.runFor(need(target.w) - 2000);
  // Another tab finishes round 2 (same generation) before this tab's section completes.
  await page.evaluate(k => localStorage.setItem(k, JSON.stringify({ '12-4': { g: 'abc', r: 2, seen: {}, pct: 0, t: 2, done: [1, 2] } })), KEY);
  await page.clock.runFor(4000);
  await expect(page.locator('#ex-reading .ex-reading-text')).toHaveText('本章重點：第 3 輪，已讀 0%（已讀完 2 次）');
  expect((await stored(page))['12-4']).toEqual({ g: 'abc', r: 2, seen: {}, pct: 0, t: 2, done: [1, 2] });
});
