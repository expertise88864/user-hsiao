// /admin 「考試內容」 editor (admin/exam-editor.js) on the real admin.html with a
// mocked /api/admin/exam-draft: chapter list, note editor with its sandboxed
// preview, explanation form, save / 409 / rejection handling, local backup,
// Ctrl+S, unsaved-change guards and focus. Admin pages are served with the
// production CSP from vercel.json so a policy violation fails the test.
// UI validation only: no credentials, no GitHub, no writes.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test.use({ serviceWorkers: 'block' });

const SAVED = '已存入雲端草稿（cms-exam/drafts），尚未上線。';
const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '../../vercel.json'), 'utf8'));
const ADMIN_CSP = vercel.headers.find(entry => entry.source === '/admin(.*)').headers
  .find(header => header.key === 'Content-Security-Policy').value;
const sha = char => char.repeat(40);

function fixture() {
  return {
    notes: {
      '1-4': '<h2 id="ch4-s1">一、本章重點</h2>\n<ul>\n<li>原始內容 <mark>重點</mark>{{q:2,3}}<span class="ref">p.63</span></li>\n</ul>\n',
      '12-4': '<h2 id="ch4-s1">一、青光眼</h2>\n<p>draft body</p>\n',
    },
    blob: { '1-4': sha('a'), '12-4': sha('b') },
    source: { '1-4': 'main', '12-4': 'draft' },
    list: [
      { key: '1-4', book: 'Update on General Medicine', title: 'Hypertension', zh: '高血壓' },
      { key: '12-4', book: 'Retina and Vitreous', title: '<img src=x onerror="window.__injected=1">' },
    ],
    entries: {
      2: { answer: 'B', summary: '摘要二', flags: ['附註一'], items: ['A', 'B', 'C', 'D'].map(key => ({ key, answer: key === 'B',
        label: key === 'B' ? '正確' : '錯誤', text: '說明 ' + key, refs: key === 'A' ? [[1, '63–64'], [9, '303']] : [] })) },
    },
    question: { stem: '題幹：哪一個正確？', options: { A: '選項甲', B: '選項乙', C: '選項丙', D: '選項丁' } },
    explBlob: sha('d'),
    draft: { exists: true, notes: ['12-4'], explanations: [], updated: '2026-11-04T00:00:00Z' },
    posts: [], failures: [], next: 0,
  };
}

async function setup(page, state) {
  await page.addInitScript(() => {
    window.__violations = [];
    // Third-party injections from the test machine (e.g. a local ad blocker's
    // script tags) are not the page's doing; everything the page or the preview
    // loads is same-origin, inline or about:srcdoc, so those must never be blocked.
    document.addEventListener('securitypolicyviolation', event => {
      const uri = event.blockedURI || '';
      if (/^https?:/.test(uri) && !uri.startsWith(location.origin)) return;
      window.__violations.push(event.violatedDirective + ' ' + uri);
    });
  });
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/api/admin/list') return route.fulfill({ json: { articles: [] } });
    if (url.pathname === '/api/admin/exam-draft') {
      expect(request.headers().authorization).toBeUndefined();
      if (request.method() === 'GET') {
        const q = url.searchParams;
        if (q.get('mode') === 'list') return route.fulfill({ json: { ok: true, notes: state.list, draft: state.draft } });
        if (q.get('kind') === 'note') {
          const key = q.get('key');
          return route.fulfill({ json: { ok: true, key, content: state.notes[key], source: state.source[key], blobSha: state.blob[key] } });
        }
        if (q.get('kind') === 'expl') {
          const id = q.get('id');
          if (!state.entries[id]) return route.fulfill({ status: 404, json: { ok: false, error: 'unknown_question', reason: '沒有題號' } });
          return route.fulfill({ json: { ok: true, id, entry: state.entries[id], question: state.question,
            source: state.draft.explanations.includes(id) ? 'draft' : 'main', blobSha: state.explBlob } });
        }
        return route.fulfill({ status: 400, json: { ok: false, error: 'invalid_request' } });
      }
      expect(request.method()).toBe('POST');
      expect(request.headers()['content-type']).toBe('application/json');
      const body = JSON.parse(request.postData());
      state.posts.push(body);
      if (state.failures.length) return route.fulfill(state.failures.shift());
      const fresh = sha(String.fromCharCode(101 + ++state.next));
      if (body.kind === 'note') {
        expect(body.baseBlobSha).toBe(state.blob[body.key]);
        state.notes[body.key] = body.content; state.blob[body.key] = fresh; state.source[body.key] = 'draft';
        state.draft = { ...state.draft, notes: [...new Set([...state.draft.notes, body.key])] };
      } else {
        expect(body.baseBlobSha).toBe(state.explBlob);
        state.entries[body.id] = body.entry; state.explBlob = fresh;
        state.draft = { ...state.draft, explanations: [...new Set([...state.draft.explanations, body.id])] };
      }
      return route.fulfill({ json: { ok: true, head: sha('9'), blobSha: fresh, branch: 'cms-exam/drafts', draft: state.draft, published: false } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, json: {} });
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      const response = await route.fetch();
      return route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': ADMIN_CSP } });
    }
    return route.continue();
  });
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-tab="exam"]').click();
  await expect(page.locator('#examList [data-exam-note]')).toHaveCount(2);
}

