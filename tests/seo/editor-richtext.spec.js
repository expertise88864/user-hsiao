const { test, expect } = require('@playwright/test');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
test.use({ serviceWorkers:'block' });
const root=path.resolve(__dirname,'../..'), origin='https://hsiao.chendermatologist.com', slug='dry-eye-myths';
const source=readFileSync(path.join(root,'blog',slug+'.html'),'utf8');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'};
async function setup(page, html=source) {
  const { default:middleware }=await new Function('url','return import(url)')('data:text/javascript;base64,'+
    Buffer.from(readFileSync(path.join(root,'middleware.js'),'utf8')).toString('base64'));
  const state={html,sha:'a'.repeat(40),posts:0,submitted:null};
  await page.context().route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.origin!==origin)return route.fulfill({body:'',contentType:'text/javascript'});
    if(u.pathname==='/api/admin/save') {
      if(route.request().method()==='GET')return route.fulfill({json:{html:state.html,sha:state.sha}});
      state.posts++;state.submitted=route.request().postDataJSON();state.html=state.submitted.html;state.sha='b'.repeat(40);
      return route.fulfill({json:{ok:true,sha:state.sha,commit:'c'.repeat(40)}});
    }
    if(u.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{error:'isolated fixture'}});
    let file=path.resolve(root,'.'+decodeURIComponent(u.pathname));
    if(!file.startsWith(root+path.sep))return route.fulfill({status:404});
    if(!path.extname(file))file+='.html';
    if(!existsSync(file))return route.fulfill({status:404});
    const headers={};
    if(u.pathname.startsWith('/blog/')&&file.endsWith('.html'))headers['Content-Security-Policy']=middleware(new Request(u.href)).headers.get('Content-Security-Policy');
    return route.fulfill({body:readFileSync(file),contentType:mime[path.extname(file)]||'application/octet-stream',headers});
  });
  await page.goto(origin+'/admin');await page.waitForFunction(()=>typeof openEditor==='function');
  await page.evaluate(s=>openEditor(s),slug);
  const frame=page.frameLocator('#edit-iframe');await expect(frame.locator('#hs-adm-save')).toBeVisible();
  return {frame,state};
}
for (const [command,selector] of [['table','table'],['myth','.myth-card'],['redflag','.hs-redflag-box'],['tldr','.tldr'],['mermaid','pre.mermaid'],['math','p']]) {
test(`${command} insertion participates in keyboard Undo and Redo without deleting the previous paragraph`,async({page})=>{
  const {frame}=await setup(page), p=frame.locator('#proseZh > p[contenteditable]').first();
  const originalNext=await p.evaluate(el=>el.nextElementSibling?.outerHTML);
  const after=()=>p.evaluate((el,selector)=>!!el.nextElementSibling?.matches(selector),selector);
  await p.fill('保留原本作者段落');await p.press('Home');await p.press('/');await page.keyboard.type(command);
  await frame.locator(`#hs-slash-menu [data-key="${command}"]`).click();
  await expect.poll(after).toBe(true);
  await page.keyboard.press('Control+z');
  await expect(p).toHaveText('保留原本作者段落');
  await expect.poll(()=>p.evaluate(el=>el.nextElementSibling?.outerHTML)).toBe(originalNext);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(after).toBe(true);
});
}

