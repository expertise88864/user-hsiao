const {test, expect} = require('@playwright/test');
test.use({serviceWorkers: 'block'});

for (const route of ['/', '/blog', '/en/', '/en/blog']) {
  test(`empty cache does not reload the document ${route}`, async ({page}) => {
    const documents = [];
    page.on('request', request => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url());
    });
    await page.goto(route);
    await page.waitForFunction(() => {
      const script = document.querySelector('script[src*="trusted-types.js"]');
      return script && localStorage.getItem('hs:siteVer') === new URL(script.src).searchParams.get('v');
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(documents).toHaveLength(1);
    await expect(page.locator('main')).toBeVisible();
  });
}

test('a previous offline cache is deleted before one epoch reload', async ({page}) => {
  await page.goto('/cache-epoch-fixture-not-found');
  await page.evaluate(async () => {
    localStorage.setItem('hs:siteVer', 'old');
    await caches.open('round3-old-offline-cache');
  });
  const documents = [];
  page.on('request', request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url());
  });
  await page.goto('/');
  await expect.poll(() => documents.length).toBe(2);
  await page.waitForFunction(() => {
    const script = document.querySelector('script[src*="trusted-types.js"]');
    return script && localStorage.getItem('hs:siteVer') === new URL(script.src).searchParams.get('v');
  });
  expect(await page.evaluate(() => caches.keys())).not.toContain('round3-old-offline-cache');
  await expect(page.locator('main')).toBeVisible();
});
