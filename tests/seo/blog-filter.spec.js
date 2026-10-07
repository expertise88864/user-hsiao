const {test,expect,chromium}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
test.use({serviceWorkers:'block'});

for(const prefix of ['', '/en']) {
 test(`native article navigation remains available without JavaScript ${prefix}`,async({browser})=>{
  const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
  try {
   const page=await context.newPage();await page.goto(test.info().project.use.baseURL+prefix+'/blog');
   await expect(page.locator('#hs-blog-filter')).toBeHidden();
   await expect(page.locator('#hs-blog-search')).toHaveAttribute('placeholder',prefix?'Type to search…':'輸入關鍵字…');
   const articles=page.locator('.article-list-item');expect(await articles.count()).toBeGreaterThan(10);
   await expect(articles.first()).toBeVisible();await articles.first().click();
   await expect(page).toHaveURL(new RegExp(prefix+'/blog/[^/?]+$'));
  } finally {await context.close();}
 });

 test(`delayed enhancement retains filter nodes and native article position ${prefix}`,async({page})=>{
  let release;const gate=new Promise(r=>release=r);
  // Wait for the real guard to complete. Empty storage can now be stamped
  // without a reload; do not seed or bypass its version check.
  // Isolate filter insertion from external font downloads. fonts.ready can wait
  // for document load in Firefox/WebKit, which this script gate deliberately holds.
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
  await page.route('https://fonts.gstatic.com/**',route=>route.abort());
  await page.route('**/blog/blog-shared.min.js*',async route=>{await gate;await route.continue();});
  try {
   await page.goto(prefix+'/blog',{waitUntil:'commit'});
   await page.waitForFunction(()=>{
    const source=document.querySelector('script[src*="trusted-types.js"]');
    return source&&localStorage.getItem('hs:siteVer')===new URL(source.src).searchParams.get('v');
   });
   const search=page.locator('#hs-blog-search');await expect(search).toBeDisabled();
   await expect(search).toHaveAttribute('placeholder',prefix?'Type to search…':'輸入關鍵字…');
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const before=await page.evaluate(()=>{window.filterSearchBefore=document.querySelector('#hs-blog-search');return document.querySelector('.article-list-item').getBoundingClientRect().top;});
   release();await expect(search).toBeEnabled();
   await expect(search).toHaveAttribute('placeholder',prefix?'Type to search…':'輸入關鍵字…');
   expect(await page.evaluate(()=>window.filterSearchBefore===document.querySelector('#hs-blog-search'))).toBe(true);
   const after=await page.locator('.article-list-item').first().boundingBox();
   // Fonts/UI language may settle; the filter itself must not be inserted again.
   expect(Math.abs(after.y-before)).toBeLessThan(3);
   await search.fill(prefix?'Glaucoma':'青光眼');
   // The monitoring research article also mentions glaucoma; a tag is narrower.
   await expect(page.locator('.article-list-item:visible')).toHaveCount(3);
   await page.locator('.hs-topic-disclosure>summary').press('Enter');
   const tag=page.locator('#hs-blog-filter [data-tag="青光眼"]');await tag.click();await expect(tag).toHaveAttribute('aria-pressed','true');
   await expect(page.locator('.article-list-item:visible')).toHaveCount(2);
   await page.locator('#hs-blog-filter .reset').click();await expect(search).toHaveValue('');
   await expect(tag).toHaveAttribute('aria-pressed','false');
  } finally {release();}
 });

 test(`canonical tag links retain grouping and localized labels ${prefix}`,async({page})=>{
  await page.goto(prefix+'/blog?tag='+encodeURIComponent('Pediatric myopia'));
  const tag=page.locator('#hs-blog-filter [data-tag="兒童近視"]');await expect(tag).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.hs-topic-disclosure')).toHaveAttribute('open','');
  await page.locator('.hs-topic-disclosure>summary').press('Enter');
  await expect(tag).toBeHidden();
  const selection=page.locator('.hs-topic-selected');
  await expect(selection).toHaveText(prefix?'Selected: Pediatric myopia':'目前：兒童近視');
  await expect(tag.locator('span').first()).toHaveText(prefix?'Pediatric myopia':'兒童近視');
  const items=page.locator('.article-list-item:visible');expect(await items.count()).toBeGreaterThan(1);
  await expect(page).toHaveURL(/tag=%E5%85%92%E7%AB%A5%E8%BF%91%E8%A6%96/);
   const search=page.locator('#hs-blog-search');
   await page.locator('#langToggle').selectOption(prefix?'zh':'en');
   await expect(selection).toHaveText(prefix?'目前：兒童近視':'Selected: Pediatric myopia');
   await expect(search).toHaveAttribute('placeholder',prefix?'輸入關鍵字…':'Type to search…');
   await page.locator('#langToggle').selectOption(prefix?'en':'zh');
   await expect(search).toHaveAttribute('placeholder',prefix?'Type to search…':'輸入關鍵字…');
  await page.locator('#hs-blog-filter [data-cat="research"]').click();
  for(const item of await items.all())await expect(item).toHaveAttribute('data-cat','research');
 });
}

