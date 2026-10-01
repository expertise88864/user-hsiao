const { test, expect } = require('@playwright/test');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
test.use({ serviceWorkers: 'block' });
const root = path.resolve(__dirname, '../..'), slug = 'dry-eye-myths';
const origin = 'https://hsiao.chendermatologist.com';
const original = readFileSync(path.join(root, 'blog', slug + '.html'), 'utf8');
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.json':'application/json' };
async function setup(page, options = {}) {
  const { default: middleware } = await new Function('url', 'return import(url)')('data:text/javascript;base64,' +
    Buffer.from(readFileSync(path.join(root, 'middleware.js'), 'utf8')).toString('base64'));
  const state = { latest: original, sha: 'a'.repeat(40), gets: 0, posts: 0, submitted: null };
  await page.context().route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.origin !== origin) return route.fulfill({ body:'', contentType:'text/javascript' });
    if (u.pathname === '/api/admin/save') {
      if (route.request().method() === 'GET') {
        state.gets++;
        if (state.gets > 1 && options.read) return options.read(route, state);
        return route.fulfill({ json:{ html:state.latest, sha:state.sha } });
      }
      state.posts++; state.submitted = route.request().postDataJSON();
      if (options.conflict) return route.fulfill({ status:409, json:{ error:'A newer saved version exists' } });
      state.latest = state.submitted.html; state.sha = 'b'.repeat(40);
      return route.fulfill({ json:{ ok:true, sha:state.sha, commit:'c'.repeat(40) } });
    }
    if (u.pathname.startsWith('/api/')) return route.fulfill({ status:503, json:{ error:'isolated' } });
    let file = path.resolve(root, '.' + decodeURIComponent(u.pathname));
    if (!file.startsWith(root + path.sep)) return route.fulfill({ status:404 });
    if (!path.extname(file)) file += '.html';
    if (!existsSync(file)) return route.fulfill({ status:404 });
    const headers = {};
    if (file.endsWith('.html') && u.pathname.startsWith('/blog/')) headers['Content-Security-Policy'] = middleware(new Request(u.href)).headers.get('Content-Security-Policy');
    return route.fulfill({ body:readFileSync(file), contentType:mime[path.extname(file)] || 'application/octet-stream', headers });
  });
  await page.goto(origin + '/admin');
  await page.waitForFunction(() => typeof openEditor === 'function');
  return state;
}
async function open(page) {
  await page.evaluate(s => openEditor(s), slug);
  const frame = page.frameLocator('#edit-iframe');
  await expect(frame.locator('#hs-adm-save')).toBeVisible();
  return frame;
}
const panel = frame => frame.getByRole('region', { name:'保存前健檢與版本比較' });
const paragraph = frame => frame.locator('#proseZh > p[contenteditable]').first();

test('version summaries exclude generated contents while retaining the complete original source', async ({ page }) => {
  await page.goto('/blog/dry-eye-myths');
  const result = await page.evaluate(async () => {
    const { describeDocument } = await import('/blog/editor-review.js');
    const original = document.cloneNode(true), withoutContents = document.cloneNode(true);
    withoutContents.querySelector('#hs-inline-toc').remove();
    const source = original.documentElement.outerHTML;
    return {
      withContents: describeDocument(original).summary,
      withoutContents: describeDocument(withoutContents).summary,
      originalSourcePreserved: describeDocument(original).source === source &&
        original.documentElement.outerHTML === source
    };
  });
  expect(result.withContents).toBe(result.withoutContents);
  expect(result.originalSourcePreserved).toBe(true);
});

test('manual structural check is read-only and shows actual title/summary, not an SEO score', async ({ page }) => {
  const state = await setup(page), frame = await open(page);
  await paragraph(frame).fill('作者尚未保存的修改');
  await frame.locator('#hs-adm-check').click();
  await expect(panel(frame)).toContainText('搜尋標題：');
  await expect(panel(frame)).toContainText('搜尋摘要：');
  await expect(panel(frame)).toContainText('不代表醫療核可');
  expect(state.posts).toBe(0);
  expect(await frame.locator('body').evaluate(() => DN._adminDirty)).toBe(true);
  await paragraph(frame).fill('健檢後的新修改');
  await expect(panel(frame)).toContainText('健檢／對照後又有修改');
});

