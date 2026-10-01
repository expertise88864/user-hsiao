const {test,expect}=require('@playwright/test');
const {collectFontEnvironment,PROBE_ID}=require('../../scripts/font-environment.cjs');
test.use({serviceWorkers:'block'});

test('font evidence reports real glyph selection without serializing reader data or changing cards',async({page,context,browserName})=>{
 test.skip(browserName!=='chromium','Lighthouse font diagnostics require Chromium CDP');
 await page.goto('/blog');
 await page.waitForFunction(()=>document.querySelector('#hs-blog-filter').dataset.filterReady==='1');
 await context.addCookies([{name:'diagnostic_secret',value:'private_cookie_sentinel',url:test.info().project.use.baseURL}]);
 await page.evaluate(()=>{localStorage.setItem('diagnostic-secret','private_storage_sentinel');document.querySelector('main h1').append(' private_text_sentinel');});
 const cardSnapshot=()=>page.locator('.article-list-item').evaluateAll(items=>items.map(item=>({href:item.getAttribute('href'),heading:item.querySelector('h3').textContent,body:item.querySelector('p').innerHTML})));
 const cards=await cardSnapshot();
 const session=await context.newCDPSession(page);
 try {
  const report=await collectFontEnvironment(page,session),encoded=JSON.stringify(report);
  expect(report.schemaVersion).toBe(1);expect(report.browser).toMatch(/^(?:Headless)?Chrome\/\d+/);
  expect(report.phase).toBe('before-lighthouse-navigation');
  expect(report.samples).toHaveLength(7);
  for(const sample of report.samples){expect(sample.fonts.length).toBeGreaterThan(0);expect(sample.fonts.some(font=>font.glyphCount>0)).toBe(true);expect(sample.width).toBeGreaterThan(0);}
  for(const marker of ['private_cookie_sentinel','private_storage_sentinel','private_text_sentinel'])expect(encoded).not.toContain(marker);
  expect(await cardSnapshot()).toEqual(cards);
  await expect(page.locator('#'+PROBE_ID)).toHaveCount(0);
  await expect(page.locator('#hs-blog-search')).toBeEnabled();
 }finally{await session.detach();}
});

for(const route of ['/', '/blog/dry-eye-myths', '/blog/pediatric-myopia-control', '/blog/floaters-retinal-detachment']) {
 test('font diagnostics cover the measured route '+route,async({page,context,browserName})=>{
  test.skip(browserName!=='chromium','Lighthouse font diagnostics require Chromium CDP');
  await page.goto(route);
  await page.waitForFunction(()=>!!window.DN&&!!document.querySelector('main h1'));
  const session=await context.newCDPSession(page);
  try {
   const report=await collectFontEnvironment(page,session);
   expect(report.samples.some(sample=>sample.label==='main h1')).toBe(true);
   expect(report.samples.filter(sample=>sample.label.startsWith('fallback-'))).toHaveLength(4);
   expect(report.samples.every(sample=>sample.fonts.some(font=>font.glyphCount>0))).toBe(true);
   await expect(page.locator('#'+PROBE_ID)).toHaveCount(0);
  }finally{await session.detach();}
 });
}

test('failed CDP font selection cleans up probes and preserves reading controls',async({page,context,browserName})=>{
 test.skip(browserName!=='chromium','Lighthouse font diagnostics require Chromium CDP');
 await page.goto('/blog');
 await page.waitForFunction(()=>document.querySelector('#hs-blog-filter').dataset.filterReady==='1');
 const session=await context.newCDPSession(page);
 try {
  const failed={send(command,args){if(command==='CSS.getPlatformFontsForNode')throw Error('diagnostic-font-error');return session.send(command,args);}};
  await expect(collectFontEnvironment(page,failed)).rejects.toThrow('diagnostic-font-error');
  await expect(page.locator('#'+PROBE_ID)).toHaveCount(0);
  await expect(page.locator('.article-list-item')).toHaveCount(20);
  await expect(page.locator('#hs-blog-search')).toBeEnabled();
 }finally{await session.detach();}
});

test('font diagnostics reacquire nodes after a transient empty rendered-font response',async({page,context,browserName})=>{
 test.skip(browserName!=='chromium','Lighthouse font diagnostics require Chromium CDP');
 await page.goto('/blog');
 await page.waitForFunction(()=>document.querySelector('#hs-blog-filter').dataset.filterReady==='1');
 const session=await context.newCDPSession(page);let headingReads=0,emptyHeading=true;
 try {
  const delayed={async send(command,args){
   if(command==='DOM.querySelector'&&args.selector==='main h1'){
    headingReads++;emptyHeading=headingReads===1;
    if(headingReads===2)await page.locator('main h1').evaluate(el=>{el.innerHTML='<span>Rendered diagnostic heading</span>';});
   }
   if(command==='CSS.getPlatformFontsForNode'&&emptyHeading)return {fonts:[]};
   return session.send(command,args);
  }};
  const report=await collectFontEnvironment(page,delayed);
  expect(headingReads).toBeGreaterThanOrEqual(2);
  expect(headingReads).toBeLessThanOrEqual(4);
  expect(report.samples.find(sample=>sample.label==='main h1').selectionAttempts).toBe(headingReads);
  expect(report.samples.every(sample=>sample.fonts.some(font=>font.glyphCount>0))).toBe(true);
  await expect(page.locator('#'+PROBE_ID)).toHaveCount(0);
 }finally{await session.detach();}
});

test('persistently empty font selection remains an error and removes diagnostics',async({page,context,browserName})=>{
 test.skip(browserName!=='chromium','Lighthouse font diagnostics require Chromium CDP');
 await page.goto('/blog');
 await page.waitForFunction(()=>document.querySelector('#hs-blog-filter').dataset.filterReady==='1');
 const session=await context.newCDPSession(page);let headingReads=0;
 try {
  const empty={async send(command,args){
   if(command==='DOM.querySelector'&&args.selector==='main h1')headingReads++;
   if(command==='CSS.getPlatformFontsForNode')return {fonts:[]};
   return session.send(command,args);
  }};
  await expect(collectFontEnvironment(page,empty)).rejects.toThrow('Font selection unavailable: main h1');
  expect(headingReads).toBe(4);
  await expect(page.locator('#'+PROBE_ID)).toHaveCount(0);
  await expect(page.locator('#hs-blog-search')).toBeEnabled();
 }finally{await session.detach();}
});
