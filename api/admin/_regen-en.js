/**
 * POST /api/admin/regen-en — regenerate the /en/ mirror for one (or all)
 * articles after a Chinese-side edit.
 *
 * Body: { slug?: string }   // omit slug → regen ALL pages
 *
 * What it does (re-implements _gen_en_pages.py logic in JS so it can run
 * inside a Vercel serverless function without Python):
 *   1. GET blog/<slug>.html (zh source)
 *   2. Apply 6 transforms:
 *        - <html lang="en">
 *        - canonical → /en/blog/<slug>
 *        - hreflang block (en self / zh original / x-default zh)
 *        - inject EN_LANG_BOOTSTRAP before blog-shared.js so first paint = EN
 *        - inject EN_BANNER under header
 *        - og:locale en_US (+ alternate zh_TW)
 *   3. PUT en/blog/<slug>.html
 *
 * If no slug given, walks every article in DN.ARTICLES + every top-level
 * .html (about, privacy, etc) and regenerates each. Heavier — use sparingly
 * (after big edits or when bumping a global template).
 */
import { requireAdmin, ghGetFile, ghPutFile, getRepoConfig } from './_auth.js';

const DOMAIN = 'https://hsiao.chendermatologist.com';
const SKIP = new Set(['404.html', 'offline.html', 'admin.html', 'dashboard.html']);

const EN_BANNER = `<div id="hs-en-banner" style="background:linear-gradient(180deg,#e3edf6,#b8cfe3);border-bottom:1px solid #3a5a7c;padding:9px 18px;text-align:center;font-size:12.5px;color:#243b56;font-family:Inter,system-ui,sans-serif;line-height:1.5;font-weight:500">
  🌐 You are reading the English-mode interface. Some article body content is currently Chinese-only — full translation in progress.
  <a href="#" id="hs-en-banner-zh" style="margin-left:8px;color:#0f172a;font-weight:700;text-decoration:underline">Switch to 中文 ↗</a>
</div>`;

const EN_LANG_BOOTSTRAP = `<script>
// Force English mode for /en/ pages — runs before blog-shared.js so the
// first applyTextOnly() pass uses English (no FOUC).
try {
  localStorage.setItem('hs_lang', 'en');
  document.cookie = 'hs_lang=en;path=/;max-age=31536000;samesite=lax';
} catch (e) {}
document.addEventListener('DOMContentLoaded', function () {
  var sw = document.getElementById('hs-en-banner-zh');
  if (sw) sw.href = location.pathname.replace(/^\\/en\\//, '/').replace(/^\\/en$/, '/');
});
</script>`;

