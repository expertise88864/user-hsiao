const {test,expect,chromium} = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname,'../..');
const origin = 'https://hsiao.chendermatologist.com', slug = 'dry-eye-myths';
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'};
test.use({serviceWorkers:'block'});

async function setup(page,{touch=false,saveFailure=false}={}) {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const {default:middleware} = await new Function('url','return import(url)')('data:text/javascript;base64,'+
    Buffer.from(fs.readFileSync(path.join(root,'middleware.js'),'utf8')).toString('base64'));
  const state = {html:fs.readFileSync(path.join(root,'blog',slug+'.html'),'utf8'),sha:'a'.repeat(40),posts:0,submitted:null};
  await page.context().route('**/*',async route=>{
    const url = new URL(route.request().url());
    if(url.origin!==origin)return route.fulfill({body:'',contentType:'text/javascript'});
    if(url.pathname==='/api/admin/save') {
      if(route.request().method()==='GET')return route.fulfill({json:{html:state.html,sha:state.sha}});
      state.posts++;state.submitted=route.request().postDataJSON();
      expect(state.submitted.baseSha).toBe(state.sha);
      if(saveFailure)return route.fulfill({status:503,json:{error:'isolated save failure'}});
      state.html=state.submitted.html;state.sha='b'.repeat(40);
      return route.fulfill({json:{ok:true,sha:state.sha,commit:'c'.repeat(40)}});
    }
    if(url.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{error:'isolated writing fixture'}});
    let file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(root+path.sep))return route.fulfill({status:404});
    if(!path.extname(file))file+='.html';
    if(!fs.existsSync(file))return route.fulfill({status:404});
    const headers={};
    if(url.pathname.startsWith('/blog/')&&file.endsWith('.html'))headers['Content-Security-Policy']=middleware(new Request(url.href)).headers.get('Content-Security-Policy');
    return route.fulfill({body:fs.readFileSync(file),contentType:mime[path.extname(file)]||'application/octet-stream',headers});
  });
  await page.goto(origin+'/admin');await page.waitForFunction(()=>typeof openEditor==='function');
  await page.evaluate(s=>openEditor(s),slug);
  // Pure touch devices intentionally use the full-page editor, not an iframe.
  if(touch)await page.waitForURL(origin+'/blog/'+slug+'?admin=1');
  const frame=touch?page:page.frameLocator('#edit-iframe');
  try { await expect(frame.locator('#hs-adm-save')).toBeVisible(); }
  catch(error) { throw Error(error.message+'; isolated page errors: '+JSON.stringify(errors)); }
  return {frame,state};
}

