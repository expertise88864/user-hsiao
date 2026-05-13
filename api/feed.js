/**
 * GET /blog/feed.xml — dynamic RSS 2.0 feed.
 * GET /blog/atom.xml — dynamic Atom 1.0 feed.
 *
 * Routed via vercel.json. Decides format from req.url path suffix.
 *
 * v29 additions vs static _gen_feeds.py output:
 *   - <enclosure> tag per <item> pointing to /assets/og/<slug>.png (RSS)
 *     so feed readers like Feedly show a rich preview card
 *   - <media:content> + <media:thumbnail> using yahoo media RSS namespace
 *   - <content:encoded> with full description (uses meta description from
 *     the actual article HTML)
 *   - lastBuildDate = max of all article lastmods (from git)
 */
import { ghGetFile, getRepoConfig } from './admin/_auth.js';

const DOMAIN = 'https://hsiao.chendermatologist.com';
const SITE_NAME = 'HsiaoEye · 蕭閔謙醫師 眼科筆記';
const AUTHOR = '蕭閔謙 醫師';
const EMAIL = 'f94001115@gmail.com';

function escapeXml(s) {
  return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
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

  const arr = [];
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
    arr.push({
      slug,
      title: getField(body, 'title'),
      title_en: getField(body, 'title_en'),
      tag: getField(body, 'tag'),
      tag_en: getField(body, 'tag_en'),
      date: getField(body, 'date') || '2026-01-01',
      cat: getField(body, 'cat'),
    });
  }
  return arr;
}

async function fetchDescription(slug) {
  try {
    const f = await ghGetFile(`blog/${slug}.html`);
    if (!f) return '';
    const m = f.content.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
    return m ? m[1] : '';
  } catch (e) { return ''; }
}

function buildRss(articles, descriptions) {
  const today = new Date().toUTCString();
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" ' +
      'xmlns:atom="http://www.w3.org/2005/Atom" ' +
      'xmlns:content="http://purl.org/rss/1.0/modules/content/" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
      'xmlns:media="http://search.yahoo.com/mrss/">',
    '<channel>',
    `  <title>${escapeXml(SITE_NAME)}</title>`,
    `  <link>${DOMAIN}/</link>`,
    `  <atom:link href="${DOMAIN}/blog/feed.xml" rel="self" type="application/rss+xml" />`,
    '  <description>蕭閔謙醫師（眼科）整理的眼科衛教與學習筆記。每月最多 1–2 篇新文章。</description>',
    '  <language>zh-Hant-TW</language>',
    `  <copyright>© ${new Date().getFullYear()} HsiaoEye · ${escapeXml(AUTHOR)}</copyright>`,
    `  <managingEditor>${EMAIL} (${escapeXml(AUTHOR)})</managingEditor>`,
    `  <webMaster>${EMAIL} (${escapeXml(AUTHOR)})</webMaster>`,
    `  <lastBuildDate>${today}</lastBuildDate>`,
    '  <generator>HsiaoEye dynamic feed v29 (/api/feed)</generator>',
    '  <image>',
    `    <url>${DOMAIN}/SUNN1302-200.jpg</url>`,
    '    <title>HsiaoEye</title>',
    `    <link>${DOMAIN}/</link>`,
    '    <width>144</width>',
    '    <height>144</height>',
    '  </image>',
    '',
  ];
  articles.slice(0, 30).forEach(a => {
    let pubDate;
    try {
      const d = new Date(a.date + 'T00:00:00Z');
      pubDate = d.toUTCString();
    } catch (e) { pubDate = today; }
    const ogUrl = `${DOMAIN}/assets/og/${a.slug}.png`;
    const desc  = descriptions[a.slug] || `${a.title} — ${AUTHOR}（眼科）整理的衛教文章。`;
    lines.push(
      '  <item>',
      `    <title>${escapeXml(a.title)}</title>`,
      `    <link>${DOMAIN}/blog/${a.slug}</link>`,
      `    <guid isPermaLink="true">${DOMAIN}/blog/${a.slug}</guid>`,
      `    <pubDate>${pubDate}</pubDate>`,
      `    <dc:creator>${escapeXml(AUTHOR)}</dc:creator>`,
      `    <category>${escapeXml(a.tag)}</category>`,
      `    <description>${escapeXml(desc)}</description>`,
      // Feedly / NetNewsWire pick up <enclosure> as a rich preview image
      `    <enclosure url="${ogUrl}" type="image/png" length="0" />`,
      `    <media:content url="${ogUrl}" type="image/png" medium="image" />`,
      `    <media:thumbnail url="${ogUrl}" />`,
      `    <content:encoded><![CDATA[<p>${escapeXml(desc)}</p><p><a href="${DOMAIN}/blog/${a.slug}">繼續閱讀全文 →</a></p><p><img src="${ogUrl}" alt="${escapeXml(a.title)}" /></p>]]></content:encoded>`,
      '  </item>',
    );
  });
  lines.push('</channel>', '</rss>');
  return lines.join('\n') + '\n';
}

