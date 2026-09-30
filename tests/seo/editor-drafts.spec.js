const { test, expect } = require('@playwright/test');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

test.use({ serviceWorkers: 'block' });
const root = path.resolve(__dirname, '../..');
const slug = 'dry-eye-myths';
const origin = 'https://hsiao.chendermatologist.com';
const originalSource = readFileSync(path.join(root, 'blog', slug + '.html'), 'utf8');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

async function setup(page, storage = 'opfs') {
  const server = { html: originalSource, sha: 'a'.repeat(40) };
  if (storage === 'ls') await page.addInitScript(() => {
    navigator.storage.getDirectory = async () => { throw Error('OPFS unavailable fixture'); };
  });
  // Every request is intercepted, including API writes and third parties. The
  // canonical origin exercises real browser storage without touching the site.
  await page.context().route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.fulfill({ status: 200, body: '', contentType: 'text/javascript' });
    if (url.pathname === '/api/admin/list') return route.fulfill({ json: { articles: [{ slug, title: 'Isolated editor fixture' }] } });
    if (url.pathname === '/api/admin/save' && route.request().method() === 'GET') return route.fulfill({ json: server });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, json: { error: 'isolated fixture' } });
    let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep)) return route.fulfill({ status: 404, body: '' });
    if (!path.extname(file)) file += '.html';
    if (!existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: readFileSync(file), contentType: mime[path.extname(file)] || 'application/octet-stream' });
  });
  await page.goto(origin + '/admin', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof openEditor === 'function');
  return server;
}
async function open(page) {
  await page.evaluate(slug => openEditor(slug), slug);
  const frame = page.frameLocator('#edit-iframe');
  await expect(frame.locator('#hs-adm-save')).toBeVisible();
  return frame;
}
async function draft(frame) {
  return frame.locator('body').evaluate((body, slug) => DN.loadDraft(slug), slug);
}
function acceptRecovery(page) { page.on('dialog', dialog => dialog.accept()); }

for (const storage of ['opfs', 'ls']) {
  test(`immediate close preserves latest author input using ${storage}`, async ({ page }) => {
    await setup(page, storage);
    acceptRecovery(page);
    let frame = await open(page);
    await frame.locator('#proseZh > p[contenteditable]').first().fill('Latest author input');
    await page.getByRole('button', { name: '← 回到後台' }).click();
    await expect(page.locator('#edit-shell')).toBeHidden();
    frame = await open(page);
    await expect(frame.locator('#proseZh > p[contenteditable]').first()).toHaveText('Latest author input');
    expect((await draft(frame)).baseSha).toBe('a'.repeat(40));
  });
}

test('failed local draft storage keeps the editor and author text open', async ({ page }) => {
  await setup(page);
  const frame = await open(page);
  await frame.locator('#proseZh > p[contenteditable]').first().fill('Keep this valuable text');
  await frame.locator('body').evaluate(() => { DN.saveDraft = async () => ({ source: null }); });
  await page.getByRole('button', { name: '← 回到後台' }).click();
  await expect(page.locator('#edit-shell')).toBeVisible();
  await expect(frame.locator('#hs-admin-status')).toContainText('本機草稿保存失敗');
  await expect(page.locator('#edit-status')).toContainText('本機草稿保存失敗');
  await expect(frame.locator('#proseZh > p[contenteditable]').first()).toHaveText('Keep this valuable text');
});

test('typing during the close flush persists a newer snapshot before leaving', async ({ page }) => {
  await setup(page);
  acceptRecovery(page);
  let frame = await open(page);
  await frame.locator('body').evaluate(() => {
    const save = DN.saveDraft;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    window.__releaseDraft = release;
    window.__draftWrites = 0;
    DN.saveDraft = async (...args) => { if (++window.__draftWrites === 1) await gate; return save(...args); };
  });
  await frame.locator('#proseZh > p[contenteditable]').first().fill('First snapshot');
  await page.evaluate(() => { void closeEditor(); });
  await expect.poll(() => frame.locator('body').evaluate(() => window.__draftWrites)).toBe(1);
  await frame.locator('#proseZh > p[contenteditable]').first().fill('Newer snapshot during draft write');
  await frame.locator('body').evaluate(() => window.__releaseDraft());
  await expect(page.locator('#edit-shell')).toBeHidden();
  frame = await open(page);
  await expect(frame.locator('#proseZh > p[contenteditable]').first()).toHaveText('Newer snapshot during draft write');
});

