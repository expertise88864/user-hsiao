// CI-only font diagnostics. Never read cookies, storage, HTML or author text.
// The four fallback probes use system fonts only, so collecting them does not
// request additional web fonts or change the page's own font-loading policy.
const PROBE_ID = 'lh-font-environment-probes';

// A CDP glyphCount includes rendered missing-glyph boxes. Use only seven fixed,
// public probe characters to check whether distinct CJK characters render alike.
// Equality is evidence about raster output, not a cmap/coverage certification.
async function collectFixedFallbackGlyphs(page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 96; canvas.height = 80;
    const context = canvas.getContext('2d', {willReadFrequently:true});
    if (!context) throw Error('Fixed font raster probe unavailable');
    return [['sans',"'PingFang TC','Microsoft JhengHei',system-ui,sans-serif"],['serif','Georgia,serif']].map(([kind,family]) => {
      context.font = '700 40px ' + family;
      context.textBaseline = 'alphabetic'; context.fillStyle = '#000';
      const distinct = [], advances = [];
      let everyGlyphHasInk = true;
      for (const glyph of '眼科衛教文章水') {
        context.clearRect(0,0,canvas.width,canvas.height);
        context.fillText(glyph,8,56);
        advances.push(context.measureText(glyph).width);
        const pixels = context.getImageData(0,0,canvas.width,canvas.height).data;
        if (!pixels.some((value,index) => index % 4 === 3 && value > 0)) everyGlyphHasInk = false;
        if (!distinct.some(prior => prior.every((value,index) => value === pixels[index]))) distinct.push(pixels);
      }
      return {kind,probe:'fixed-seven-CJK-v1',glyphCount:advances.length,advances,
        distinctRasterCount:distinct.length,everyGlyphHasInk,
        scope:'Fixed system-font probe only; no pixels or author text exported. Equal rasters do not certify font cmap coverage.'};
    });
  });
}

async function collectFontEnvironment(page, session) {
  let inserted = false;
  try {
    const state = await page.evaluate(id => {
      if (document.getElementById(id)) throw new Error('Font probe ID already exists');
      const selectors = ['main h1', '.article-list-item h3', 'main p'];
      const targets = selectors.filter(selector => document.querySelector(selector));
      const parent = document.createElement('div');
      parent.id = id;
      Object.assign(parent.style, {position:'fixed', left:'0', top:'-10000px', opacity:'0', pointerEvents:'none'});
      parent.setAttribute('aria-hidden','true');
      const labels = [];
      for (const [kind, family] of [['sans',"'PingFang TC','Microsoft JhengHei',system-ui,sans-serif"], ['serif','Georgia,serif']]) {
        for (const [lang,text] of [['en','Ophthalmology articles'],['zh','眼科衛教文章']]) {
          const label = kind + '-' + lang;
          const span = document.createElement('span');
          span.id = id + '-' + label;
          span.textContent = text;
          Object.assign(span.style, {display:'block', width:'max-content', fontFamily:family, fontSize:'40px', fontWeight:'700', lineHeight:'normal'});
          parent.appendChild(span);
          labels.push(label);
        }
      }
      document.body.appendChild(parent);
      const samples = [...targets.map(selector => ({label:selector,selector})), ...labels.map(label => ({label:'fallback-'+label,selector:'#'+id+'-'+label}))];
      return {locale:navigator.language, language:document.documentElement.lang, viewport:{width:innerWidth,height:innerHeight}, fontStatus:document.fonts.status,
        samples:samples.map(sample => {
          const element = document.querySelector(sample.selector),style = getComputedStyle(element),rect = element.getBoundingClientRect();
          return {...sample,fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,lineHeight:style.lineHeight,width:rect.width,height:rect.height};
        })};
    }, PROBE_ID);
    inserted = true;
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    for (const sample of state.samples) {
      let selected;
      // CDP reports direct text nodes; a heading composed entirely of spans
      // has no direct glyphs. Query descendant IDs without retrieving text or
      // HTML. Keep a union of fonts, with maximum per-element glyph counts,
      // rather than inventing an aggregate count across nested elements.
      // Immediately after load, Chromium can return an empty font list while
      // text is being rendered or replaced by the language runtime. Retry only
      // that empty result, with a bounded paint opportunity; reacquire DOM IDs
      // so a replaced heading cannot leave us querying detached descendants.
      // Protocol errors and missing nodes still fail immediately. This does
      // not wait for web-font downloads or change the site's loading policy.
      for (let attempt = 1; attempt <= 4; attempt++) {
        const {root} = await session.send('DOM.getDocument');
        const {nodeId} = await session.send('DOM.querySelector',{nodeId:root.nodeId,selector:sample.selector});
        if (!nodeId) throw new Error('Font probe node missing');
        const {nodeIds} = await session.send('DOM.querySelectorAll',{nodeId,selector:'*'});
        selected = new Map();
        for (const elementId of [nodeId,...nodeIds]) {
          const {fonts} = await session.send('CSS.getPlatformFontsForNode',{nodeId:elementId});
          if (!Array.isArray(fonts)) throw new Error('Font response invalid');
          for (const {familyName,postScriptName,isCustomFont,glyphCount} of fonts) {
            const key = JSON.stringify([familyName,postScriptName,isCustomFont]);
            const previous = selected.get(key);
            if (!previous || glyphCount > previous.glyphCount) selected.set(key,{familyName,postScriptName,isCustomFont,glyphCount});
          }
        }
        sample.selectionAttempts = attempt;
        if (selected.size || attempt === 4) break;
        await new Promise(resolve => setTimeout(resolve,50));
      }
      if (!selected.size) throw new Error('Font selection unavailable: ' + sample.label);
      sample.fonts = Array.from(selected.values());
      sample.glyphCountScope = 'maximum per direct-text element; not a total';
      delete sample.selector;
    }
    const {product} = await session.send('Browser.getVersion');
    const fixedFallbackGlyphs = await collectFixedFallbackGlyphs(page);
    return {schemaVersion:2,browser:product,phase:'before-lighthouse-navigation',...state,fixedFallbackGlyphs};
  } finally {
    if (inserted) await page.evaluate(id => document.getElementById(id)?.remove(),PROBE_ID);
  }
}

module.exports = {collectFontEnvironment,collectFixedFallbackGlyphs,PROBE_ID};
