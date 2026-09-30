const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });

const report = {
  metrics: [
    { name: 'LCP', source: 'ga4', status: 'mean_only', samples: 4, avg: 0, p75: null, windowDays: 7 },
    { name: 'CLS', source: 'kv', status: 'measured', samples: 1, avg: 0, p75: 0, windowDays: 7 },
    { name: 'INP', source: null, status: 'unavailable', samples: null, avg: null, p75: null },
    { name: '<img src=x onerror=alert(1)>', source: 'kv', status: 'no_samples', samples: 0, p75: null },
  ], collection: { kv: { configured: true }, ga4: { status: 'partial' } },
};

test.beforeEach(async ({ page }) => {
  // Exercise the real dashboard HTML/asset with synthetic API responses.
  // This is UI validation, not proof of live GA4 or KV receipt.
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/admin/list') return route.fulfill({ json: { articles: [] } });
    if (path === '/api/admin/cwv') return route.fulfill({ json: report });
    return route.fulfill({ status: 503, json: {} });
  });
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-tab="cwv"]').click();
  await expect(page.locator('#cwv-result tbody tr')).toHaveCount(4);
});

test('missing percentiles stay neutral while measured zero and average-only data remain distinct', async ({ page }) => {
  const lcp = page.getByRole('row', { name: /^LCP / });
  await expect(lcp).toContainText('僅平均值，無法判定 p75');
  await expect(lcp.locator('td').first()).toHaveText('—');
  const cls = page.getByRole('row', { name: /^CLS / });
  await expect(cls.locator('td').first()).toHaveText('0.000');
  await expect(cls).toContainText('樣本 p75 良好');
  const inp = page.getByRole('row', { name: /^INP / });
  await expect(inp).toContainText('尚無可用數據');
  await expect(page.locator('#cwv-result img')).toHaveCount(0);
  await expect(page.locator('#cwv-result')).toContainText('<img src=x onerror=alert(1)>');
});

test('a narrow dashboard keeps its wide data table in a keyboard-scrollable region', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const region = page.getByRole('region', { name: '使用者體驗指標表，可橫向捲動' });
  expect(await region.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await region.focus();
  await region.press('ArrowRight');
  await expect.poll(() => region.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
});
