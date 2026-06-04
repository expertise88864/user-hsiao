/**
 * POST /api/admin/new — create a new article skeleton + register in blog-shared.js DN.ARTICLES.
 *
 * Body: { slug, titleZh, titleEn, tagZh, tagEn, cat }
 *
 * What it does:
 *   1. Generate a minimal article HTML from a template (clones structure of dry-eye-myths.html)
 *   2. PUT blog/<slug>.html via GitHub API
 *   3. PATCH blog/blog-shared.js to add a new entry to DN.ARTICLES (newest first)
 *
 * After commit, user must `git pull` before doing local edits.
 */
import { requireAdmin, ghGetFile, ghPutFile } from './_auth.js';

const MAX_TITLE_LEN = 120;
const MAX_TAG_LEN = 60;

function cleanText(value, maxLen) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  if (!s || s.length > maxLen || /[\u0000-\u001f\u007f<>]/.test(s)) return null;
  return s;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

function escapeJsString(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, ' ');
}

function buildJsonLd(vars) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'MedicalScholarlyArticle',
    headline: vars.rawTitleZh,
    description: `${vars.rawTitleZh} — HsiaoEye 眼科衛教筆記。`,
    datePublished: vars.today,
    dateModified: vars.today,
    inLanguage: 'zh-Hant-TW',
    author: { '@type': 'Person', name: '蕭閔謙 醫師' },
    publisher: {
      '@type': 'Person',
      name: '蕭閔謙 醫師',
      url: 'https://hsiao.chendermatologist.com/',
    },
    image: 'https://hsiao.chendermatologist.com/icon-512.png',
    mainEntityOfPage: `https://hsiao.chendermatologist.com/blog/${vars.slug}`,
  }).replace(/</g, '\\u003c');
}

