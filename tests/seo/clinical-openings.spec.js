const {test,expect}=require('@playwright/test');
const {createHash}=require('node:crypto');
const {rows}=require('./fixtures/clinical-openings.json');

for(const row of rows) for(const lang of ['zh','en']) {
  test(`updated clinical dates agree across article metadata: ${row.slug}, ${lang}`,async({page})=>{
    await page.route('https://**/*',route=>route.abort());
    await page.goto((lang==='en'?'/en':'')+'/blog/'+row.slug+'.html');
    const metadata=await page.evaluate(()=>{
      const schemas=[...document.querySelectorAll('script[type="application/ld+json"]')]
        .flatMap(el=>{const value=JSON.parse(el.textContent);return value['@graph']||[value];});
      const types=node=>[].concat(node['@type']||[]);
      return {
        published:document.querySelector('meta[property="article:published_time"]').content,
        modified:document.querySelector('meta[property="article:modified_time"]').content,
        article:schemas.find(node=>types(node).includes('MedicalScholarlyArticle')),
        webpage:schemas.find(node=>types(node).includes('MedicalWebPage'))
      };
    });
    expect(metadata.modified).toBe('2026-10-04T00:00:00+08:00');
    expect(metadata.article.dateModified).toBe(metadata.modified.slice(0,10));
    expect(metadata.webpage.dateModified).toBe(metadata.article.dateModified);
    expect(metadata.published.slice(0,10)).toBe(metadata.article.datePublished);
    await expect(page.locator('#hs-reading-meta')).toContainText(metadata.article.dateModified);
  });
}

for(const row of rows) for(const lang of ['zh','en']) {
  test(`print research summary without scripts or opening it: ${row.slug}, ${lang}`,async({browser,baseURL})=>{
    const context=await browser.newContext({javaScriptEnabled:false});
    try {
      const page=await context.newPage();await page.goto(baseURL+(lang==='en'?'/en':'')+'/blog/'+row.slug+'.html');
      const details=page.locator('.hs-full-summary'),original=details.locator('p.tldr');
      await expect(original).toBeHidden();await expect(details).not.toHaveAttribute('open');
      await page.emulateMedia({media:'print'});
      await expect(original).toBeVisible();await expect(details.locator('summary')).toBeHidden();
      expect(await original.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThan(30);
      await expect(details).not.toHaveAttribute('open');
      await page.emulateMedia({media:'screen'});await expect(original).toBeHidden();
    } finally {await context.close();}
  });
}

for(const prefix of ['', '/en']) {
  test(`approved glaucoma ranking is grammatical in summary, body and index: ${prefix||'zh'}`,async({page})=>{
    await page.route('https://**/*',route=>route.abort());
    await page.goto(prefix+'/blog/glaucoma-comprehensive-guide.html');
    const retained=page.locator('.hs-full-summary p.tldr');
    const body=page.locator('article [data-en*="a major cause of blindness worldwide"]');
    for(const node of [retained,body]) {
      const en=await node.getAttribute('data-en');
      expect(en.replace(/<[^>]+>/g,'')).not.toContain('the a major cause');
      expect(en.replace(/<[^>]+>/g,'')).toContain('a major cause of blindness worldwide');
    }
    await page.goto(prefix+'/blog/');
    const card=page.locator('[data-en*="a major cause of blindness worldwide"]').first();
    expect((await card.getAttribute('data-en')).replace(/<[^>]+>/g,'')).not.toContain('the a major cause');
  });
}

for(const row of rows) for(const lang of ['zh','en']) {
  test(`short opening and original research summary work without scripts: ${row.slug}, ${lang}`,async({browser,baseURL})=>{
    const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
    try {
      await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(baseURL).origin?
        route.continue():route.abort());
      const page=await context.newPage();
      await page.goto(baseURL+(lang==='en'?'/en':'')+'/blog/'+row.slug+'.html');
      const opening=page.locator('.hs-patient-opening');
      await expect(opening).toBeVisible();await expect(opening).toHaveText(row[lang]);
      const details=page.locator('.hs-full-summary'), original=details.locator('p.tldr');
      await expect(details).not.toHaveAttribute('open');await expect(original).toBeHidden();
      const pair=await original.evaluate(el=>[el.getAttribute('data-zh'),el.getAttribute('data-en')]);
      expect(createHash('sha256').update(JSON.stringify(pair)).digest('hex')).toBe(row.originalPairSHA256);
      expect(await opening.evaluate(el=>el.closest('details')===null)).toBe(true);
      if(row.slug==='glaucoma-comprehensive-guide') {
        const warning=page.locator('.hs-opening-warning');await expect(warning).toBeVisible();
        await expect(warning).toContainText(lang==='zh'?'必須立刻就醫':'ophthalmic emergency');
        expect(await warning.evaluate(el=>el.closest('details')===null)).toBe(true);
      }
      await expect(page.locator('.hs-redflag-box').first()).toBeVisible();
      const summary=details.locator('summary');await summary.focus();await summary.press('Enter');
      await expect(original).toBeVisible();await expect(summary).toBeFocused();
      expect(await summary.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      await summary.press('Space');await expect(original).toBeHidden();await expect(opening).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    } finally {await context.close();}
  });
}

test('switching language preserves native disclosure and its original paired summary',async({page})=>{
  await page.route('https://**/*',route=>route.abort());
  const row=rows.find(row=>row.slug==='dry-eye-myths');
  await page.goto('/blog/'+row.slug+'.html');
  const summary=page.locator('.hs-full-summary>summary');await summary.click();
  await page.locator('select.lang-select').first().selectOption('en');
  await expect(page.locator('.hs-patient-opening')).toHaveText(row.en);
  await expect(page.locator('.hs-full-summary')).toHaveAttribute('open');
  await expect(summary).toHaveText('Full summary and research highlights');
  await page.locator('select.lang-select').first().selectOption('zh');
  await expect(page.locator('.hs-patient-opening')).toHaveText(row.zh);
  await expect(page.locator('.hs-full-summary')).toHaveAttribute('open');
  await expect(summary).toHaveText('完整摘要與研究重點');
});
