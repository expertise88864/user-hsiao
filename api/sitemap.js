/**
 * GET /sitemap.xml — dynamically generated sitemap.
 *
 * Source of truth: parses DN.ARTICLES from blog/blog-shared.js (so reorders /
 * new articles propagate immediately, no need to run _gen_feeds.py manually).
 *
 * lastmod: uses the latest commit timestamp for each article path (queried
 * via the GitHub API), so search engines see real "this article changed"
 * signals from admin edits or rollbacks. Falls back to date in DN.ARTICLES.
 *
 * Cached at the edge for 6 hours (s-maxage=21600) — bump it via a redeploy
 * or via the cache-purge endpoint (TODO).
 *
 * Note: This is wired up in vercel.json with a rewrite — `/sitemap.xml`
 * → `/api/sitemap` so the URL stays clean.
 */
import { ghGetFile, getRepoConfig } from './admin/_auth.js';

const DOMAIN = 'https://hsiao.chendermatologist.com';

const STATIC_PAGES = [
  { url: '/',              priority: '1.0',  changefreq: 'weekly' },
  { url: '/about',         priority: '0.8',  changefreq: 'monthly' },
  { url: '/tools',         priority: '0.85', changefreq: 'monthly' },
  { url: '/blog',          priority: '0.95', changefreq: 'weekly' },
  { url: '/blog/topics',   priority: '0.7',  changefreq: 'monthly' },
  { url: '/notes',         priority: '0.5',  changefreq: 'monthly' },
  { url: '/privacy',       priority: '0.4',  changefreq: 'yearly' },
];

const STATIC_OG_SLUGS = {
  '/': 'home',
  '/about': 'about',
  '/tools': 'tools',
  '/blog': 'blog',
  '/blog/topics': 'topics',
  '/notes': 'notes',
  '/privacy': 'privacy',
};

const STATIC_IMAGE_TITLES = {
  zh: {
    '/': '蕭閔謙醫師 眼科筆記 · 乾眼、近視控制、白內障衛教',
    '/about': '關於我 | 蕭閔謙醫師 · 眼科衛教筆記',
    '/tools': '眼科自評量表 · 5 個臨床計算器',
    '/blog': '眼科衛教文章索引',
    '/blog/topics': '主題地圖',
    '/notes': '學習筆記',
    '/privacy': '隱私權政策',
  },
  en: {
    '/': 'Dr. Min-Chien Hsiao Ophthalmology Notes',
    '/about': 'About Dr. Min-Chien Hsiao',
    '/tools': 'Ophthalmology Calculators',
    '/blog': 'Ophthalmology Articles',
    '/blog/topics': 'Ophthalmology Topic Map',
    '/notes': 'Ophthalmology Study Notes',
    '/privacy': 'Privacy Policy',
  },
};

function staticOgImage(path) {
  const slug = STATIC_OG_SLUGS[path];
  return slug ? `${DOMAIN}/assets/og/${slug}.png` : '';
}

function staticImageTitle(path, lang) {
  return (STATIC_IMAGE_TITLES[lang] && STATIC_IMAGE_TITLES[lang][path]) || 'HsiaoEye';
}

async function parseArticles() {
  const file = await ghGetFile('blog/blog-shared.js');
  if (!file) return [];
  const m = file.content.match(/DN\.ARTICLES\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) return [];
  const stubMatch = file.content.match(/DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]\s*\)/);
  const stubs = new Set();
  if (stubMatch) {
    for (const row of stubMatch[1].matchAll(/'([^']+)'/g)) stubs.add(row[1]);
  }
  const enStubMatch = file.content.match(/DN\.EN_STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]\s*\)/);
  const enStubs = new Set();
  if (enStubMatch) {
    for (const row of enStubMatch[1].matchAll(/'([^']+)'/g)) enStubs.add(row[1]);
  }

  const articles = [];
  const getField = (body, key) => {
    const mm = body.match(new RegExp(`${key}\\s*:\\s*'([^']*)'`));
    return mm ? mm[1] : '';
  };
  const re = /\{([\s\S]*?)\}/g;
  let row;
  while ((row = re.exec(m[1])) !== null) {
    const body = row[1];
    const slug = getField(body, 'slug');
    if (!slug || stubs.has(slug)) continue;
    articles.push({
      slug,
      title: getField(body, 'title'),
      title_en: getField(body, 'title_en'),
      tag: getField(body, 'tag'),
      tag_en: getField(body, 'tag_en'),
      date: getField(body, 'date') || '2026-01-01',
      updated: getField(body, 'updated') || getField(body, 'date') || '2026-01-01',
      cat: getField(body, 'cat') || 'myth',
      has_en: !enStubs.has(slug),
    });
  }
  return articles;
}

