const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const {installStartupGeometry,readStartupGeometry,removeStartupGeometry,KEY}=require('../../scripts/startup-font-geometry.cjs');
const URL='http://127.0.0.1:43173/startup-font-geometry-fixture';
const HTML='<html><body><main><section><h1>private_text_sentinel</h1><div class="tldr">Private summary sentinel</div></section><article>Private body sentinel</article></main></body></html>';
const adapt=page=>({
 evaluateOnNewDocument:async(fn,arg)=>({identifier:await page.addInitScript(fn,arg)}),
 removeScriptToEvaluateOnNewDocument:async()=>{},
 evaluate:(...args)=>page.evaluate(...args),
});
test.use({serviceWorkers:'block'});

test('startup geometry captures real displacement without reader content or storage',async({page,context})=>{
 await page.route(URL,route=>route.fulfill({contentType:'text/html',body:HTML}));
 await context.addCookies([{name:'diagnostic-secret',value:'private_cookie_sentinel',url:URL}]);
 const adapted=adapt(page),script=await installStartupGeometry(adapted);
 await page.goto(URL);
 await page.evaluate(()=>localStorage.setItem('diagnostic-secret','private_storage_sentinel'));
 await page.waitForFunction(()=>performance.getEntriesByName('first-contentful-paint').length>0);
 await page.locator('main h1').evaluate(el=>el.style.marginBottom='120px');
 await page.waitForFunction(key=>window[key].read().events.some(e=>e.kind==='layout-shift'&&e.value>0),KEY);
 const report=await readStartupGeometry(adapted),encoded=JSON.stringify(report);
 expect(report.phase).toBe('preparation-page-startup');
 expect(report.events.some(e=>e.kind==='paint')).toBe(true);
 expect(report.events.every(e=>e.sampledAt>=e.time)).toBe(true);
 const shifts=report.events.filter(e=>e.kind==='layout-shift'&&e.value>0);
 expect(shifts.some(e=>e.sources.some(s=>s.before.y!==s.after.y))).toBe(true);
 for(const sentinel of ['private_text_sentinel','Private summary sentinel','Private body sentinel','private_cookie_sentinel','private_storage_sentinel'])expect(encoded).not.toContain(sentinel);
 await removeStartupGeometry(adapted,script);
 expect(await page.evaluate(key=>key in window,KEY)).toBe(false);
 expect(await page.locator('main h1').textContent()).toBe('private_text_sentinel');
});

test('startup collection is bounded and starts fresh after real navigation',async({page})=>{
 await page.route(URL,route=>route.fulfill({contentType:'text/html',body:HTML}));
 const adapted=adapt(page),script=await installStartupGeometry(adapted);
 await page.goto(URL);
 await page.waitForFunction(()=>performance.getEntriesByName('first-contentful-paint').length>0);
 await page.evaluate(async()=>{
  const heading=document.querySelector('main h1');
  for(let i=0;i<65;i++){
   heading.style.marginBottom=i%2?'120px':'20px';
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  }
 });
 const report=await readStartupGeometry(adapted);
 expect(report.events).toHaveLength(report.limit);expect(report.dropped).toBeGreaterThan(0);
 await page.reload();
 const fresh=await readStartupGeometry(adapted);
 expect(fresh.events.length).toBeLessThan(fresh.limit);expect(fresh.dropped).toBe(0);
 await removeStartupGeometry(adapted,script);
});

test('a real font arriving after first paint is recorded without delaying navigation',async({page})=>{
 let release,requested;
 const gate=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>requested=resolve);
 const font=fs.readFileSync(path.join(__dirname,'../../node_modules/@vercel/og/dist/Geist-Regular.ttf'));
 await page.route(URL,route=>route.fulfill({contentType:'text/html',body:HTML.replace('<body>','<head><style>@font-face{font-family:CIStartupFont;src:url(/geometryFont.ttf);font-display:swap}h1{font-family:CIStartupFont,serif}</style></head><body>')}));
 await page.route('**/geometryFont.ttf',async route=>{requested();await gate;await route.fulfill({contentType:'font/ttf',body:font});});
 const adapted=adapt(page),script=await installStartupGeometry(adapted);
 try{
  await page.goto(URL,{waitUntil:'domcontentloaded'});await seen;
  await page.waitForFunction(()=>performance.getEntriesByName('first-contentful-paint').length>0);
  const early=await readStartupGeometry(adapted);
  expect(early.events.some(e=>e.kind==='paint')).toBe(true);
  expect(early.events.some(e=>e.kind==='fonts-loading-done')).toBe(false);
  release();await page.evaluate(()=>document.fonts.ready);
  await page.waitForFunction(key=>window[key].read().events.some(e=>e.kind==='fonts-loading-done'),KEY);
  const final=await readStartupGeometry(adapted);
  expect(final.events.find(e=>e.kind==='fonts-loading-done').time).toBeGreaterThan(early.events.find(e=>e.kind==='paint').time);
 }finally{release();await removeStartupGeometry(adapted,script);}
});
