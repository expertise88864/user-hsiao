const {test,expect}=require('@playwright/test');
for(const js of [false,true])for(const scheme of ['light','dark'])for(const width of [360,390,641,720])for(const language of ['zh','en'])for(const slug of ['refractory-noninfectious-uveitis-biologics-rubi-trial','osa-amd-systematic-review-2026','glaucoma-comprehensive-guide']){
  test(`keyboard table reading ${slug} ${language} ${width} ${scheme} js=${js}`,async({browser,baseURL})=>{
    const context=await browser.newContext({baseURL,viewport:{width,height:844},javaScriptEnabled:js,colorScheme:scheme,serviceWorkers:'block',reducedMotion:'reduce'});
    try{
      await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(baseURL).origin?r.continue():r.abort());
      const page=await context.newPage();await page.goto((language==='en'?'/en':'')+'/blog/'+slug);
      if(js)await page.waitForFunction(()=>document.getElementById('hs-font-size-style'));
      const visible=page.locator('.hs-table-scroll:visible');
      await expect(visible.first()).toBeVisible();
      const wide=visible.filter({has:page.locator('thead tr th:nth-child(4)')}).first();
      await expect(wide).toBeVisible();await wide.scrollIntoViewIfNeeded();
      await expect(wide.locator('xpath=preceding-sibling::p')).toBeVisible();
      const table=wide.locator('table');await expect(table).toHaveRole('table');
      const original=await table.innerText();
      await wide.press('ArrowRight');
      if(await wide.evaluate(el=>el.scrollWidth>el.clientWidth)){
        await expect.poll(()=>wide.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
        const atRight=await wide.evaluate(el=>el.scrollLeft);
        await wide.press('ArrowLeft');
        await expect.poll(()=>wide.evaluate(el=>el.scrollLeft)).toBeLessThan(atRight);
      }
      expect(await table.innerText()).toBe(original);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      await expect(wide).toHaveAccessibleName(language==='en'?/Scroll horizontally/:/資料表可左右捲動/);
      expect(await wide.evaluate(el=>el.closest('[lang]').lang)).toMatch(language==='en'?/^en(?:-|$)/:/^zh(?:-|$)/);
      expect(await wide.evaluate(el=>el.contains(document.activeElement)||el===document.activeElement)).toBe(true);
    }finally{await context.close();}
  });
}
