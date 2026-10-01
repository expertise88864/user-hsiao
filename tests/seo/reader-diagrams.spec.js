const {test,expect,chromium}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const slugs=['refractory-noninfectious-uveitis-biologics-rubi-trial','lacrimal-gland-tumor','dry-eye-myths'];
for(const slug of slugs)for(const width of [360,390,768,1440])for(const js of [false,true])for(const scheme of ['light','dark'])for(const language of ['zh','en']){
 test(`diagram keyboard ${slug} ${language} ${width} ${scheme} js=${js}`,async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,viewport:{width,height:900},javaScriptEnabled:js,colorScheme:scheme,serviceWorkers:'block',reducedMotion:'reduce'});
  try{
   await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(baseURL).origin?route.continue():route.abort());
   const page=await context.newPage();await page.goto((language==='en'?'/en':'')+'/blog/'+slug);
   if(js)await page.waitForFunction(()=>window.DN&&typeof window.DN.telemetryAllowed==='function');
   const regions=page.locator('.hs-diagram-scroll:visible');expect(await regions.count()).toBeGreaterThan(0);
   for(const region of await regions.all()){
    const mode=region.locator('xpath=preceding-sibling::details'),summary=mode.locator('summary'),svg=region.locator('svg').first();
    await expect(summary).toHaveText(language==='en'?'Enlarge diagram':'放大圖表');
    await expect(region).toHaveAccessibleName(language==='en'?'Enlarge diagram':'放大圖表');
    const before=await svg.evaluate(el=>el.outerHTML);
    await summary.press('Enter');await expect(mode).toHaveAttribute('open','');
    const labels=await svg.evaluate(el=>[...el.querySelectorAll('text')].filter(t=>t.getClientRects().length).map(t=>{const m=t.getScreenCTM();return parseFloat(getComputedStyle(t).fontSize)*Math.hypot(m.a,m.b)}));
    expect(labels.length).toBeGreaterThan(0);expect(Math.min(...labels)).toBeGreaterThanOrEqual(12);
    await region.press('ArrowRight');
    if(await region.evaluate(el=>el.scrollWidth>el.clientWidth+1))await expect.poll(()=>region.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
    await region.press('ArrowDown');
    if(await region.evaluate(el=>el.scrollHeight>el.clientHeight+1))await expect.poll(()=>region.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    expect(await region.evaluate(el=>document.activeElement===el)).toBe(true);
    await region.press('Shift+Tab');
    await expect.poll(()=>summary.evaluate(el=>{
      const box=el.getBoundingClientRect();
      return document.activeElement===el && el.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));
    })).toBe(true);
    await summary.press('Enter');await expect(mode).not.toHaveAttribute('open');
    expect(await svg.evaluate(el=>el.outerHTML)).toBe(before);
   }
  }finally{await context.close();}
 });
}
for(const slug of slugs)for(const windowWidth of [768,1440])for(const js of [false,true]){
 test(`native 200% diagram focus returns visibly ${slug} ${windowWidth} js=${js}`,async({baseURL})=>{
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'hsiaoeye-native-zoom-'));
  fs.mkdirSync(path.join(profile,'Default'));
  fs.writeFileSync(path.join(profile,'Default/Preferences'),JSON.stringify({partition:{default_zoom_level:{x:Math.log(2)/Math.log(1.2)}}}));
  let context;
  try{
   context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:null,deviceScaleFactor:undefined,isMobile:undefined,javaScriptEnabled:js,serviceWorkers:'block',reducedMotion:'reduce',args:['--window-size='+windowWidth+',1000']});
   await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(baseURL).origin?route.continue():route.abort());
   const page=await context.newPage();await page.goto(baseURL+'/blog/'+slug);
   if(js)await page.waitForFunction(()=>window.DN&&typeof window.DN.telemetryAllowed==='function');
   const cdp=await context.newCDPSession(page),layout=await cdp.send('Page.getLayoutMetrics');
   expect(layout.cssVisualViewport.zoom).toBe(2);expect(layout.cssVisualViewport.scale).toBe(1);
   await cdp.detach();
   const regions=page.locator('.hs-diagram-scroll:visible');expect(await regions.count()).toBeGreaterThan(0);
   for(const region of await regions.all()){
    const mode=region.locator('xpath=preceding-sibling::details'),summary=mode.locator('summary');
    await summary.press('Enter');await expect(mode).toHaveAttribute('open','');
    await region.press('ArrowRight');await region.press('ArrowDown');await region.press('Shift+Tab');
    await expect.poll(()=>summary.evaluate(el=>{
      const box=el.getBoundingClientRect();
      return document.activeElement===el && el.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));
    })).toBe(true);
    await summary.press('Enter');await expect(mode).not.toHaveAttribute('open');
   }
  }finally{
   if(context)await context.close();
   const resolved=path.resolve(profile),tempRoot=path.resolve(os.tmpdir())+path.sep;
   if(!resolved.startsWith(tempRoot)||!path.basename(resolved).startsWith('hsiaoeye-native-zoom-'))throw Error('Unsafe test profile cleanup');
   fs.rmSync(resolved,{recursive:true,force:true});
  }
 });
}
