const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
test.use({ serviceWorkers: 'block' });

// 2026-11-03, ported from the dermatology exam section: the /exam hub shows a
// 「繼續閱讀」 card from the reading positions saved on chapter pages (hs:exam:pos):
// the last chapter and section, when, this chapter's 重點 coverage (hs:exam:reading),
// a link that reopens the chapter at that place, and up to 3 other recent chapters.
// Without storage or a saved position the card stays hidden.

const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../exam/notes-data.json'), 'utf8'));
const NOW = new Date('2026-11-03T12:00:00+08:00').getTime();
const MIN = 60000;
const name = key => data.chapters[key].label + ' ' + data.chapters[key].title;

function seed(page, values) {
  return page.addInitScript(v => {
    if (sessionStorage.getItem('seeded')) return;
    Object.keys(v).forEach(k => localStorage.setItem(k, JSON.stringify(v[k])));
    sessionStorage.setItem('seeded', '1');
  }, values);
}
async function signedOut(page) {
  await page.route('**/api/exam/data**', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
}

test('the card shows the last chapter, section, time and coverage, and continues there', async ({ page }) => {
  await signedOut(page);
  await page.clock.setFixedTime(NOW);
  const noted = Object.keys(data.notes).filter(k => k !== '12-4');
  const [b, c, d, e] = noted;
  await seed(page, {
    'hs:exam:pos': {
      [c]: { id: 'np-1', t: NOW - 3 * 3600000 },
      '12-4': { id: 'ch4-s3', t: NOW - 5 * MIN, h: '三、Dry AMD 病理與治療' },
      [e]: { id: 'np-1', t: NOW - 40 * 86400000 },
      [b]: { id: 'np-1', t: NOW - 30 * MIN, h: 'x' },
      [d]: { id: 'np-1', t: NOW - 2 * 86400000 },
      '99-1': { id: 'np-1', t: NOW },         // not a chapter on the hub
      [noted[5]]: { id: 'np-1', t: 'soon' },  // malformed
    },
    'hs:exam:reading': { '12-4': { g: 'a', r: 1, seen: {}, pct: 42, t: 1, done: [1] } },
  });
  await page.goto('/exam');
  const card = page.locator('section.ex-continue');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { level: 2, name: '繼續閱讀' })).toHaveAttribute('id', 'ex-continue-h');
  await expect(page.getByRole('region', { name: '繼續閱讀' })).toBeVisible();
  await expect(card.locator('.ex-continue-main')).toHaveText(name('12-4') + ' 〈三、Dry AMD 病理與治療〉');
  await expect(card.locator('.ex-continue-sub')).toHaveText('5 分鐘前 · 本章重點已讀 42%');
  const go = card.getByRole('link', { name: '繼續 →' });
  await expect(go).toHaveAttribute('href', '/exam/bcsc12-4');

  // Up to 3 other chapters, newest first; the 4th older one is left out.
  const more = card.locator('.ex-continue-more a');
  await expect(more).toHaveCount(3);
  expect(await more.evaluateAll(as => as.map(a => a.getAttribute('href')))).toEqual([b, c, d].map(k => '/exam/bcsc' + k));
  for (const [i, key] of [b, c, d].entries()) {
    const text = await more.nth(i).textContent();
    const full = name(key);
    expect(text === full || (text.endsWith('…') && full.startsWith(text.slice(0, -1).trim()))).toBe(true);
  }
  await expect(card.locator('.ex-continue-more')).toContainText('最近也讀過：');
  // Placed right before the hub search box.
  expect(await page.evaluate(() => {
    const s = document.querySelector('[data-hub-search]');
    return document.querySelector('.ex-continue').nextElementSibling === s;
  })).toBe(true);

  // The link has no #: the chapter page reopens at the saved section itself.
  await go.click();
  await expect(page).toHaveURL(/\/exam\/bcsc12-4$/);
  await expect(page.locator('.ex-resume')).toBeVisible();
  await expect(page.locator('#ch4-s3')).toBeInViewport();
});

test('older positions show a date; a chapter without its section still shows', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  const key = Object.keys(data.notes).find(k => k !== '12-4');
  await seed(page, { 'hs:exam:pos': { [key]: { id: 'np-1', t: NOW - 40 * 86400000 } } });
  await page.goto('/exam');
  const card = page.locator('section.ex-continue');
  await expect(card.locator('.ex-continue-main')).toHaveText(name(key));
  await expect(card.locator('.ex-continue-sub')).toHaveText('2026-09-24 · 本章重點已讀 0%');
  await expect(card.locator('.ex-continue-more')).toHaveCount(0);
});

test('no card without a saved position, and none when storage is blocked', async ({ page, browser }) => {
  await page.goto('/exam');
  await expect(page.locator('.ex-chapter-list li[data-ch]').first()).toBeAttached();
  await expect(page.locator('section.ex-continue')).toBeHidden();
  await expect(page.locator('section.ex-continue')).toBeEmpty();

  await page.evaluate(() => localStorage.setItem('hs:exam:pos', JSON.stringify({ '12-4': { id: 'ch4-s3' } })));
  await page.reload();
  await expect(page.locator('section.ex-continue')).toBeHidden();

  const context = await browser.newContext({ serviceWorkers: 'block' });
  const blocked = await context.newPage();
  const errors = [];
  blocked.on('pageerror', err => errors.push(err.message));
  await blocked.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage disabled'); } });
  });
  await blocked.goto('/exam');
  await expect(blocked.locator('.ex-chapter-list li[data-ch]').first()).toBeAttached();
  await expect(blocked.locator('section.ex-continue')).toBeHidden();
  expect(errors).toEqual([]);
  await context.close();
});