for(const prefix of ['', '/en'])for(const [width,scheme] of [[360,'light'],[390,'dark'],[768,'light'],[1440,'dark']]){
 test(`topic disclosure supports keyboard and readable filters ${prefix} ${width} ${scheme}`,async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,viewport:{width,height:900},colorScheme:scheme,serviceWorkers:'block',reducedMotion:'reduce'});
  try{
   await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(baseURL).origin?route.continue():route.abort());
   const page=await context.newPage();await page.goto(prefix+'/blog');
   const host=page.locator('#hs-blog-filter'),summary=host.locator('summary'),details=host.locator('details');
   await expect(host).toHaveAttribute('data-filter-ready','1');
   await expect(details).not.toHaveAttribute('open');
   await expect(summary).toHaveAccessibleName(prefix?'Browse by topic (13)':'按主題找文章 (13)');
   expect((await summary.boundingBox()).height).toBeGreaterThanOrEqual(44);
   const tag=host.locator('[data-tag="青光眼"]');await expect(tag).toBeHidden();
   await summary.press('Tab');await expect(host.locator('input[type="search"]')).toBeFocused();
   await summary.press('Enter');await expect(tag).toBeVisible();
   await tag.click();await expect(page.locator('.article-list-item:visible')).toHaveCount(2);
   await summary.press('Space');await expect(tag).toBeHidden();
   await expect(host.locator('.hs-topic-selected')).toHaveText(prefix?'Selected: Glaucoma':'目前：青光眼');
   await host.locator('.reset').click();await expect(page.locator('.article-list-item:visible')).toHaveCount(20);
   await expect(host.locator('.hs-topic-selected')).toBeHidden();
   await summary.press('Enter');
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
   const scan=await new AxeBuilder({page}).include('#hs-blog-filter').withTags(['wcag2a','wcag2aa','best-practice']).analyze();
   expect(scan.violations).toEqual([]);
  }finally{await context.close();}
 });
}

for(const prefix of ['', '/en']){
 test(`native 200% zoom retains topic keyboard controls ${prefix}`,async({baseURL})=>{
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'hsiaoeye-filter-zoom-'));
  fs.mkdirSync(path.join(profile,'Default'));
  fs.writeFileSync(path.join(profile,'Default/Preferences'),JSON.stringify({partition:{default_zoom_level:{x:Math.log(2)/Math.log(1.2)}}}));
  let context;
  try{
   context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:null,deviceScaleFactor:undefined,isMobile:undefined,serviceWorkers:'block',reducedMotion:'reduce',args:['--window-size=1440,1000']});
   await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(baseURL).origin?route.continue():route.abort());
   const page=await context.newPage();await page.goto(baseURL+prefix+'/blog');
   await expect(page.locator('#hs-blog-filter')).toHaveAttribute('data-filter-ready','1');
   const cdp=await context.newCDPSession(page),layout=await cdp.send('Page.getLayoutMetrics');
   expect(layout.cssVisualViewport.zoom).toBe(2);expect(layout.cssVisualViewport.scale).toBe(1);await cdp.detach();
   const summary=page.locator('.hs-topic-disclosure>summary');await summary.press('Enter');
   await page.locator('#hs-blog-filter [data-tag="青光眼"]').press('Enter');
   await expect(page.locator('.article-list-item:visible')).toHaveCount(2);
   await summary.focus();
   await expect.poll(()=>summary.evaluate(el=>{const box=el.getBoundingClientRect();return document.activeElement===el&&el.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));})).toBe(true);
   await summary.press('Space');await expect(page.locator('.hs-topic-selected')).toBeVisible();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }finally{
   if(context)await context.close();
   const resolved=path.resolve(profile),tempRoot=path.resolve(os.tmpdir())+path.sep;
   if(!resolved.startsWith(tempRoot)||!path.basename(resolved).startsWith('hsiaoeye-filter-zoom-'))throw Error('Unsafe test profile cleanup');
   fs.rmSync(resolved,{recursive:true,force:true});
  }
 });
}
