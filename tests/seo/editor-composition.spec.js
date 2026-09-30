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


// Isolated real editor DOM. Synthetic key cases prove handler behavior, not an
// OS input-method matrix; the CDP case below also exercises native composition.
for (const marker of ['event', 'legacy', 'session']) {
  for (const key of ['Enter', 's']) {
    test(`composition ${marker} leaves ${key} to the input method`, async ({ page }) => {
      await setup(page);
      let writes = 0;
      await page.route('**/api/admin/save', async route => {
        if (route.request().method() === 'GET') return route.fallback();
        writes++;
        return route.fulfill({ json: { ok: true, sha: 'b'.repeat(40), commit: 'c'.repeat(40) } });
      });
      const frame = await open(page);
      const p = frame.locator('#proseZh > p[contenteditable]').first();
      await p.fill('');
      await p.press('/');
      await expect(frame.locator('#hs-slash-menu')).toBeVisible();
      const result = await p.evaluate((el, {marker, key}) => {
        if (marker === 'session') el.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true,data:''}));
        const e = new KeyboardEvent('keydown', {key,ctrlKey:key === 's',bubbles:true,cancelable:true,
          isComposing:marker === 'event',keyCode:marker === 'legacy' ? 229 : 0});
        el.dispatchEvent(e);
        return {prevented:e.defaultPrevented, sameParagraph:el.parentNode.querySelector('p') === el};
      }, {marker,key});
      expect(result.prevented).toBe(false);
      expect(result.sameParagraph).toBe(true);
      await expect.poll(() => writes).toBe(0);
      if (marker === 'session') await expect(frame.locator('#hs-slash-menu')).toBeHidden();
      await p.evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'??'})));
      await p.fill('Completed Chinese text');
      await p.press('Control+s');
      await expect.poll(() => writes).toBe(1);
    });
  }
}

test('Chromium native composition closes commands and preserves committed Chinese in a draft', async ({ page, context }) => {
  await setup(page);
  const frame = await open(page);
  const p = frame.locator('#proseZh > p[contenteditable]').first();
  await p.fill('');
  await p.press('/');
  await expect(frame.locator('#hs-slash-menu')).toBeVisible();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.imeSetComposition',{text:'中文組字',selectionStart:4,selectionEnd:4});
  await expect(frame.locator('#hs-slash-menu')).toBeHidden();
  await expect(p).toHaveText('中文組字');
  await cdp.send('Input.insertText',{text:'中文組字'});
  await expect(p).toHaveText('中文組字');
  expect(await frame.locator('body').evaluate(() => DN.adminBeforeClose())).toBe(true);
  expect((await draft(frame)).html).toContain('中文組字');
  // Ordinary commands become usable after the native composition ends.
  await p.fill('');
  await p.press('/');
  await expect(frame.locator('#hs-slash-menu')).toBeVisible();
  await cdp.detach();
});

test('normal typing supports keyboard undo and redo before acknowledged draft storage', async ({ page }) => {
  await setup(page);
  const frame = await open(page);
  const p = frame.locator('#proseZh > p[contenteditable]').first();
  await p.fill('Author text');
  await p.press('End');
  await p.pressSequentially('!');
  await expect(p).toHaveText('Author text!');
  await p.press('Control+z');
  await expect(p).toHaveText('Author text');
  await p.press('Control+Shift+z');
  await expect(p).toHaveText('Author text!');
  expect(await frame.locator('body').evaluate(() => DN.adminBeforeClose())).toBe(true);
  expect((await draft(frame)).html).toContain('Author text!');
});
