// CI-only, isolated font experiment. Run AFTER Lighthouse, in a separate browser.
// Never export author text, HTML, cookies, storage, request headers or traces.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {targetUrl, previewCookies, verifyRuntimeIdentity, PRODUCTION} = require('./preview-access.cjs');
const {collectFixedFallbackGlyphs} = require('./font-environment.cjs');

// Prior heading, Latin and CJK-pitch variants did not remove summary wrapping.
// Test a bounded excerpt only in the disposable diagnostic context. The article
// index's current 1.75 line-height makes 5.25em three lines; author text and links
// remain unchanged. This is not a product style or approval to publish it.
const SUMMARY_EXCERPT = '.al-body p{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;min-height:5.25em;max-height:5.25em}';
const VARIANTS = Object.freeze([
  {name:'control',css:''},
  {name:'index-three-line-excerpt',css:SUMMARY_EXCERPT},
]);
const VIEWPORTS = Object.freeze([{width:390,height:844},{width:800,height:600},{width:1350,height:940}]);
const REPETITIONS = Object.freeze([1,2]);

function requestPolicy(value, method, origin) {
  let url;
  try { url = new URL(value); } catch { return 'block'; }
  if (!['GET','HEAD'].includes(method) || url.username || url.password) return 'block';
  if (url.protocol === 'https:' && !url.port && url.hostname === 'fonts.googleapis.com') return 'font-css';
  if (url.protocol === 'https:' && !url.port && url.hostname === 'fonts.gstatic.com') return 'font-data';
  if (url.origin !== origin) return 'block';
  // Do not read or write reader/admin API endpoints or follow speculative pages.
  if (url.pathname === '/blog' || url.pathname === '/blog/' || url.pathname === '/blog/index.html' ||
      url.pathname === '/blog/blog-shared.min.js' || url.pathname === '/blog/blog-shared.js' ||
      /^\/assets\/[A-Za-z0-9_./-]+$/.test(url.pathname)) return 'site';
  return 'block';
}

function checkConfig(env) {
  const base = targetUrl(env.SITE_URL);
  assert.notEqual(base.origin, PRODUCTION, 'Controlled font experiment requires a candidate Preview');
  assert.match(env.CANDIDATE_SHA || '', /^[a-f0-9]{40}$/, 'Exact candidate SHA required');
  assert.equal(env.GITHUB_REPOSITORY, 'expertise88864/user-hsiao', 'Unexpected candidate repository');
  assert.ok(env.CHROME_PATH && path.isAbsolute(env.CHROME_PATH), 'Chrome executable path required');
  return {base,sha:env.CANDIDATE_SHA,repository:env.GITHUB_REPOSITORY,chrome:env.CHROME_PATH};
}

function checkPageUrl(value, origin) {
  const current = new URL(value);
  assert.equal(current.origin,origin,'Article index changed deployment');
  assert.ok(['/blog','/blog/'].includes(current.pathname) && !current.search && !current.hash,
    'Article index changed route');
}

async function geometry(page) {
  return page.evaluate(() => {
    const rect = element => {
      const r = element.getBoundingClientRect(), style = getComputedStyle(element);
      return {x:r.x,y:r.y,width:r.width,height:r.height,fontSize:style.fontSize,
        lineHeight:style.lineHeight,fontFamily:style.fontFamily,fontSizeAdjust:style.fontSizeAdjust};
    };
    const cards = [...document.querySelectorAll('.article-list-item')].slice(0,3);
    if (!document.querySelector('main h1') || !document.querySelector('main > section > p') || cards.length !== 3) {
      throw Error('Expected article index geometry unavailable');
    }
    return {fontStatus:document.fonts.status,telemetryAllowed:window.DN?.telemetryAllowed(),
      language:document.documentElement.lang,fontSizeAdjustSupported:CSS.supports('font-size-adjust','ic-width 1'),viewport:{width:innerWidth,height:innerHeight},
      scrollWidth:document.documentElement.scrollWidth,
      hero:rect(document.querySelector('main > section')),
      h1:rect(document.querySelector('main h1')),
      intro:rect(document.querySelector('main > section > p')),
      cards:cards.map(element => ({card:rect(element),heading:rect(element.querySelector('h3')),summary:rect(element.querySelector('p'))}))};
  });
}

