const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const path = require('node:path');

test.use({ serviceWorkers: 'block' });

for (const format of ['svg', 'png']) {
  for (const selection of ['preserved', 'missing', 'outside']) {
    test(`${format} upload with ${selection} selection reports the actual insertion result`, async ({ page }) => {
      const source = readFileSync(path.join(__dirname, '../../blog/dry-eye-myths.html'), 'utf8');
      await page.route('**/api/admin/save?*', route => route.fulfill({ json: { html: source, sha: 'a'.repeat(40) } }));
      await page.route('**/api/admin/offline-token', route => route.fulfill({ status: 503, json: {} }));
      let release;
      const uploadGate = new Promise(resolve => { release = resolve; });
      let uploaded = false;
      const imageUrl = `/assets/article-img/upload-fixture.${format}`;
      await page.route(`**/api/admin/${format === 'svg' ? 'upload' : 'upload-srcset'}`, async route => {
        uploaded = true;
        await uploadGate;
        await route.fulfill({ json: { url: imageUrl, imgSnippet: `<img src="${imageUrl}" alt="fixture">` } });
      });
      await page.goto('/blog/dry-eye-myths?admin=1', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#hs-adm-save')).toBeVisible();
      const paragraph = page.locator('#proseZh > p[contenteditable]').first();
      await paragraph.fill('Preserved author paragraph');
      await paragraph.press('End');
      const buffer = format === 'svg'
        ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>')
        : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
      await page.locator('#hs-adm-img-input').setInputFiles({ name: `fixture.${format}`, mimeType: `image/${format === 'svg' ? 'svg+xml' : 'png'}`, buffer });
      try {
        await expect.poll(() => uploaded).toBe(true);
        if (selection !== 'preserved') {
          await page.evaluate(mode => {
            const selected = window.getSelection();
            selected.removeAllRanges();
            if (mode === 'outside') {
              const range = document.createRange();
              range.selectNodeContents(document.getElementById('hs-admin-bar'));
              range.collapse(true);
              selected.addRange(range);
            }
          }, selection);
        }
      } finally { release(); }
      const status = page.locator('#hs-admin-status');
      if (selection === 'preserved') {
        await expect(status).toContainText('已插入');
        await expect(page.locator(`#proseZh > figure img[src="${imageUrl}"]`)).toHaveCount(1);
      } else {
        await expect(status).toContainText('請先把游標放在文章正文內');
        await expect(status).not.toContainText('已插入');
        await expect(page.locator(`img[src="${imageUrl}"]`)).toHaveCount(0);
      }
      await expect(paragraph).toHaveText('Preserved author paragraph');
    });
  }
}