function buildAtom(articles, descriptions) {
  const today = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xml:lang="zh-Hant-TW">',
    `  <title>${escapeXml(SITE_NAME)}</title>`,
    '  <subtitle>眼科衛教與學習筆記</subtitle>',
    `  <link href="${DOMAIN}/" rel="alternate" />`,
    `  <link href="${DOMAIN}/blog/atom.xml" rel="self" />`,
    `  <id>${DOMAIN}/</id>`,
    `  <updated>${today}</updated>`,
    '  <author>',
    `    <name>${escapeXml(AUTHOR)}</name>`,
    `    <email>${EMAIL}</email>`,
    `    <uri>${DOMAIN}/about</uri>`,
    '  </author>',
    `  <rights>© ${new Date().getFullYear()} ${escapeXml(AUTHOR)}</rights>`,
    `  <generator uri="${DOMAIN}">HsiaoEye dynamic feed v29</generator>`,
    '',
  ];
  articles.slice(0, 30).forEach(a => {
    let iso;
    try { iso = new Date(a.date + 'T00:00:00Z').toISOString().replace(/\.\d+Z$/, 'Z'); }
    catch (e) { iso = today; }
    const ogUrl = `${DOMAIN}/assets/og/${a.slug}.png`;
    const desc  = descriptions[a.slug] || `${a.title} — ${AUTHOR}（眼科）整理的衛教文章。`;
    lines.push(
      '  <entry>',
      `    <title>${escapeXml(a.title)}</title>`,
      `    <link href="${DOMAIN}/blog/${a.slug}" rel="alternate" />`,
      `    <link href="${ogUrl}" rel="enclosure" type="image/png" />`,
      `    <id>${DOMAIN}/blog/${a.slug}</id>`,
      `    <updated>${iso}</updated>`,
      `    <published>${iso}</published>`,
      `    <category term="${escapeXml(a.tag)}" />`,
      `    <summary>${escapeXml(desc)}</summary>`,
      `    <media:thumbnail url="${ogUrl}" />`,
      `    <content type="html"><![CDATA[<p>${escapeXml(desc)}</p><p><img src="${ogUrl}" alt="${escapeXml(a.title)}" /></p><p><a href="${DOMAIN}/blog/${a.slug}">繼續閱讀全文 →</a></p>]]></content>`,
      '  </entry>',
    );
  });
  lines.push('</feed>');
  return lines.join('\n') + '\n';
}

// FNV-1a 32-bit hash → ETag
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
  const fmt = (req.query && req.query.fmt) || '';
  const u = req.url || '';
  const isAtom = fmt === 'atom' || /atom/i.test(u);
  try {
    const tA0 = Date.now();
    const articles = await parseArticles();
    articles.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const top = articles.slice(0, 30);
    const tA = Date.now() - tA0;

    const tD0 = Date.now();
    const descriptions = {};
    await Promise.all(top.map(async a => { descriptions[a.slug] = await fetchDescription(a.slug); }));
    const tD = Date.now() - tD0;

    const xml = isAtom ? buildAtom(top, descriptions) : buildRss(top, descriptions);
    const etag = etagOf(xml);
    const tTotal = Date.now() - t0;
    const serverTiming = `articles;dur=${tA}, descs;dur=${tD}, total;dur=${tTotal}`;

    res.setHeader('Content-Type', isAtom ? 'application/atom+xml; charset=utf-8' : 'application/rss+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
    res.setHeader('ETag', etag);
    res.setHeader('Server-Timing', serverTiming);

    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.status(200).send(xml);
  } catch (e) {
    res.status(500).send(`<?xml version="1.0"?><error>${String(e.message || e)}</error>`);
  }
}
