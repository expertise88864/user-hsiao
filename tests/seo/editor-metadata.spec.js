const { test, expect } = require('@playwright/test');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const axeSource = require('axe-core').source;
test.use({ serviceWorkers: 'block' });
const root=path.resolve(__dirname,'../..'), origin='https://hsiao.chendermatologist.com', slug='dry-eye-myths';
const original=readFileSync(path.join(root,'blog',slug+'.html'),'utf8');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'};
async function setup(page, options={}) {
  const { default:middleware }=await new Function('url','return import(url)')('data:text/javascript;base64,'+Buffer.from(readFileSync(path.join(root,'middleware.js'),'utf8')).toString('base64'));
  const articleSlug=options.slug||slug;
  const state={html:options.slug?readFileSync(path.join(root,'blog',articleSlug+'.html'),'utf8'):original,sha:'a'.repeat(40),catalogSha:'d'.repeat(40),posts:0,submitted:null};
  if(options.citation) state.html=state.html.replace('</head>','<script type="application/ld+json">{"@type":"BlogPosting","@id":"https://external.example/article","headline":"External citation title","description":"External citation description"}</script></head>');
  if(options.fresh) state.html=original.replace('data-zh="乾眼症 8 大迷思" data-en="8 Dry-Eye Myths">乾眼症 8 大迷思</span><br',
    'data-zh="最新來源主標題" data-en="Latest source heading">最新來源主標題</span><br');
  await page.context().route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.origin!==origin)return route.fulfill({body:'',contentType:'text/javascript'});
    if(u.pathname==='/api/admin/save') {
      if(route.request().method()==='GET')return route.fulfill({json:{html:state.html,sha:state.sha,catalogSha:state.catalogSha}});
      state.posts++;state.submitted=route.request().postDataJSON();
      if(options.conflict)return route.fulfill({status:409,json:{error:'Catalog has changed'}});
      state.html=state.submitted.html;state.sha='b'.repeat(40);state.catalogSha='e'.repeat(40);
      return route.fulfill({json:{ok:true,sha:state.sha,commit:'c'.repeat(40),catalogSha:state.catalogSha}});
    }
    if(u.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{error:'isolated fixture'}});
    let file=path.resolve(root,'.'+decodeURIComponent(u.pathname));
    if(!file.startsWith(root+path.sep))return route.fulfill({status:404});
    if(!path.extname(file))file+='.html';
    if(!existsSync(file))return route.fulfill({status:404});
    const headers={};
    if(u.pathname.startsWith('/blog/')&&file.endsWith('.html'))headers['Content-Security-Policy']=middleware(new Request(u.href)).headers.get('Content-Security-Policy');
    return route.fulfill({body:readFileSync(file),contentType:mime[path.extname(file)]||'application/octet-stream',headers});
  });
  await page.goto(origin+'/admin');await page.waitForFunction(()=>typeof openEditor==='function');
  await page.evaluate(s=>openEditor(s),articleSlug);
  const frame=page.frameLocator('#edit-iframe');await expect(frame.locator('#hs-adm-save')).toBeVisible();
  return {frame,state};
}
const input=(frame,key)=>frame.locator('#hs-editor-'+key);
test('table instructions follow editor language without changing authored saved lang attributes',async({page})=>{
  const {frame,state}=await setup(page);
  const group=frame.locator('#proseZh .hs-table-scroll').first();
  await expect(group).toHaveAttribute('lang','zh-TW');
  await frame.locator('#langToggle').selectOption('en');
  await expect(frame.locator('#proseEn .hs-table-scroll').first()).toHaveAttribute('lang','en');
  await frame.locator('#proseEn p[contenteditable]').first().fill('English table editing draft');
  await frame.locator('#hs-adm-save').click();await expect.poll(()=>state.posts).toBe(1);
  const controls=state.submitted.html.match(/<(?:div|p)\b[^>]*class="hs-table-(?:scroll|hint)[^"]*"[^>]*>/g);
  expect(controls.length).toBeGreaterThan(0);
  for(const tag of controls)expect(tag).not.toMatch(/\slang=/);
  expect(state.submitted.html).toContain('English table editing draft');
});

