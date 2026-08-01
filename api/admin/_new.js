/**
 * POST /api/admin/new — create an unpublished noindex article draft.
 *
 * Body: { slug, titleZh, titleEn, tagZh, tagEn, cat }
 *
 * What it does:
 * Drafts are deliberately NOT added to DN.ARTICLES. Publishing requires the
 * full article pipeline so listings, feeds, English mirrors, search, OG cards,
 * structured data, and CSP stay consistent. The draft HTML and draft manifest
 * are written in one atomic git commit.
 *
 * After commit, user must `git pull` before doing local edits.
 */
import { requireAdmin, ghGetFile, ghCommitFiles } from './_auth.js';

const DRAFTS_PATH = '_cms/admin-drafts.json';

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
<meta name="robots" content="noindex,nofollow,noarchive" />

<link rel="canonical" href="https://hsiao.chendermatologist.com/blog/${vars.slug}" />

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
<link rel="preload" as="style" href="/assets/app.css?v=20260668" />
<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Fraunces:wght@600&family=Inter:wght@600&family=JetBrains+Mono:wght@500&family=Noto+Sans+TC:wght@400;700&family=Noto+Serif+TC:wght@600&display=swap" id="hs-fonts" /><noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:wght@600&family=Inter:wght@600&family=JetBrains+Mono:wght@500&family=Noto+Sans+TC:wght@400;700&family=Noto+Serif+TC:wght@600&display=swap" /></noscript><script>(function(){var l=document.getElementById('hs-fonts');if(l)l.addEventListener('load',function(){l.rel='stylesheet'},{once:true});})();</script>
<link rel="stylesheet" href="/assets/app.css?v=20260668" />
<link rel="preload" as="style" href="/assets/article.css?v=20260668" />
<link rel="stylesheet" href="/assets/article.css?v=20260668" />
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
<style>.dn-skiplinks{position:absolute;left:-9999px;top:auto;z-index:9999}.dn-skiplinks:focus-within{position:fixed;top:8px;left:8px;display:flex;gap:6px}.dn-skiplinks a{background:#0c5159;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,.2)}.dn-skiplinks a:focus{outline:2px solid #fff;outline-offset:2px}</style><nav class="dn-skiplinks" aria-label="Skip navigation"><a href="#main-content" data-zh="跳至主要內容" data-en="Skip to main content">跳至主要內容</a></nav>

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
<p data-zh="從這裡開始寫文章內容。在 admin 模式下，選取文字後會出現浮動工具列。" data-en="Start writing here. Select text in admin mode to open the formatting toolbar.">從這裡開始寫文章內容。在 admin 模式下，選取文字後會出現浮動工具列。</p>

<h2 id="section-2">第二段標題</h2>
<p data-zh="每個章節標題都會自動進入文章大綱。" data-en="Each section heading is added to the article outline automatically.">每個章節標題都會自動進入文章大綱。</p>

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

<script src="/blog/blog-shared.min.js?v=20260668" defer></script>
<script>document.addEventListener('DOMContentLoaded', function () { if (window.DN) DN.initBlog({}); });</script>
</body>
</html>
`;

export function todayISO(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export default async function handler(req, res) {
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

    // 2. Reject a slug already present in the public catalog.
    const sharedJs = await ghGetFile('blog/blog-shared.js');
    if (!sharedJs) return res.status(500).json({ error: 'blog-shared.js not found' });
    if (new RegExp(`slug\\s*:\\s*'${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`).test(sharedJs.content)) {
      return res.status(409).json({ error: `Article ${slug} is already registered in DN.ARTICLES` });
    }

    // 3. Update the deployment-excluded CMS draft manifest.
    const draftFile = await ghGetFile(DRAFTS_PATH);
    let draftState = { drafts: {} };
    if (draftFile) {
      try { draftState = JSON.parse(draftFile.content); } catch (e) { draftState = { drafts: {} }; }
    }
    draftState.drafts = draftState.drafts || {};
    if (draftState.drafts[slug]) {
      return res.status(409).json({ error: `Draft ${slug} already exists` });
    }
    draftState.drafts[slug] = {
      slug,
      title: rawTitleZh,
      title_en: rawTitleEn,
      cat: safeCat,
      tag: rawTagZh,
      tag_en: rawTagEn,
      date: today,
      status: 'draft',
    };

    // 4. Create draft HTML + manifest in one commit.
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
    const created = await ghCommitFiles([
      { path: `blog/${slug}.html`, content: html, expectedSha: null },
      {
        path: DRAFTS_PATH,
        content: JSON.stringify(draftState, null, 2) + '\n',
        expectedSha: draftFile ? draftFile.sha : null,
      },
    ], `admin: create draft ${slug}`);

    res.status(200).json({
      ok: true,
      draft: true,
      slug,
      commit: created.commitSha,
      message: 'Unpublished draft created as noindex. Run the full publication pipeline before adding it to DN.ARTICLES.',
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
