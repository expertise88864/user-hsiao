const { test, expect } = require('@playwright/test');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const origin = 'https://hsiao.chendermatologist.com';
const slug = 'dry-eye-myths';
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.json':'application/json' };
test.use({ serviceWorkers:'block' });

for (const oldCache of [false, true]) for (const newerInput of [false, true]) test(`late reader initialization preserves saved source and actual pending input, newer=${newerInput}, oldCache=${oldCache}`, async ({ page }) => {
  const { default:middleware } = await new Function('url','return import(url)')('data:text/javascript;base64,'+
    Buffer.from(readFileSync(path.join(root,'middleware.js'),'utf8')).toString('base64'));
  const original = readFileSync(path.join(root,'blog',slug+'.html'),'utf8');
  const state = { html:original, sha:'a'.repeat(40), catalogSha:'d'.repeat(40), submitted:null, posts:0, idleCallbacks:0 };
  // Deliberately deliver the real deferred reader callbacks during the POST,
  // after the editor has imported its authenticated article and the author typed.
  await page.addInitScript(() => {
    if (window.parent === window || !location.search.includes('admin=1')) return;
    window.__delayedReaderIdle = [];
    window.requestIdleCallback = callback => { window.__delayedReaderIdle.push(callback); return window.__delayedReaderIdle.length; };
    window.cancelIdleCallback = () => {};
    // Browser SWs are blocked in this isolated fixture. Exercise actual
    // registration/queue call paths with an initially uncontrolled SW API.
    window.__editorSw = { registrations:[], messages:[], sync:[] };
    const registration = { addEventListener(){}, update:()=>Promise.resolve(), sync:{ register:tag=>{window.__editorSw.sync.push(tag);return Promise.resolve();} } };
    const workers = { controller:null, ready:Promise.resolve(registration), addEventListener(){}, removeEventListener(){},
      register:url=>{window.__editorSw.registrations.push(url);workers.controller={postMessage:(value,ports)=>{
        window.__editorSw.messages.push(value);
        window.__editorSw.reply=()=>{ports[0].postMessage({queued:true});ports[0].close();};
      }};return Promise.resolve(registration);} };
    Object.defineProperty(navigator,'serviceWorker',{ configurable:true, value:workers });
  });
  await page.context().route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.origin !== origin) return route.fulfill({ body:'', contentType:'text/javascript' });
    if (u.pathname === '/api/admin/list') return route.fulfill({ json:{ articles:[] } });
    if (u.pathname === '/api/admin/offline-token') return route.fulfill({ json:{ token:'isolated-editor-capability', expiresAt:Date.now()+3600000 } });
    if (u.pathname === '/api/admin/save') {
      if (route.request().method() === 'GET') return route.fulfill({ json:{ html:state.html, sha:state.sha, catalogSha:state.catalogSha } });
      state.posts++;
      if (state.posts > 1) return route.abort('failed');
      state.submitted = route.request().postDataJSON();
      expect(state.submitted.baseSha).toBe(state.sha);
      state.html = state.submitted.html;state.sha = 'b'.repeat(40);state.catalogSha = 'e'.repeat(40);
      const articleFrame = page.frames().find(frame => frame.url().includes('?admin=1'));
      state.idleCallbacks = await articleFrame.evaluate(() => {
        const callbacks = window.__delayedReaderIdle.splice(0);
        window.requestIdleCallback = cb => setTimeout(() => cb({ didTimeout:false, timeRemaining:()=>50 }), 0);
        callbacks.forEach(cb => cb({ didTimeout:false, timeRemaining:()=>50 }));
        return callbacks.length;
      });
      if (newerInput) await page.frameLocator('#edit-iframe').locator('#hs-editor-titleZh').fill('保存請求期間的新標題');
      await articleFrame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      return route.fulfill({ json:{ ok:true, sha:'b'.repeat(40), catalogSha:'e'.repeat(40), commit:'c'.repeat(40) } });
    }
    if (u.pathname.startsWith('/api/')) return route.fulfill({ status:503, json:{ error:'isolated fixture' } });
    let file = path.resolve(root,'.'+decodeURIComponent(u.pathname));
    if (!file.startsWith(root+path.sep)) return route.fulfill({ status:404 });
    if (!path.extname(file)) file += '.html';
    if (!existsSync(file)) return route.fulfill({ status:404 });
    const headers = {};
    if (u.pathname.startsWith('/blog/') && file.endsWith('.html')) headers['Content-Security-Policy'] = middleware(new Request(u.href)).headers.get('Content-Security-Policy');
    return route.fulfill({ body:readFileSync(file), contentType:mime[path.extname(file)]||'application/octet-stream', headers });
  });
  if (oldCache) {
    await page.goto(origin+'/icon.svg');
    await page.evaluate(async () => {
      localStorage.setItem('hs:siteVer','old');
      await caches.open('old-editor-fixture');
    });
  }
  const documents=[];
  page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url()); });
  await page.goto(origin+'/admin');
  await expect.poll(()=>documents.length).toBe(oldCache ? 2 : 1);
  await page.waitForFunction(() => localStorage.getItem('hs:siteVer') === new URL(document.querySelector('script[src*="trusted-types.js"]').src).searchParams.get('v'));
  expect(await page.evaluate(()=>caches.keys())).not.toContain('old-editor-fixture');
  await page.waitForFunction(()=>typeof openEditor==='function' && LOGGED_IN);
  await page.evaluate(s=>openEditor(s),slug);
  const frame = page.frameLocator('#edit-iframe');
  await frame.locator('#hs-adm-article-info').click();
  await frame.locator('#hs-editor-titleZh').fill('本次保存標題');
  await frame.locator('#hs-adm-save').click();
  await expect(frame.locator('#hs-admin-status')).toContainText(newerInput ? '仍有較新的修改尚未儲存' : '已保存至 GitHub');
  expect(state.posts).toBe(1);expect(state.idleCallbacks).toBeGreaterThanOrEqual(2);
  expect(state.submitted.html).toContain('本次保存標題');
  expect(state.submitted.html).not.toContain('保存請求期間的新標題');
  expect(await frame.locator('body').evaluate(()=>!!DN._adminDirty)).toBe(newerInput);
  const integrity = await frame.locator('body').evaluate((body, source) => {
    const expected = new DOMParser().parseFromString(source,'text/html');
    return ['#hs-share','#hs-author-bio','#hs-support','#hs-related','.myth-card'].every(selector => {
      const before = [...expected.querySelectorAll(selector)], after = [...document.querySelectorAll(selector)];
      return before.length === after.length && before.every((node,index) => {
        const current = after[index].cloneNode(true);
        current.querySelectorAll('[contenteditable]').forEach(el=>{el.removeAttribute('contenteditable');el.removeAttribute('spellcheck');});
        return current.outerHTML === node.outerHTML;
      });
    });
  }, original);
  expect(integrity).toBe(true);
  expect(await frame.locator('body').evaluate(()=>window.__editorSw.registrations)).toEqual(['/sw.js']);
  if (!newerInput) {
    await expect.poll(()=>frame.locator('body').evaluate(()=>!!DN._offlineSaveTokens['dry-eye-myths'])).toBe(true);
    await frame.locator('#hs-editor-titleZh').fill('網路失敗時保留的標題');
    await frame.locator('#hs-adm-save').click();
    await expect.poll(()=>frame.locator('body').evaluate(()=>window.__editorSw.messages.length)).toBe(1);
    await expect(frame.locator('#hs-admin-status')).not.toContainText('已排入背景同步');
    await frame.locator('body').evaluate(()=>window.__editorSw.reply());
    await expect(frame.locator('#hs-admin-status')).toContainText('已排入背景同步');
    const queued = await frame.locator('body').evaluate(()=>window.__editorSw.messages);
    expect(queued).toHaveLength(1);expect(queued[0].type).toBe('QUEUE_SAVE');
    expect(queued[0].payload.baseSha).toBe('b'.repeat(40));
    expect(queued[0].payload.html).toContain('網路失敗時保留的標題');
    expect(queued[0].payload.token).toBe('isolated-editor-capability');
    await expect.poll(()=>frame.locator('body').evaluate(()=>window.__editorSw.sync)).toEqual(['admin-save-replay']);
  }
  if (newerInput) {
    await page.getByRole('button',{ name:'← 回到後台', exact:true }).click();
    await expect(page.locator('#edit-shell')).toBeHidden();
    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('偵測到未儲存的草稿');
      await dialog.accept();
    });
    await page.evaluate(s=>openEditor(s),slug);
    await expect(frame.locator('#hs-editor-titleZh')).toHaveValue('保存請求期間的新標題');
  }
});
