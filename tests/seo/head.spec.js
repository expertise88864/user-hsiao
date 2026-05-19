// SEO smoke tests for HsiaoEye.
// Loads every public URL and verifies the <head> has all the SEO-critical
// metadata (canonical, hreflang, og:*, JSON-LD, viewport, lang attr).
//
// Run:  npm run test:seo
// CI:   wired into .github/workflows/quality.yml

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = process.env.PW_BASE_URL || 'http://127.0.0.1:4173';
const SITE = 'https://hsiao.chendermatologist.com';
const ROOT = path.resolve(__dirname, '../..');

// Public URLs — keep aligned with sitemap.xml. /admin and /404 deliberately
// excluded (admin private; 404 only renders on bad URLs).
function getPublishedArticleSlugs() {
  const sharedPath = path.join(ROOT, 'blog', 'blog-shared.js');
  const src = fs.readFileSync(sharedPath, 'utf8');
  const articles = src.match(/DN\.ARTICLES\s*=\s*\[([\s\S]*?)\];/);
  if (!articles) throw new Error('Could not parse DN.ARTICLES from blog/blog-shared.js');

  const slugs = Array.from(articles[1].matchAll(/slug:\s*'([^']+)'/g), m => m[1]);
  const stubBlock = src.match(/DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]/);
  const stubs = new Set(stubBlock ? Array.from(stubBlock[1].matchAll(/'([^']+)'/g), m => m[1]) : []);
  return slugs.filter(slug => !stubs.has(slug));
}

const STATIC_PUBLIC_PATHS = [
  '/',
  '/about',
  '/notes',
  '/privacy',
  '/tools',
  '/blog/',
  '/blog/topics',
  '/en/',
  '/en/about',
  '/en/notes',
  '/en/privacy',
  '/en/tools',
  '/en/blog/',
];

const ARTICLE_SLUGS = getPublishedArticleSlugs();
const PUBLIC_PATHS = Array.from(new Set([
  ...STATIC_PUBLIC_PATHS,
  ...ARTICLE_SLUGS.flatMap(slug => [`/blog/${slug}`, `/en/blog/${slug}`]),
]));

function walkValues(obj, visit) {
  if (Array.isArray(obj)) return obj.forEach(x => walkValues(x, visit));
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      visit(k, v);
      walkValues(v, visit);
    }
  }
}

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
      expect(ogUrl, 'og:url must match canonical').toBe(canonical);
      const ogTitle = await page.locator('head meta[property="og:title"]').getAttribute('content');
      expect(ogTitle, 'og:title missing').toBeTruthy();
      const ogDesc = await page.locator('head meta[property="og:description"]').getAttribute('content');
      expect(ogDesc, 'og:description missing').toBeTruthy();
      expect(ogDesc.length, 'og:description too short').toBeGreaterThan(45);
      const ogImage = await page.locator('head meta[property="og:image"]').getAttribute('content');
      expect(ogImage, 'og:image missing').toBeTruthy();
      expect(ogImage, 'og:image must be absolute https URL').toMatch(/^https:\/\//);
      const twitterDesc = await page.locator('head meta[name="twitter:description"]').getAttribute('content');
      expect(twitterDesc, 'twitter:description missing').toBeTruthy();
      expect(twitterDesc.length, 'twitter:description too short').toBeGreaterThan(45);

      // 8. JSON-LD blocks must parse and agree with page language / URL.
      const ldBlocks = await page.locator('head script[type="application/ld+json"]').count();
      expect(ldBlocks, 'no JSON-LD').toBeGreaterThan(0);
      for (let i = 0; i < ldBlocks; i++) {
        const raw = await page.locator('head script[type="application/ld+json"]').nth(i).textContent();
        let parsed;
        expect(() => { parsed = JSON.parse(raw); }, `JSON-LD #${i + 1} parse error`).not.toThrow();
        if (path.startsWith('/en/')) {
          walkValues(parsed, (k, v) => {
            if (k === 'inLanguage') expect(JSON.stringify(v), `English page JSON-LD #${i + 1} has zh inLanguage`).not.toMatch(/zh/i);
            if ((k === 'url' || k === 'mainEntityOfPage') && typeof v === 'string' && v.startsWith(SITE)) {
              if (/\/(blog|about|tools|notes|privacy)(\/|$)/.test(path)) {
                expect(v, `English page JSON-LD #${i + 1} URL should point at /en/ when page-scoped`).not.toMatch(/^https:\/\/hsiao\.chendermatologist\.com\/(blog|about|tools|notes|privacy)(\/|$)/);
              }
            }
          });
        }
      }
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
  expect(xml).not.toMatch(/cataract-surgery-faq|glaucoma-warnings|contact-lens-safety|red-eye-conjunctivitis/);
});

test('referenced core assets exist', async ({ request }) => {
  const paths = [
    '/favicon.ico',
    '/icon-16.png',
    '/icon-32.png',
    '/icon-192.png',
    '/icon-512.png',
    '/apple-touch-icon.png',
    '/logo-512.png',
    ...ARTICLE_SLUGS.map(slug => `/assets/og/${slug}.png`),
  ];
  for (const p of paths) {
    const r = await request.get(BASE + p);
    expect(r.ok(), `${p} should exist`).toBeTruthy();
  }
});
