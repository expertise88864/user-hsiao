const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
test.use({ serviceWorkers: 'block' });

test('search responds before idle callbacks have run', async ({ page }) => {
  await page.addInitScript(() => { window.__idle = []; window.requestIdleCallback = cb => window.__idle.push(cb); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '搜尋', exact: true }).first().click();
  await expect(page.locator('#hs-cmdk-input')).toBeVisible();
});

test('one calculator failure does not prevent subsequent calculators', async ({ page }) => {
  await page.addInitScript(() => { window.__idle = []; window.requestIdleCallback = cb => window.__idle.push(cb); });
  await page.goto('/tools', { waitUntil: 'domcontentloaded' });
  const called = await page.evaluate(() => {
    const calls = [];
    for (const name of ['injectOSDI', 'injectDEQ5', 'injectSnellenLogMAR', 'injectSphericalEquivalent', 'injectFloaterRedFlag']) {
      DN[name] = () => { calls.push(name); if (name === 'injectOSDI') throw Error('fixture'); };
    }
    window.__idle.splice(0).forEach(cb => cb({ didTimeout: false, timeRemaining: () => 50 }));
    return calls;
  });
  expect(called).toHaveLength(5);
});

test('visual editor loads a fresh snapshot and sends its original version', async ({ page }) => {
  const source = readFileSync(path.join(__dirname, '../../blog/dry-eye-myths.html'), 'utf8')
    .replace('</head>', '<meta name="review-source" content="fresh-server-snapshot"></head>');
  const sha = createHash('sha1').update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest('hex');
  let submitted;
  await page.route('**/api/admin/save?*', route => route.fulfill({json: {html: source, sha}}));
  await page.route('**/api/admin/offline-token', route => route.fulfill({status:503,json:{}}));
  await page.route('**/api/admin/save', async route => {
    submitted = route.request().postDataJSON();
    await route.fulfill({status:409,json:{error:'fixture: newer remote edit'}});
  });
  await page.goto('/blog/dry-eye-myths?admin=1', {waitUntil:'domcontentloaded'});
  await expect(page.locator('#hs-adm-save')).toBeVisible();
  await page.locator('#proseZh p[contenteditable]').first().fill('Review fixture text');
  await page.locator('#hs-adm-save').click();
  await expect(page.locator('#hs-admin-status')).toContainText('newer remote edit');
  expect(submitted.baseSha).toBe(sha);
  expect(submitted.html).toContain('fresh-server-snapshot');
  expect(submitted.html).toContain('Review fixture text');
  expect(submitted.html).not.toContain('contenteditable=');
  expect(submitted.html).toContain('data-en=');
  const draft = await page.evaluate(() => DN.loadDraft('dry-eye-myths'));
  expect(draft.baseSha).toBe(sha);
  expect(draft.html).toContain('Review fixture text');
});


test('stale local draft is archived and downloadable before editing a fresh article', async ({ page }) => {
  const source = readFileSync(path.join(__dirname, '../../blog/dry-eye-myths.html'), 'utf8');
  const sha = createHash('sha1').update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest('hex');
  await page.route('**/api/admin/save?*', route => route.fulfill({json:{html:source,sha}}));
  await page.route('**/api/admin/offline-token', route => route.fulfill({status:503,json:{}}));
  await page.addInitScript(() => {
    localStorage.setItem('hs:draft-dry-eye-myths.json', JSON.stringify({slug:'dry-eye-myths',html:'<html>Old valuable draft</html>',baseSha:'a'.repeat(40),ts:12345}));
  });
  await page.goto('/blog/dry-eye-myths?admin=1', {waitUntil:'domcontentloaded'});
  await expect(page.getByRole('link', {name:'下載舊版本草稿'})).toBeVisible();
  const archive = await page.evaluate(() => DN.loadDraft('dry-eye-myths-conflict-12345'));
  expect(archive.html).toContain('Old valuable draft');
  await page.locator('#proseZh p[contenteditable]').first().fill('New work');
  const download = await page.getByRole('link', {name:'下載舊版本草稿'}).getAttribute('download');
  expect(download).toBe('dry-eye-myths-conflict.html');
});
