const {test,expect}=require('@playwright/test');
test.use({serviceWorkers:'block'});

for(const prefix of ['', '/en']) {
 test(`native article navigation remains available without JavaScript ${prefix}`,async({browser})=>{
  const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
  try {
   const page=await context.newPage();await page.goto(test.info().project.use.baseURL+prefix+'/blog');
   await expect(page.locator('#hs-blog-filter')).toBeHidden();
   const articles=page.locator('.article-list-item');expect(await articles.count()).toBeGreaterThan(10);
   await expect(articles.first()).toBeVisible();await articles.first().click();
   await expect(page).toHaveURL(new RegExp(prefix+'/blog/[^/?]+$'));
  } finally {await context.close();}
 });

 test(`delayed enhancement retains filter nodes and native article position ${prefix}`,async({page})=>{
  let release;const gate=new Promise(r=>release=r);
  // Observe the real startup guard. Some engines have neither cache API and
  // therefore stamp the version without reloading. Never bypass the guard.
  await page.addInitScript(()=>{window.filterInitialCache={stamp:localStorage.getItem('hs:siteVer'),canReload:'serviceWorker' in navigator||'caches' in window};});
  // Isolate filter insertion from external font downloads. fonts.ready can wait
  // for document load in Firefox/WebKit, which this script gate deliberately holds.
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
  await page.route('https://fonts.gstatic.com/**',route=>route.abort());
  await page.route('**/blog/blog-shared.min.js*',async route=>{await gate;await route.continue();});
  try {
   await page.goto(prefix+'/blog',{waitUntil:'commit'});
   await page.waitForFunction(()=>{
    const source=document.querySelector('script[src*="trusted-types.js"]'),state=window.filterInitialCache;
    return source&&state&&(!state.canReload||state.stamp===new URL(source.src).searchParams.get('v'));
   });
   const search=page.locator('#hs-blog-search');await expect(search).toBeDisabled();
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const before=await page.evaluate(()=>{window.filterSearchBefore=document.querySelector('#hs-blog-search');return document.querySelector('.article-list-item').getBoundingClientRect().top;});
   release();await expect(search).toBeEnabled();
   expect(await page.evaluate(()=>window.filterSearchBefore===document.querySelector('#hs-blog-search'))).toBe(true);
   const after=await page.locator('.article-list-item').first().boundingBox();
   // Fonts/UI language may settle; the filter itself must not be inserted again.
   expect(Math.abs(after.y-before)).toBeLessThan(3);
   await search.fill(prefix?'Glaucoma':'青光眼');
   // The monitoring research article also mentions glaucoma; a tag is narrower.
   await expect(page.locator('.article-list-item:visible')).toHaveCount(3);
   const tag=page.locator('#hs-blog-filter [data-tag="青光眼"]');await tag.click();await expect(tag).toHaveAttribute('aria-pressed','true');
   await expect(page.locator('.article-list-item:visible')).toHaveCount(2);
   await page.locator('#hs-blog-filter .reset').click();await expect(search).toHaveValue('');
   await expect(tag).toHaveAttribute('aria-pressed','false');
  } finally {release();}
 });

 test(`canonical tag links retain grouping and localized labels ${prefix}`,async({page})=>{
  await page.goto(prefix+'/blog?tag='+encodeURIComponent('Pediatric myopia'));
  const tag=page.locator('#hs-blog-filter [data-tag="兒童近視"]');await expect(tag).toHaveAttribute('aria-pressed','true');
  await expect(tag.locator('span').first()).toHaveText(prefix?'Pediatric myopia':'兒童近視');
  const items=page.locator('.article-list-item:visible');expect(await items.count()).toBeGreaterThan(1);
  await expect(page).toHaveURL(/tag=%E5%85%92%E7%AB%A5%E8%BF%91%E8%A6%96/);
  await page.locator('#hs-blog-filter [data-cat="research"]').click();
  for(const item of await items.all())await expect(item).toHaveAttribute('data-cat','research');
 });
}
