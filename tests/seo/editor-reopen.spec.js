const { test, expect } = require('@playwright/test');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const origin = 'https://hsiao.chendermatologist.com';
const slug = 'dry-eye-myths';
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.json':'application/json' };
test.use({ serviceWorkers:'block' });

for (const oldCache of [false, true]) test(`saved article can immediately reopen repeatedly without a blank editor or stale source, oldCache=${oldCache}`, async ({ page }) => {
  const { default:middleware } = await new Function('url','return import(url)')('data:text/javascript;base64,'+
    Buffer.from(readFileSync(path.join(root,'middleware.js'),'utf8')).toString('base64'));
  const state = { html:readFileSync(path.join(root,'blog',slug+'.html'),'utf8'), sha:'a'.repeat(40), catalogSha:'d'.repeat(40), posts:0, submissions:[] };
  // Every request, including authenticated saves and third parties, is isolated.
  await page.context().route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.origin !== origin) return route.fulfill({ body:'', contentType:'text/javascript' });
    if (u.pathname === '/api/admin/list') return route.fulfill({ json:{ articles:[] } });
    if (u.pathname === '/api/admin/save') {
      if (route.request().method() === 'GET') return route.fulfill({ json:{ html:state.html, sha:state.sha, catalogSha:state.catalogSha } });
      const submitted = route.request().postDataJSON();
      expect(submitted.baseSha).toBe(state.sha);
      state.submissions.push(submitted);state.html = submitted.html;state.posts++;
      state.sha = String(state.posts).padStart(40,'0');
      state.catalogSha = String(state.posts+100).padStart(40,'0');
      return route.fulfill({ json:{ ok:true, sha:state.sha, catalogSha:state.catalogSha, commit:String(state.posts+200).padStart(40,'0') } });
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
  const frame = page.frameLocator('#edit-iframe');
  for (let cycle=0;cycle<8;cycle++) {
    // No blank-frame wait or delay: this is the rapid reopen that regressed.
    await page.evaluate(s=>openEditor(s),slug);
    await frame.locator('#hs-adm-article-info').click();
    const title = frame.locator('#hs-editor-titleZh');
    await expect(title).toBeVisible();
    if (cycle) await expect(title).toHaveValue('保存重開 '+(cycle-1));
    await title.fill('保存重開 '+cycle);
    await frame.locator('#hs-adm-save').click();
    await expect(frame.locator('#hs-admin-status')).toContainText('已保存至 GitHub');
    await expect.poll(()=>state.posts).toBe(cycle+1);
    await page.getByRole('button',{ name:'← 回到後台', exact:true }).click();
    await expect(page.locator('#edit-shell')).toBeHidden();
  }
  expect(state.submissions).toHaveLength(8);
  expect(state.html).toContain('保存重開 7');
  expect(state.html).not.toContain('hs-editor-metadata-workspace');
});