const status = page => page.locator('#examStatus');
const previewFrame = page => page.frameLocator('#examPreview');

test('chapter list is grouped, escaped and filterable', async ({ page }) => {
  const state = fixture();
  await setup(page, state);
  await expect(page.locator('#examList')).toContainText('BCSC 1 · Update on General Medicine');
  await expect(page.locator('[data-exam-note="1-4"]')).toContainText('Ch.4 Hypertension（高血壓）');
  await expect(page.locator('[data-exam-note="12-4"]')).toContainText('<img src=x');
  await expect(page.locator('[data-exam-note="12-4"]')).toContainText('雲端草稿');
  await expect(page.locator('#examList img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__injected)).toBeUndefined();
  await expect(page.locator('#examDraftSummary')).toContainText('重點 1 章、詳解 0 題');
  await page.locator('#examFilter').fill('高血壓');
  await expect(page.locator('#examList [data-exam-note]')).toHaveCount(1);
  await page.locator('#examFilter').fill('12-4');
  await expect(page.locator('#examList [data-exam-note="12-4"]')).toHaveCount(1);
  await page.locator('#examFilter').fill('nothing-matches');
  await expect(page.locator('#examList')).toContainText('沒有符合篩選的章節');
});

test('note editor: sandboxed styled preview, Ctrl+S saves to the draft, 409 keeps a restorable backup', async ({ page }) => {
  const state = fixture();
  await setup(page, state);
  const row = page.locator('[data-exam-note="1-4"]');
  await row.click();
  const dialog = page.getByRole('dialog', { name: /課本重點/ });
  await expect(dialog).toBeVisible();
  await expect(status(page)).toContainText('來源：正式版 main');
  const source = page.locator('#examNoteSource');
  await expect(source).toHaveValue(state.notes['1-4']);
  await expect(source).toBeFocused();
  await expect(page.locator('#examPreview')).toHaveAttribute('sandbox', '');
  await expect(previewFrame(page).locator('h2')).toHaveText('一、本章重點');
  await expect(previewFrame(page).locator('sup.ex-qref span')).toHaveText(['Q2', 'Q3']);
  // The generated exam stylesheet reaches the preview under the admin CSP.
  await expect.poll(() => previewFrame(page).locator('.ref').evaluate(node => getComputedStyle(node).fontSize)).not.toBe('16px');
  // Scripts never run in the preview.
  await source.fill(state.notes['1-4'] + '<p>x</p><script>window.top.__injected = 1</script>\n');
  await expect(previewFrame(page).locator('p')).toHaveText('x');
  expect(await page.evaluate(() => window.__injected)).toBeUndefined();

  const edited = state.notes['1-4'].replace('原始內容', '修改後內容');
  await source.fill(edited);
  expect(await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })).toBe(true);
  await page.keyboard.press('Control+s');
  await expect(status(page)).toContainText(SAVED);
  expect(state.posts.at(-1)).toEqual({ kind: 'note', key: '1-4', content: edited, baseBlobSha: sha('a') });
  await expect(row).toContainText('雲端草稿');
  expect(await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })).toBe(false);

  // A conflict keeps the text, backs it up and lets the owner restore it after reloading.
  const conflicted = edited + '<p>second edit</p>\n';
  await source.fill(conflicted);
  state.failures.push({ status: 409, json: { ok: false, error: 'conflict' } });
  await page.locator('#examSave').click();
  await expect(status(page)).toContainText('版本衝突');
  await expect(source).toHaveValue(conflicted);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#examReload').click();
  await expect(source).toHaveValue(edited);
  await expect(page.locator('#examRestore')).toBeVisible();
  await page.locator('#examRestore').click();
  await expect(source).toHaveValue(conflicted);

  // A server rejection shows its reason and nothing else changes.
  state.failures.push({ status: 400, json: { ok: false, error: 'invalid_note', reason: '不允許的標籤 <script>（第 3 行）' } });
  await page.locator('#examSave').click();
  await expect(status(page)).toContainText('重點內容被拒絕：不允許的標籤 <script>（第 3 行）');

  // Closing with unsaved text asks first; Esc closes and focus returns to the row.
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#examClose').click();
  await expect(dialog).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(row).toBeFocused();
  expect(await page.evaluate(() => window.__violations)).toEqual([]);
});