test('empty authored prose is blocked before POST and content is not replaced', async ({ page }) => {
  const state = await setup(page), frame = await open(page);
  await frame.locator('#proseZh').evaluate(el => { el.replaceChildren(); DN._adminDirty = true; });
  await frame.locator('#hs-adm-save').click();
  await expect(panel(frame)).toContainText('正文是空白');
  await expect(frame.locator('#hs-admin-status')).toContainText('尚未送出保存');
  expect(state.posts).toBe(0);
  await expect(frame.locator('#proseZh')).toBeEmpty();
  await expect(frame.locator('#hs-adm-save')).toBeEnabled();
});

for (const accept of [false,true]) {
  test(`new broken section link requires author review; accept=${accept}`, async ({ page }) => {
    const state = await setup(page), frame = await open(page);
    await paragraph(frame).evaluate(el => {
      const a = document.createElement('a'); a.href = '#missing-author-section'; a.textContent = '新的段落連結';
      el.appendChild(a); el.dispatchEvent(new Event('input', { bubbles:true }));
    });
    let message;
    page.once('dialog', async dialog => { message=dialog.message(); await (accept ? dialog.accept() : dialog.dismiss()); });
    await frame.locator('#hs-adm-save').click();
    await expect.poll(() => message).toContain('段落連結找不到');
    if (accept) {
      await expect.poll(() => state.posts).toBe(1);
      await expect(frame.locator('#hs-admin-status')).toContainText('已保存至 GitHub');
      expect(state.submitted.html).not.toContain('保存前健檢與版本比較');
    } else {
      await expect(frame.locator('#hs-admin-status')).toContainText('尚未送出保存');
      expect(state.posts).toBe(0);
      await expect(paragraph(frame).locator('a[href="#missing-author-section"]')).toHaveCount(1);
      await expect.poll(async () => frame.locator('body').evaluate((body,s) => DN.loadDraft(s), slug), { timeout:10000 }).not.toBeNull();
    }
  });
}

test('409 preserves local changes and compares three versions without rebasing or retrying POST', async ({ page }) => {
  const state = await setup(page, { conflict:true }), frame = await open(page);
  await paragraph(frame).fill('本機中文修改 <script>不可執行</script>');
  state.latest = original.replace('</article>', '<p>其他人最新保存的內容</p></article>'); state.sha='d'.repeat(40);
  await frame.locator('#hs-adm-save').click();
  await expect(frame.locator('#hs-admin-status')).toContainText('文章已有新保存版本');
  await frame.locator('#hs-adm-compare').click();
  await expect(panel(frame)).toContainText('其他人最新保存的內容');
  for (const name of ['開啟時版本','目前編輯內容','最新保存版本']) await expect(panel(frame).getByRole('heading', { name, exact:true })).toBeVisible();
  await expect(panel(frame)).toContainText('本機中文修改');
  await expect(paragraph(frame)).toHaveText('本機中文修改 <script>不可執行</script>');
  expect((await frame.locator('body').evaluate((body,s) => DN.loadDraft(s), slug)).baseSha).toBe('a'.repeat(40));
  await frame.locator('#hs-adm-save').click();
  expect(state.posts).toBe(1);
  await expect(frame.locator('#hs-admin-status')).toContainText('保存版本已改變');
});