async function selectedFonts(page) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const {root} = await session.send('DOM.getDocument');
    const rows = [];
    for (const selector of ['main h1','main > section > p','.article-list-item h3','.article-list-item p']) {
      const {nodeId} = await session.send('DOM.querySelector',{nodeId:root.nodeId,selector});
      if (!nodeId) throw Error('Font target missing');
      const {nodeIds} = await session.send('DOM.querySelectorAll',{nodeId,selector:'*'});
      const selected = new Map();
      for (const id of [nodeId,...nodeIds]) {
        const {fonts} = await session.send('CSS.getPlatformFontsForNode',{nodeId:id});
        for (const {familyName,postScriptName,isCustomFont,glyphCount} of fonts) {
          const key = JSON.stringify([familyName,postScriptName,isCustomFont]);
          const prior = selected.get(key);
          if (!prior || glyphCount > prior.glyphCount) selected.set(key,{familyName,postScriptName,isCustomFont,glyphCount});
        }
      }
      if (!selected.size) throw Error('Font selection unavailable');
      rows.push({selector,fonts:[...selected.values()],glyphCountScope:'maximum per direct-text element; not a total'});
    }
    return rows;
  } finally { await session.detach(); }
}

function checkPhase(sample, fonts, phase) {
  assert.equal(sample.telemetryAllowed, false, 'Reader telemetry must be excluded');
  assert.ok(/^zh\b/.test(sample.language), 'Expected Chinese index');
  const webFonts = fonts.flatMap(row => row.fonts).filter(font => font.isCustomFont);
  if (phase === 'before') {
    assert.ok(!webFonts.some(font => /^(Inter|Noto|Fraunces)/.test(font.familyName)), 'Web font loaded before controlled release');
  } else {
    assert.equal(sample.fontStatus, 'loaded', 'Incomplete font loading');
    assert.ok(webFonts.some(font => /^Noto/.test(font.familyName)), 'Requested CJK web font not rendered');
  }
}

