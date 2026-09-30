const { test, expect } = require('@playwright/test');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

test.use({ serviceWorkers: 'block' });
const root = path.resolve(__dirname, '../..');
const slug = 'dry-eye-myths';
const origin = 'https://hsiao.chendermatologist.com';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
async function setup(context, storage = 'opfs') {
  const state = { reads: 0, posts: 0, failRead: false, blockSave: null };
  if (storage === 'ls') await context.addInitScript(() => {
    navigator.storage.getDirectory = async () => { throw Error('OPFS unavailable fixture'); };
  });
  // Intercept all requests; real shared browser storage, no production API writes.
  await context.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.origin !== origin) return route.fulfill({ status: 200, body: '', contentType: 'text/javascript' });
    if (u.pathname === '/api/admin/list') return route.fulfill({ json: { articles: [{ slug, title: 'Isolated editor' }] } });
    if (u.pathname === '/api/admin/save') {
      if (route.request().method() === 'GET') {
        state.reads++;
        if (state.failRead) return route.fulfill({ status: 503, json: { error: 'fixture source unavailable' } });
        const file = path.join(root, 'blog', u.searchParams.get('slug') + '.html');
        return route.fulfill({ json: { html: readFileSync(file, 'utf8'), sha: 'a'.repeat(40) } });
      }
      state.posts++;
      if (state.blockSave) await state.blockSave;
      return route.fulfill({ json: { ok: true, sha: 'b'.repeat(40), commit: 'c'.repeat(40) } });
    }
    if (u.pathname.startsWith('/api/')) return route.fulfill({ status: 503, json: { error: 'isolated fixture' } });
    let file = path.resolve(root, '.' + decodeURIComponent(u.pathname));
    if (!file.startsWith(root + path.sep)) return route.fulfill({ status: 404, body: '' });
    if (!path.extname(file)) file += '.html';
    if (!existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: readFileSync(file), contentType: mime[path.extname(file)] || 'application/octet-stream' });
  });
  return state;
}
async function start(context, articleSlug = slug) {
  const page = await context.newPage();
  page.on('dialog', d => d.accept());
  await page.goto(origin + '/admin', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof openEditor === 'function');
  await page.evaluate(s => openEditor(s), articleSlug);
  return { page, frame: page.frameLocator('#edit-iframe') };
}
async function editable(context, articleSlug = slug) {
  const tab = await start(context, articleSlug);
  await expect(tab.frame.locator('#hs-adm-save')).toBeVisible();
  return tab;
}
async function blocked(context) {
  const tab = await start(context);
  await expect(tab.frame.getByRole('alert')).toContainText('另一個分頁正在編輯');
  await expect(tab.frame.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(tab.frame.locator('#hs-adm-save')).toHaveCount(0);
  return tab;
}

for (const storage of ['opfs', 'ls']) {
  test(`same article rejects the second editor before source/draft mutation using ${storage}`, async ({ context }) => {
    const state = await setup(context, storage);
    const a = await editable(context);
    await a.frame.locator('#proseZh > p[contenteditable]').first().fill('Protected first tab draft');
    expect(await a.frame.locator('body').evaluate(() => DN.adminBeforeClose())).toBe(true);
    const before = await a.frame.locator('body').evaluate((body, s) => DN.loadDraft(s), slug);
    expect(before.html).toContain('Protected first tab draft');
    const b = await blocked(context);
    expect(state.reads).toBe(1);
    const after = await a.frame.locator('body').evaluate((body, s) => DN.loadDraft(s), slug);
    expect(after).toEqual(before);
    await b.page.getByRole('button', { name: '← 回到後台' }).click();
    await expect(b.page.locator('#edit-shell')).toBeHidden();
    await expect(a.frame.locator('#hs-adm-save')).toBeVisible();
  });

  test(`closing owner flushes its draft and allows a waiting tab to recover using ${storage}`, async ({ context }) => {
    await setup(context, storage);
    const a = await editable(context);
    const b = await blocked(context);
    await a.frame.locator('#proseZh > p[contenteditable]').first().fill('Latest owner text before handoff');
    await a.page.getByRole('button', { name: '← 回到後台' }).click();
    await expect(a.page.locator('#edit-shell')).toBeHidden();
    await b.frame.getByRole('button', { name: '重新開啟編輯' }).click();
    await expect(b.frame.locator('#hs-adm-save')).toBeVisible();
    await expect(b.frame.locator('#proseZh > p[contenteditable]').first()).toHaveText('Latest owner text before handoff');
  });
}

test('abrupt owner termination releases the lock and keeps its acknowledged draft recoverable', async ({ context }) => {
  await setup(context);
  const a = await editable(context);
  const b = await blocked(context);
  await a.frame.locator('#proseZh > p[contenteditable]').first().fill('Acknowledged draft before forced close');
  expect(await a.frame.locator('body').evaluate(() => DN.adminBeforeClose())).toBe(true);
  await a.page.close({ runBeforeUnload: false });
  await b.frame.getByRole('button', { name: '重新開啟編輯' }).click();
  await expect(b.frame.locator('#hs-adm-save')).toBeVisible();
  await expect(b.frame.locator('#proseZh > p[contenteditable]').first()).toHaveText('Acknowledged draft before forced close');
});

test('failed safe close retains ownership and author text until storage recovers', async ({ context }) => {
  await setup(context);
  const a = await editable(context);
  await a.frame.locator('#proseZh > p[contenteditable]').first().fill('Retain this unsaved work');
  await a.frame.locator('body').evaluate(() => { DN.saveDraft = async () => ({ source: null }); });
  await a.page.getByRole('button', { name: '← 回到後台' }).click();
  await expect(a.frame.locator('#hs-admin-status')).toContainText('本機草稿保存失敗');
  await blocked(context);
  await expect(a.frame.locator('#proseZh > p[contenteditable]').first()).toHaveText('Retain this unsaved work');
});

test('source initialization failure releases ownership before retry in a different tab', async ({ context }) => {
  const state = await setup(context);
  state.failRead = true;
  const a = await start(context);
  await expect(a.frame.getByRole('alert')).toContainText('請登入後重新開啟');
  state.failRead = false;
  await editable(context);
  expect(state.reads).toBe(2);
});

for (const failure of ['unavailable', 'rejected']) {
  test(`lock ${failure} fails before editing or touching stored drafts`, async ({ context }) => {
    await context.addInitScript(failure => {
      if (failure === 'unavailable') Object.defineProperty(navigator, 'locks', { value: undefined });
      else navigator.locks.request = async () => { throw Error('fixture lock permission denied'); };
      localStorage.setItem('hs:draft-dry-eye-myths.json', 'valuable existing recovery fixture');
    }, failure);
    const state = await setup(context);
    const a = await start(context);
    await expect(a.frame.getByRole('alert')).toContainText('無法開啟編輯');
    await expect(a.frame.locator('[contenteditable="true"]')).toHaveCount(0);
    expect(state.reads).toBe(0);
    expect(await a.page.evaluate(() => localStorage.getItem('hs:draft-dry-eye-myths.json'))).toBe('valuable existing recovery fixture');
  });
}

test('Git save and draft cleanup keep ownership until the editor actually closes', async ({ context }) => {
  const state = await setup(context);
  let release;
  state.blockSave = new Promise(resolve => { release = resolve; });
  const a = await editable(context);
  await a.frame.locator('#proseZh > p[contenteditable]').first().fill('Git save fixture');
  await a.frame.locator('#hs-adm-save').click();
  await expect.poll(() => state.posts).toBe(1);
  const b = await blocked(context);
  release();
  await expect(a.frame.locator('#hs-admin-status')).toContainText('正式上線尚未確認');
  await b.frame.getByRole('button', { name: '重新開啟編輯' }).click();
  await expect(b.frame.getByRole('alert')).toContainText('另一個分頁正在編輯');
  expect(state.reads).toBe(1);
  await a.page.getByRole('button', { name: '← 回到後台' }).click();
  await expect(a.page.locator('#edit-shell')).toBeHidden();
  await b.frame.getByRole('button', { name: '重新開啟編輯' }).click();
  await expect(b.frame.locator('#hs-adm-save')).toBeVisible();
});

test('two different articles can be edited concurrently', async ({ context }) => {
  const state = await setup(context);
  await editable(context);
  await editable(context, 'glaucoma-comprehensive-guide');
  expect(state.reads).toBe(2);
});
