const { test, expect } = require('@playwright/test');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

test.use({ serviceWorkers: 'block' });
const root = path.resolve(__dirname, '../..');
const slug = 'dry-eye-myths';
const origin = 'https://hsiao.chendermatologist.com';
const original = readFileSync(path.join(root, 'blog', slug + '.html'), 'utf8');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2' };
async function setup(page, options = {}) {
  // An explicit ESM URL avoids Playwright's CommonJS .js handling. Execute
  // the complete unmodified middleware source, not a copied CSP fixture.
  const middlewareSource = readFileSync(path.join(root, 'middleware.js'), 'utf8');
  const { default: middleware } = await new Function('url', 'return import(url)')('data:text/javascript;base64,' + Buffer.from(middlewareSource).toString('base64'));
  const state = { html: original, sha: 'a'.repeat(40), submitted: null, saves: 0, publicEvents: [], diagnostics: [], cspReports: [], blockedRequests: [] };
  // Real generated production CSP, real assets and browser storage, no live API.
  await page.context().route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.pathname === '/api/csp-report') state.cspReports.push(route.request().postData());
    if (u.hostname === 'blocked.example.test') state.blockedRequests.push(u.href);
    if (u.pathname === '/api/errors') state.diagnostics.push({ url:u.href, frame:route.request().frame().url(), payload:route.request().postData() });
    if (/google-analytics|googletagmanager|clarity\.ms|doubleclick\.net|_vercel\/(?:insights|speed-insights)|\/api\/(?:cwv-ingest|search-log|admin\/(?:ab-stats|search-log))(?:[/?]|$)/.test(u.href)) state.publicEvents.push(u.href);
    if (u.origin !== origin) return route.fulfill({ status: 200, body: '', contentType: 'text/javascript' });
    if (u.pathname === '/api/admin/save') {
      if (route.request().method() === 'GET') return route.fulfill({ json: { html: state.html, sha: state.sha } });
      state.saves++; state.submitted = route.request().postDataJSON();
      state.html = state.submitted.html; state.sha = 'b'.repeat(40);
      return route.fulfill({ json: { ok: true, sha: state.sha, commit: 'c'.repeat(40) } });
    }
    if (u.pathname.startsWith('/api/')) return route.fulfill({ status: 503, json: { error: 'isolated fixture' } });
    let file = path.resolve(root, '.' + decodeURIComponent(u.pathname));
    if (!file.startsWith(root + path.sep)) return route.fulfill({ status: 404, body: '' });
    if (!path.extname(file)) file += '.html';
    if (!existsSync(file)) return route.fulfill({ status: 404, body: '' });
    const headers = {};
    if (u.pathname.startsWith('/blog/') && file.endsWith('.html')) {
      headers['Content-Security-Policy'] = middleware(new Request(u.href)).headers.get('Content-Security-Policy');
      if (options.denyPolicy) headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace(' hs-editor-document', '');
    }
    return route.fulfill({ body: readFileSync(file), contentType: mime[path.extname(file)] || 'application/octet-stream', headers });
  });
  await page.goto(origin + '/admin', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof openEditor === 'function');
  return state;
}
async function open(page) {
  await page.evaluate(s => openEditor(s), slug);
  const frame = page.frameLocator('#edit-iframe');
  await expect(frame.locator('#hs-adm-save')).toBeVisible();
  return frame;
}
async function preview(page, frame) {
  const next = page.context().waitForEvent('page');
  await frame.locator('#hs-adm-preview').click();
  const popup = await next;
  popup.on('pageerror', error => { throw error; });
  await expect(popup).toHaveURL(/^blob:/);
  await expect(popup.getByRole('note')).toContainText('本機內容預覽');
  return popup;
}
function scripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map(m => ({
    src: m[1].match(/\bsrc="([^"]*)"/)?.[1] || '',
    type: m[1].match(/\btype="([^"]*)"/)?.[1] || '', text: m[2].replace(/\r\n/g, '\n')
  }));
}

test('enforced CSP saves all authored data and page scripts with the edited text intact', async ({ page }) => {
  const state = await setup(page);
  const frame = await open(page);
  await frame.locator('#proseZh > p[contenteditable]').first().fill('CSP-preserved author text');
  await frame.locator('#hs-adm-save').click();
  await expect.poll(() => state.saves).toBe(1);
  expect(state.submitted.html).toContain('CSP-preserved author text');
  expect(scripts(state.submitted.html)).toEqual(scripts(original));
  expect(state.submitted.html).not.toContain('data-hs-editor-preview-path');
  expect(state.submitted.html).not.toContain('/blog/editor-preview.js');
});

