const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block', timezoneId: 'America/Los_Angeles' });

const report = {
  metrics: [
    { name: 'LCP', source: 'ga4', status: 'mean_only', samples: 4, avg: 0, p75: null, windowDays: 7 },
    { name: 'CLS', source: 'kv', status: 'measured', samples: 1, avg: 0, p75: 0, windowDays: 7,
      method: 'web-vitals-6', percentileMethod: 'nearest-rank',
      oldestSampleAt: Date.UTC(2026, 9, 3, 12, 34, 56), newestSampleAt: Date.UTC(2026, 9, 3, 13, 34, 56) },
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

test('receipt times use explicit Taiwan time independently of browser timezone, with no invented GA4 times', async ({ page }) => {
  const cls = page.getByRole('row', { name: /^CLS / });
  await expect(cls).toContainText('web-vitals 6；原始樣本排序 p75');
  await expect(cls).toContainText('2026/10/03 20:34:56');
  await expect(cls).toContainText('2026/10/03 21:34:56');
  await expect(cls.locator('time').first()).toHaveAttribute('datetime', '2026-10-03T12:34:56.000Z');
  await expect(page.getByRole('row', { name: /^LCP / }).locator('time')).toHaveCount(0);
  await expect(page.locator('#cwv-result')).toContainText('收件時間，不代表造訪時間');
});
