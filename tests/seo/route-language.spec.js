const {test,expect}=require('@playwright/test');
test.use({serviceWorkers:'block'});

async function expectLanguage(page,lang){
 await expect(page.locator('html')).toHaveAttribute('lang',lang==='en'?'en':'zh-TW');
 await expect(page.locator('#langToggle')).toHaveValue(lang);
 const translated=page.locator('main h1 [data-zh][data-en]');
 const heading=await translated.count()?translated.first():page.locator('main h1');
 const expected=await heading.getAttribute('data-'+lang);
 expect(expected).toBeTruthy();await expect(heading).toHaveText(expected);
}

for(const locale of ['en-US','zh-TW'])for(const prefix of ['', '/en']){
 const lang=prefix?'en':'zh';
 for(const route of ['/blog','/blog/glaucoma-comprehensive-guide']){
  test(`fresh ${locale} visit to ${prefix+route} uses route language`,async({browser,baseURL})=>{
   const context=await browser.newContext({locale,serviceWorkers:'block'});
   try{
    const page=await context.newPage();await page.goto(baseURL+prefix+route);
    await expectLanguage(page,lang);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href','https://hsiao.chendermatologist.com'+prefix+route);
    if(!prefix){
     expect(await page.evaluate(()=>localStorage.getItem('hs_lang'))).toBeNull();
     expect((await context.cookies()).filter(c=>c.name==='hs_lang')).toEqual([]);
    }
   }finally{await context.close();}
  });
 }
}

for(const prefix of ['', '/en']){
 test(`native ${prefix||'Chinese'} route remains readable without JavaScript`,async({browser,baseURL})=>{
  const context=await browser.newContext({locale:prefix?'zh-TW':'en-US',javaScriptEnabled:false,serviceWorkers:'block'});
  try{
   const page=await context.newPage();await page.goto(baseURL+prefix+'/blog/glaucoma-comprehensive-guide');
   const span=page.locator('main h1 [data-zh][data-en]').first();
   await expect(span).toHaveText(await span.getAttribute('data-'+(prefix?'en':'zh')));
   await expect(page.locator('html')).toHaveAttribute('lang',prefix?'en':'zh-Hant-TW');
  }finally{await context.close();}
 });
}

test('saved preference and manual toggle still override Chinese route default',async({page})=>{
 await page.goto('/blog/glaucoma-comprehensive-guide');await expectLanguage(page,'zh');
 await page.locator('#langToggle').selectOption('en');await expectLanguage(page,'en');
 await page.reload();await expectLanguage(page,'en');
 await page.goto('/blog');await expectLanguage(page,'en');
 await page.locator('#langToggle').selectOption('zh');await expectLanguage(page,'zh');
 await page.reload();await expectLanguage(page,'zh');
});

test('valid cookie remains ahead of valid local storage',async({page,context,baseURL})=>{
 await page.goto('/blog');await page.evaluate(()=>localStorage.setItem('hs_lang','en'));
 await context.addCookies([{name:'hs_lang',value:'zh',url:baseURL}]);
 await page.reload();await expectLanguage(page,'zh');
 await context.clearCookies();await page.reload();await expectLanguage(page,'en');
});

test('invalid preferences and unavailable local storage preserve Chinese default in English browser',async({browser,baseURL})=>{
 const context=await browser.newContext({locale:'en-US',serviceWorkers:'block'});
 try{
  const page=await context.newPage();await page.goto(baseURL+'/blog');
  await page.evaluate(()=>localStorage.setItem('hs_lang','unsupported'));
  await context.addCookies([{name:'hs_lang',value:'unsupported',url:baseURL}]);
  await page.reload();await expectLanguage(page,'zh');
  await page.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Disabled','SecurityError');}}));
  await page.reload();await expectLanguage(page,'zh');
  await page.goto(baseURL+'/en/blog');await expectLanguage(page,'en');
 }finally{await context.close();}
});