async function runProbe(browser, base, viewport, variant, cookies) {
  // CSP bypass is confined to this disposable diagnostic context, allowing the
  // experimental style. Production CSP checks and website headers are unchanged.
  const context = await browser.newContext({viewport,locale:'zh-TW',serviceWorkers:'block',reducedMotion:'reduce',bypassCSP:true});
  let releaseFonts;
  const held = new Promise(resolve => { releaseFonts = resolve; });
  const failures = [];
  let stage = 'navigation';
  try {
    if (cookies.length) await context.addCookies(cookies);
    await context.route('**/*',async route => {
      const policy = requestPolicy(route.request().url(),route.request().method(),base.origin);
      if (policy === 'font-css') await held;
      return policy === 'block' ? route.abort() : route.continue();
    });
    await context.addInitScript(css => {
      document.addEventListener('DOMContentLoaded',() => {
        const style = document.createElement('style');
        style.id = 'hs-ci-external-font-prototype';
        style.textContent = css;
        document.head.appendChild(style);
      },{once:true});
    },variant.css);
    const page = await context.newPage();
    page.on('requestfailed',req => {
      const policy = requestPolicy(req.url(),req.method(),base.origin);
      if (policy === 'font-css' || policy === 'font-data') failures.push({type:req.resourceType(),reason:req.failure()?.errorText});
    });
    const response = await page.goto(new URL('/blog/',base).href,{waitUntil:'domcontentloaded',timeout:30000});
    assert.equal(response?.status(),200,'Article index must return HTTP200');
    checkPageUrl(page.url(),base.origin);
    stage = 'before-fonts';
    await page.waitForFunction(() => typeof window.DN?.telemetryAllowed === 'function' &&
      document.querySelector('#hs-blog-filter')?.dataset.filterReady === '1',{},{timeout:10000});
    // Finish only the local fallback faces; Google CSS is still held. Filter
    // initialization must not be mistaken for a font-caused geometry change.
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const before = await geometry(page), beforeFonts = await selectedFonts(page);
    const fixedFallbackGlyphs = await collectFixedFallbackGlyphs(page);
    checkPhase(before,beforeFonts,'before');
    releaseFonts();
    stage = 'font-completion';
    // load/ready alone can resolve before the asynchronous stylesheet registers.
    await page.waitForFunction(() => [...document.fonts].some(font => font.family === 'Inter' && font.weight === '600'),{},{timeout:30000});
    await page.evaluate(async () => {
      await document.fonts.load('600 16px Inter','Ophthalmology articles');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const after = await geometry(page), afterFonts = await selectedFonts(page);
    stage = 'after-fonts';
    checkPhase(after,afterFonts,'after');
    assert.ok(!failures.some(failure => failure.type === 'font'),'Web font request failed');
    return {viewport,variant:variant.name,before,beforeFonts,after,afterFonts,fixedFallbackGlyphs,observedFontFailures:failures,
      deltas:{heroHeight:after.hero.height-before.hero.height,introHeight:after.intro.height-before.intro.height,
        cardY:after.cards.map((item,i)=>item.card.y-before.cards[i].card.y),
        cardHeight:after.cards.map((item,i)=>item.card.height-before.cards[i].card.height),
        headingHeight:after.cards.map((item,i)=>item.heading.height-before.cards[i].heading.height)}};
  } catch {
    const error = Error('Controlled font probe failed');
    error.probeStage = stage;
    error.probeVariant = variant.name;
    error.probeViewport = viewport;
    throw error;
  } finally {
    releaseFonts();
    await context.close();
  }
}

async function main() {
  // Offline delivery contract tests import only the dependency-free guards.
  const {chromium, request} = require('playwright');
  const {base,sha,repository,chrome} = checkConfig(process.env);
  const cookies = await previewCookies(base.href,request);
  const client = await request.newContext({storageState:{cookies,origins:[]}});
  let identity;
  try { identity = await verifyRuntimeIdentity(client,base.href,sha,repository); }
  finally { await client.dispose(); }
  const browser = await chromium.launch({executablePath:chrome,headless:true});
  const rows = [];
  try {
    for (const viewport of VIEWPORTS) for (const repetition of REPETITIONS) for (const variant of VARIANTS) {
      rows.push({...await runProbe(browser,base,viewport,variant,cookies),repetition});
    }
    assert.equal(rows.length,12,'Complete controlled matrix required');
    assert.equal(new Set(rows.map(row => row.viewport.width + ':' + row.variant + ':' + row.repetition)).size,12,'Repeated controlled matrix must be distinct');
    const report = {schemaVersion:3,phase:'controlled-index-font-experiment',sha,identity,
      checkedAt:new Date().toISOString(),platform:process.platform,browser:browser.version(),route:'/blog/',
      scope:'Separate browser after Lighthouse. Hold/release Google Fonts CSS; three viewports, control/three-line summary excerpt, two repetitions each. Author text and article links are unchanged; excerpt CSS exists only in this diagnostic context. Fixed system-glyph raster equality and numeric geometry/font selection only; not cmap certification, Lighthouse CLS, production CSP validation, Ubuntu PNG approval, field metrics or CTR. Schema1 used four variants without repetition; schema2 used control/intro-summary pitch. Preserve those historical results and compare named controls, not pooled experiments.',
      diagnosticCSPBypass:true,rows};
    const dir = path.resolve('font-layout-experiment-results');
    fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'index-font-experiment-' + sha + '.json'),JSON.stringify(report,null,2),{flag:'wx'});
    console.log('Controlled index font experiment completed: 12 probes, exact candidate SHA.');
  } finally { await browser.close(); }
}

module.exports = {requestPolicy,checkConfig,checkPageUrl,checkPhase,runProbe,VARIANTS,VIEWPORTS,REPETITIONS};
if (require.main === module) main().catch(error => {
  // Never echo a network error carrying authentication material or page content.
  console.error(JSON.stringify({status:'controlled-font-experiment-failed',completeReport:false,
    stage:error.probeStage || 'configuration-identity-or-report',variant:error.probeVariant,viewport:error.probeViewport}));
  process.exitCode = 1;
});