const TEMPLATE = (vars) => `<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<title>${vars.titleZh} | HsiaoEye · 蕭閔謙醫師</title>
<meta name="description" content="${vars.titleZh} — 蕭閔謙醫師（眼科）整理的衛教筆記。" />
<meta name="theme-color" content="#3a5a7c" />
<meta name="keywords" content="${vars.tagZh},${vars.tagEn},蕭閔謙醫師,眼科衛教,HsiaoEye" />
<meta name="author" content="蕭閔謙 醫師 · HsiaoEye" />

<link rel="canonical" href="https://hsiao.chendermatologist.com/blog/${vars.slug}" />
<link rel="alternate" hreflang="x-default" href="https://hsiao.chendermatologist.com/blog/${vars.slug}" />
<link rel="alternate" hreflang="zh-Hant-TW" href="https://hsiao.chendermatologist.com/blog/${vars.slug}" />
<link rel="alternate" hreflang="en" href="https://hsiao.chendermatologist.com/en/blog/${vars.slug}" />

<link rel="icon" type="image/svg+xml" href="/icon.svg" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
<link rel="manifest" href="/manifest.json" />

<meta property="og:type" content="article" />
<meta property="og:url" content="https://hsiao.chendermatologist.com/blog/${vars.slug}" />
<meta property="og:title" content="${vars.titleZh}" />
<meta property="og:description" content="${vars.titleZh} — HsiaoEye 眼科衛教筆記。" />
<meta property="og:image" content="https://hsiao.chendermatologist.com/icon-512.png" />
<meta property="og:locale" content="zh_TW" />
<meta property="og:site_name" content="HsiaoEye" />

<link rel="dns-prefetch" href="https://www.googletagmanager.com" />
<link rel="dns-prefetch" href="https://www.google-analytics.com" />
<link rel="preload" as="style" href="/assets/app.css?v=20260656" />
<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@600&family=Inter:wght@600&family=JetBrains+Mono:wght@500&family=Noto+Sans+TC:wght@400;700&family=Noto+Serif+TC:wght@600&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/assets/app.css?v=20260656" />
<link rel="preload" as="style" href="/assets/article.css?v=20260656" />
<link rel="stylesheet" href="/assets/article.css?v=20260656" />
<style>
  :root{
    --bg:#faf7f2; --surface:#ffffff; --ink:#2a2620; --ink-2:#5e574e; --muted:#8b8378;
    --teal:#6b8caf; --teal-deep:#3a5a7c; --teal-bright:#a4c4dd; --mint-soft:#dcd9d1;
    --blue:#6b8caf; --blue-deep:#3a5a7c; --blue-soft:#d6e4f0;
    --gold:#c9a961; --border:#dcd5c8; --line:#ebe4d8;
  }
  html,body{ background:var(--bg); color:var(--ink); font-family:Inter,'Noto Sans TC',sans-serif; }
  body::before{ content:''; position:fixed; inset:0; pointer-events:none; z-index:-1; background: radial-gradient(800px 500px at 12% -8%, rgba(143,179,212,.18), transparent 60%), linear-gradient(180deg,#f7f5f0 0%, #fbfaf6 40%, #f7f5f0 100%); }
  .blue-text{ background:linear-gradient(180deg,#6b8caf 0%, #243b56 100%); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .lang-select{ appearance:none; padding:6px 26px 6px 12px; font-size:12px; font-weight:600; color:var(--ink); border:1px solid var(--border); border-radius:9999px; background:#fff; cursor:pointer; }
</style>

<script type="application/ld+json">
${vars.jsonLd}
</script>

<!-- ===== Google Analytics 4 + Consent Mode v2 (id: G-0ZKDQP9DNH) ===== -->
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', {
  'ad_storage': 'denied',
  'ad_user_data': 'denied',
  'ad_personalization': 'denied',
  'analytics_storage': 'granted',
  'functionality_storage': 'granted',
  'security_storage': 'granted',
  'wait_for_update': 500
});
gtag('js', new Date());
gtag('config', 'G-0ZKDQP9DNH');
</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-0ZKDQP9DNH"></script>
</head>
<body class="font-sans antialiased text-ink-900">
<a href="#main-content" class="skip-link" style="position:absolute;left:-999px;top:0;background:#243b56;color:#fff;padding:8px 16px;z-index:9999;border-radius:0 0 8px 0;font-size:13px;font-weight:600">跳到主內容</a>

<header class="sticky top-0 z-40 backdrop-blur border-b" style="background:rgba(247,245,240,.92); border-color:var(--border)">
  <div class="max-w-6xl mx-auto px-5 sm:px-8">
    <div class="h-16 flex items-center justify-between gap-4">
      <a href="/" class="flex items-center gap-3 min-w-0">
        <img src="/icon.svg" alt="HsiaoEye" class="w-9 h-9 rounded-lg flex-shrink-0" width="36" height="36" fetchpriority="high" decoding="async" />
        <div class="min-w-0 leading-tight">
          <div class="font-display font-semibold text-[16px] sm:text-[18px] blue-text">HsiaoEye</div>
          <div class="text-[10.5px] sm:text-[11.5px] mt-0.5 truncate" style="color:var(--muted)">蕭閔謙醫師 · 眼科衛教筆記</div>
        </div>
      </a>
      <div class="flex items-center gap-2 sm:gap-3 flex-shrink-0">
        <a href="/blog/" class="hidden sm:inline-flex items-center px-3 py-1.5 rounded-full text-[12px] font-semibold" style="color:var(--blue-deep)" data-zh="← 文章索引" data-en="← Articles">← 文章索引</a>
        <button type="button" aria-label="搜尋" title="搜尋 (Cmd/Ctrl + K)" class="inline-flex items-center justify-center w-9 h-9 rounded-full" style="background:#fff;border:1px solid var(--border);color:var(--blue-deep)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
        </button>
        <select id="langToggle" class="lang-select" aria-label="Language">
          <option value="zh">中文</option>
          <option value="en">EN</option>
        </select>
      </div>
    </div>
  </div>
</header>

<main id="main-content">

<section class="pt-12 sm:pt-14 pb-6">
  <div class="max-w-3xl mx-auto px-5 sm:px-8">
    <div class="text-[11px] uppercase tracking-[.24em] font-semibold mb-3" style="color:var(--blue-deep)" data-zh="衛教 · ${vars.tagZh}" data-en="Patient Ed · ${vars.tagEn}">衛教 · ${vars.tagZh}</div>
    <h1 class="font-display font-bold leading-[1.18] text-[32px] sm:text-[44px]" style="color:var(--ink)">
      <span data-zh="${vars.titleZh}" data-en="${vars.titleEn}">${vars.titleZh}</span>
    </h1>
    <p class="mt-6 text-[15.5px] leading-[1.95] tldr" style="color:var(--ink-2)">
      在這裡寫一段精簡的引言（TLDR）—— 點開 admin 模式（網址加 ?admin=1）即可所見即所得編輯。
    </p>
  </div>
</section>

<article class="max-w-3xl mx-auto px-5 sm:px-8 mb-16">

<div id="proseZh" class="prose">

<h2 id="section-1">第一段標題</h2>
<p>從這裡開始寫文章內容。在 admin 模式下,選文字後會出現浮動工具列可以改字型、字級、粗體、列表、連結。</p>

<h2 id="section-2">第二段標題</h2>
<p>每一個 h2 都會自動進入左側浮動大綱,使用者捲動時會 highlight 目前讀到的段落。</p>

<h2 id="references">主要參考文獻</h2>
<ol class="references">
  <li>第一篇文獻 — 期刊年份。</li>
</ol>

</div>

</article>
</main>

<footer class="mag-footer cv-auto-short" style="background:var(--ink); color:var(--bg); padding:48px 24px; margin-top:60px;">
  <div style="max-width:1440px; margin:0 auto; text-align:center; font-size:13px;">
    <h3 style="font-family:'Noto Serif TC',Georgia,serif; font-style:italic; font-weight:600; font-size:24px; margin:0 0 8px;">HsiaoEye · 蕭閔謙醫師 眼科筆記</h3>
    <p style="opacity:.7; margin:0;">從診間到日常，好好照顧你的眼睛。</p>
  </div>
</footer>

<script src="/blog/blog-shared.js?v=20260656" defer></script>
<script>document.addEventListener('DOMContentLoaded', function () { if (window.DN) DN.initBlog({}); });</script>
</body>
</html>
`;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  const { requireAdmin } = await import('./_auth.js');
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { slug, titleZh, titleEn, tagZh, tagEn, cat } = body || {};

  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'Invalid slug' });
  if (!titleZh || !titleEn || !tagZh || !tagEn) return res.status(400).json({ error: 'Missing required fields' });
  const rawTitleZh = cleanText(titleZh, MAX_TITLE_LEN);
  const rawTitleEn = cleanText(titleEn, MAX_TITLE_LEN);
  const rawTagZh = cleanText(tagZh, MAX_TAG_LEN);
  const rawTagEn = cleanText(tagEn, MAX_TAG_LEN);
  if (!rawTitleZh || !rawTitleEn || !rawTagZh || !rawTagEn) {
    return res.status(400).json({ error: 'Invalid title/tag text' });
  }
  const validCats = ['alert', 'rx', 'myth', 'notes', 'research'];
  const safeCat = validCats.includes(cat) ? cat : 'myth';

  const today = todayISO();

  try {
    // 1. Check article doesn't already exist
    const existing = await ghGetFile(`blog/${slug}.html`);
    if (existing) {
      return res.status(409).json({ error: `Article ${slug}.html already exists` });
    }

    // 2. Prepare the DN.ARTICLES catalog patch before creating the article.
    // GitHub Contents API cannot commit both files atomically, so fail early
    // if the catalog cannot be patched instead of leaving an orphan article.
    const sharedJs = await ghGetFile('blog/blog-shared.js');
    if (!sharedJs) {
      return res.status(500).json({ error: 'blog-shared.js not found' });
    }
    if (new RegExp(`slug\\s*:\\s*'${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`).test(sharedJs.content)) {
      return res.status(409).json({ error: `Article ${slug} is already registered in DN.ARTICLES` });
    }
    const newEntry = `    { slug:'${slug}', title:'${escapeJsString(rawTitleZh)}', title_en:'${escapeJsString(rawTitleEn)}', cat:'${safeCat}', tag:'${escapeJsString(rawTagZh)}', tag_en:'${escapeJsString(rawTagEn)}', date:'${today}' },\n`;
    const patchedSharedJs = sharedJs.content.replace(
      /(DN\.ARTICLES\s*=\s*\[\s*\n)/,
      `$1${newEntry}`
    );
    if (patchedSharedJs === sharedJs.content) {
      return res.status(500).json({ error: 'DN.ARTICLES insertion point not found in blog-shared.js' });
    }

    // 3. Create article HTML from template
    const html = TEMPLATE({
      slug,
      titleZh: escapeHtml(rawTitleZh),
      titleEn: escapeHtml(rawTitleEn),
      tagZh: escapeHtml(rawTagZh),
      tagEn: escapeHtml(rawTagEn),
      rawTitleZh,
      today,
      jsonLd: buildJsonLd({ slug, rawTitleZh, today }),
    });
    const created = await ghPutFile(
      `blog/${slug}.html`,
      html,
      `admin: create new article ${slug}`
    );

    // 4. Register the new article in DN.ARTICLES.
    try {
      await ghPutFile(
        'blog/blog-shared.js',
        patchedSharedJs,
        `admin: register article ${slug} in DN.ARTICLES`,
        sharedJs.sha
      );
    } catch (e) {
      return res.status(502).json({
        ok: false,
        partial: true,
        slug,
        articleCommit: created.commitSha,
        error: `Created blog/${slug}.html but failed to register DN.ARTICLES: ${e.message || e}`,
      });
    }

    res.status(200).json({ ok: true, slug, commit: created.commitSha });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