test('bilingual table edits survive Undo/Redo, save, and reopening the saved source',async({page})=>{
  const {frame,state}=await setup(page);
  const p=frame.locator('#proseZh > p[contenteditable]').first();
  await p.press('Home');await p.press('/');await page.keyboard.type('table');
  await frame.locator('#hs-slash-menu [data-key="table"]').click();
  const cell=frame.locator('#proseZh table.dn td').first();
  await cell.fill('中文儲存格');
  await frame.locator('#langToggle').selectOption('en');
  const ep=frame.locator('#proseEn > p[contenteditable]').first();
  await ep.press('Home');await ep.press('/');await page.keyboard.type('table');
  await frame.locator('#hs-slash-menu [data-key="table"]').click();
  const ec=frame.locator('#proseEn table.dn td').first();
  await ec.fill('English cell');
  await frame.locator('#hs-adm-undo').click();await expect(ec).toHaveText('');
  await frame.locator('#hs-adm-redo').click();await expect(ec).toHaveText('English cell');
  await frame.locator('#langToggle').selectOption('zh');await expect(cell).toHaveText('中文儲存格');
  await frame.locator('#hs-adm-save').click();await expect.poll(()=>state.posts).toBe(1);
  expect(state.submitted.html).toContain('data-zh="中文儲存格"');
  expect(state.submitted.html).toContain('data-en="English cell"');
  expect(state.submitted.baseSha).toBe('a'.repeat(40));
  await page.reload();await page.waitForFunction(()=>typeof openEditor==='function');
  await page.evaluate(s=>openEditor(s),slug);await expect(cell).toHaveText('中文儲存格');
  await frame.locator('#langToggle').selectOption('en');await expect(ec).toHaveText('English cell');
});

test('saving an unrelated edit preserves literal comparisons in bilingual prose and SVG labels',async({page})=>{
  const fixture='<p id="literal-pair" data-zh="甲 &gt; 乙 &amp; 丙" data-en="A &lt; B &amp; C">甲 &gt; 乙 &amp; 丙</p><svg viewBox="0 0 120 30"><text id="literal-svg" x="0" y="20" data-zh="MD &gt; -2 dB" data-en="MD &lt; -2 dB">MD &gt; -2 dB</text></svg>';
  const html=source.replace('<div id="proseZh" class="prose">','<div id="proseZh" class="prose">'+fixture);
  const {frame,state}=await setup(page,html);
  await frame.locator('#proseZh > p[contenteditable]').nth(1).fill('另一段已修改');
  await frame.locator('#hs-adm-save').click();await expect.poll(()=>state.posts).toBe(1);
  const saved=await page.evaluate(html=>{
    const doc=new DOMParser().parseFromString(html,'text/html');
    return ['literal-pair','literal-svg'].map(id=>{const el=doc.getElementById(id);return [el.getAttribute('data-zh'),el.getAttribute('data-en')];});
  },state.submitted.html);
  expect(saved).toEqual([['甲 > 乙 & 丙','A < B & C'],['MD > -2 dB','MD < -2 dB']]);
  await page.reload();await page.waitForFunction(()=>typeof openEditor==='function');await page.evaluate(s=>openEditor(s),slug);
  await expect(frame.locator('#literal-pair')).toHaveText('甲 > 乙 & 丙');
  await expect(frame.locator('#literal-svg')).toHaveText('MD > -2 dB');
  await frame.locator('#langToggle').selectOption('en');
  await expect(frame.locator('#literal-pair')).toHaveText('A < B & C');
  await expect(frame.locator('#literal-svg')).toHaveText('MD < -2 dB');
});

test('literal tag syntax stays text after save and reopening without changing opposite-language rich text',async({page})=>{
  const html=source.replace('<div id="proseZh" class="prose">','<div id="proseZh" class="prose"><p id="literal-edit" data-zh="原文" data-en="&lt;strong&gt;Original English&lt;/strong&gt;">原文</p>');
  const {frame,state}=await setup(page,html);
  await frame.locator('#literal-edit').fill('請保留 <em>文字</em> & > 符號');
  await frame.locator('#hs-adm-save').click();await expect.poll(()=>state.posts).toBe(1);
  const saved=await page.evaluate(html=>{const el=new DOMParser().parseFromString(html,'text/html').getElementById('literal-edit');return [el.getAttribute('data-zh'),el.getAttribute('data-en'),el.hasAttribute('data-hs-text-zh'),el.hasAttribute('data-hs-text-en')];},state.submitted.html);
  expect(saved).toEqual(['請保留 <em>文字</em> & > 符號','<strong>Original English</strong>',true,false]);
  await page.reload();await page.waitForFunction(()=>typeof openEditor==='function');await page.evaluate(s=>openEditor(s),slug);
  await expect(frame.locator('#literal-edit')).toHaveText('請保留 <em>文字</em> & > 符號');
  await expect(frame.locator('#literal-edit em')).toHaveCount(0);
  await frame.locator('#langToggle').selectOption('en');
  await expect(frame.locator('#literal-edit strong')).toHaveText('Original English');
  await frame.locator('#langToggle').selectOption('zh');
  await expect(frame.locator('#literal-edit')).toHaveText('請保留 <em>文字</em> & > 符號');
});