test('enforced CSP recovery retains article JSON-LD and both language bodies on a later save', async ({ page }) => {
  const state = await setup(page);
  page.on('dialog', d => d.accept());
  let frame = await open(page);
  await frame.locator('#proseZh > p[contenteditable]').first().fill('Recovered under real CSP');
  await page.getByRole('button', { name: '← 回到後台' }).click();
  await expect(page.locator('#edit-shell')).toBeHidden();
  frame = await open(page);
  await expect(frame.locator('#proseZh > p[contenteditable]').first()).toHaveText('Recovered under real CSP');
  await frame.locator('#hs-adm-save').click();
  await expect.poll(() => state.saves).toBe(1);
  expect(scripts(state.submitted.html)).toEqual(scripts(original));
  expect(state.submitted.html).toContain('id="proseEn"');
});

test('local preview loads real assets, current text and reader controls without saving or collecting', async ({ page }) => {
  const state = await setup(page);
  const frame = await open(page);
  const editorPreference = await page.evaluate(() => localStorage.getItem('hs_lang'));
  await frame.locator('#proseZh > p[contenteditable]').first().fill('Unpublished preview text');
  const popup = await preview(page, frame);
  await expect(popup.locator('#proseZh > p').first()).toHaveText('Unpublished preview text');
  await expect.poll(() => popup.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"][href^="/assets/"]')].every(el => !!el.sheet))).toBe(true);
  await expect.poll(() => popup.locator('img[src="/icon.svg"]').evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
  await expect.poll(() => popup.evaluate(() => window.DN?.currentSlug())).toBe(slug);
  await expect(popup.locator('#hs-related a[href]').first()).toBeAttached();
  expect(await popup.evaluate(() => opener === null && HsiaoTelemetry.allowed(window) === false)).toBe(true);
  await expect(popup.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(popup.locator('#hs-admin-bar')).toHaveCount(0);
  await popup.locator('#langToggle').selectOption('en');
  await expect(popup.getByRole('note')).toContainText('Local content preview');
  await expect(popup.locator('#proseEn')).toBeVisible();
  expect(await popup.evaluate(() => DN.detectLang())).toBe('en');
  await popup.evaluate(() => new Promise(resolve => setTimeout(() => { DN.applyTextOnly(DN.detectLang()); resolve(); }, 10)));
  await expect(popup.getByRole('note')).toContainText('Local content preview');
  expect(await page.evaluate(() => localStorage.getItem('hs_lang'))).toBe(editorPreference);
  expect(state.saves).toBe(0);
  expect(state.publicEvents).toEqual([]);
  expect(state.diagnostics.filter(event => event.frame.startsWith('blob:'))).toEqual([]);
  expect(state.cspReports).toEqual([]);
  await popup.close();
});

test('local preview error diagnostics do not send unsaved document details', async ({ page }) => {
  const state = await setup(page);
  const frame = await open(page);
  const popup = await preview(page, frame);
  await popup.evaluate(() => {
    window.dispatchEvent(new ErrorEvent('error', { message:'Isolated preview diagnostic fixture', filename:location.href, lineno:1 }));
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise:Promise.resolve(), reason:new Error('Isolated preview rejection fixture') }));
  });
  // Flush the event handlers and beacon/fetch route interception.
  await popup.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
  expect(state.publicEvents).toEqual([]);
  // Resource errors in the existing admin fixture retain its diagnostic policy;
  // every request from the actual blob preview must remain excluded.
  expect(state.diagnostics.filter(event => event.frame.startsWith('blob:'))).toEqual([]);
  expect(state.cspReports).toEqual([]);
  expect(state.saves).toBe(0);
  await popup.close();
});

test('local preview blocks unapproved resources without sending native CSP reports', async ({ page }) => {
  const state = await setup(page);
  await page.context().addInitScript(() => {
    window.__previewCspViolations = [];
    document.addEventListener('securitypolicyviolation', event => {
      window.__previewCspViolations.push({ directive:event.effectiveDirective, blocked:event.blockedURI });
    });
  });
  state.html = state.html.replace('</article>', '<img src="https://blocked.example.test/unsaved-author-image.jpg" alt="Isolated blocked preview fixture"></article>');
  const frame = await open(page);
  const popup = await preview(page, frame);
  await expect.poll(() => popup.evaluate(() => window.__previewCspViolations.some(event => event.directive === 'img-src' && event.blocked.includes('blocked.example.test')))).toBe(true);
  await popup.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
  expect(state.blockedRequests).toEqual([]);
  expect(state.cspReports).toEqual([]);
  expect(state.publicEvents).toEqual([]);
  expect(state.saves).toBe(0);
  await popup.close();
});