for (const kind of ['fragment','duplicate-id']) {
  test(`a different ${kind} issue requires confirmation even when aggregate warnings stay the same`, async ({ page }) => {
    const state = await setup(page);
    const markup = kind === 'fragment' ? '<p><a href="#old-missing-section">原失效連結</a></p>' :
      '<p id="old-duplicate">甲</p><p id="old-duplicate">乙</p>';
    state.latest = original.replace('</article>', markup + '</article>');
    const frame = await open(page);
    const before = await frame.locator('article').evaluate(async el => {
      const module = await import('/blog/editor-review.js');
      return module.checkDocument(el.ownerDocument).warnings;
    });
    await frame.locator('article.max-w-3xl').evaluate((el,kind) => {
      if (kind === 'fragment') el.querySelector('a[href="#old-missing-section"]').setAttribute('href','#new-missing-section');
      else el.querySelectorAll('#old-duplicate').forEach(node => { node.id = 'new-duplicate'; });
      el.dispatchEvent(new Event('input', { bubbles:true }));
    }, kind);
    const after = await frame.locator('article').evaluate(async el => {
      const module = await import('/blog/editor-review.js');
      return module.checkDocument(el.ownerDocument).warnings;
    });
    expect(after).toEqual(before);
    let message;
    page.once('dialog', async d => { message = d.message(); await d.dismiss(); });
    await frame.locator('#hs-adm-save').click();
    await expect.poll(() => message).toContain(kind === 'fragment' ? '#new-missing-section' : 'new-duplicate');
    await expect(frame.locator('#hs-admin-status')).toContainText('尚未送出保存');
    expect(state.posts).toBe(0);
  });
}

test('latest comparison HTML is inert, complete source is available, and edits invalidate the old view', async ({ page }) => {
  const state = await setup(page), frame = await open(page);
  state.latest = original.replace('</article>', '<p>外部保存內容</p><script>window.__reviewExecuted=1</script><img src="/bad-comparison.png" onerror="window.__reviewExecuted=2" alt="<svg onload=alert(1)>"></article>');
  await frame.locator('#hs-adm-compare').click();
  await expect(panel(frame)).toContainText('外部保存內容');
  expect(await frame.locator('body').evaluate(() => window.__reviewExecuted)).toBeUndefined();
  expect(await panel(frame).locator('script').count()).toBe(0);
  expect(await panel(frame).locator('img').count()).toBe(0);
  await panel(frame).getByText('完整正文原始碼（含格式、圖表與雙語屬性）', { exact:true }).last().click();
  await expect(panel(frame).locator('details pre').last()).toContainText('window.__reviewExecuted=1');
  await paragraph(frame).fill('比較完成之後才輸入');
  await expect(panel(frame)).toContainText('健檢／對照後又有修改');
  expect(state.posts).toBe(0);
});

test('failed latest-version lookup retains content and offers a complete UTF8 plain-text download', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', async d => { dialogs.push(d.type()); await d.dismiss(); });
  const state = await setup(page, { read:route => route.fulfill({ status:503 }) }), frame = await open(page);
  await paragraph(frame).fill('即使網路失敗也保留中文圖表內容');
  await frame.locator('#hs-adm-compare').click();
  await expect(panel(frame)).toContainText('無法比較版本');
  await paragraph(frame).fill('比較失敗後繼續輸入，也要完整下載');
  const arrival = page.waitForEvent('download');
  await panel(frame).getByRole('link', { name:'下載目前編輯內容', exact:true }).click();
  const download = await arrival;
  expect(download.suggestedFilename()).toBe(slug + '-current.html.txt');
  const exported = readFileSync(await download.path(), 'utf8');
  expect(exported).toContain('比較失敗後繼續輸入，也要完整下載');
  expect(exported).toContain('data-en=');
  expect(exported).not.toContain('保存前健檢與版本比較');
  expect(dialogs).toEqual([]);
  await expect(paragraph(frame)).toHaveText('比較失敗後繼續輸入，也要完整下載');
  expect(state.posts).toBe(0);
});

