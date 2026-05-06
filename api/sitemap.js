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
  { url: '/blog/',         priority: '0.95', changefreq: 'weekly' },
  { url: '/blog/topics',   priority: '0.7',  changefreq: 'monthly' },
  { url: '/notes',         priority: '0.5',  changefreq: 'monthly' },
  { url: '/privacy',       priority: '0.4',  changefreq: 'yearly' },
];

async function parseArticles() {
  const file = await ghGetFile('blog/blog-shared.js');
  if (!file) return [];
  const m = file.content.match(/DN\.ARTICLES\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) return [];
  const articles = [];
  const re = /\{\s*slug\s*:\s*'([^']+)'[^}]*?title\s*:\s*'([^']+)'[^}]*?(?:tag\s*:\s*'([^']*)')?[^}]*?(?:date\s*:\s*'([^']*)')?[^}]*?(?:cat\s*:\s*'([^']*)')?[^}]*\}/g;
  let row;
  while ((row = re.exec(m[1])) !== null) {
    articles.push({ slug: row[1], title: row[2], tag: row[3] || '', date: row[4] || '2026-01-01', cat: row[5] || 'myth' });
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

function emit(zhUrl, enUrl, lastmod, changefreq, priority, image, imageTitle) {
  const lines = ['  <url>', `    <loc>${DOMAIN}${zhUrl}</loc>`];
  lines.push(`    <lastmod>${lastmod}</lastmod>`);
  lines.push(`    <changefreq>${changefreq}</changefreq>`);
  lines.push(`    <priority>${priority}</priority>`);
  lines.push(`    <xhtml:link rel="alternate" hreflang="x-default"  href="${DOMAIN}${zhUrl}" />`);
  lines.push(`    <xhtml:link rel="alternate" hreflang="zh-Hant-TW" href="${DOMAIN}${zhUrl}" />`);
  lines.push(`    <xhtml:link rel="alternate" hreflang="en"         href="${DOMAIN}${enUrl}" />`);
  if (image) {
    lines.push('    <image:image>');
    lines.push(`      <image:loc>${image}</image:loc>`);
    if (imageTitle) lines.push(`      <image:title>${imageTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</image:title>`);
    lines.push('    </image:image>');
  }
  lines.push('  </url>');
  return lines.join('\n');
}

export default async function handler(req, res) {
  try {
    const articles = await parseArticles();
    articles.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const today = new Date().toISOString().slice(0, 10);

    // Fetch real lastmods from git for each article (best-effort)
    const articlePaths = articles.map(a => `blog/${a.slug}.html`);
    const lastmods = await batchLastmod(articlePaths);

    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
      '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"',
      '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
      '',
      '  <!-- ===== Chinese (canonical) ===== -->',
    ];

    STATIC_PAGES.forEach(p => {
      const en = p.url === '/' ? '/en/' : (p.url === '/blog/' ? '/en/blog/' : '/en' + p.url);
      lines.push(emit(p.url, en, today, p.changefreq, p.priority));
    });

    lines.push('', '  <!-- ===== Published articles ===== -->');
    articles.forEach(a => {
      const lastmod = lastmods[`blog/${a.slug}.html`] || a.date;
      lines.push(emit(`/blog/${a.slug}`, `/en/blog/${a.slug}`, lastmod, 'monthly', '0.95',
        `${DOMAIN}/assets/og/${a.slug}.png`, a.title));
    });

    lines.push('', '  <!-- ===== English mirror (/en/) ===== -->');
    STATIC_PAGES.forEach(p => {
      const en = p.url === '/' ? '/en/' : (p.url === '/blog/' ? '/en/blog/' : '/en' + p.url);
      const pri = Math.max(0.3, parseFloat(p.priority) - 0.1).toFixed(2);
      lines.push('  <url>',
        `    <loc>${DOMAIN}${en}</loc>`,
        `    <lastmod>${today}</lastmod>`,
        `    <changefreq>${p.changefreq}</changefreq>`,
        `    <priority>${pri}</priority>`,
        `    <xhtml:link rel="alternate" hreflang="x-default"  href="${DOMAIN}${p.url}" />`,
        `    <xhtml:link rel="alternate" hreflang="zh-Hant-TW" href="${DOMAIN}${p.url}" />`,
        `    <xhtml:link rel="alternate" hreflang="en"         href="${DOMAIN}${en}" />`,
        '  </url>');
    });
    articles.forEach(a => {
      const lastmod = lastmods[`blog/${a.slug}.html`] || a.date;
      lines.push('  <url>',
        `    <loc>${DOMAIN}/en/blog/${a.slug}</loc>`,
        `    <lastmod>${lastmod}</lastmod>`,
        '    <changefreq>monthly</changefreq>',
        '    <priority>0.85</priority>',
        `    <xhtml:link rel="alternate" hreflang="x-default"  href="${DOMAIN}/blog/${a.slug}" />`,
        `    <xhtml:link rel="alternate" hreflang="zh-Hant-TW" href="${DOMAIN}/blog/${a.slug}" />`,
        `    <xhtml:link rel="alternate" hreflang="en"         href="${DOMAIN}/en/blog/${a.slug}" />`,
        '  </url>');
    });

    lines.push('', '</urlset>');
    const xml = lines.join('\n') + '\n';

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=21600, stale-while-revalidate=86400');
    res.status(200).send(xml);
  } catch (e) {
    res.status(500).send(`<?xml version="1.0"?><error>${String(e.message || e)}</error>`);
  }
}