async function usable(frame) {
  const geometry=await frame.locator('#hs-admin-bar').evaluate(bar=>({
    overflow:document.documentElement.scrollWidth>innerWidth,
    toolbarHeight:bar.getBoundingClientRect().height,
    padding:parseFloat(getComputedStyle(document.body).paddingBottom),
    heights:[...bar.querySelectorAll('button,select,summary')].filter(el=>el.getBoundingClientRect().height>0).map(el=>el.getBoundingClientRect().height),
  }));
  expect(geometry.overflow).toBe(false);
  expect(geometry.heights.every(height=>height>=44)).toBe(true);
  await expect.poll(()=>frame.locator('body').evaluate(body=>parseFloat(getComputedStyle(body).paddingBottom)-
    document.querySelector('#hs-admin-bar').getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
}

for(const width of [360,390,768,1440]) for(const dark of [false,true]) {
  test(`writing actions remain reachable with collapsed advanced tools at ${width}, dark=${dark}`,async({page})=>{
    await page.setViewportSize({width,height:844});await page.emulateMedia({colorScheme:dark?'dark':'light'});
    const {frame,state}=await setup(page);
    await expect(frame.locator('#hs-adm-advanced')).not.toHaveAttribute('open');
    await expect(frame.locator('#hs-adm-check')).toBeHidden();
    await expect(frame.locator('#hs-adm-save')).toHaveText('💾 儲存至 GitHub');
    await usable(frame);
    const summary=frame.locator('#hs-adm-advanced>summary');await summary.focus();await summary.press('Enter');
    await expect(frame.locator('#hs-adm-check')).toBeVisible();await expect(summary).toBeFocused();await usable(frame);
    await summary.focus();await summary.press('Space');await expect(frame.locator('#hs-adm-check')).toBeHidden();
    const p=frame.locator('#proseZh > p[contenteditable]').first();await p.fill('常用寫作操作保留作者中文。');
    await expect(frame.locator('#hs-admin-status')).toContainText('尚有未儲存至 GitHub');
    await frame.locator('#hs-adm-undo').click();await expect(p).not.toHaveText('常用寫作操作保留作者中文。');
    await frame.locator('#hs-adm-redo').click();await expect(p).toHaveText('常用寫作操作保留作者中文。');
    await frame.locator('#hs-adm-save').click();await expect.poll(()=>state.posts).toBe(1);
    await expect(frame.locator('#hs-admin-status')).toContainText('已保存至 GitHub');
    await expect(frame.locator('#hs-adm-save')).toHaveText('💾 儲存至 GitHub');
    expect(state.submitted.html).toContain('常用寫作操作保留作者中文。');
    expect(state.submitted.html).not.toContain('id="hs-adm-advanced"');
    expect(state.submitted.html).not.toContain('contenteditable=');
  });
}

test('native 200% zoom preserves writing controls and keyboard disclosure',async()=>{
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'hsiaoeye-writing-zoom-'));
  fs.mkdirSync(path.join(profile,'Default'));
  fs.writeFileSync(path.join(profile,'Default/Preferences'),JSON.stringify({partition:{default_zoom_level:{x:Math.log(2)/Math.log(1.2)}}}));
  let context;
  try {
    context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:null,deviceScaleFactor:undefined,
      isMobile:undefined,serviceWorkers:'block',args:['--window-size=1440,1000']});
    const page=await context.newPage(),{frame}=await setup(page);
    const cdp=await context.newCDPSession(page),layout=await cdp.send('Page.getLayoutMetrics');
    expect(layout.cssVisualViewport.zoom).toBe(2);expect(layout.cssVisualViewport.scale).toBe(1);await cdp.detach();
    await usable(frame);
    const summary=frame.locator('#hs-adm-advanced>summary');await summary.focus();await summary.press('Enter');
    await expect(frame.locator('#hs-adm-compare')).toBeVisible();await expect(summary).toBeFocused();await usable(frame);
  } finally {
    if(context)await context.close();
    const resolved=path.resolve(profile),tempRoot=path.resolve(os.tmpdir())+path.sep;
    if(!resolved.startsWith(tempRoot)||!path.basename(resolved).startsWith('hsiaoeye-writing-zoom-'))throw Error('Unsafe test profile cleanup');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
});

test('keyboard disclosure preserves selected author text for font formatting',async({page})=>{
  const {frame}=await setup(page),p=frame.locator('#proseZh > p[contenteditable]').first();
  await p.fill('鍵盤選取的作者內容');await p.press('Control+a');
  const summary=frame.locator('#hs-adm-advanced>summary');await summary.focus();await summary.press('Enter');
  await expect(summary).toBeFocused();
  await frame.locator('#hs-adm-size').selectOption('20px');
  await expect(p.locator('span[style*="font-size"]')).toHaveText('鍵盤選取的作者內容');
});

test('a failed save keeps the GitHub label and local author content available',async({page})=>{
  const {frame,state}=await setup(page,{saveFailure:true}),p=frame.locator('#proseZh > p[contenteditable]').first();
  await p.fill('保存失敗仍需保留的作者段落');await frame.locator('#hs-adm-save').click();
  await expect.poll(()=>state.posts).toBe(1);await expect(frame.locator('#hs-adm-save')).toBeEnabled();
  await expect(frame.locator('#hs-adm-save')).toHaveText('💾 儲存至 GitHub');
  await expect(frame.locator('#hs-admin-status')).not.toContainText('已保存至 GitHub');
  await expect(p).toHaveText('保存失敗仍需保留的作者段落');
  expect(await frame.locator('body').evaluate(()=>DN._adminDirty)).toBe(true);
});

test.describe('touch disclosure',()=>{
  test.use({hasTouch:true,isMobile:true,viewport:{width:390,height:844}});
  test('tapping advanced tools preserves selected author text',async({page})=>{
    const {frame}=await setup(page,{touch:true}),p=frame.locator('#proseZh > p[contenteditable]').first();
    await p.fill('觸控選取的作者內容');
    await p.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});
    await frame.locator('#hs-adm-advanced>summary').tap();
    await frame.locator('#hs-adm-size').selectOption('20px');
    await expect(p.locator('span[style*="font-size"]')).toHaveText('觸控選取的作者內容');
  });
});
