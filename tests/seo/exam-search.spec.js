const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });

// Owner request 2026-11-03: port the dermatology exam section's search and layout details.
// 1. The hub disease search is a combobox: ↑/↓ choose a result, Enter opens the highlighted
//    (or top) hit, Esc closes the list and then clears the box; results grouped by chapter.
// 2. Ranked names: exact abbreviation > name > prefix > word; short Latin queries match whole
//    words only; a glossary built from the notes links abbreviations, full names and Chinese.
// 3. The site header search (Ctrl/Cmd+K) also lists exam chapters and their note headings.
// 4. Each wide note table scrolls in its own box (not the whole note).
// 5. A #hash link opens any closed <details> around its target.

async function signedOut(page) {
  await page.route('**/api/exam/data**', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
}

test('hub search is a combobox: arrows choose, Enter opens, Esc closes then clears', async ({ page }) => {
  await signedOut(page);
  await page.goto('/exam');
  const input = page.getByLabel('搜尋疾病（全名或縮寫）');
  await expect(input).toHaveAttribute('role', 'combobox');
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await input.fill('MEWDS');
  await expect(page.locator('.ex-find-status')).toContainText('「MEWDS」出現在');
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await expect(input).toHaveAttribute('aria-controls', 'ex-find-list');
  const listbox = page.getByRole('listbox', { name: '搜尋結果' });
  await expect(listbox).toBeVisible();
  // Grouped by chapter; the exact abbreviation in a section heading ranks its chapter first.
  // Which chapter that is depends on the notes (9-9 joined 12-11 on 2026-11-04), so read it.
  const first = listbox.getByRole('group').first();
  await expect(first.locator('.ex-find-h [role=option]')).toContainText(/^BCSC \d+ Ch\.\d+/);
  const firstKey = (await first.locator('.ex-find-h [role=option]').getAttribute('href')).match(/bcsc(\d+-\d+)/)[1];
  await expect(first.locator('.ex-find-names a').first()).toHaveAttribute('href', new RegExp('^/exam/bcsc' + firstKey + '\\?hl=MEWDS#ch\\d+-s\\d+$'));
  await expect(first.locator('.ex-find-names a').first()).toContainText('名稱符合：MEWDS');

  const options = listbox.getByRole('option');
  await input.press('ArrowDown');
  const id0 = await options.nth(0).getAttribute('id');
  await expect(input).toHaveAttribute('aria-activedescendant', id0);
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
  await input.press('ArrowDown');
  await expect(input).toHaveAttribute('aria-activedescendant', await options.nth(1).getAttribute('id'));
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'false');
  await input.press('ArrowUp');
  await expect(input).toHaveAttribute('aria-activedescendant', id0);
  // Up from the first option wraps to the last one.
  await input.press('ArrowUp');
  const last = options.last();
  await expect(input).toHaveAttribute('aria-activedescendant', await last.getAttribute('id'));
  await expect(input).toBeFocused();

  // Esc closes the list but keeps the text; ↓ reopens it; a second Esc clears.
  await input.press('Escape');
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await expect(listbox).toBeHidden();
  await expect(input).not.toHaveAttribute('aria-activedescendant', /./);
  await expect(input).toHaveValue('MEWDS');
  await input.press('ArrowDown');
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await expect(listbox).toBeVisible();
  await input.press('Escape');
  await input.press('Escape');
  await expect(input).toHaveValue('');
  await expect(page.locator('.ex-find-group')).toHaveCount(0);

  // The listbox holds only groups and options (axe ARIA rules on the open combobox).
  await input.fill('pvrl');
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await input.press('ArrowDown');
  const AxeBuilder = require('@axe-core/playwright').default;
  const axe = await new AxeBuilder({ page }).include('form[data-hub-search]').include('#ex-find-results')
    .withRules(['aria-required-children', 'aria-required-parent', 'aria-allowed-role', 'aria-valid-attr-value',
      'aria-required-attr', 'aria-allowed-attr', 'nested-interactive', 'color-contrast']).analyze();
  expect(axe.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(', '))).toEqual([]);
  await input.fill('');
  await expect(page.locator('.ex-find-group')).toHaveCount(0);

  // Enter after choosing a result opens that result.
  await input.fill('MEWDS');
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  const href = await options.nth(1).getAttribute('href');
  expect(href).toMatch(/^\/exam\/bcsc\d+-\d+\?hl=MEWDS#ch\d+-s\d+$/);
  await Promise.all([page.waitForURL('**' + href), input.press('Enter')]);
  await expect(page.locator('#' + href.split('#')[1])).toBeInViewport();
});