test('explanation form: question context, one answer, refs parsing, client checks and save', async ({ page }) => {
  const state = fixture();
  await setup(page, state);
  await page.locator('#examExplOpenId').fill('2');
  await page.locator('#examExplOpen').click();
  const dialog = page.getByRole('dialog', { name: /題目詳解 · 第 2 題/ });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('題幹：哪一個正確？');
  await expect(dialog.locator('fieldset')).toHaveCount(4);
  await expect(dialog.locator('fieldset').first().locator('legend')).toHaveText('選項 A：選項甲');
  await expect(page.locator('#examAnswerB')).toBeChecked();
  await expect(dialog.locator('fieldset').first().getByLabel('參考頁碼（refs）')).toHaveValue('1:63–64; 9:303');

  const summary = dialog.getByLabel('摘要（summary）');
  await summary.fill('新的摘要');
  await page.locator('#examAnswerC').check();
  await dialog.locator('fieldset').nth(2).getByLabel('參考頁碼（refs）').fill('2:100-101; 3：5');
  await dialog.locator('fieldset').nth(2).getByLabel(/判定/).fill('正確');
  await dialog.locator('fieldset').nth(1).getByLabel(/判定/).fill('錯誤');
  await page.keyboard.press('Control+s');
  await expect(status(page)).toContainText(SAVED);
  const entry = state.posts.at(-1).entry;
  expect(state.posts.at(-1)).toMatchObject({ kind: 'expl', id: '2', baseBlobSha: sha('d') });
  expect(entry.answer).toBe('C');
  expect(entry.summary).toBe('新的摘要');
  expect(entry.items.map(item => item.answer)).toEqual([false, false, true, false]);
  expect(entry.items[2].refs).toEqual([[2, '100–101'], [3, '5']]);
  expect(entry.flags).toEqual(['附註一']);
  await expect(page.locator('[data-exam-expl="2"]')).toBeVisible();

  // Client-side checks never reach the API.
  const before = state.posts.length;
  await dialog.locator('fieldset').first().getByLabel('參考頁碼（refs）').fill('p.63');
  await page.locator('#examSave').click();
  await expect(status(page)).toContainText('選項 A：參考頁碼格式');
  await dialog.locator('fieldset').first().getByLabel('參考頁碼（refs）').fill('1:63');
  await summary.fill('');
  await page.locator('#examSave').click();
  await expect(status(page)).toContainText('摘要不可空白');
  expect(state.posts.length).toBe(before);

  // Unknown question ids report the API's answer; invalid ids are refused locally.
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#examExplId').fill('999');
  await page.locator('#examExplLoad').click();
  await expect(status(page)).toContainText('找不到這個題號的詳解');
  await page.locator('#examExplId').fill('1-1');
  await page.locator('#examExplLoad').click();
  await expect(status(page)).toContainText('題號需為數字');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.__violations)).toEqual([]);
});

test('an expired session shows a readable message instead of the list', async ({ page }) => {
  await page.route('**/api/admin/exam-draft**', route => route.fulfill({ status: 401, json: { ok: false, error: 'login_required' } }));
  await page.route('**/api/admin/list', route => route.fulfill({ json: { articles: [] } }));
  await page.route('**/api/admin/ab-stats', route => route.fulfill({ status: 503, json: {} }));
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-tab="exam"]').click();
  await expect(page.locator('#examList')).toContainText('登入已失效');
  await expect(page.locator('#examRetry')).toBeVisible();
});
