const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
test.use({ serviceWorkers: 'block' });

test('ImageEncoder rejection still uploads native WebP and preserves the editable paragraph', async ({ page }) => {
  const source = readFileSync(path.join(__dirname, '../../blog/dry-eye-myths.html'), 'utf8');
  await page.addInitScript(() => { window.ImageEncoder = class { async encode() { throw Error('fixture unsupported codec'); } }; });
  await page.route('**/api/admin/save?*', route => route.fulfill({ json: { html: source, sha: 'a'.repeat(40) } }));
  await page.route('**/api/admin/offline-token', route => route.fulfill({ status: 503, json: {} }));
  const uploads = [];
  await page.route('**/api/admin/upload-srcset', async route => {
    uploads.push(route.request().postDataJSON());
    await route.fulfill({ json: { url: '/assets/article-img/codec-fixture.webp', imgSnippet: '<img src="/assets/article-img/codec-fixture.webp" alt="fixture">' } });
  });
  await page.goto('/blog/dry-eye-myths?admin=1');
  await expect(page.locator('#hs-adm-save')).toBeVisible();
  const paragraph = page.locator('#proseZh > p[contenteditable]').first();
  await paragraph.fill('中文原稿保留'); await paragraph.press('End');
  await page.locator('#hs-adm-img-input').setInputFiles({ name: 'fixture.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') });
  await expect(page.locator('#hs-admin-status')).toContainText('已插入');
  await expect(paragraph).toHaveText('中文原稿保留');
  expect(uploads).toHaveLength(1);
  // Real native canvas/Blob/FileReader encoding, with a fixture upload sink.
  const payload = JSON.stringify(uploads[0]);
  expect(payload).toContain('webp'); expect(payload).toMatch(/UklGR/);
});

test('offline page uses the same saved language key as the online reader', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('hs_lang', 'en'));
  await page.goto('/offline.html');
  await expect(page.locator('h1')).toContainText('offline');
});

test('English home search labels are English without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
  try {
    const page = await context.newPage(); await page.goto(baseURL + '/en/');
    await expect(page.locator('#hs-search-input')).toHaveAttribute('placeholder', 'Search article titles or keywords…');
    await expect(page.locator('#hs-search-input')).toHaveAttribute('aria-label', 'Search articles');
  } finally { await context.close(); }
});

test('runtime reading estimate preserves English word boundaries', async ({ page }) => {
  await page.goto('/blog/dry-eye-myths');
  await expect.poll(() => page.evaluate(() => !!window.DN)).toBe(true);
  await page.evaluate(() => {
    document.querySelector('#hs-reading-meta')?.remove();
    document.querySelector('#proseZh').textContent = Array(800).fill('reader').join(' ');
    delete DN.ARTICLES.find(article => article.slug === DN.currentSlug()).minutes;
    DN.addReadingMeta();
  });
  await expect(page.locator('#hs-reading-meta')).toContainText('4');
});

test('editor metadata recovery preserves English numbered labels within a Chinese summary', async ({ page }) => {
  await page.goto('/blog/dry-eye-myths');
  const recovered = await page.evaluate(async () => {
    const { readOverrides } = await import('/blog/editor-metadata.js?v=20260713');
    const value = { version: 1, descriptionZh: '中文摘要 · Outcome 1: unchanged · Day 1: follow-up' };
    const source = new DOMParser().parseFromString('<html><head><meta name="hs-editor-metadata" content="' +
      encodeURIComponent(JSON.stringify(value)) + '"></head></html>', 'text/html');
    return readOverrides(source);
  });
  expect(recovered.descriptionZh).toBe('中文摘要 · Outcome 1: unchanged · Day 1: follow-up');
});