test('a local preview remains reloadable after 30 seconds and releases its blob on close', async ({ page }) => {
  await setup(page);
  await page.clock.install();
  const frame = await open(page);
  await frame.locator('body').evaluate(() => {
    const revoke = URL.revokeObjectURL.bind(URL);
    window.__previewRevoked = [];
    URL.revokeObjectURL = url => { window.__previewRevoked.push(url); revoke(url); };
  });
  const popup = await preview(page, frame);
  const url = popup.url();
  await page.clock.fastForward(31000);
  await popup.reload({ waitUntil:'domcontentloaded' });
  await expect(popup.getByRole('note')).toBeVisible();
  expect(await frame.locator('body').evaluate(() => window.__previewRevoked)).not.toContain(url);
  await popup.close();
  await page.clock.fastForward(1100);
  expect(await frame.locator('body').evaluate(() => window.__previewRevoked)).toContain(url);
});

test('preview fragments navigate within the unsaved blob and still open FAQ details', async ({ page }) => {
  const state = await setup(page);
  state.html = state.html.replace('</article>', '<p><a href="#preview-faq">Preview FAQ</a></p><details class="hf" id="preview-faq"><summary>Fixture question</summary><p>Fixture answer</p></details></article>');
  const frame = await open(page);
  const popup = await preview(page, frame);
  const blob = popup.url();
  const link = popup.locator('a[href="#preview-faq"]');
  const hash = await link.getAttribute('href');
  await link.click();
  expect(popup.url()).toBe(blob + hash);
  await expect(popup.locator('#preview-faq')).toHaveAttribute('open', '');
  await expect(popup.getByRole('note')).toBeAttached();
  await popup.close();
});

test('CSP editor removes executable imports while retaining authored JSON data', async ({ page }) => {
  const state = await setup(page);
  state.html = state.html.replace('</article>', '<script>window.__badSource = true</script><script type="application/json">{"authorData":"retained"}</script><img src="/missing.jpg" onerror="window.__badSource=true"><iframe srcdoc="&lt;script&gt;window.__badSource=true&lt;/script&gt;"></iframe><a href="javascript:window.__badSource=true">Unsafe fixture</a></article>');
  const frame = await open(page);
  expect(await frame.locator('body').evaluate(() => window.__badSource)).toBeUndefined();
  await expect(frame.locator('article script:not([type="application/json"]):not([type="application/ld+json"])')).toHaveCount(0);
  await expect(frame.locator('article [onerror], article [srcdoc], article a[href^="javascript:"]')).toHaveCount(0);
  expect(await frame.locator('article script[type="application/json"]').textContent()).toBe('{"authorData":"retained"}');
  await frame.locator('#proseZh > p[contenteditable]').first().fill('Safe authored text');
  await frame.locator('#hs-adm-save').click();
  await expect.poll(() => state.saves).toBe(1);
  expect(state.submitted.html).toContain('"authorData":"retained"');
  expect(state.submitted.html).not.toContain('window.__badSource');
});

test('blocked popup is visible and keeps the author content and draft available', async ({ page }) => {
  const state = await setup(page);
  const frame = await open(page);
  await frame.locator('#proseZh > p[contenteditable]').first().fill('Keep author text on popup failure');
  await frame.locator('body').evaluate(() => { window.open = () => null; });
  await frame.locator('#hs-adm-preview').click();
  await expect(frame.locator('#hs-admin-status')).toContainText('瀏覽器封鎖新視窗');
  await expect(frame.locator('#proseZh > p[contenteditable]').first()).toHaveText('Keep author text on popup failure');
  expect(await frame.locator('body').evaluate(() => DN.adminBeforeClose())).toBe(true);
  expect(state.saves).toBe(0);
});

test('missing editor document policy fails before writes and keeps old draft storage', async ({ page }) => {
  const state = await setup(page, { denyPolicy: true });
  await page.evaluate(() => localStorage.setItem('hs:draft-dry-eye-myths.json', 'untouched fixture'));
  await page.evaluate(s => openEditor(s), slug);
  const frame = page.frameLocator('#edit-iframe');
  await expect(frame.getByRole('alert')).toContainText('無法開啟編輯');
  await expect(frame.locator('[contenteditable="true"]')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('hs:draft-dry-eye-myths.json'))).toBe('untouched fixture');
  expect(state.saves).toBe(0);
});

test('ordinary public CSP rejects the editor-only policy and keeps general HTML sanitization', async ({ page }) => {
  await setup(page);
  const response = await page.goto(origin + '/blog/' + slug);
  expect(response.headers()['content-security-policy']).toContain('report-uri /api/csp-report');
  const result = await page.evaluate(() => {
    let denied = false;
    try { trustedTypes.createPolicy('hs-editor-document', {createHTML:v=>v}); } catch (e) { denied = true; }
    const el = document.createElement('div');
    el.innerHTML = '<script>window.__badPolicy=true</script><img src="/icon.svg" onerror="window.__badPolicy=true">';
    return {denied, scripts:el.querySelectorAll('script').length, event:el.querySelector('img').hasAttribute('onerror')};
  });
  expect(result).toEqual({denied:true,scripts:0,event:false});
});