test('literal tag text can later receive genuine rich formatting without losing it on save',async({page})=>{
  const html=source.replace('<div id="proseZh" class="prose">','<div id="proseZh" class="prose"><p id="literal-transition" data-zh="原文" data-en="English counterpart">原文</p>');
  const {frame,state}=await setup(page,html);
  const p=frame.locator('#literal-transition');
  await p.fill('保留 <em>標記字樣</em>');
  await frame.locator('#hs-adm-save').click();await expect.poll(()=>state.posts).toBe(1);
  await page.reload();await page.waitForFunction(()=>typeof openEditor==='function');await page.evaluate(s=>openEditor(s),slug);
  await expect(p).toHaveAttribute('contenteditable','true');
  await p.fill('真正粗體');await p.press('Control+a');await frame.locator('[data-cmd="bold"]').click();
  await expect(p.locator('b,strong')).toHaveText('真正粗體');
  await frame.locator('#hs-adm-save').click();await expect.poll(()=>state.posts).toBe(2);
  await page.reload();await page.waitForFunction(()=>typeof openEditor==='function');await page.evaluate(s=>openEditor(s),slug);
  await expect(p).toHaveAttribute('contenteditable','true');
  await expect(p.locator('b,strong')).toHaveText('真正粗體');
  await frame.locator('#langToggle').selectOption('en');await expect(p).toHaveText('English counterpart');
  await frame.locator('#langToggle').selectOption('zh');await expect(p.locator('b,strong')).toHaveText('真正粗體');
});

test('unsaved literal tag text remains literal across language switching',async({page})=>{
  const html=source.replace('<div id="proseZh" class="prose">','<div id="proseZh" class="prose"><p id="literal-toggle" data-zh="原文" data-en="English counterpart">原文</p>');
  const {frame}=await setup(page,html);
  const p=frame.locator('#literal-toggle');await p.fill('保留 <em>標記字樣</em>');
  await frame.locator('#langToggle').selectOption('en');await expect(p).toHaveText('English counterpart');
  await frame.locator('#langToggle').selectOption('zh');await expect(p).toHaveText('保留 <em>標記字樣</em>');
  await expect(p.locator('em')).toHaveCount(0);
});

test('new typing after Undo invalidates Redo and retains the restored caret',async({page})=>{
  const {frame}=await setup(page), p=frame.locator('#proseZh > p[contenteditable]').first();
  await expect(frame.locator('#hs-inline-toc')).toHaveCount(0);
  await p.fill('first edit');await p.press('End');await p.press('!');
  await p.press('Control+z');await expect(p).toHaveText('first edit');
  await page.keyboard.type('?');await expect(p).toHaveText('first edit?');
  await expect(frame.locator('#hs-adm-redo')).toBeDisabled();
  await p.press('Control+Shift+z');await expect(p).toHaveText('first edit?');
});