const darkPilots=['lacrimal-gland-tumor','dry-eye-myths','floaters-retinal-detachment','pediatric-myopia-control','glaucoma-comprehensive-guide'];
for(const articleSlug of [...darkPilots,'dry-eye-symptom-sign-discordance-dream','thyroid-eye-disease','cataract-surgery-selection']) {
 const pilot=darkPilots.includes(articleSlug);
 for(const width of pilot?[360,390,768,1440]:[390]) {
  for(const mode of pilot?['public','editor']:['public']) test(`painted dark reading contrast: ${articleSlug}, ${mode}, ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:844});
    await page.emulateMedia({colorScheme:'dark'});
    const {state}=await setup(page,{slug:articleSlug});
    let subject=page.frames().find(f=>f.url().includes('?admin=1'));
    if(mode==='public'){await page.goto(origin+'/blog/'+articleSlug);subject=page.mainFrame();}
    // Visit reveal cards using the site's own observer. An axe full-body scan
    // can otherwise begin while an offscreen card is fading into view.
    for(const card of await subject.locator('.reveal, .article-list-item, .myth-card').all()) {
      if(!await card.isVisible())continue;
      await card.scrollIntoViewIfNeeded();
      // Authenticated source replacement can already be opaque without the
      // public observer's class. Assert the painted state in both modes.
      await expect(card).toHaveCSS('opacity','1');
      await card.evaluate(async el=>{
        await Promise.all(el.getAnimations({subtree:true}).filter(a=>a.effect&&a.timeline===document.timeline&&a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));
      });
    }
    if(mode==='public') {
      await subject.locator('#hs-related').scrollIntoViewIfNeeded();
      await expect(subject.locator('#hs-related .hs-related-grid > a').first()).toBeVisible();
    } else {
      // Existing editing chrome intentionally hides recommendations.
      await expect(subject.locator('#hs-related')).toBeHidden();
    }
    await require('../../scripts/a11y-rendering.cjs').prepareA11yPage(subject);
    await subject.evaluate(async()=>{
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      // A scroll timeline cannot finish by elapsed time. Keep its actual
      // rendering, while allowing ordinary finite transitions to settle.
      await Promise.all(document.getAnimations().filter(a=>a.effect&&a.timeline===document.timeline&&a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));
    });
    expect(await subject.evaluate(()=>document.documentElement.dataset.theme)).toBe('dark');
    await subject.evaluate(axeSource);
    const result=await subject.evaluate(()=>window.axe.run(document.body,{runOnly:{type:'rule',values:['color-contrast']}}));
    expect(result.violations).toEqual([]);
    // SVG/gradient cases axe cannot decide remain explicit manual-review
    // evidence. A passing text-contrast test is not complete WCAG approval.
    await test.info().attach('contrast-manual-review',{body:JSON.stringify(result.incomplete),contentType:'application/json'});
    expect(state.posts).toBe(0);
  });
 }
}

for(const width of [360,390]) for(const dark of [false,true]) {
 test(`opened mobile menu stays readable at ${width}px, dark=${dark}`,async({page})=>{
  await page.setViewportSize({width,height:844});await page.emulateMedia({colorScheme:dark?'dark':'light'});
  const {state}=await setup(page);await page.goto(origin+'/blog/dry-eye-myths');
  const toggle=page.locator('#hsMobileMenuBtn');await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded','true');
  await expect(page.locator('#hsMobileDrawer a').first()).toBeVisible();
  await page.evaluate(axeSource);
  const result=await page.evaluate(()=>window.axe.run(document.getElementById('hsMobileDrawer'),{runOnly:{type:'rule',values:['color-contrast']}}));
  expect(result.violations).toEqual([]);
  if(dark)await expect(toggle).toHaveCSS('color','rgb(245, 240, 230)');
  await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','false');
  expect(await page.locator('body').evaluate(el=>el.style.overflow)).toBe('');expect(state.posts).toBe(0);
 });
}

test('lazy related-heading contrast waits for the actual runtime response',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:'dark'});
 await page.goto('/blog/dry-eye-myths');
 let release;const response=new Promise(resolve=>{release=resolve});let requested=false;
 await page.route('**/assets/related.json',async route=>{requested=true;await response;await route.fulfill({json:{'dry-eye-myths':[{slug:'glaucoma-comprehensive-guide',reasons:[]},{slug:'thyroid-eye-disease',reasons:[]}]}})});
 await page.locator('#hs-related').evaluate(el=>el.replaceChildren());
 await page.evaluate(()=>DN.addRelatedArticles());
 await page.locator('#hs-related').scrollIntoViewIfNeeded();
 await expect.poll(()=>requested).toBe(true);await expect(page.locator('#hs-related-title')).toHaveCount(0);
 release();await expect(page.locator('#hs-related .hs-related-grid > a')).toHaveCount(2);
 await expect(page.locator('#hs-related .hs-related-grid > a').first()).toHaveAttribute('href','/blog/glaucoma-comprehensive-guide');
 await expect(page.locator('#hs-related-title')).toBeVisible();await page.evaluate(axeSource);
 const result=await page.evaluate(()=>window.axe.run(document.getElementById('hs-related'),{runOnly:{type:'rule',values:['color-contrast']}}));
 expect(result.violations).toEqual([]);
});

for(const dark of [false,true]) test(`editor canvas, toolbar, menu and saved status stay legible, dark=${dark}`,async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({colorScheme:dark?'dark':'light'});
  const {frame,state}=await setup(page);
  const articleFrame=page.frames().find(f=>f.url().includes('?admin=1'));
  await expect(frame.locator('.myth-card').first()).toHaveCSS('opacity','1');
  await expect(frame.locator('.myth-card').first()).toHaveCSS('animation-name','none');
  const colors=await frame.locator('body').evaluate(el=>{
    const style=getComputedStyle(el);
    return {background:style.backgroundColor,expected:style.getPropertyValue('--bg').trim(),footerOpacity:getComputedStyle(document.querySelector('.mag-footer')).opacity};
  });
  expect(colors.background).toBe(dark?'rgb(26, 24, 21)':'rgb(250, 247, 242)');
  expect(colors.footerOpacity).toBe('1');
  expect(await frame.locator('body').evaluate(()=>!!DN._adminDirty)).toBe(false);
  await articleFrame.evaluate(axeSource);
  async function contrast(selectors){
    await articleFrame.evaluate(async()=>{
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      await Promise.all([...document.getElementById('hs-admin-bar').getAnimations({subtree:true})].filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));
    });
    const result=await articleFrame.evaluate(include=>window.axe.run({include:include.map(s=>[s])},{runOnly:{type:'rule',values:['color-contrast']}}),selectors);
    expect(result.violations).toEqual([]);
  }
  await contrast(['#hs-admin-bar']);
  await frame.locator('#hs-adm-cancel').hover();await contrast(['#hs-adm-cancel']);
  await frame.locator('#hs-adm-check').hover();await contrast(['#hs-adm-check']);
  await frame.locator('#hs-adm-check').press('Tab');
  const p=frame.locator('#proseZh > p[contenteditable]').first();
  await p.fill('');await p.press('/');
  await expect(frame.locator('#hs-slash-menu')).toBeVisible();
  await contrast(['#hs-slash-menu']);
  await p.press('Escape');
  await frame.locator('#hs-adm-save').click();await expect.poll(()=>state.posts).toBe(1);
  await expect(frame.locator('#hs-admin-status')).toContainText('已保存至 GitHub');
  await contrast(['#hs-admin-bar']);
  const submitted=await page.evaluate(html=>{const doc=new DOMParser().parseFromString(html,'text/html');return{style:doc.body.getAttribute('style'),classes:doc.body.className,editorCss:!!doc.getElementById('hs-admin-css')}},state.submitted.html);
  expect(submitted.style).toBeNull();expect(submitted.classes).not.toContain('hs-admin');expect(submitted.editorCss).toBe(false);
  // Footer is content-visibility:auto; inspect its painted colors only.
  await require('../../scripts/a11y-rendering.cjs').prepareA11yPage(articleFrame);
  await contrast(['footer']);
});

test('authenticated heading replaces a stale public heading; opening the workspace does not dirty or rewrite metadata',async({page})=>{
  const {frame,state}=await setup(page,{fresh:true});
  await expect(frame.locator('h1')).toContainText('最新來源主標題');
  await expect(input(frame,'titleZh')).toHaveValue('最新來源主標題');
  expect(await frame.locator('body').evaluate(()=>!!DN._adminDirty)).toBe(false);
  await frame.locator('#hs-adm-save').click();await expect.poll(()=>state.posts).toBe(1);
  expect(state.submitted.html).not.toContain('hs-editor-metadata');
  expect(state.submitted.html).not.toContain('文章標題與搜尋摘要');
});

test('title/summary share undo, redo, version comparison and source-safe save; a second title edit uses the receipt catalog version',async({page})=>{
  const {frame,state}=await setup(page,{citation:true});
  const old=await input(frame,'titleZh').inputValue();
  const title='作者標題 <img src=x onerror=window.injected=1> & "引號"';
  await input(frame,'titleZh').fill(title);
  await input(frame,'titleZh').press('Control+z');await expect(input(frame,'titleZh')).toHaveValue(old);
  await expect(input(frame,'titleZh')).toBeFocused();
  await input(frame,'titleZh').press('Control+Shift+z');await expect(input(frame,'titleZh')).toHaveValue(title);
  const english='Author & <em>literal English title</em>';
  await input(frame,'titleEn').fill(english);
  await input(frame,'searchTitleZh').fill('作者自訂搜尋標題 | HsiaoEye');
  await input(frame,'descriptionZh').fill('作者自訂摘要，保留實際文章內容與限制。');
  await input(frame,'descriptionEn').fill('Author English summary with limitations.');
  await frame.locator('#hs-adm-compare').click();
  const comparison=frame.getByRole('region',{name:'保存前健檢與版本比較'});
  await expect(comparison).toContainText('作者自訂搜尋標題');
  await expect(comparison).toContainText('Author English summary');
  expect(await frame.locator('body').evaluate(()=>window.injected)).toBeUndefined();
  await expect(frame.locator('h1 img')).toHaveCount(0);
  await frame.locator('#hs-adm-save').click();await expect.poll(()=>state.posts).toBe(1);
  await expect(frame.locator('#hs-admin-status')).toContainText('已保存至 GitHub');
  const saved=await page.evaluate(html=>{
    const doc=new DOMParser().parseFromString(html,'text/html');
    return {meta:JSON.parse(decodeURIComponent(doc.querySelector('meta[name="hs-editor-metadata"]').content)),title:doc.title,
      canonical:doc.querySelector('link[rel="canonical"]').href, author:doc.querySelector('meta[name="author"]').content,
      zhStyle:doc.getElementById('proseZh').getAttribute('style'),enStyle:doc.getElementById('proseEn').getAttribute('style')};
  },state.submitted.html);
  expect(saved.meta.titleZh).toBe(title);expect(saved.meta.catalogBaseSha).toBe('d'.repeat(40));
  expect(saved.title).toBe('作者自訂搜尋標題 | HsiaoEye');
  expect(saved.canonical).toBe(origin+'/blog/'+slug);expect(saved.author).toContain('蕭閔謙');
  expect(state.submitted.html).toContain('"headline":"External citation title"');
  expect(state.submitted.html).toContain('"description":"External citation description"');
  expect(saved.zhStyle).toBeNull();expect(saved.enStyle).toBe('display:none');
  expect(await frame.locator('body').evaluate(()=>DN._adminDirty)).toBe(false);
  await page.getByRole('button',{name:'← 回到後台'}).click();await expect(page.locator('#edit-shell')).toBeHidden();
  await page.evaluate(s=>openEditor(s),slug);await expect(input(frame,'titleZh')).toHaveValue(title);
  await expect(frame.locator('h1')).toContainText(title);
  await frame.locator('#langToggle').selectOption('en');await expect(frame.locator('h1')).toContainText(english);
  await expect(frame.locator('h1 em,h1 img')).toHaveCount(0);
  await frame.locator('#langToggle').selectOption('zh');await expect(frame.locator('h1')).toContainText(title);
  await input(frame,'titleZh').fill('第二次標題修改');
  await frame.locator('#hs-adm-save').click();await expect.poll(()=>state.posts).toBe(2);
  expect(decodeURIComponent(state.submitted.html.match(/name="hs-editor-metadata" content="([^"]*)"/)[1])).toContain('e'.repeat(40));
});

test('normalized title and summary stay consistent in marker, source attributes, reload and language toggles',async({page})=>{
  const {frame,state}=await setup(page);
  await input(frame,'titleZh').fill('作者標題?');
  await input(frame,'searchTitleZh').fill('搜尋標題! | HsiaoEye');
  await input(frame,'descriptionZh').fill('中文摘要! 問題 1:');
  await input(frame,'descriptionEn').fill('Research study 1:');
  await expect(frame.locator('h1')).toContainText('作者標題？');
  await frame.locator('#hs-adm-save').click();await expect.poll(()=>state.posts).toBe(1);
  await expect(frame.locator('#hs-admin-status')).toContainText('已保存至 GitHub');
  await expect(input(frame,'titleZh')).toHaveValue('作者標題？');
  expect(await frame.locator('body').evaluate(()=>DN._adminDirty)).toBe(false);
  const marker=JSON.parse(decodeURIComponent(state.submitted.html.match(/name="hs-editor-metadata" content="([^"]*)"/)[1]));
  expect(marker.titleZh).toBe('作者標題？');expect(marker.descriptionZh).toBe('中文摘要！ 問題 1：');
  expect(marker.descriptionEn).toBe('Research study 1:');
  expect(state.submitted.html).toContain('data-zh="作者標題？"');
  expect(state.submitted.html).toContain('content="中文摘要！ 問題 1："');
  expect(state.submitted.html).toContain('<title>搜尋標題！ | HsiaoEye</title>');
  await page.getByRole('button',{name:'← 回到後台'}).click();await expect(page.locator('#edit-shell')).toBeHidden();
  await page.evaluate(s=>openEditor(s),slug);
  await frame.locator('#langToggle').selectOption('en');await frame.locator('#langToggle').selectOption('zh');
  await expect(frame.locator('h1')).toContainText('作者標題？');
  await expect(input(frame,'descriptionZh')).toHaveValue('中文摘要！ 問題 1：');
});

test('metadata typing never clones the full HTML document or parses page JSON-LD',async({page})=>{
  const {frame}=await setup(page);
  await input(frame,'descriptionZh').evaluate(()=>{
    const clone=Node.prototype.cloneNode,parse=JSON.parse;
    window.metadataWork={documents:0,jsonParses:0};
    Node.prototype.cloneNode=function(...args){if(this.nodeType===9||this.nodeName==='HTML')metadataWork.documents++;return clone.apply(this,args);};
    JSON.parse=function(...args){metadataWork.jsonParses++;return parse.apply(this,args);};
  });
  await input(frame,'descriptionZh').fill('作者新摘要');
  await input(frame,'titleZh').fill('作者新主標題');
  expect(await input(frame,'titleZh').evaluate(()=>window.metadataWork)).toEqual({documents:0,jsonParses:0});
});

test('close/reopen restores metadata plus both prose languages; catalog conflict preserves draft without retry',async({page})=>{
  const {frame,state}=await setup(page,{conflict:true});
  await input(frame,'titleZh').fill('草稿主標題');
  await input(frame,'descriptionEn').fill('Draft English summary');
  await frame.locator('#proseZh > p[contenteditable]').first().fill('中文草稿正文');
  await frame.locator('#langToggle').selectOption('en');
  await frame.locator('#proseEn p[contenteditable]').first().fill('English draft body');
  await frame.locator('#hs-adm-save').click();await expect.poll(()=>state.posts).toBe(1);
  await expect(frame.locator('#hs-admin-status')).toContainText('草稿與目前內容仍保留');
  await frame.locator('#hs-adm-save').click();expect(state.posts).toBe(1);
  state.catalogSha='e'.repeat(40); // Another article/catalog changed, same article blob.
  await page.getByRole('button',{name:'← 回到後台'}).click();
  await expect(page.locator('#edit-shell')).toBeHidden();
  page.once('dialog',dialog=>dialog.accept());
  await page.evaluate(s=>openEditor(s),slug);
  await expect(input(frame,'titleZh')).toHaveValue('草稿主標題');
  await expect(input(frame,'descriptionEn')).toHaveValue('Draft English summary');
  await expect(frame.locator('#proseZh')).toContainText('中文草稿正文');
  await expect(frame.locator('#proseEn')).toContainText('English draft body');
  await frame.locator('#hs-adm-save').click();await expect.poll(()=>state.posts).toBe(2);
  const recovered=JSON.parse(decodeURIComponent(state.submitted.html.match(/name="hs-editor-metadata" content="([^"]*)"/)[1]));
  expect(recovered.catalogBaseSha).toBe('d'.repeat(40));
});

for (const {width,height} of [{width:375,height:812},{width:768,height:812},{width:384,height:480}]) for(const dark of [false,true]) {
test(`writing workspace fits ${width}x${height}, dark=${dark}, keyboard reachable`,async({page})=>{
  await page.setViewportSize({width,height});
  await page.emulateMedia({colorScheme:dark?'dark':'light'});
  const {frame,state}=await setup(page);
  const workspace=frame.getByRole('region',{name:'文章標題與搜尋摘要'});
  await expect(frame.locator('html')).toHaveAttribute('data-theme',dark?'dark':'light');
  const bounds=await workspace.boundingBox();expect(bounds.width).toBeLessThanOrEqual(width);
  for(const key of ['titleZh','titleEn','searchTitleZh','descriptionZh','descriptionEn']) {
    await input(frame,key).click();await expect(input(frame,key)).toBeFocused();
  }
  if(height<600) {
    const bar=await frame.locator('#hs-admin-bar').boundingBox();
    expect(bar.height).toBeLessThanOrEqual(height*0.4+1);
    await frame.locator('#hs-adm-check').click();
    await expect(frame.getByRole('region',{name:'保存前健檢與版本比較'})).toBeVisible();
  }
  const articleFrame=page.frames().find(f=>f.url().includes('?admin=1'));
  await articleFrame.evaluate(axeSource);
  const result=await articleFrame.evaluate(()=>window.axe.run(document.getElementById('hs-editor-metadata-workspace'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
  expect(result.violations).toEqual([]);
  expect(await workspace.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  expect(state.posts).toBe(0);
});
}