async function batchLastmod(paths) {
  // Query the latest commit per file from GitHub API in parallel.
  const { owner, repo, branch, token } = getRepoConfig();
  if (!token) return {};
  const map = {};
  await Promise.all(paths.map(async (p) => {
    try {
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits?path=${encodeURIComponent(p)}&sha=${branch}&per_page=1`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (r.ok) {
        const data = await r.json();
        if (data && data[0]) {
          const iso = data[0].commit?.author?.date || data[0].commit?.committer?.date;
          if (iso) map[p] = iso.slice(0, 10);
        }
      }
    } catch (e) { /* skip */ }
  }));
  return map;
}

function emit(zhUrl, enUrl, lastmod, changefreq, priority, image, imageTitle, includeEn = true) {
  const lines = ['  <url>', `    <loc>${DOMAIN}${zhUrl}</loc>`];
  lines.push(`    <lastmod>${lastmod}</lastmod>`);
  lines.push(`    <changefreq>${changefreq}</changefreq>`);
  lines.push(`    <priority>${priority}</priority>`);
  lines.push(`    <xhtml:link rel="alternate" hreflang="x-default"  href="${DOMAIN}${zhUrl}" />`);
  lines.push(`    <xhtml:link rel="alternate" hreflang="zh-Hant-TW" href="${DOMAIN}${zhUrl}" />`);
  if (includeEn) lines.push(`    <xhtml:link rel="alternate" hreflang="en"         href="${DOMAIN}${enUrl}" />`);
  if (image) {
    lines.push('    <image:image>');
    lines.push(`      <image:loc>${image}</image:loc>`);
    if (imageTitle) lines.push(`      <image:title>${xmlEscape(imageTitle)}</image:title>`);
    lines.push('    </image:image>');
  }
  lines.push('  </url>');
  return lines.join('\n');
}

function xmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function ymdToDate(value) {
  const d = new Date(`${value || '2026-01-01'}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? new Date('2026-01-01T00:00:00Z') : d;
}

function rfc822Date(value) {
  return ymdToDate(value).toUTCString();
}

function isFreshSince(headerValue, lastModified) {
  if (!headerValue) return false;
  const requestTime = Date.parse(headerValue);
  const modifiedTime = Date.parse(lastModified);
  return Number.isFinite(requestTime) && Number.isFinite(modifiedTime) && requestTime >= modifiedTime;
}

function etagMatches(headerValue, etag) {
  if (!headerValue) return false;
  return String(headerValue).split(',').map(v => v.trim()).includes(etag) || String(headerValue).trim() === '*';
}

// Build ETag from a string (FNV-1a 32-bit hash, hex-encoded — fast and edge-safe)
function etagOf(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return '"' + h.toString(16) + '"';
}

export default async function handler(req, res) {
  const t0 = Date.now();
  try {
    const tArt0 = Date.now();
    const articles = await parseArticles();
    articles.sort((a, b) => (b.updated || b.date || '').localeCompare(a.updated || a.date || ''));
    const tArt = Date.now() - tArt0;

    const siteUpdated = articles[0]?.updated || articles[0]?.date || '2026-01-01';

    // Fetch real lastmods from git for each article (best-effort)
    const tLm0 = Date.now();
    const articlePaths = articles.map(a => `blog/${a.slug}.html`);
    const lastmods = await batchLastmod(articlePaths);
    const tLm = Date.now() - tLm0;

    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
      '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"',
      '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
      '',
      '  <!-- ===== Chinese (canonical) ===== -->',
    ];

    STATIC_PAGES.forEach(p => {
      const en = p.url === '/' ? '/en' : '/en' + p.url;
      lines.push(emit(
        p.url,
        en,
        siteUpdated,
        p.changefreq,
        p.priority,
        staticOgImage(p.url),
        staticImageTitle(p.url, 'zh')
      ));
    });

    lines.push('', '  <!-- ===== Published articles ===== -->');
    articles.forEach(a => {
      const lastmod = lastmods[`blog/${a.slug}.html`] || a.date;
      lines.push(emit(`/blog/${a.slug}`, `/en/blog/${a.slug}`, lastmod, 'monthly', '0.95',
        `${DOMAIN}/assets/og/${a.slug}.png`, a.title, a.has_en));
    });

    lines.push('', '  <!-- ===== English mirror (/en/) ===== -->');
    STATIC_PAGES.forEach(p => {
      const en = p.url === '/' ? '/en' : '/en' + p.url;
      const pri = Math.max(0.3, parseFloat(p.priority) - 0.1).toFixed(2);
      const image = staticOgImage(p.url);
      lines.push('  <url>',
        `    <loc>${DOMAIN}${en}</loc>`,
        `    <lastmod>${siteUpdated}</lastmod>`,
        `    <changefreq>${p.changefreq}</changefreq>`,
        `    <priority>${pri}</priority>`,
        `    <xhtml:link rel="alternate" hreflang="x-default"  href="${DOMAIN}${p.url}" />`,
        `    <xhtml:link rel="alternate" hreflang="zh-Hant-TW" href="${DOMAIN}${p.url}" />`,
        `    <xhtml:link rel="alternate" hreflang="en"         href="${DOMAIN}${en}" />`);
      if (image) {
        lines.push('    <image:image>',
          `      <image:loc>${image}</image:loc>`,
          `      <image:title>${xmlEscape(staticImageTitle(p.url, 'en'))}</image:title>`,
          '    </image:image>');
      }
      lines.push('  </url>');
    });
    articles.forEach(a => {
      if (!a.has_en) return;
      const lastmod = lastmods[`blog/${a.slug}.html`] || a.date;
      lines.push('  <url>',
        `    <loc>${DOMAIN}/en/blog/${a.slug}</loc>`,
        `    <lastmod>${lastmod}</lastmod>`,
        '    <changefreq>monthly</changefreq>',
        '    <priority>0.85</priority>',
        `    <xhtml:link rel="alternate" hreflang="x-default"  href="${DOMAIN}/blog/${a.slug}" />`,
        `    <xhtml:link rel="alternate" hreflang="zh-Hant-TW" href="${DOMAIN}/blog/${a.slug}" />`,
        `    <xhtml:link rel="alternate" hreflang="en"         href="${DOMAIN}/en/blog/${a.slug}" />`,
        '    <image:image>',
        `      <image:loc>${DOMAIN}/assets/og/${a.slug}.png</image:loc>`,
        `      <image:title>${xmlEscape(a.title_en || a.title || a.slug)}</image:title>`,
        '    </image:image>',
        '  </url>');
    });

    lines.push('', '</urlset>');
    const xml = lines.join('\n') + '\n';

    const etag = etagOf(xml);
    const ifNoneMatch = req.headers['if-none-match'];
    const ifModifiedSince = req.headers['if-modified-since'];
    const lastModified = rfc822Date(siteUpdated);
    const tTotal = Date.now() - t0;
    const serverTiming = `articles;dur=${tArt}, lastmod;dur=${tLm}, total;dur=${tTotal}`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=21600, stale-while-revalidate=86400');
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', lastModified);
    res.setHeader('Server-Timing', serverTiming);

    if (etagMatches(ifNoneMatch, etag) || (!ifNoneMatch && isFreshSince(ifModifiedSince, lastModified))) {
      res.status(304).end();
      return;
    }
    res.status(200).send(xml);
  } catch (e) {
    res.status(500).send(`<?xml version="1.0"?><error>${xmlEscape(e.message || e)}</error>`);
  }
}
