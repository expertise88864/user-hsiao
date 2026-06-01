/**
 * Dynamic RSS/Atom/JSON Feed for /blog/feed.xml, /blog/atom.xml, and
 * /blog/feed.json.
 *
 * Vercel rewrites those public XML URLs to this API route. Keep this file in
 * parity with _gen_feeds.py: published articles only, stable updated dates,
 * image enclosures, rich descriptions, and English alternates for Atom.
 */
import { ghGetFile } from './admin/_auth.js';

const DOMAIN = 'https://hsiao.chendermatologist.com';
const WEBSUB_HUB = 'https://pubsubhubbub.appspot.com/';
const SITE_NAME = 'HsiaoEye Ophthalmology Notes';
const AUTHOR = 'Min-Chien Hsiao, MD';
const EMAIL = 'f94001115@gmail.com';
const FEED_DESCRIPTION = 'Ophthalmology patient-education notes by Min-Chien Hsiao, MD, covering dry eye, pediatric myopia, cataract, glaucoma, retina, and common eye symptoms.';

function escapeXml(value) {
  return String(value == null ? '' : value).replace(/[<>&"']/g, c => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&apos;',
  }[c]));
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanText(value) {
  return stripTags(decodeHtml(value));
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

function atomDate(value) {
  return ymdToDate(value).toISOString().replace(/\.\d+Z$/, 'Z');
}

async function parseArticles() {
  const file = await ghGetFile('blog/blog-shared.js');
  if (!file) return [];
  const catalog = file.content.match(/DN\.ARTICLES\s*=\s*(\[[\s\S]*?\]);/);
  if (!catalog) return [];

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

  const rows = [];
  const getField = (body, key) => {
    const found = body.match(new RegExp(`${key}\\s*:\\s*'([^']*)'`));
    return found ? found[1] : '';
  };

  const rowRe = /\{([\s\S]*?)\}/g;
  let row;
  while ((row = rowRe.exec(catalog[1])) !== null) {
    const body = row[1];
    const slug = getField(body, 'slug');
    const title = getField(body, 'title');
    if (!slug || !title || stubs.has(slug)) continue;
    const date = getField(body, 'date') || '2026-01-01';
    rows.push({
      slug,
      title,
      title_en: getField(body, 'title_en'),
      tag: getField(body, 'tag'),
      tag_en: getField(body, 'tag_en'),
      date,
      updated: getField(body, 'updated') || date,
      cat: getField(body, 'cat') || 'myth',
      has_en: !enStubs.has(slug),
    });
  }
  return rows;
}

async function fetchDescription(slug) {
  try {
    const file = await ghGetFile(`blog/${slug}.html`);
    if (!file) return '';
    const meta = file.content.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
    return meta ? cleanText(meta[1]) : '';
  } catch (e) {
    return '';
  }
}

function articleSummary(article, descriptions) {
  return descriptions[article.slug] || `${article.title} - HsiaoEye ophthalmology patient education.`;
}

function rssItem(article, descriptions) {
  const url = `${DOMAIN}/blog/${article.slug}`;
  const ogUrl = `${DOMAIN}/assets/og/${article.slug}.png`;
  const desc = articleSummary(article, descriptions);
  return [
    '  <item>',
    `    <title>${escapeXml(article.title)}</title>`,
    `    <link>${url}</link>`,
    `    <guid isPermaLink="true">${url}</guid>`,
    `    <pubDate>${rfc822Date(article.date)}</pubDate>`,
    `    <dc:creator>${escapeXml(AUTHOR)}</dc:creator>`,
    `    <category>${escapeXml(article.tag)}</category>`,
    `    <description>${escapeXml(desc)}</description>`,
    `    <enclosure url="${ogUrl}" type="image/png" length="0" />`,
    `    <media:content url="${ogUrl}" type="image/png" medium="image" />`,
    `    <media:thumbnail url="${ogUrl}" />`,
    `    <content:encoded><![CDATA[<p>${escapeXml(desc)}</p><p><a href="${url}">Read the full article</a></p><p><img src="${ogUrl}" alt="${escapeXml(article.title)}" /></p>]]></content:encoded>`,
    '  </item>',
  ].join('\n');
}

function atomEntry(article, descriptions) {
  const url = `${DOMAIN}/blog/${article.slug}`;
  const enUrl = `${DOMAIN}/en/blog/${article.slug}`;
  const ogUrl = `${DOMAIN}/assets/og/${article.slug}.png`;
  const desc = articleSummary(article, descriptions);
  return [
    '  <entry>',
    `    <title>${escapeXml(article.title)}</title>`,
    `    <link href="${url}" rel="alternate" />`,
    article.has_en ? `    <link href="${enUrl}" rel="alternate" hreflang="en" />` : '',
    `    <link href="${ogUrl}" rel="enclosure" type="image/png" />`,
    `    <id>${url}</id>`,
    `    <updated>${atomDate(article.updated || article.date)}</updated>`,
    `    <published>${atomDate(article.date)}</published>`,
    `    <category term="${escapeXml(article.tag)}" />`,
    `    <summary>${escapeXml(desc)}</summary>`,
    `    <media:thumbnail url="${ogUrl}" />`,
    `    <content type="html"><![CDATA[<p>${escapeXml(desc)}</p><p><img src="${ogUrl}" alt="${escapeXml(article.title)}" /></p><p><a href="${url}">Read the full article</a></p>]]></content>`,
    '  </entry>',
  ].join('\n');
}

function buildRss(articles, descriptions) {
  const feedUpdated = articles[0]?.updated || articles[0]?.date || '2026-01-01';
  const copyrightYear = ymdToDate(feedUpdated).getUTCFullYear();
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">',
    '<channel>',
    `  <title>${escapeXml(SITE_NAME)}</title>`,
    `  <link>${DOMAIN}/</link>`,
    `  <atom:link href="${DOMAIN}/blog/feed.xml" rel="self" type="application/rss+xml" />`,
    `  <atom:link href="${WEBSUB_HUB}" rel="hub" />`,
    `  <description>${escapeXml(FEED_DESCRIPTION)}</description>`,
    '  <language>zh-Hant-TW</language>',
    `  <copyright>Copyright ${copyrightYear} HsiaoEye - ${escapeXml(AUTHOR)}</copyright>`,
    `  <managingEditor>${EMAIL} (${escapeXml(AUTHOR)})</managingEditor>`,
    `  <webMaster>${EMAIL} (${escapeXml(AUTHOR)})</webMaster>`,
    `  <lastBuildDate>${rfc822Date(feedUpdated)}</lastBuildDate>`,
    '  <generator>HsiaoEye dynamic feed v30 (/api/feed)</generator>',
    '  <image>',
    `    <url>${DOMAIN}/SUNN1302-200.jpg</url>`,
    '    <title>HsiaoEye</title>',
    `    <link>${DOMAIN}/</link>`,
    '    <width>144</width>',
    '    <height>144</height>',
    '  </image>',
    '',
    ...articles.slice(0, 30).map(article => rssItem(article, descriptions)),
    '</channel>',
    '</rss>',
  ];
  return lines.join('\n') + '\n';
}

