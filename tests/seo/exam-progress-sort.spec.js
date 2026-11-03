const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
test.use({ serviceWorkers: 'block' });

// 2026-11-03, ported from the dermatology exam section: /exam/progress orders the
// chapters inside each book table by 章節順序 / 尚未作答優先 / 正確率低優先 /
// 閱讀進度低優先; the choice is remembered on this device. When the browser cannot
// store anything, the page says so and its controls are disabled.

const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../exam/notes-data.json'), 'utf8'));
// A question that belongs to this chapter only, so it moves no other row.
const only = key => data.qs.find(([, ch]) => ch.length === 1 && ch[0] === key)[0];
const RIGHT = only('12-4');
const WRONG = only('12-5');
const HALF = [only('12-7'), data.qs.filter(([, ch]) => ch.length === 1 && ch[0] === '12-7')[1][0]];

function seed(page, values) {
  return page.addInitScript(v => {
    if (sessionStorage.getItem('seeded')) return;
    Object.keys(v).forEach(k => localStorage.setItem(k, JSON.stringify(v[k])));
    sessionStorage.setItem('seeded', '1');
  }, values);
}
const book12 = page => page.locator('details[data-book="12"]');
const order = page => book12(page).locator('tbody tr td:first-child a')
  .evaluateAll(as => as.map(a => a.getAttribute('href').replace('/exam/bcsc', '')));

test.beforeEach(async ({ page }) => {
  await seed(page, {
    'hs:exam:stats': { [RIGHT]: [1, 1, 1], [WRONG]: [0, 1, 1], [HALF[0]]: [1, 1, 1], [HALF[1]]: [0, 1, 1] },
    'hs:exam:reading': {
      '12-4': { g: 'a', r: 1, seen: {}, pct: 10, t: 1, done: [1] },
      '12-5': { g: 'b', r: 0, seen: {}, pct: 50, t: 1, done: [] },
      '12-7': { g: 'c', r: 0, seen: {}, pct: 20, t: 1, done: [] },
    },
  });
});

test('the four orders sort the chapters inside each book table', async ({ page }) => {
  await page.goto('/exam/progress');
  const select = page.locator('select.ex-progress-sort');
  await expect(select).toBeEnabled();
  await expect(select).toHaveValue('order');
  await expect(page.locator('.ex-prog-store')).toBeHidden();
  await expect(book12(page).locator('tbody tr').first()).toBeAttached();
  const bcsc = await order(page);
  expect(bcsc.slice(0, 5)).toEqual(['12-1', '12-2', '12-3', '12-4', '12-5']);
  const rest = keys => bcsc.filter(k => !keys.includes(k));

  // 尚未作答優先: every chapter with no answer yet keeps BCSC order ahead of the answered ones.
  await select.selectOption('todo');
  await expect.poll(() => order(page)).toEqual([...rest(['12-4', '12-5', '12-7']), '12-4', '12-5', '12-7']);

  // 正確率低優先: 0% (12-5), 50% (12-7), 100% (12-4), then chapters without answers.
  await select.selectOption('low');
  await expect.poll(() => order(page)).toEqual(['12-5', '12-7', '12-4', ...rest(['12-4', '12-5', '12-7'])]);

  // 閱讀進度低優先: chapters with notes first, fewest rounds then lowest coverage.
  const noted = bcsc.filter(k => data.notes[k]);
  const unread = noted.filter(k => !['12-4', '12-5', '12-7'].includes(k));
  await select.selectOption('reading');
  await expect.poll(() => order(page)).toEqual([...unread, '12-7', '12-5', '12-4', ...bcsc.filter(k => !data.notes[k])]);

  await select.selectOption('order');
  await expect.poll(() => order(page)).toEqual(bcsc);
});

test('the chosen order is remembered on this device and survives a re-render', async ({ page }) => {
  await page.goto('/exam/progress');
  const select = page.locator('select.ex-progress-sort');
  await select.selectOption('low');
  await expect.poll(() => order(page).then(o => o[0])).toBe('12-5');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hs:exam:psort')))).toBe('low');
  // Ticking 課本已讀 re-renders the tables in the same order.
  await book12(page).locator('input[data-chapter="12-4"]').check();
  await expect(book12(page).locator('input[data-chapter="12-4"]')).toBeFocused();
  expect((await order(page)).slice(0, 3)).toEqual(['12-5', '12-7', '12-4']);

  await page.reload();
  await expect(select).toHaveValue('low');
  await expect.poll(() => order(page).then(o => o.slice(0, 3))).toEqual(['12-5', '12-7', '12-4']);
  // A hand-edited value falls back to BCSC order.
  await page.evaluate(() => localStorage.setItem('hs:exam:psort', JSON.stringify('nope')));
  await page.reload();
  await expect(select).toHaveValue('order');
  await expect.poll(() => order(page).then(o => o[0])).toBe('12-1');
});

test('storage blocked: the page says progress cannot be kept and disables its controls', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage disabled'); } });
  });
  await page.goto('/exam/progress');
  const note = page.locator('.ex-prog-store');
  await expect(note).toBeVisible();
  await expect(note).toHaveText('這個瀏覽器無法儲存資料（例如無痕模式或停用網站資料），讀書進度無法記錄。');
  await expect(page.locator('select.ex-progress-sort')).toBeDisabled();
  await expect(page.locator('.ex-clear-progress')).toBeDisabled();
  await page.locator('details[data-book="12"] summary').click();
  const boxes = page.locator('#ex-progress input[type=checkbox]');
  await expect(boxes.first()).toBeDisabled();
  expect(await boxes.evaluateAll(list => list.every(b => b.disabled))).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});