test('hub search: Enter opens the top hit; 「再顯示」 is reachable from the keyboard', async ({ page }) => {
  await signedOut(page);
  await page.goto('/exam');
  const input = page.getByLabel('搜尋疾病（全名或縮寫）');
  await input.fill('pvrl');
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  // 「再顯示 N 段」 is an option: choosing it with Enter shows the rest and keeps the choice there.
  const more = page.getByRole('option', { name: /^再顯示 \d+ 段$/ }).first();
  const group = page.locator('.ex-find-group').filter({ has: more });
  const shown = await group.locator('.ex-find-list li:visible').count();
  const moreId = await more.getAttribute('id');
  for (let i = 0; i < 80; i++) {
    await input.press('ArrowDown');
    if (await input.getAttribute('aria-activedescendant') === moreId) break;
  }
  await expect(input).toHaveAttribute('aria-activedescendant', moreId);
  await input.press('Enter');
  await expect(group.locator('.ex-find-list li:visible')).not.toHaveCount(shown);
  const active = page.locator('#' + await input.getAttribute('aria-activedescendant'));
  await expect(active).toHaveAttribute('href', /^\/exam\/bcsc[\d-]+\?hl=pvrl#np-\d+$/);
  // Typing again searches anew; Enter without choosing opens the top hit.
  await input.fill('MEWDS');
  await expect(page.locator('.ex-find-status')).toContainText('「MEWDS」出現在');
  const top = await page.locator('#ex-find-list [role=option]').first().getAttribute('href');
  expect(top).toMatch(/^\/exam\/bcsc\d+-\d+\?hl=MEWDS#(np-\d+|ch\d+-s\d+)$/);
  await Promise.all([page.waitForURL(url => url.pathname === top.split('?')[0]), input.press('Enter')]);
});

test('hub search: clicking 「再顯示」 keeps the keyboard working (PR #82 review)', async ({ page }) => {
  await signedOut(page);
  await page.goto('/exam');
  const input = page.getByLabel('搜尋疾病（全名或縮寫）');
  await input.fill('pvrl');
  const moreId = await page.getByRole('option', { name: /^再顯示 \d+ 段$/ }).first().getAttribute('id');
  const more = page.locator('#' + moreId);
  await more.click();
  // The button is gone; focus is back in the input with the first revealed paragraph chosen.
  await expect(more).toHaveCount(0);
  await expect(input).toBeFocused();
  const first = await input.getAttribute('aria-activedescendant');
  expect(first).toBeTruthy();
  await input.press('ArrowDown');
  await expect(input).not.toHaveAttribute('aria-activedescendant', first);
  const href = await page.locator('#' + await input.getAttribute('aria-activedescendant')).getAttribute('href');
  await Promise.all([page.waitForURL(url => href.startsWith(url.pathname)), input.press('Enter')]);
});

test('ranked names: whole-word abbreviations, glossary full names and Chinese names', async ({ page }) => {
  await signedOut(page);
  await page.goto('/exam');
  const input = page.getByLabel('搜尋疾病（全名或縮寫）');
  // The spelled-out name finds the section titled only with the abbreviation and its Chinese name.
  await input.fill('multiple evanescent white dot syndrome');
  await expect(page.locator('.ex-find-group').first().locator('.ex-find-names a').first())
    .toHaveAttribute('href', /#ch11-s4$/);
  // A short Latin query never matches inside a longer word: RP finds RP, not RPE or RP1L1.
  await input.fill('RP');
  await expect(page.locator('.ex-find-status')).toContainText('「RP」出現在');
  const why = await page.locator('.ex-find-why').allTextContents();
  expect(why.length).toBeGreaterThan(0);
  for (const text of why) {
    const names = text.replace(/^名稱符合：/, '').split('、');
    expect(names.every(n => /(^|[^A-Za-z0-9])RPs?([^A-Za-z0-9]|$)/i.test(n)), text).toBe(true);
  }
  // Chinese and English names meet through the glossary: 圓錐角膜 lists Keratoconus sections.
  await input.fill('圓錐角膜');
  await expect(page.locator('.ex-find-status')).toContainText('「圓錐角膜」出現在');
  const secs = await page.locator('.ex-find-names .ex-find-sec').allTextContents();
  expect(secs.some(s => /Keratoconus/.test(s))).toBe(true);
});

test('header search (Ctrl+K) lists exam chapters and note headings after the articles', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  const input = page.locator('#hs-cmdk-input');
  await expect(input).toBeFocused();
  await input.fill('MEWDS');
  const results = page.locator('#hs-cmdk-results');
  await expect(results.locator('.hs-cmdk-group')).toHaveText('專科考試筆記');
  await expect(results.locator('a.row[href="/exam/bcsc12-11"]')).toBeVisible();
  const sub = results.locator('a.row.sub[href="/exam/bcsc12-11#ch11-s4"]');
  await expect(sub).toContainText('MEWDS');
  // The exam rows join the keyboard list: ↓ reaches them and Enter opens the heading.
  const rows = results.locator('a.row');
  const index = await rows.evaluateAll(as => as.findIndex(a => a.getAttribute('href') === '/exam/bcsc12-11#ch11-s4'));
  for (let i = 0; i < index; i++) await input.press('ArrowDown');
  await expect(sub).toHaveClass(/active/);
  await Promise.all([page.waitForURL('**/exam/bcsc12-11#ch11-s4'), input.press('Enter')]);

  // A Chinese name finds an English-titled chapter; articles still come first.
  await page.goto('/');
  await page.keyboard.press('Control+k');
  await input.fill('青光眼');
  await expect(results.locator('.hs-cmdk-group')).toBeVisible();
  const order = await results.locator('a.row').evaluateAll(as => as.map(a => a.getAttribute('href')));
  const firstExam = order.findIndex(h => h.startsWith('/exam/'));
  expect(firstExam).toBeGreaterThan(0);
  expect(order.slice(firstExam).every(h => h.startsWith('/exam/'))).toBe(true);
  expect(order.slice(0, firstExam).some(h => h.startsWith('/blog/'))).toBe(true);
  // Public headings only: the index never carries question text.
  const nav = await (await page.request.get('/exam/nav-search.json')).json();
  expect(nav.length).toBeGreaterThan(20);
  expect(JSON.stringify(nav)).not.toMatch(/"stem"|"options"|"answer"/);
});

test('header search on the English site does not load the exam index', async ({ page }) => {
  let asked = false;
  page.on('request', r => { if (r.url().includes('/exam/nav-search.json')) asked = true; });
  await page.goto('/en/');
  await page.keyboard.press('Control+k');
  await page.locator('#hs-cmdk-input').fill('glaucoma');
  await expect(page.locator('#hs-cmdk-results a.row').first()).toBeVisible();
  await expect(page.locator('#hs-cmdk-results .hs-cmdk-group')).toHaveCount(0);
  expect(asked).toBe(false);
});

test('phone: a wide note table scrolls in its own box, the page does not', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await signedOut(page);
  await page.goto('/exam/bcsc12-11');
  const wrap = page.locator('.ex-note .ex-table-wrap').first();
  await wrap.scrollIntoViewIfNeeded();
  await expect(wrap.locator('> table.ex-ddx')).toBeVisible();
  expect(await wrap.evaluate(w => getComputedStyle(w).overflowX)).toBe('auto');
  expect(await wrap.evaluate(w => w.scrollWidth > w.clientWidth)).toBe(true);
  await wrap.evaluate(w => { w.scrollLeft = 200; });
  expect(await wrap.evaluate(w => w.scrollLeft)).toBeGreaterThan(0);
  // The note itself no longer scrolls sideways, and neither does the page, even on chapters
  // with long page-reference chips (12-12, 2-6, 4-10) and a narrow 320px phone.
  expect(await page.locator('.ex-note').evaluate(n => getComputedStyle(n).overflowX)).toBe('visible');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 320, height: 720 });
  for (const key of ['12-11', '12-12', '2-6', '4-10', '6-24', '9-11']) {
    await page.goto('/exam/bcsc' + key);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), key).toBe(true);
  }
  await context.close();
});

test('a #hash link opens the closed <details> around its target', async ({ page }) => {
  await signedOut(page);
  // A concept of another chapter sits in two closed <details> on the chapter page.
  await page.goto('/exam/bcsc12-11#cpt-c9-020');
  const concept = page.locator('#cpt-c9-020');
  await expect(concept).toHaveJSProperty('open', true);
  await expect(page.locator('details.ex-cpt-other')).toHaveJSProperty('open', true);
  await expect(concept).toBeInViewport();
  // Same-page hash changes too.
  await expect(page.locator('#cpt-c12-034')).toHaveJSProperty('open', false);
  await page.evaluate(() => { location.hash = '#cpt-c12-034'; });
  await expect(page.locator('#cpt-c12-034')).toHaveJSProperty('open', true);
  await expect(page.locator('#cpt-c12-034')).toBeInViewport();
  // Hub: a chapter in a closed BCSC part.
  await page.goto('/exam#ch-12-11');
  const item = page.locator('#ch-12-11');
  await expect(item.locator('xpath=ancestor::details')).toHaveJSProperty('open', true);
  await expect(item).toBeVisible();
  await expect(item).toBeInViewport();
});