test('null-download navigation preserves only the active editor export', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });
  const state = await setup(page, { read:route => route.fulfill({ status:503 }) }), frame = await open(page);
  await paragraph(frame).fill('下載導覽不應丟失的中文內容');
  test.skip(!(await frame.locator('body').evaluate(() => 'navigation' in window)),
    'Navigation API unavailable; real download and native leave protection have separate cross-engine tests');
  await frame.locator('#hs-adm-compare').click();
  await expect(panel(frame)).toContainText('無法比較版本');
  const link = panel(frame).getByRole('link', { name:'下載目前編輯內容', exact:true });
  // Reproduce Firefox's second event without depending on its download timing.
  const dispatch = mode => link.evaluate((source, mode) => {
    const original = source.href;
    let other;
    if (mode === 'navigation') source.removeAttribute('download');
    if (mode === 'untracked') { other = URL.createObjectURL(new Blob(['other'])); source.href = other; }
    const event = new Event('navigate', { cancelable:true });
    Object.assign(event, { downloadRequest:null, sourceElement:source, destination:{ url:source.href } });
    const allowed = window.navigation.dispatchEvent(event);
    if (other) { source.href = original; URL.revokeObjectURL(other); }
    return allowed;
  }, mode);
  expect(await dispatch('export')).toBe(true);
  expect(dialogs).toEqual([]);
  expect(await dispatch('untracked')).toBe(false);
  expect(await dispatch('navigation')).toBe(false);
  expect(dialogs).toHaveLength(2);
  expect(dialogs.every(message => message.includes('有未儲存的編輯'))).toBe(true);
  await expect(paragraph(frame)).toHaveText('下載導覽不應丟失的中文內容');
  expect(state.posts).toBe(0);
});

test('actual navigation still asks before leaving unsaved edits', async ({ page }) => {
  await setup(page); const frame = await open(page);
  await paragraph(frame).fill('離開前應保留的輸入');
  let warning;
  page.on('dialog', async d => { warning = { type:d.type(), message:d.message() }; await d.dismiss(); });
  await frame.locator('body').evaluate(() => {
    const a = document.createElement('a'); a.href = '/blog/glaucoma-comprehensive-guide';
    a.textContent = '測試離開'; document.getElementById('hs-admin-bar').appendChild(a);
  });
  await frame.getByRole('link', { name:'測試離開', exact:true }).click();
  // Engines without the Navigation API show a native beforeunload dialog;
  // its message is browser-controlled and may be empty.
  await expect.poll(() => warning && (warning.type === 'beforeunload' ||
    (warning.type === 'confirm' && warning.message.includes('有未儲存的編輯')))).toBe(true);
  await expect(paragraph(frame)).toHaveText('離開前應保留的輸入');
});

test('typing during version retrieval is included when the comparison arrives', async ({ page }) => {
  let release, arrived;
  const gate = new Promise(r => { release=r; }), arrival = new Promise(r => { arrived=r; });
  const state = await setup(page, { read:async(route,s) => { arrived(); await gate; return route.fulfill({ json:{ html:s.latest, sha:s.sha } }); } });
  const frame = await open(page);
  await paragraph(frame).fill('開始讀取前的內容');
  await frame.locator('#hs-adm-compare').click(); await arrival;
  await paragraph(frame).fill('讀取途中新的作者內容'); release();
  await expect(panel(frame)).toContainText('讀取途中新的作者內容');
  await expect(paragraph(frame)).toHaveText('讀取途中新的作者內容');
  expect(state.posts).toBe(0);
});

test('opening a stale draft keeps the conflict notice and archives rather than restoring it', async ({ page }) => {
  await setup(page);
  const stale = original.replace('</article>', '<p>較舊的作者草稿</p></article>');
  await page.evaluate(({ slug, stale }) => localStorage.setItem('hs:draft-' + slug + '.json',
    JSON.stringify({ slug, html:stale, baseSha:'d'.repeat(40), ts:12345 })), { slug, stale });
  const frame = await open(page);
  await expect(frame.locator('#hs-admin-status')).toContainText('舊版本草稿已另存備份');
  await expect(frame.locator('article.max-w-3xl')).not.toContainText('較舊的作者草稿');
  const archived = await frame.locator('body').evaluate((body,s) => DN.loadDraft(s + '-conflict-12345'), slug);
  expect(archived.html).toContain('較舊的作者草稿');
  await frame.locator('#hs-adm-compare').click();
  await expect(panel(frame).getByRole('link', { name:'下載舊版本草稿' })).toBeVisible();
});