test('GitHub save in flight blocks closing and retains newer typing against the returned version', async ({ page }) => {
  const server = await setup(page);
  acceptRecovery(page);
  let release, submitted;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/admin/save', async route => {
    submitted = route.request().postDataJSON();
    await gate;
    server.html = submitted.html;
    server.sha = 'b'.repeat(40);
    await route.fulfill({ json: { ok: true, sha: server.sha, commit: 'c'.repeat(40) } });
  });
  let frame = await open(page);
  await frame.locator('#proseZh > p[contenteditable]').first().fill('Submitted snapshot');
  await frame.locator('#hs-adm-save').click();
  await expect.poll(() => !!submitted).toBe(true);
  await page.getByRole('button', { name: '← 回到後台' }).click();
  await expect(page.locator('#edit-shell')).toBeVisible();
  await expect(frame.locator('#hs-admin-status')).toContainText('請等候結果後再離開');
  await frame.locator('#proseZh > p[contenteditable]').first().fill('New work during network save');
  release();
  await expect(frame.locator('#hs-adm-save')).toBeEnabled();
  expect((await draft(frame)).baseSha).toBe('b'.repeat(40));
  await expect(page.locator('#edit-status')).toContainText('仍有修改尚未儲存');
  await page.getByRole('button', { name: '← 回到後台' }).click();
  await expect(page.locator('#edit-shell')).toBeHidden();
  frame = await open(page);
  await expect(frame.locator('#proseZh > p[contenteditable]').first()).toHaveText('New work during network save');
});

test('successful GitHub save has a persistent status and does not claim deployment', async ({ page }) => {
  await setup(page);
  await page.route('**/api/admin/save', route => route.fulfill({ json: { ok: true, sha: 'b'.repeat(40), commit: 'c'.repeat(40) } }));
  const frame = await open(page);
  await frame.locator('#proseZh > p[contenteditable]').first().fill('Saved author input');
  await frame.locator('#hs-adm-save').click();
  await expect(frame.locator('#hs-admin-status')).toContainText('正式上線尚未確認');
  await page.waitForTimeout(5500);
  await expect(frame.locator('#hs-admin-status')).toContainText('已保存至 GitHub');
  await expect(page.locator('#edit-status')).toContainText('正式上線尚未確認');
  expect(await draft(frame)).toBeNull();
});

test('existing complete-article recovery preserves separate Chinese and English prose', async ({ page }) => {
  await setup(page);
  acceptRecovery(page);
  let frame = await open(page);
  await frame.locator('#proseZh > p[contenteditable]').first().fill('Chinese draft fixture');
  await frame.locator('body').evaluate(() => {
    document.getElementById('proseEn').querySelector('p').textContent = 'English stored-draft fixture';
  });
  await page.getByRole('button', { name: '← 回到後台' }).click();
  await expect(page.locator('#edit-shell')).toBeHidden();
  frame = await open(page);
  await expect(frame.locator('#proseZh > p[contenteditable]').first()).toHaveText('Chinese draft fixture');
  await expect(frame.locator('#proseEn p').first()).toHaveText('English stored-draft fixture');
});