function buildAtom(articles, descriptions) {
  const feedUpdated = articles[0]?.updated || articles[0]?.date || '2026-01-01';
  const copyrightYear = ymdToDate(feedUpdated).getUTCFullYear();
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xml:lang="zh-Hant-TW">',
    `  <title>${escapeXml(SITE_NAME)}</title>`,
    `  <subtitle>${escapeXml(FEED_DESCRIPTION)}</subtitle>`,
    `  <link href="${DOMAIN}/" rel="alternate" />`,
    `  <link href="${DOMAIN}/blog/atom.xml" rel="self" />`,
    `  <link href="${WEBSUB_HUB}" rel="hub" />`,
    `  <id>${DOMAIN}/</id>`,
    `  <updated>${atomDate(feedUpdated)}</updated>`,
    '  <author>',
    `    <name>${escapeXml(AUTHOR)}</name>`,
    `    <email>${EMAIL}</email>`,
    `    <uri>${DOMAIN}/about</uri>`,
    '  </author>',
    `  <rights>Copyright ${copyrightYear} ${escapeXml(AUTHOR)}</rights>`,
    `  <generator uri="${DOMAIN}">HsiaoEye dynamic feed v30</generator>`,
    '',
    ...articles.slice(0, 30).map(article => atomEntry(article, descriptions)),
    '</feed>',
  ];
  return lines.join('\n') + '\n';
}

