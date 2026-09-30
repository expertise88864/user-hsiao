const {test,expect}=require('@playwright/test');
test.use({serviceWorkers:'block'});
const title='<style id="catalog-style">body{color:red}</style>Research & <img id="catalog-image" src="x"> Practice';
const english='English & <em id="catalog-em">literal</em>';
test.beforeEach(async({page})=>{await page.route('https://**/*',route=>route.abort());});
test('legacy recent/popular renderer keeps catalog titles plaintext in both languages',async({page})=>{
  await page.goto('/');await page.waitForFunction(()=>window.DN?.ARTICLES?.length);
  const slug=await page.evaluate(({title,english})=>{
    // The current homepage no longer mounts these lists. Exercise the retained
    // renderer in explicit fixture mounts rather than assuming an old layout.
    for(const id of ['hs-recent-list','hs-popular-list']){
      const list=document.createElement('ul');list.id=id;document.body.appendChild(list);
    }
    const row=DN.ARTICLES.find(a=>!DN.isStub(a.slug));row.title=title;row.title_en=english;row.date='2099-01-01';
    DN.getPersonalizedPopular=()=>[row.slug];
    DN.injectSpotlight();DN._bilingualCache=null;DN.applyTextOnly('zh');return row.slug;
  },{title,english});
  const card=page.locator('#hs-recent-list a[href="/blog/'+slug+'"]');
  await expect(card).toContainText(title);
  const popular=page.locator('#hs-popular-list a[href="/blog/'+slug+'"]');
  await expect(popular).toContainText(title);
  await expect(page.locator('#catalog-style,#catalog-image,#catalog-em')).toHaveCount(0);
  await page.evaluate(()=>DN.applyTextOnly('en'));await expect(card).toContainText(english);
  await expect(popular).toContainText(english);
  await expect(page.locator('#catalog-style,#catalog-image,#catalog-em')).toHaveCount(0);
});
test('public previous/next and dynamic related catalog titles stay plaintext',async({page})=>{
  await page.goto('/blog/dry-eye-myths');await page.waitForFunction(()=>window.DN?.ARTICLES?.length);
  await page.evaluate(({title,english})=>{
    for(const row of DN.ARTICLES){row.title=title;row.title_en=english;}
    document.getElementById('hs-prevnext')?.remove();DN.injectPrevNext();
    document.getElementById('hs-related')?.replaceChildren();DN.addRelatedArticles();
  },{title,english});
  await page.locator('#hs-related').scrollIntoViewIfNeeded();
  await expect(page.locator('#hs-prevnext')).toContainText(title);
  await expect(page.locator('#hs-related')).toContainText(title);
  await expect(page.locator('#catalog-style,#catalog-image,#catalog-em')).toHaveCount(0);
  await page.evaluate(()=>{DN._bilingualCache=null;DN.applyTextOnly('en');});
  await expect(page.locator('#hs-prevnext')).toContainText(english);
  await expect(page.locator('#hs-related')).toContainText(english);
  await expect(page.locator('#catalog-style,#catalog-image,#catalog-em')).toHaveCount(0);
});