test('direct navigation prompts before abandoning unsaved author input', async ({ page }) => {
  await setup(page);
  await page.goto(origin + '/blog/' + slug + '?admin=1', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#hs-adm-save')).toBeVisible();
  await page.locator('#proseZh > p[contenteditable]').first().fill('Do not silently abandon');
  let prompted = false;
  page.on('dialog', async dialog => { if (dialog.type() === 'beforeunload') prompted = true; await dialog.dismiss(); });
  await page.goto('about:blank').catch(error => { if (!error.message.includes('ERR_ABORTED')) throw error; });
  expect(prompted).toBe(true);
  await expect(page.locator('#proseZh > p[contenteditable]').first()).toHaveText('Do not silently abandon');
});

test('explicit discard clears the stored draft and reloads the unchanged server source', async ({ page }) => {
  await setup(page);
  acceptRecovery(page);
  const frame = await open(page);
  await frame.locator('#proseZh > p[contenteditable]').first().fill('Explicitly discarded text');
  await frame.locator('body').evaluate(() => DN.adminBeforeClose());
  expect((await draft(frame)).html).toContain('Explicitly discarded text');
  await frame.locator('#hs-adm-cancel').click();
  await expect(frame.locator('#proseZh > p[contenteditable]').first()).not.toHaveText('Explicitly discarded text');
  expect(await draft(frame)).toBeNull();
});

test('typing during the final discard read verification remains unsaved and visible', async ({ page }) => {
  await setup(page);
  acceptRecovery(page);
  const frame = await open(page);
  await frame.locator('#proseZh > p[contenteditable]').first().fill('Initial work to discard');
  await frame.locator('body').evaluate(() => {
    const load = DN.loadDraft;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    window.__releaseDiscardRead = release;
    DN.loadDraft = async (...args) => { window.__discardReading = true; await gate; return load(...args); };
  });
  await frame.locator('#hs-adm-cancel').click();
  await expect.poll(() => frame.locator('body').evaluate(() => !!window.__discardReading)).toBe(true);
  await frame.locator('#proseZh > p[contenteditable]').first().fill('New input during final read');
  await frame.locator('body').evaluate(() => window.__releaseDiscardRead());
  await expect(frame.locator('#hs-admin-status')).toContainText('確認草稿期間又有新修改');
  await expect(frame.locator('#proseZh > p[contenteditable]').first()).toHaveText('New input during final read');
  expect(await frame.locator('body').evaluate(() => DN._adminDirty)).toBe(true);
});

for (const failure of ['opfs-delete', 'opfs-verify', 'ls-delete', 'ls-verify']) {
  test(`unconfirmed ${failure} cannot be acknowledged as draft deletion`, async ({ page }) => {
    await setup(page);
    acceptRecovery(page);
    const frame = await open(page);
    await frame.locator('#proseZh > p[contenteditable]').first().fill('Preserve on storage failure');
    await frame.locator('body').evaluate(async (body, failure) => {
      if (failure.startsWith('opfs')) {
        const directory = await navigator.storage.getDirectory();
        const directoryPrototype = Object.getPrototypeOf(directory);
        directoryPrototype[failure === 'opfs-delete' ? 'removeEntry' : 'getFileHandle'] = async () => { throw new DOMException('Storage fixture denied', 'NotAllowedError'); };
      } else {
        Storage.prototype[failure === 'ls-delete' ? 'removeItem' : 'getItem'] = () => { throw new DOMException('Storage fixture denied', 'SecurityError'); };
      }
    }, failure);
    const result = await frame.locator('body').evaluate((body, slug) => DN.deleteDraft(slug), slug);
    expect(result.deleted).toBe(false);
    await frame.locator('#hs-adm-cancel').click();
    await expect(frame.locator('#hs-admin-status')).toContainText('無法清除本機草稿');
    await expect(frame.locator('#proseZh > p[contenteditable]').first()).toHaveText('Preserve on storage failure');
    await page.getByRole('button', { name: '← 回到後台' }).click();
    await expect(page.locator('#edit-shell')).toBeVisible();
  });
}

test('new draft storage failure after Git save remains an error in parent and frame', async ({ page }) => {
  await setup(page);
  let release, submitted;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/admin/save', async route => {
    submitted = route.request().postDataJSON();
    await gate;
    await route.fulfill({ json: { ok: true, sha: 'b'.repeat(40), commit: 'c'.repeat(40) } });
  });
  const frame = await open(page);
  await frame.locator('#proseZh > p[contenteditable]').first().fill('Submitted snapshot');
  await frame.locator('#hs-adm-save').click();
  await expect.poll(() => !!submitted).toBe(true);
  await frame.locator('#proseZh > p[contenteditable]').first().fill('New work with unavailable draft storage');
  await frame.locator('body').evaluate(() => { DN.saveDraft = async () => ({ source: null }); });
  release();
  await expect(frame.locator('#hs-adm-save')).toBeEnabled();
  await expect(page.locator('#edit-status')).toContainText('本機草稿保存失敗');
  await expect(frame.locator('#hs-admin-status')).toContainText('本機草稿保存失敗');
  await page.getByRole('button', { name: '← 回到後台' }).click();
  await expect(page.locator('#edit-shell')).toBeVisible();
});

test('Git save cleanup failure is visible and never queues an already saved commit offline', async ({ page }) => {
  await setup(page);
  await page.route('**/api/admin/save', route => route.fulfill({ json: { ok: true, sha: 'b'.repeat(40), commit: 'c'.repeat(40) } }));
  const frame = await open(page);
  await frame.locator('#proseZh > p[contenteditable]').first().fill('Git save succeeds');
  await frame.locator('body').evaluate(() => {
    DN.deleteDraft = async () => ({ deleted: false });
    window.__offlineQueueCalls = 0;
    DN.queueOfflineSave = () => { window.__offlineQueueCalls++; return true; };
  });
  await frame.locator('#hs-adm-save').click();
  await expect(frame.locator('#hs-adm-save')).toBeEnabled();
  await expect(frame.locator('#hs-admin-status')).toContainText('GitHub 已保存；本機草稿處理失敗');
  expect(await frame.locator('body').evaluate(() => window.__offlineQueueCalls)).toBe(0);
  await page.getByRole('button', { name: '← 回到後台' }).click();
  await expect(page.locator('#edit-shell')).toBeVisible();
});

