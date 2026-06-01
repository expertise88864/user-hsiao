/**
 * POST /api/admin/indexnow — ping IndexNow with one or more URLs to
 * trigger instant indexing on Bing, Yandex, Naver (and other engines
 * that subscribe to IndexNow.org).
 *
 * Body: { urls: ["https://hsiao.chendermatologist.com/blog/<slug>", …] }
 * Or omit body to send ALL published article URLs from DN.ARTICLES.
 *
 * Why this exists: Google doesn't participate in IndexNow (use GSC's
 * URL Inspection tool for fast Google indexing). But Bing+Yandex
 * together are ~6-15% of search traffic in TW and they index within
 * minutes via IndexNow vs days via crawl. Worth the 50ms POST.
 *
 * Key: the file `bfc071112dd2988a75988a1249d0ce44.txt` is committed at
 * the site root and contains just the key string. IndexNow fetches
 * this to verify domain ownership.
 */
import { requireAdmin, ghGetFile } from './_auth.js';

const KEY = 'bfc071112dd2988a75988a1249d0ce44';
const HOST = 'hsiao.chendermatologist.com';
const ENDPOINT = 'https://api.indexnow.org/IndexNow';


async function loadPublishedSlugs() {
  // Parse DN.ARTICLES from blog/blog-shared.js (GitHub) to enumerate
  // published article URLs when caller doesn't specify them.
  try {
    const file = await ghGetFile('blog/blog-shared.js');
    if (!file) return [];
    const js = file.content;
    const m = js.match(/DN\.ARTICLES\s*=\s*\[([\s\S]*?)\];/);
    if (!m) return [];
    const stubMatch = js.match(/DN\.STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]/);
    const stubs = new Set();
    if (stubMatch) {
      for (const s of stubMatch[1].matchAll(/'([^']+)'/g)) stubs.add(s[1]);
    }
    const enStubMatch = js.match(/DN\.EN_STUB_SLUGS\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]/);
    const enStubs = new Set();
    if (enStubMatch) {
      for (const s of enStubMatch[1].matchAll(/'([^']+)'/g)) enStubs.add(s[1]);
    }
    const slugs = [];
    for (const s of m[1].matchAll(/slug:\s*'([^']+)'/g)) {
      if (!stubs.has(s[1])) slugs.push(s[1]);
    }
    return { slugs, enStubs };
  } catch (e) { return { slugs: [], enStubs: new Set() }; }
}


export default async function handler(req, res) {
  if (!(await requireAdmin(req, res))) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  let urls = Array.isArray(body && body.urls) ? body.urls : null;
  if (!urls || !urls.length) {
    const { slugs, enStubs } = await loadPublishedSlugs();
    urls = slugs.flatMap((s) => [
      `https://${HOST}/blog/${s}`,
      ...(enStubs.has(s) ? [] : [`https://${HOST}/en/blog/${s}`]),
    ]);
    // Also include landing pages
    urls.unshift(
      `https://${HOST}/`,
      `https://${HOST}/blog`,
      `https://${HOST}/blog/topics`,
      `https://${HOST}/notes`,
      `https://${HOST}/privacy`,
      `https://${HOST}/en`,
      `https://${HOST}/en/blog`,
      `https://${HOST}/en/blog/topics`,
      `https://${HOST}/about`,
      `https://${HOST}/en/about`,
      `https://${HOST}/tools`,
      `https://${HOST}/en/tools`,
      `https://${HOST}/en/notes`,
      `https://${HOST}/en/privacy`,
      `https://${HOST}/sitemap.xml`,
      `https://${HOST}/llms.txt`,
      `https://${HOST}/opensearch.xml`,
      `https://${HOST}/blog/feed.xml`,
      `https://${HOST}/blog/atom.xml`,
      `https://${HOST}/blog/feed.json`,
      `https://${HOST}/assets/search-index.json`,
    );
  }
  // IndexNow accepts max 10,000 URLs per request — we'll never get close.
  // Reject same-host validation: every URL must be on HOST.
  urls = urls.filter((u) => {
    try { return new URL(u).host === HOST; } catch (e) { return false; }
  });
  if (!urls.length) return res.status(400).json({ error: 'no valid same-host URLs' });

  const payload = {
    host: HOST,
    key: KEY,
    keyLocation: `https://${HOST}/${KEY}.txt`,
    urlList: urls,
  };

  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await r.text().catch(() => '');
    return res.status(200).json({
      ok: r.ok,
      status: r.status,
      urls_sent: urls.length,
      response_excerpt: text.slice(0, 300),
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