test('dirty conflict backup downloads after comparison links are retired', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', async d => { dialogs.push(d.type()); await d.dismiss(); });
  const state = await setup(page);
  const stale = original.replace('</article>', '<p>較舊的作者草稿 UTF8 備份</p></article>');
  await page.evaluate(({ slug, stale }) => localStorage.setItem('hs:draft-' + slug + '.json',
    JSON.stringify({ slug, html:stale, baseSha:'d'.repeat(40), ts:12345 })), { slug, stale });
  const frame = await open(page);
  await paragraph(frame).fill('繼續編輯中的最新內容');
  await frame.locator('#hs-adm-compare').click();
  await expect(panel(frame).getByRole('link', { name:'下載舊版本草稿', exact:true })).toBeVisible();
  await frame.locator('#hs-adm-check').click();
  const arrival = page.waitForEvent('download');
  await frame.locator('#hs-admin-bar > a').filter({ hasText:'下載舊版本草稿' }).click();
  const download = await arrival;
  expect(download.suggestedFilename()).toBe(slug + '-conflict.html');
  expect(readFileSync(await download.path(), 'utf8')).toBe(stale);
  expect(dialogs).toEqual([]);
  await expect(paragraph(frame)).toHaveText('繼續編輯中的最新內容');
  const archive = await frame.locator('body').evaluate((body,s) => DN.loadDraft(s + '-conflict-12345'), slug);
  expect(archive.html).toBe(stale);
  expect(state.posts).toBe(0);
});

test('save invalidates an outstanding comparison response', async ({ page }) => {
  let release, arrived;
  const gate = new Promise(r => { release=r; }), arrival = new Promise(r => { arrived=r; });
  const state = await setup(page, { read:async route => {
    arrived(); await gate;
    await route.fulfill({ json:{ html:original.replace('</article>', '<p>過期比較內容</p></article>'), sha:'d'.repeat(40) } }).catch(() => {});
  } });
  const frame = await open(page);
  await paragraph(frame).fill('新保存版本');
  await frame.locator('#hs-adm-compare').click(); await arrival;
  await frame.locator('#hs-adm-save').click();
  await expect.poll(() => state.posts).toBe(1);
  await expect(frame.locator('#hs-admin-status')).toContainText('已保存至 GitHub');
  release();
  await expect(panel(frame)).toBeHidden();
  await expect(frame.getByRole('region', { name:'保存前健檢與版本比較', includeHidden:true })).not.toContainText('過期比較內容');
  await expect(paragraph(frame)).toHaveText('新保存版本');
});

test('save rechecks content changed while the save lock was pending', async ({ page }) => {
  const state = await setup(page), frame = await open(page);
  await paragraph(frame).fill('準備保存的正文');
  await frame.locator('body').evaluate(() => {
    DN.withLock = async (key, fn) => {
      await new Promise(resolve => { window.__releaseSaveCheck = resolve; });
      return fn();
    };
  });
  await frame.locator('#hs-adm-save').click();
  await expect.poll(() => frame.locator('body').evaluate(() => typeof window.__releaseSaveCheck)).toBe('function');
  await frame.locator('#proseZh').evaluate(el => { el.replaceChildren(); window.__releaseSaveCheck(); });
  await expect(panel(frame)).toContainText('正文是空白');
  await expect(frame.locator('#hs-adm-save')).toBeEnabled();
  expect(state.posts).toBe(0);
});

for (const width of [390,1440]) {
  test(`checks/comparison controls are reachable and do not cause overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height:844 });
    await setup(page); const frame = await open(page);
    await frame.locator('#hs-adm-check').click();
    await panel(frame).getByRole('button', { name:'收起健檢' }).click();
    await frame.locator('#hs-adm-compare').click();
    await expect(panel(frame)).toContainText('最新保存版本與');
    expect(await frame.locator('body').evaluate(() => document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const close = panel(frame).getByRole('button', { name:'收起比較，保留編輯內容' });
    await close.focus(); await expect(close).toBeFocused(); await close.press('Enter');
    await expect(panel(frame)).toBeHidden();
  });
}