function jsonFeedItem(article, descriptions) {
  const url = `${DOMAIN}/blog/${article.slug}`;
  const enUrl = `${DOMAIN}/en/blog/${article.slug}`;
  const ogUrl = `${DOMAIN}/assets/og/${article.slug}.png`;
  const desc = articleSummary(article, descriptions);
  return {
    id: url,
    url,
    title: article.title,
    summary: desc,
    content_html: `<p>${escapeXml(desc)}</p><p><img src="${ogUrl}" alt="${escapeXml(article.title)}" /></p><p><a href="${url}">Read the full article</a></p>`,
    image: ogUrl,
    banner_image: ogUrl,
    date_published: atomDate(article.date),
    date_modified: atomDate(article.updated || article.date),
    tags: article.tag ? [article.tag] : [],
    authors: [{ name: AUTHOR, url: `${DOMAIN}/about` }],
    attachments: [{ url: ogUrl, mime_type: 'image/png', title: article.title }],
    _hsiaoeye: {
      ...(article.has_en ? { english_url: enUrl } : {}),
      category: article.cat || 'myth',
    },
  };
}

function buildJsonFeed(articles, descriptions) {
  const feed = {
    version: 'https://jsonfeed.org/version/1.1',
    title: SITE_NAME,
    home_page_url: `${DOMAIN}/`,
    feed_url: `${DOMAIN}/blog/feed.json`,
    description: FEED_DESCRIPTION,
    language: 'zh-Hant-TW',
    icon: `${DOMAIN}/icon-512.png`,
    favicon: `${DOMAIN}/favicon.ico`,
    authors: [{ name: AUTHOR, url: `${DOMAIN}/about` }],
    items: articles.slice(0, 30).map(article => jsonFeedItem(article, descriptions)),
  };
  return JSON.stringify(feed, null, 2) + '\n';
}

function etagOf(value) {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return `"${h.toString(16)}"`;
}

export default async function handler(req, res) {
  const t0 = Date.now();
  const fmt = (req.query && req.query.fmt) || '';
  const isAtom = fmt === 'atom' || /atom/i.test(req.url || '');
  const isJson = fmt === 'json' || /feed\.json/i.test(req.url || '');
  try {
    const tArticles0 = Date.now();
    const articles = await parseArticles();
    articles.sort((a, b) => (b.updated || b.date || '').localeCompare(a.updated || a.date || ''));
    const top = articles.slice(0, 30);
    const tArticles = Date.now() - tArticles0;

    const tDescriptions0 = Date.now();
    const descriptions = {};
    await Promise.all(top.map(async article => {
      descriptions[article.slug] = await fetchDescription(article.slug);
    }));
    const tDescriptions = Date.now() - tDescriptions0;

    const body = isJson ? buildJsonFeed(top, descriptions) : (isAtom ? buildAtom(top, descriptions) : buildRss(top, descriptions));
    const feedUpdated = top[0]?.updated || top[0]?.date || '2026-01-01';
    const lastModified = rfc822Date(feedUpdated);
    const etag = etagOf(body);
    const ifNoneMatch = req.headers['if-none-match'];
    const ifModifiedSince = req.headers['if-modified-since'];
    const serverTiming = `articles;dur=${tArticles}, descs;dur=${tDescriptions}, total;dur=${Date.now() - t0}`;

    res.setHeader('Content-Type', isJson ? 'application/feed+json; charset=utf-8' : (isAtom ? 'application/atom+xml; charset=utf-8' : 'application/rss+xml; charset=utf-8'));
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', lastModified);
    res.setHeader('Server-Timing', serverTiming);

    if (etagMatches(ifNoneMatch, etag) || (!ifNoneMatch && isFreshSince(ifModifiedSince, lastModified))) {
      res.status(304).end();
      return;
    }
    res.status(200).send(body);
  } catch (e) {
    res.status(500).send(`<?xml version="1.0"?><error>${escapeXml(e.message || e)}</error>`);
  }
}