for (const rich of [false,true]) {
test(`native ${rich?'HTML':'plain text'} clipboard paste can be undone, redone and saved`,async({page})=>{
  const {frame,state}=await setup(page), p=frame.locator('#proseZh > p[contenteditable]').first();
  await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin});
  await page.evaluate(async rich=>{
    if(rich) await navigator.clipboard.write([new ClipboardItem({
      'text/html':new Blob(['<strong>Clipboard bold</strong> and <a href="https://example.com/reference">reference</a>'],{type:'text/html'}),
      'text/plain':new Blob(['Clipboard bold and reference'],{type:'text/plain'})})]);
    else await navigator.clipboard.writeText('Clipboard plain text');
  },rich);
  await p.fill('Original');await p.press('End');await p.press('Control+v');
  await expect(p).toContainText(rich?'Clipboard bold and reference':'Clipboard plain text');
  if(rich)await expect(p.locator('strong,b')).toHaveText('Clipboard bold');
  await p.press('Control+z');await expect(p).toHaveText('Original');
  await page.keyboard.press('Control+Shift+z');
  await expect(p).toContainText(rich?'Clipboard bold and reference':'Clipboard plain text');
  await frame.locator('#hs-adm-save').click();await expect.poll(()=>state.posts).toBe(1);
  expect(state.submitted.html).toContain(rich?'Clipboard bold':'Clipboard plain text');
});
}
test('paired Chinese text survives switching languages before saving',async({page})=>{
  const html=source.replace('<div id="proseZh" class="prose">','<div id="proseZh" class="prose"><p id="paired-fixture" data-zh="原中文" data-en="Original English">原中文</p>');
  const {frame,state}=await setup(page,html);
  const title=frame.locator('#paired-fixture');await title.fill('作者修改的中文段落');
  await frame.locator('#langToggle').selectOption('en');
  await frame.locator('#langToggle').selectOption('zh');
  await expect(title).toHaveText('作者修改的中文段落');
  await frame.locator('#hs-adm-save').click();await expect.poll(()=>state.posts).toBe(1);
  expect(state.submitted.html).toContain('作者修改的中文段落');
});
test('existing English body is editable and retains Chinese body on save',async({page,browser})=>{
  const {frame,state}=await setup(page);
  const english=frame.locator('#proseEn p').first();
  await frame.locator('#langToggle').selectOption('en');
  expect(await english.getAttribute('contenteditable')).toBe('true');
  await english.fill('Author English body edit');
  await frame.locator('#hs-adm-undo').click();
  await frame.locator('#hs-adm-redo').click();
  await expect(english).toHaveText('Author English body edit');
  await frame.locator('#hs-adm-save').click();await expect.poll(()=>state.posts).toBe(1);
  expect(state.submitted.html).toContain('Author English body edit');
  expect(state.submitted.html).toContain('id="proseZh"');
  expect(state.submitted.html).not.toContain('contenteditable=');
  const visibility = await page.evaluate(html => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return ['proseZh', 'proseEn'].map(id => doc.getElementById(id).getAttribute('style'));
  }, state.submitted.html);
  expect(visibility).toEqual([null, 'display:none']);
  const noJs = await browser.newContext({javaScriptEnabled:false});
  try {
    await noJs.route('**/*', route => route.fulfill({body:route.request().url() === origin+'/saved-source' ? state.submitted.html : '',contentType:'text/html'}));
    const reader = await noJs.newPage();
    await reader.goto(origin+'/saved-source');
    await expect(reader.locator('#proseZh')).toBeVisible();
    await expect(reader.locator('#proseEn')).toBeHidden();
  } finally { await noJs.close(); }
});

test('English-mode serialization preserves authored prose style attributes',async({page})=>{
  const html=source.replace('id="proseZh" class="prose"','id="proseZh" class="prose" style="color:navy"')
    .replace('id="proseEn" class="prose" style="display:none"','id="proseEn" class="prose" style="display:none;color:teal"');
  const {frame,state}=await setup(page,html);
  await frame.locator('#langToggle').selectOption('en');
  await frame.locator('#proseEn p').first().fill('Preserve original style while writing English');
  await frame.locator('#hs-adm-save').click();await expect.poll(()=>state.posts).toBe(1);
  const styles=await page.evaluate(html=>{
    const doc=new DOMParser().parseFromString(html,'text/html');
    return ['proseZh','proseEn'].map(id=>doc.getElementById(id).getAttribute('style'));
  },state.submitted.html);
  expect(styles).toEqual(['color:navy','display:none;color:teal']);
});