test('six-item symptom organizer counts actual answers and never grades formal OSDI severity', async ({ page }) => {
  await page.goto('/tools');
  const tool = page.locator('#hs-osdi');
  await expect(tool).toBeVisible();
  await expect(tool.locator('[data-key]')).toHaveCount(6);
  for (const input of await tool.locator('input').all()) await expect(input).toHaveValue('');
  await tool.locator('[data-key="q1"]').fill('0');
  await tool.locator('[data-key="q2"]').fill('4');
  await expect(tool.locator('[data-result="score"]')).toHaveText('2 / 6');
  await expect(tool.locator('[data-result="interp"]')).toContainText('2.0 / 4');
  await expect(tool).not.toContainText(/重度乾眼|正常 \(OSDI|Cyclosporine|LipiFlow|IPL/);
  await page.selectOption('#langToggle', 'en');
  await expect(tool.locator('[data-result="interp"]')).toContainText('not confirm or exclude');
  await tool.locator('[data-key="q3"]').fill('4');
  await expect(tool.locator('[data-result="score"]')).toHaveText('3 / 6');
  await expect(tool.locator('[data-result="interp"]')).toContainText('2.7 / 4');
  await expect(tool.locator('[data-key="q1"]')).toHaveValue('0');
  await tool.locator('[data-key="q3"]').fill('8');
  await expect(tool.locator('[data-result="score"]')).toHaveText('2 / 6');
  await tool.locator('[data-key="q2"]').fill('');
  await expect(tool.locator('[data-result="score"]')).toHaveText('1 / 6');
  await expect(tool.locator('[data-result="interp"]')).toContainText('0.0 / 4');
});

test('one acute floater red flag requires same-day care; history alone is not an acute symptom', async ({ page }) => {
  await page.goto('/tools');
  const tool = page.locator('#hs-floater-rf');
  await expect(tool).toBeVisible();
  await tool.locator('[data-key="r1"]').selectOption('1');
  await expect(tool.locator('[data-result="interp"]')).toContainText('當天');
  await expect(tool.locator('[data-result="interp"]')).not.toContainText(/48|72/);
  await page.selectOption('#langToggle', 'en');
  await expect(tool.locator('[data-result="interp"]')).toContainText('same-day');
  await tool.locator('[data-key="r1"]').selectOption('0');
  await tool.locator('[data-key="r5"]').selectOption('1');
  await expect(tool.locator('[data-result="band"]')).toHaveText('History risk');
  await expect(tool.locator('[data-result="interp"]')).toContainText('Arrange assessment');
});

for (const failure of ['none', 'error', 'messageerror', 'explicit', 'timeout', 'constructor']) {
  test(`3D structure list and Worker recovery: ${failure}`, async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('https://cdn.jsdelivr.net/**', route => route.abort());
    // Native Worker and native canvas transfer; only its renderer is a fixture.
    await page.route('**/tools/eye-3d-worker.js?*', route => route.fulfill({ contentType: 'text/javascript', body:
      `self.onmessage = e => {
        if(e.data.type === 'init') {
          if(${JSON.stringify(failure)} === 'timeout') return;
          self.postMessage({type:'ready', renderer:'webgl'});
        }
        if(e.data.type === 'highlight') self.postMessage({type:'pick',id:e.data.id});
      };` }));
    await page.addInitScript(mode => {
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          if(mode === 'constructor') throw Error('fixture Worker unavailable');
          super(...args); window.__eyeWorker = this;
          const send = this.postMessage.bind(this);
          this.postMessage = (...messages) => { window.__eyeSends = (window.__eyeSends || 0) + 1; return send(...messages); };
        }
      };
      const transfer = HTMLCanvasElement.prototype.transferControlToOffscreen;
      HTMLCanvasElement.prototype.transferControlToOffscreen = function(...args) {
        window.__transferredEye = this; return transfer.apply(this, args);
      };
      if(mode === 'timeout') {
        const schedule = window.setTimeout;
        window.setTimeout = (fn, ms, ...args) => schedule(fn, ms === 15000 ? 25 : ms, ...args);
      }
    }, failure);
    await page.goto('/tools/eye-3d');
    await expect(page.locator('#part-list .part')).toHaveCount(9);
    if(failure === 'none') {
      await expect(page.locator('#eye-renderer-info')).toContainText('Worker');
      await page.locator('#part-list [data-id="retina"]').click();
      await expect(page.locator('#part-list [data-id="retina"]')).toHaveClass(/active/);
    } else {
      if(['error','messageerror','explicit'].includes(failure)) {
        await expect(page.locator('#eye-renderer-info')).toContainText('Worker');
        await page.evaluate(mode => {
          const event = mode === 'explicit' ? new MessageEvent('message', {data:{type:'error'}}) : new Event(mode);
          window.__eyeWorker.dispatchEvent(event);
        }, failure);
      }
      await expect(page.locator('#eye-renderer-info')).toContainText('Three.js');
      if(failure !== 'constructor') expect(await page.evaluate(() => document.querySelector('#eye-canvas') !== window.__transferredEye)).toBe(true);
      const sends = await page.evaluate(() => window.__eyeSends || 0);
      await page.locator('#btn-reset').click();
      expect(await page.evaluate(() => window.__eyeSends || 0)).toBe(sends);
    }
    expect(pageErrors).toEqual([]);
  });
}
