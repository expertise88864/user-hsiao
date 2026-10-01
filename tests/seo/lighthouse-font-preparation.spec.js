const {test,expect}=require('@playwright/test');
const {collectPreparedFontEnvironment}=require('../../scripts/lighthouse-setup.cjs');
const {PROBE_ID}=require('../../scripts/font-environment.cjs');
const BASE='https://lighthouse-font-fixture.vercel.app';
const HTML='<html><head><title>Public diagnostic fixture</title><link rel="canonical" href="https://hsiao.chendermatologist.com/"></head><body><main><h1>Eye education diagnostic</h1><p>Fixed public educational diagnostic content, deliberately long enough to validate a real content page.</p></main></body></html>';
test.use({serviceWorkers:'block'});

async function fixture(page,context,intercept){
 await page.route('https://*.vercel.app/**',route=>route.fulfill({contentType:'text/html',body:HTML}));
 return {
  mainFrame:()=>page.mainFrame(),on:(name,fn)=>page.on(name,fn),off:(name,fn)=>page.off(name,fn),
  goto:(url,options)=>page.goto(url,options),url:()=>page.url(),waitForFunction:(...args)=>page.waitForFunction(...args),
  evaluate:(...args)=>page.evaluate(...args),
  evaluateOnNewDocument:async(fn,arg)=>({identifier:await page.addInitScript(fn,arg)}),
  // Playwright has no removeInitScript; each test owns an isolated context.
  removeScriptToEvaluateOnNewDocument:async()=>{},
  async createCDPSession(){
   const session=await context.newCDPSession(page);
   return {detach:()=>session.detach(),send:async(command,args)=>{
    await intercept?.(command,args);
    return session.send(command,args);
   }};
  },
 };
}

async function reloadDuringEvaluation(page,url){
 const pending=page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,10000))).then(()=>null,error=>error);
 if(url)await page.goto(url);else await page.reload();
 const error=await pending;expect(error).toBeTruthy();throw error;
}

test('preparation survives an actual same-route reload and reads the final document',async({page,context,browserName})=>{
 test.skip(browserName!=='chromium','Font preparation uses Chromium CDP');
 let reloads=0;
 const adapted=await fixture(page,context,async(command)=>{
  if(command==='CSS.getPlatformFontsForNode'&&!reloads++){await reloadDuringEvaluation(page);}
 });
 const report=await collectPreparedFontEnvironment(adapted,BASE,BASE+'/');
 expect(report.preparationNavigationAttempts).toBe(2);
 expect(report.samples.every(sample=>sample.fonts.some(font=>font.glyphCount>0))).toBe(true);
 await expect(page.locator('#'+PROBE_ID)).toHaveCount(0);
});

test('destroyed-context rejection can arrive before the reload navigation notification',async({page,context,browserName})=>{
 test.skip(browserName!=='chromium','Font preparation uses Chromium CDP');
 let reloaded=false,delivered=0,seen=0;
 const timers=new Set(),listeners=new Map();
 const adapted=await fixture(page,context,async(command)=>{
  if(command==='CSS.getPlatformFontsForNode'&&!reloaded){
   reloaded=true;
   try{await reloadDuringEvaluation(page);}catch(error){expect(delivered).toBe(1);throw error;}
  }
 });
 // Deliver the real second main-frame event later than the real browser error.
 // This controls the event ordering without inventing an exception or document.
 adapted.on=(name,fn)=>{
  const wrapped=frame=>{
   if(frame===page.mainFrame()&&++seen===2){
    const timer=setTimeout(()=>{timers.delete(timer);delivered++;fn(frame);},100);
    timers.add(timer);
   }else{delivered++;fn(frame);}
  };
  listeners.set(fn,wrapped);page.on(name,wrapped);
 };
 adapted.off=(name,fn)=>{
  page.off(name,listeners.get(fn));listeners.delete(fn);
  for(const timer of timers)clearTimeout(timer);timers.clear();
 };
 const report=await collectPreparedFontEnvironment(adapted,BASE,BASE+'/');
 expect(report.preparationNavigationAttempts).toBe(2);
 expect(report.samples.every(sample=>sample.fonts.some(font=>font.glyphCount>0))).toBe(true);
 expect(listeners.size).toBe(0);expect(timers.size).toBe(0);
 await expect(page.locator('#'+PROBE_ID)).toHaveCount(0);
});

test('repeated real reloads remain bounded and fail',async({page,context,browserName})=>{
 test.skip(browserName!=='chromium','Font preparation uses Chromium CDP');
 let reloads=0;
 const adapted=await fixture(page,context,async(command)=>{
  if(command==='CSS.getPlatformFontsForNode'){reloads++;await reloadDuringEvaluation(page);}
 });
 await expect(collectPreparedFontEnvironment(adapted,BASE,BASE+'/')).rejects.toThrow('Execution context was destroyed');
 expect(reloads).toBe(3);
 await expect(page.locator('#'+PROBE_ID)).toHaveCount(0);
});

test('protocol failure without a reload is not retried',async({page,context,browserName})=>{
 test.skip(browserName!=='chromium','Font preparation uses Chromium CDP');
 let errors=0;
 const adapted=await fixture(page,context,command=>{if(command==='CSS.getPlatformFontsForNode'){errors++;throw Error('diagnostic-protocol-error');}});
 await expect(collectPreparedFontEnvironment(adapted,BASE,BASE+'/')).rejects.toThrow('diagnostic-protocol-error');
 expect(errors).toBe(1);
 await expect(page.locator('#'+PROBE_ID)).toHaveCount(0);
});

test('empty font results without an extra navigation fail rather than retry preparation',async({page,context,browserName})=>{
 test.skip(browserName!=='chromium','Font preparation uses Chromium CDP');
 const adapted=await fixture(page,context);
 let opens=0,queries=0;
 const goto=adapted.goto;adapted.goto=(...args)=>{opens++;return goto(...args);};
 adapted.createCDPSession=async()=>{
  const session=await context.newCDPSession(page);
  return {detach:()=>session.detach(),send:(command,args)=>{
   if(command==='CSS.getPlatformFontsForNode'){queries++;return Promise.resolve({fonts:[]});}
   return session.send(command,args);
  }};
 };
 await expect(collectPreparedFontEnvironment(adapted,BASE,BASE+'/')).rejects.toThrow('Font selection unavailable: main h1');
 expect(opens).toBe(1);expect(queries).toBe(4);
 await expect(page.locator('#'+PROBE_ID)).toHaveCount(0);
});

test('an off-origin navigation remains an error rather than a retry',async({page,context,browserName})=>{
 test.skip(browserName!=='chromium','Font preparation uses Chromium CDP');
 let reloads=0;
 const adapted=await fixture(page,context,async(command)=>{
  if(command==='CSS.getPlatformFontsForNode'){reloads++;await reloadDuringEvaluation(page,'https://unexpected-font-fixture.vercel.app/');}
 });
 await expect(collectPreparedFontEnvironment(adapted,BASE,BASE+'/')).rejects.toThrow('Execution context was destroyed');
 expect(reloads).toBe(1);
 await expect(page.locator('#'+PROBE_ID)).toHaveCount(0);
});