function transform(html, zhCanonical, enCanonical) {
  let s = html;
  s = s.replace(/<html\s+lang="[^"]*"/, '<html lang="en"');
  s = s.replace(
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/,
    `<link rel="canonical" href="${DOMAIN}${enCanonical}" />`
  );
  const hreflang =
    `<link rel="alternate" hreflang="x-default" href="${DOMAIN}${zhCanonical}" />\n` +
    `<link rel="alternate" hreflang="zh-Hant-TW" href="${DOMAIN}${zhCanonical}" />\n` +
    `<link rel="alternate" hreflang="en" href="${DOMAIN}${enCanonical}" />`;
  s = s.replace(
    /(<link\s+rel="alternate"\s+hreflang="[^"]*"\s+href="[^"]*"\s*\/?>\s*\n?)+/,
    hreflang + '\n'
  );
  s = s.replace(
    /(<script\s+src="\/blog\/blog-shared\.js[^"]*"[^>]*><\/script>)/,
    EN_LANG_BOOTSTRAP + '\n$1'
  );
  if (s.includes('<a href="#main-content" class="skip-link"')) {
    s = s.replace(/(\n<header\s+class="sticky)/, `\n${EN_BANNER}$1`);
  } else {
    s = s.replace(/(<\/header>)/, `$1\n${EN_BANNER}`);
  }
  if (s.includes('<meta property="og:locale"')) {
    s = s.replace(/<meta property="og:locale" content="[^"]*"\s*\/?>/, '<meta property="og:locale" content="en_US" />');
  } else {
    s = s.replace('</head>', '<meta property="og:locale" content="en_US" />\n<meta property="og:locale:alternate" content="zh_TW" />\n</head>');
  }
  if (s.includes('<meta property="og:locale:alternate"')) {
    s = s.replace(/<meta property="og:locale:alternate" content="[^"]*"\s*\/?>/, '<meta property="og:locale:alternate" content="zh_TW" />');
  }

  // v36.2 SEO FIX — rewrite internal anchor hrefs so /en/ pages link to
  // their /en/ counterparts. Previously every `<a href="/blog/foo">` in
  // the EN mirror pointed back at the ZH version, which made Google
  // override the user-declared canonical: GSC reported "Google chose a
  // different canonical" because the internal-link signal said "the
  // /blog/foo URL is the real authority" — even though the EN page's
  // <link rel="canonical"> said /en/blog/foo.
  //
  // We rewrite ONLY anchor hrefs (`<a … href="…">`), and only when the
  // href starts with one of the known site-root paths. NOT touched:
  //   • Script/link src= (resources stay shared: blog-shared.js etc.)
  //   • hreflang alternates (already correctly handled above)
  //   • mailto:, https://, etc.
  //   • #fragment-only or ./relative paths
  function rewriteAnchor(prefix) {
    return function (full, openTag, before, path, after) {
      // Already /en/-prefixed? leave alone.
      if (path.startsWith('/en/')) return full;
      return openTag + before + prefix + path + after;
    };
  }
  // Anchor href rewriter: matches `<a … href="…">` and inspects path.
  s = s.replace(
    /(<a\b[^>]*?\bhref=")([^"#?]*?)((?:[?#][^"]*)?")/gi,
    function (full, openTagAndHref, path, after) {
      if (!path) return full;
      if (path.startsWith('/en/')) return full;
      // Match exactly /blog/ (with or without trailing slug) or top-level
      // routes that have an /en/ equivalent.
      var isPrefixable =
        path === '/' ||
        path === '/about' ||
        path === '/privacy' ||
        path === '/tools' ||
        path === '/notes' ||
        path === '/blog/' ||
        /^\/blog\/[a-z0-9-]+$/i.test(path);
      if (!isPrefixable) return full;
      var newPath = (path === '/') ? '/en/' : '/en' + path;
      return openTagAndHref + newPath + after;
    }
  );

  return s;
}

async function regenOne(zhPath, zhCanonical, enPath, enCanonical) {
  const src = await ghGetFile(zhPath);
  if (!src) return { path: zhPath, ok: false, error: 'source not found' };
  const out = transform(src.content, zhCanonical, enCanonical);
  // Skip if identical (avoids extra commits)
  const existing = await ghGetFile(enPath);
  if (existing && existing.content === out) {
    return { path: enPath, ok: true, noop: true };
  }
  const result = await ghPutFile(enPath, out, `admin: regen ${enPath} via /admin`, existing ? existing.sha : undefined);
  return { path: enPath, ok: true, commit: result.commitSha };
}

async function listAllArticleSlugs() {
  const file = await ghGetFile('blog/blog-shared.js');
  if (!file) return [];
  const m = file.content.match(/DN\.ARTICLES\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) return [];
  const re = /\{\s*slug\s*:\s*'([^']+)'/g;
  const slugs = [];
  let row;
  while ((row = re.exec(m[1])) !== null) slugs.push(row[1]);
  return slugs;
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { slug } = body || {};

  try {
    if (slug) {
      // Single-slug regen
      if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'Invalid slug' });
      const result = await regenOne(
        `blog/${slug}.html`,
        `/blog/${slug}`,
        `en/blog/${slug}.html`,
        `/en/blog/${slug}`
      );
      return res.status(200).json({ ok: true, results: [result] });
    }

    // Full regen — every article + every top-level non-blog page (best-effort)
    const slugs = await listAllArticleSlugs();
    const results = [];
    for (const sl of slugs) {
      try {
        const r = await regenOne(
          `blog/${sl}.html`,
          `/blog/${sl}`,
          `en/blog/${sl}.html`,
          `/en/blog/${sl}`
        );
        results.push(r);
      } catch (e) {
        results.push({ path: `blog/${sl}.html`, ok: false, error: String(e.message || e) });
      }
    }

    // Also regen blog/index, topics
    for (const idxPath of ['blog/index.html', 'blog/topics.html']) {
      const stem = idxPath.replace('blog/', '').replace('.html', '');
      try {
        const r = await regenOne(
          idxPath,
          stem === 'index' ? '/blog/' : `/blog/${stem}`,
          `en/${idxPath}`,
          stem === 'index' ? '/en/blog/' : `/en/blog/${stem}`
        );
        results.push(r);
      } catch (e) {
        results.push({ path: idxPath, ok: false, error: String(e.message || e) });
      }
    }

    res.status(200).json({ ok: true, count: results.length, results });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