for (const configured of [true, false, undefined]) {
  test(`KV status uses explicit configured=${configured} rather than response speed`, async ({ page }) => {
    await setup(page);
    await page.route('**/api/admin/ab-stats**', async route => {
      if (configured === true) await new Promise(resolve => setTimeout(resolve, 450));
      await route.fulfill({ json: { configured, tests: {} } });
    });
    await page.evaluate(() => checkEnvStatus());
    const expected = configured === true ? '已設定；收件尚須確認' : configured === false ? '未設定；A/B 計數不保存' : '無法確認設定';
    await expect(page.locator('#env-kv')).toContainText(expected);
    await expect(page.locator('#env-kv')).not.toContainText('fallback');
  });
}

for (const receipt of ['malformed-json', 'missing-sha', 'invalid-sha', 'invalid-commit']) {
  test(`invalid save receipt ${receipt} preserves the draft and never queues a 2xx replay`, async ({ page }) => {
    await setup(page);
    let requests = 0;
    await page.route('**/api/admin/save', route => {
      requests++;
      if (receipt === 'malformed-json') return route.fulfill({ status: 200, body: '{"ok":true,', contentType: 'application/json' });
      const data = { ok: true, sha: 'b'.repeat(40), commit: 'c'.repeat(40) };
      if (receipt === 'missing-sha') delete data.sha;
      if (receipt === 'invalid-sha') data.sha = 'unverified';
      if (receipt === 'invalid-commit') data.commit = {};
      return route.fulfill({ json: data });
    });
    const frame = await open(page);
    await frame.locator('#proseZh > p[contenteditable]').first().fill('Preserve uncertain save receipt');
    await frame.locator('body').evaluate(() => {
      window.__offlineQueueCalls = 0;
      DN.queueOfflineSave = () => { window.__offlineQueueCalls++; return true; };
    });
    await frame.locator('#hs-adm-save').click();
    await expect(frame.locator('#hs-admin-status')).toContainText('無法確認保存版本');
    const retained = await draft(frame);
    expect(retained.baseSha).toBe('a'.repeat(40));
    expect(retained.html).toContain('Preserve uncertain save receipt');
    expect(await frame.locator('body').evaluate(() => window.__offlineQueueCalls)).toBe(0);
    await frame.locator('#hs-adm-save').click();
    expect(requests).toBe(1);
  });
}

test('valid unchanged-save receipt permits the empty commit only with noop', async ({ page }) => {
  await setup(page);
  await page.route('**/api/admin/save', route => route.fulfill({ json: { ok: true, sha: 'a'.repeat(40), commit: '', noop: true } }));
  const frame = await open(page);
  await frame.locator('#hs-adm-save').click();
  await expect(frame.locator('#hs-admin-status')).toContainText('已保存至 GitHub');
  expect(await draft(frame)).toBeNull();
});

test('storage failure combined with an invalid 200 never claims a retained local draft', async ({ page }) => {
  await setup(page);
  await page.route('**/api/admin/save', route => route.fulfill({ status: 200, body: '{"ok":', contentType: 'application/json' }));
  const frame = await open(page);
  await frame.locator('#proseZh > p[contenteditable]').first().fill('Only in this open editor');
  await frame.locator('body').evaluate(() => { DN.saveDraft = async () => ({ source: null }); });
  await frame.locator('#hs-adm-save').click();
  await expect(frame.locator('#hs-admin-status')).toContainText('本機草稿未能保存');
  await expect(frame.locator('#hs-admin-status')).toContainText('無法確認保存版本');
  await expect(frame.locator('#hs-admin-status')).not.toContainText('已保留草稿');
  expect(await draft(frame)).toBeNull();
  await frame.locator('#hs-adm-save').click();
  await expect(frame.locator('#hs-admin-status')).not.toContainText('本機草稿已保留');
  await page.getByRole('button', { name: '← 回到後台' }).click();
  await expect(page.locator('#edit-shell')).toBeVisible();
  await expect(frame.locator('#proseZh > p[contenteditable]').first()).toHaveText('Only in this open editor');
});

test('GitHub can acknowledge a valid save when the optional local backup write is unavailable', async ({ page }) => {
  await setup(page);
  await page.route('**/api/admin/save', route => route.fulfill({ json: { ok: true, sha: 'b'.repeat(40), commit: 'c'.repeat(40) } }));
  const frame = await open(page);
  await frame.locator('#proseZh > p[contenteditable]').first().fill('Valid remote save without local backup');
  await frame.locator('body').evaluate(() => { DN.saveDraft = async () => ({ source: null }); });
  await frame.locator('#hs-adm-save').click();
  await expect(frame.locator('#hs-admin-status')).toContainText('已保存至 GitHub');
  await expect(frame.locator('#hs-admin-status')).not.toContainText('本機草稿已保存');
});
