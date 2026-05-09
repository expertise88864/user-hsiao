// SEO smoke tests for HsiaoEye.
// Loads every public URL and verifies the <head> has all the SEO-critical
// metadata (canonical, hreflang, og:*, JSON-LD, viewport, lang attr).
//
// Run:  npm run test:seo
// CI:   wired into .github/workflows/quality.yml

const { test, expect } = require('@playwright/test');

const BASE = process.env.PW_BASE_URL || 'https://hsiao.chendermatologist.com';

// Public URLs — keep aligned with sitemap.xml. /admin and /404 deliberately
// excluded (admin private; 404 only renders on bad URLs).
const PUBLIC_PATHS = [
  '/',
  '/about',
  '/notes',
  '/privacy',
  '/tools',
  '/blog/',
  '/blog/topics',
  '/blog/dry-eye-myths',
  '/blog/floaters-retinal-detachment',
  '/blog/lacrimal-gland-tumor',
  '/blog/pediatric-myopia-control',
  '/blog/thyroid-eye-disease',
  '/en/',
  '/en/about',
  '/en/blog/',
  '/en/blog/thyroid-eye-disease',
];

for (const path of PUBLIC_PATHS) {
  test.describe(`SEO head — ${path}`, () => {
    test('canonical, hreflang, og:url, og:title, JSON-LD, lang, viewport', async ({ page }) => {
      const resp = await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
      expect(resp.ok(), `non-2xx for ${path}`).toBeTruthy();

      // 1. <html lang="...">
      const lang = await page.locator('html').getAttribute('lang');
      expect(lang, 'html lang attribute missing').toBeTruthy();

      // 2. <title>
      const title = await page.title();
      expect(title.length, 'empty <title>').toBeGreaterThan(5);
      expect(title.length, '<title> too long for SERP').toBeLessThan(80);

      // 3. <meta name="description">
      const desc = await page.locator('head meta[name="description"]').getAttribute('content');
      expect(desc, 'meta description missing').toBeTruthy();
      expect(desc.length, 'meta description too short').toBeGreaterThan(40);

      // 4. <meta name="viewport">
      const vp = await page.locator('head meta[name="viewport"]').count();
      expect(vp, 'viewport meta missing').toBeGreaterThan(0);

      // 5. <link rel="canonical">
      const canonical = await page.locator('head link[rel="canonical"]').getAttribute('href');
      expect(canonical, 'canonical link missing').toBeTruthy();
      expect(canonical, 'canonical not absolute https URL').toMatch(/^https:\/\//);

      // 6. <link rel="alternate" hreflang="...">
      const hreflangs = await page.locator('head link[rel="alternate"][hreflang]').count();
      expect(hreflangs, 'no hreflang alternate links').toBeGreaterThanOrEqual(2);

      // 7. og:url, og:title, og:image
      const ogUrl = await page.locator('head meta[property="og:url"]').getAttribute('content');
      expect(ogUrl, 'og:url missing').toBeTruthy();
      const ogTitle = await page.locator('head meta[property="og:title"]').getAttribute('content');
      expect(ogTitle, 'og:title missing').toBeTruthy();
      const ogImage = await page.locator('head meta[property="og:image"]').getAttribute('content');
      expect(ogImage, 'og:image missing').toBeTruthy();

      // 8. At least one valid JSON-LD block
      const ldBlocks = await page.locator('head script[type="application/ld+json"]').count();
      expect(ldBlocks, 'no JSON-LD').toBeGreaterThan(0);
      const firstLd = await page.locator('head script[type="application/ld+json"]').first().textContent();
      expect(() => JSON.parse(firstLd), 'JSON-LD parse error').not.toThrow();
    });
  });
}

test('robots.txt allows Googlebot, blocks GPTBot, allows ChatGPT-User', async ({ request }) => {
  const r = await request.get(BASE + '/robots.txt');
  expect(r.ok()).toBeTruthy();
  const txt = await r.text();
  // Googlebot must be allowed
  expect(txt).toMatch(/User-agent:\s*Googlebot[\s\S]*?Allow:\s*\//);
  // GPTBot training crawler must be blocked
  expect(txt).toMatch(/User-agent:\s*GPTBot[\s\S]*?Disallow:\s*\//);
  // ChatGPT-User (query-time) must NOT have a Disallow (covered by * Allow: /)
  expect(txt).not.toMatch(/User-agent:\s*ChatGPT-User\s*\nDisallow:\s*\//);
  // Sitemap directive present
  expect(txt).toMatch(/Sitemap:\s*https:\/\//);
});

test('sitemap.xml is valid XML and contains canonical URLs', async ({ request }) => {
  const r = await request.get(BASE + '/sitemap.xml');
  expect(r.ok()).toBeTruthy();
  const xml = await r.text();
  expect(xml).toMatch(/^<\?xml/);
  expect(xml).toMatch(/<urlset\b/);
  expect(xml.match(/<url>/g).length).toBeGreaterThan(10);
  expect(xml).toMatch(/https:\/\/hsiao\.chendermatologist\.com\/blog\/thyroid-eye-disease/);
});
