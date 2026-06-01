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
function parseSlugSet(src, name) {
  const block = src.match(new RegExp(`DN\\.${name}\\s*=\\s*new\\s+Set\\(\\s*\\[([\\s\\S]*?)\\]`));
  return new Set(block ? Array.from(block[1].matchAll(/'([^']+)'/g), m => m[1]) : []);
}

function getPublishedArticleCatalog() {
  const sharedPath = path.join(ROOT, 'blog', 'blog-shared.js');
  const src = fs.readFileSync(sharedPath, 'utf8');
  const articles = src.match(/DN\.ARTICLES\s*=\s*\[([\s\S]*?)\];/);
  if (!articles) throw new Error('Could not parse DN.ARTICLES from blog/blog-shared.js');

  const slugs = Array.from(articles[1].matchAll(/slug:\s*'([^']+)'/g), m => m[1]);
  const stubs = parseSlugSet(src, 'STUB_SLUGS');
  const enStubs = parseSlugSet(src, 'EN_STUB_SLUGS');
  return {
    slugs: slugs.filter(slug => !stubs.has(slug)),
    enStubs,
  };
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

const STATIC_OG_SLUGS = ['home', 'about', 'tools', 'notes', 'privacy', 'blog', 'topics'];
const ARTICLE_CATALOG = getPublishedArticleCatalog();
const ARTICLE_SLUGS = ARTICLE_CATALOG.slugs;
const EN_STUB_SLUGS = ARTICLE_CATALOG.enStubs;
const EN_ARTICLE_SLUGS = ARTICLE_SLUGS.filter(slug => !EN_STUB_SLUGS.has(slug));
const PUBLIC_PATHS = Array.from(new Set([
  ...STATIC_PUBLIC_PATHS,
  ...ARTICLE_SLUGS.map(slug => `/blog/${slug}`),
  ...EN_ARTICLE_SLUGS.map(slug => `/en/blog/${slug}`),
]));

function isGatedZhArticleUrl(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(/^https:\/\/hsiao\.chendermatologist\.com\/blog\/([a-z0-9-]+)(?:#.*)?$/);
  return Boolean(match && EN_STUB_SLUGS.has(match[1]));
}

function walkValues(obj, visit) {
  if (Array.isArray(obj)) return obj.forEach(x => walkValues(x, visit));
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      visit(k, v, obj);
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

      // 6b. OpenSearch discovery for browser/search-tool site search.
      const openSearch = page.locator('head link[rel="search"][type="application/opensearchdescription+xml"]');
      await expect(openSearch, 'OpenSearch discovery link missing').toHaveCount(1);
      await expect(openSearch, 'OpenSearch link should point to /opensearch.xml').toHaveAttribute('href', '/opensearch.xml');

      const jsonFeed = page.locator('head link[rel="alternate"][type="application/feed+json"]');
      await expect(jsonFeed, 'JSON Feed autodiscovery link missing').toHaveCount(1);
      await expect(jsonFeed, 'JSON Feed link should point to /blog/feed.json').toHaveAttribute('href', '/blog/feed.json');

      // 7. og:url, og:title, og:image
      const ogUrl = await page.locator('head meta[property="og:url"]').getAttribute('content');
      expect(ogUrl, 'og:url missing').toBeTruthy();
      expect(ogUrl, 'og:url must match canonical').toBe(canonical);
      const ogTitle = await page.locator('head meta[property="og:title"]').getAttribute('content');
      expect(ogTitle, 'og:title missing').toBeTruthy();
      const ogDesc = await page.locator('head meta[property="og:description"]').getAttribute('content');
      expect(ogDesc, 'og:description missing').toBeTruthy();
      expect(ogDesc.length, 'og:description too short').toBeGreaterThan(45);
      const expectedOgLocale = path.startsWith('/en/') || path === '/en/' ? 'en_US' : 'zh_TW';
      const expectedOgAlternate = expectedOgLocale === 'en_US' ? 'zh_TW' : 'en_US';
      await expect(page.locator('head meta[property="og:locale"]'), 'og:locale missing/duplicated').toHaveCount(1);
      await expect(page.locator('head meta[property="og:locale"]'), 'og:locale should match page language').toHaveAttribute('content', expectedOgLocale);
      await expect(page.locator('head meta[property="og:locale:alternate"]'), 'og:locale:alternate missing/duplicated').toHaveCount(1);
      await expect(page.locator('head meta[property="og:locale:alternate"]'), 'og:locale:alternate should point at sibling locale').toHaveAttribute('content', expectedOgAlternate);
      const ogImage = await page.locator('head meta[property="og:image"]').getAttribute('content');
      expect(ogImage, 'og:image missing').toBeTruthy();
      expect(ogImage, 'og:image must be absolute https URL').toMatch(/^https:\/\//);
      expect(ogImage, 'og:image should be served from the canonical site').toContain(SITE);
      const ogImageWidth = await page.locator('head meta[property="og:image:width"]').getAttribute('content');
      expect(ogImageWidth, 'og:image:width must be 1200 for large preview cards').toBe('1200');
      const ogImageHeight = await page.locator('head meta[property="og:image:height"]').getAttribute('content');
      expect(ogImageHeight, 'og:image:height must be 630 for large preview cards').toBe('630');
      const ogImageAlt = await page.locator('head meta[property="og:image:alt"]').getAttribute('content');
      expect(ogImageAlt, 'og:image:alt missing').toBeTruthy();
      expect(ogImageAlt.length, 'og:image:alt too short').toBeGreaterThan(7);
      const twitterCard = await page.locator('head meta[name="twitter:card"]').getAttribute('content');
      expect(twitterCard, 'twitter:card must request a large image card').toBe('summary_large_image');
      const twitterImage = await page.locator('head meta[name="twitter:image"]').getAttribute('content');
      expect(twitterImage, 'twitter:image must match og:image').toBe(ogImage);
      const twitterImageAlt = await page.locator('head meta[name="twitter:image:alt"]').getAttribute('content');
      expect(twitterImageAlt, 'twitter:image:alt missing').toBeTruthy();
      expect(twitterImageAlt.length, 'twitter:image:alt too short').toBeGreaterThan(7);
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
          walkValues(parsed, (k, v, owner) => {
            if (k === 'inLanguage' && !isGatedZhArticleUrl(owner.url) && !isGatedZhArticleUrl(owner['@id'])) {
              expect(JSON.stringify(v), `English page JSON-LD #${i + 1} has zh inLanguage`).not.toMatch(/zh/i);
            }
            if ((k === 'url' || k === 'mainEntityOfPage') && typeof v === 'string' && v.startsWith(SITE)) {
              if (/\/(blog|about|tools|notes|privacy)(\/|$)/.test(path)) {
                if (!isGatedZhArticleUrl(v)) {
                  expect(v, `English page JSON-LD #${i + 1} URL should point at /en/ when page-scoped`).not.toMatch(/^https:\/\/hsiao\.chendermatologist\.com\/(blog|about|tools|notes|privacy)(\/|$)/);
                }
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
  for (const slug of EN_STUB_SLUGS) {
    expect(xml, `gated English mirror leaked into sitemap: ${slug}`).not.toContain(`${SITE}/en/blog/${slug}`);
  }
});

test('llms.txt indexes published articles without private paths', async ({ request }) => {
  const r = await request.get(BASE + '/llms.txt');
  expect(r.ok()).toBeTruthy();
  const txt = await r.text();
  expect(txt).toMatch(/^# HsiaoEye/);
  for (const slug of ARTICLE_SLUGS) {
    expect(txt, `missing ZH URL for ${slug}`).toContain(`${SITE}/blog/${slug}`);
    if (EN_STUB_SLUGS.has(slug)) {
      expect(txt, `gated EN URL leaked into llms.txt for ${slug}`).not.toContain(`${SITE}/en/blog/${slug}`);
    } else {
      expect(txt, `missing EN URL for ${slug}`).toContain(`${SITE}/en/blog/${slug}`);
    }
  }
  expect(txt).toContain(`${SITE}/blog/feed.xml`);
  expect(txt).toContain(`${SITE}/blog/atom.xml`);
  expect(txt).toContain(`${SITE}/blog/feed.json`);
  expect(txt).toContain(`${SITE}/opensearch.xml`);
  expect(txt).toContain(`${SITE}/assets/search-index.json`);
  expect(txt).not.toMatch(/\/admin|\/api|reset-sw/);
});

test('opensearch.xml advertises site article search', async ({ request }) => {
  const r = await request.get(BASE + '/opensearch.xml');
  expect(r.ok()).toBeTruthy();
  expect(r.headers()['content-type']).toMatch(/opensearchdescription\+xml|xml/);
  const xml = await r.text();
  expect(xml).toMatch(/<OpenSearchDescription\b/);
  expect(xml).toMatch(/<ShortName>HsiaoEye<\/ShortName>/);
  expect(xml).toContain(`${SITE}/blog?q={searchTerms}`);
  expect(xml).toContain(`<SearchForm>${SITE}/blog</SearchForm>`);
});

test('JSON Feed exposes rich article metadata', async ({ request }) => {
  const r = await request.get(BASE + '/blog/feed.json');
  expect(r.ok()).toBeTruthy();
  expect(r.headers()['content-type']).toMatch(/feed\+json|json/);
  const feed = await r.json();
  expect(feed.version).toBe('https://jsonfeed.org/version/1.1');
  expect(feed.feed_url).toBe(`${SITE}/blog/feed.json`);
  expect(feed.items.length).toBe(Math.min(30, ARTICLE_SLUGS.length));
  for (const item of feed.items) {
    expect(item.url).toMatch(/^https:\/\/hsiao\.chendermatologist\.com\/blog\//);
    expect(item.summary.length).toBeGreaterThan(60);
    expect(item.image).toMatch(/^https:\/\/hsiao\.chendermatologist\.com\/assets\/og\/.+\.png$/);
    expect(item.content_html).toContain(item.image);
    expect(item.attachments[0].mime_type).toBe('image/png');
    const slug = item.url.split('/').pop();
    if (EN_STUB_SLUGS.has(slug)) {
      expect(item._hsiaoeye.english_url, `gated EN URL leaked into JSON Feed for ${slug}`).toBeUndefined();
    } else {
      expect(item._hsiaoeye.english_url).toMatch(/^https:\/\/hsiao\.chendermatologist\.com\/en\/blog\//);
    }
  }
});

test('search-index.json indexes only published bilingual articles', async ({ request }) => {
  const r = await request.get(BASE + '/assets/search-index.json');
  expect(r.ok()).toBeTruthy();
  const index = await r.json();
  expect(Array.isArray(index)).toBeTruthy();
  expect(index.length).toBe(ARTICLE_SLUGS.length + EN_ARTICLE_SLUGS.length);
  for (const slug of ARTICLE_SLUGS) {
    expect(index.some(item => item.slug === slug && item.lang === 'zh-Hant-TW' && item.url === `/blog/${slug}`), `missing zh index entry for ${slug}`).toBeTruthy();
    const hasEnEntry = index.some(item => item.slug === slug && item.lang === 'en' && item.url === `/en/blog/${slug}`);
    expect(hasEnEntry, `${EN_STUB_SLUGS.has(slug) ? 'gated' : 'missing'} en index entry for ${slug}`).toBe(!EN_STUB_SLUGS.has(slug));
  }
  expect(JSON.stringify(index)).not.toMatch(/cataract-surgery-faq|glaucoma-warnings|contact-lens-safety|red-eye-conjunctivitis/);
});

test('untranslated English mirrors stay noindex and out of hreflang discovery', async ({ page }) => {
  for (const slug of EN_STUB_SLUGS) {
    const pagePath = `/en/blog/${slug}`;
    const resp = await page.goto(BASE + pagePath, { waitUntil: 'domcontentloaded' });
    expect(resp.ok(), `non-2xx for gated mirror ${pagePath}`).toBeTruthy();
    await expect(page.locator('head meta[name="robots"]'), `${pagePath} should stay noindex`).toHaveAttribute('content', /noindex/);
    await expect(page.locator('head link[rel="alternate"][hreflang]'), `${pagePath} should not advertise hreflang`).toHaveCount(0);
    await expect(page.locator('head link[rel="canonical"]'), `${pagePath} should keep a self canonical`).toHaveAttribute('href', `${SITE}${pagePath}`);
  }
});

test('Cmd+K search finds published content and hides stubs', async ({ page }) => {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.locator('button[aria-label="搜尋"], button[aria-label="Search"]').first().click();
  await expect(page.locator('#hs-cmdk-input')).toBeVisible();
  await page.locator('#hs-cmdk-input').fill('乾眼症');
  await expect(page.locator('#hs-cmdk-results .row').first()).toBeVisible();
  await expect(page.locator('#hs-cmdk-results')).not.toContainText('cataract-surgery-faq');

  await page.locator('#hs-cmdk-input').fill('cataract surgery faq');
  await expect(page.locator('#hs-cmdk-empty')).toBeVisible();
});

test('referenced core assets exist', async ({ request }) => {
  const paths = [
    '/favicon.ico',
    '/icon-16.png',
    '/icon-32.png',
    '/icon-192.png',
    '/icon-512.png',
    '/apple-touch-icon.png',
    '/assets/search-index.json',
    '/opensearch.xml',
    '/blog/feed.json',
    ...STATIC_OG_SLUGS.map(slug => `/assets/og/${slug}.png`),
    ...ARTICLE_SLUGS.map(slug => `/assets/og/${slug}.png`),
  ];
  for (const p of paths) {
    const r = await request.get(BASE + p);
    expect(r.ok(), `${p} should exist`).toBeTruthy();
  }
});