test('nested bilingual attributes retain their edits when a runtime widget is stripped',async({page})=>{
  const paired=(text)=>`&lt;span data-zh=&quot;Before&quot; data-en=&quot;English&quot;&gt;${text}&lt;/span&gt;`;
  const html=source.replace('<div id="proseZh" class="prose">',`<div id="proseZh" class="prose"><div id="hs-inline-toc" data-zh="runtime" data-en="runtime">runtime</div><p id="nested-pair" data-zh="${paired('Before')}" data-en="${paired('English')}"><span data-zh="Before" data-en="English">Before</span></p>`);
  const {frame,state}=await setup(page,html);
  const p=frame.locator('#nested-pair');
  await p.press('End');await page.keyboard.type(' changed');
  await frame.locator('#langToggle').selectOption('en');await frame.locator('#langToggle').selectOption('zh');
  await expect(p).toHaveText('Before changed');
  await frame.locator('#hs-adm-save').click();await expect.poll(()=>state.posts).toBe(1);
  const saved=await page.evaluate(html=>{
    const d=new DOMParser().parseFromString(html,'text/html'),p=d.querySelector('#nested-pair');
    return {html:p.getAttribute('data-zh'),child:p.querySelector('span').getAttribute('data-zh')};
  },state.submitted.html);
  expect(saved.html).toContain('changed');expect(saved.child).toContain('changed');
  expect(saved.html).not.toContain('contenteditable');
  expect(state.submitted.html).not.toContain('id="hs-inline-toc"');
});

test('typing does not serialize the whole article repeatedly for the same input event',async({page})=>{
  const {frame}=await setup(page),p=frame.locator('#proseZh > p[contenteditable]').first();
  await p.press('End');
  await p.evaluate(el=>{
    const article=el.closest('article'),clone=Node.prototype.cloneNode;
    const html=Object.getOwnPropertyDescriptor(Element.prototype,'outerHTML');
    window.inputWork={clones:0,serializations:0};
    Node.prototype.cloneNode=function(...args){if(this===article)inputWork.clones++;return clone.apply(this,args);};
    Object.defineProperty(Element.prototype,'outerHTML',{...html,get(){
      if(this.matches('article.max-w-3xl'))inputWork.serializations++;
      return html.get.call(this);
    }});
  });
  await p.press('!');
  const work=await p.evaluate(()=>window.inputWork);
  expect(work.clones).toBeLessThanOrEqual(2);
  expect(work.serializations).toBe(1);
});

test('Undo into a shorter translated paired value puts the fallback caret at its end',async({page})=>{
  const html=await page.evaluate(source=>{
    const d=new DOMParser().parseFromString(source,'text/html');d.querySelector('#proseEn').remove();
    const p=d.createElement('p');p.id='cross-language';p.setAttribute('data-zh','很長的中文原始段落');p.setAttribute('data-en','Short');
    p.textContent='很長的中文原始段落';d.querySelector('#proseZh').prepend(p);
    return '<!doctype html>'+d.documentElement.outerHTML;
  },source);
  const {frame}=await setup(page,html),p=frame.locator('#cross-language');
  await p.fill('更長的中文作者修改段落');await p.press('End');await p.press('!');
  await frame.locator('#langToggle').selectOption('en');await expect(p).toHaveText('Short');
  await p.focus();await p.press('Control+z');await page.keyboard.type('?');
  await expect(p).toHaveText('Short?');
});

test('font-size DOM formatting follows the same Undo/Redo history as typing',async({page})=>{
  const {frame}=await setup(page), p=frame.locator('#proseZh > p[contenteditable]').first();
  await p.fill('Formatting example');await p.press('Control+a');
  await frame.locator('#hs-adm-size').selectOption('20px');
  await expect(p.locator('span[style*="font-size"]')).toHaveText('Formatting example');
  await frame.locator('#hs-adm-undo').click();await expect(p).toHaveText('Formatting example');
  await expect(p.locator('span[style*="font-size"]')).toHaveCount(0);
  await frame.locator('#hs-adm-redo').click();await expect(p.locator('span[style*="font-size"]')).toHaveText('Formatting example');
});
