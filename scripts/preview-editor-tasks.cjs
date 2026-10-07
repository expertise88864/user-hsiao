/* Disposable Preview editor fixtures; no credentials, private reads or writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const AxeBuilder = require('@axe-core/playwright').default;
const { targetUrl, verifyRuntimeIdentity } = require('./preview-access.cjs');
const { prepareA11yPage } = require('./a11y-rendering.cjs');

function withExampleImages(html) {
  const picture = (language, alt) => '<figure><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" width="90" height="90" alt="' + alt + '"><figcaption>' + language + ' example image</figcaption></figure>';
  assert.ok(html.includes('<div id="proseZh" class="prose">'));
  assert.ok(html.includes('<div id="proseEn" class="prose" style="display:none">'));
  return html.replace('<div id="proseZh" class="prose">', '<div id="proseZh" class="prose">' + picture('中文', '編輯操作示範圖片'))
    .replace('<div id="proseEn" class="prose" style="display:none">', '<div id="proseEn" class="prose" style="display:none">' + picture('English', 'Example image for editing'));
}

function editorFixtureRoute(base, source, blockedWrites) {
  return async route => {
    const request = route.request(), url = new URL(request.url());
    if (!['GET', 'HEAD'].includes(request.method())) {
      blockedWrites.push(url.origin === base.origin ? url.pathname : 'external');
      return route.abort();
    }
    if (url.origin === base.origin && url.pathname === '/api/admin/save') {
      return route.fulfill({ json: { html: source, sha: 'a'.repeat(40), catalogSha: 'b'.repeat(40) } });
    }
    if (url.origin === base.origin && (url.pathname.startsWith('/api/') || /^\/admin(?:\/|\.html|$)/.test(url.pathname))) {
      return route.fulfill({ status: 503, json: { error: 'Read-only Preview fixture' } });
    }
    if (url.origin !== base.origin && !['https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(url.origin)) {
      return route.abort();
    }
    return route.continue();
  };
}

async function captureEditorTasks(browser, base, cookies, expectedSHA, repository) {
  base = targetUrl(base.href);
  assert.ok(base.hostname.endsWith('.vercel.app'));
  const rows = [];
  const accessibility = [];
  async function auditTask(page, width, task) {
    const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    if (task === 'information') await prepareA11yPage(page);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'best-practice']).analyze();
    accessibility.push({ width, task, result });
    fs.writeFileSync('delivery-preview/editor-task-accessibility.json', JSON.stringify({
      sha: expectedSHA, platform: process.platform, browser: browser.version(), accessibility,
      scope: 'Isolated synthetic editor states on exact Preview; full active-page axe with painted footer. Incomplete rules require manual assessment, not a claim of complete WCAG conformance.',
    }, null, 2));
    assert.equal(result.violations.length, 0, 'Editor ' + width + ' ' + task + ' accessibility violations');
    await page.evaluate(position => scrollTo({ left: position.x, top: position.y, behavior: 'instant' }), scroll);
    await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.all([...document.querySelectorAll('#hs-toc-float, #hs-font-sizer, #hs-mobile-nav, #hs-totop, #hs-pip-btn')]
        .flatMap(element => element.getAnimations())
        .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {})));
    });
  }
  for (const width of [360, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'zh-TW',
      colorScheme: width === 360 || width === 1440 ? 'dark' : 'light', serviceWorkers: 'block' });
    try {
      await context.addCookies(cookies);
      const identity = await verifyRuntimeIdentity(context.request, base.href, expectedSHA, repository);
      assert.equal(identity.environment, 'preview');
      const articleURL = new URL('/blog/dry-eye-myths', base).href;
      const response = await context.request.get(articleURL, { maxRedirects: 0 });
      assert.equal(response.status(), 200);
      assert.equal(response.url(), articleURL);
      const source = withExampleImages(await response.text());
      const blockedWrites = [];
      await context.route('**/*', editorFixtureRoute(base, source, blockedWrites));
      const page = await context.newPage();
      await page.goto(new URL('/blog/dry-eye-myths?admin=1', base).href, { waitUntil: 'load' });
      await page.locator('#hs-adm-save').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#hs-editor-titleZh').isVisible(), false);
      await page.locator('#hs-adm-article-info').click();
      await page.locator('#hs-editor-titleZh').waitFor({ state: 'visible' });
      await auditTask(page, width, 'information');
      await page.screenshot({ path: 'delivery-preview/editor-' + width + '-information.png', fullPage: false });
      await page.locator('#hs-editor-metadata-workspace > summary').click();
      await page.locator('#hs-adm-image-description').click();
      const dialog = page.getByRole('dialog', { name: '圖片替代文字' });
      await dialog.waitFor({ state: 'visible' });
      await auditTask(page, width, 'image-description');
      await page.screenshot({ path: 'delivery-preview/editor-' + width + '-image-description.png', fullPage: false });
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(await page.evaluate(() => !!window.DN._adminDirty), false);
      rows.push({ width, identity, syntheticPublicContent: true, blockedWriteAttempts: blockedWrites,
        transmittedWriteRequests: 0, privateAdminReads: 0 });
    } finally { await context.close(); }
  }
  fs.writeFileSync('delivery-preview/editor-task-evidence.json', JSON.stringify({
    sha: expectedSHA, checkedAt: new Date().toISOString(), platform: process.platform, browser: browser.version(), rows,
    scope: 'Actual deployed Preview editor and CSS with synthetic public source. No private session, Production CMS writes, saved author content, baseline acceptance, human timing or field metrics.',
  }, null, 2));
}

module.exports = { captureEditorTasks, withExampleImages, editorFixtureRoute };
