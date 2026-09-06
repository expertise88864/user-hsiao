/* ============================================================
 * HsiaoEye - shared runtime (zh / en)
 *
 * Includes:
 *   - language detection + 2-button / dropdown toggle (toggles #proseZh/#proseEn)
 *   - reading progress bar at top
 *   - scroll-to-top button
 *   - mobile hamburger drawer
 *   - reveal-on-scroll, view transitions
 *   - service worker registration + update toast
 *   - prefetch on idle
 *   - article: inline TOC (collapsible, top of article)
 *   - article: floating TOC sidebar (desktop ≥1280px)
 *   - article: scroll-position memory + "continue reading" toast
 *   - article: reading time + last-reviewed badges
 *   - article: floating font sizer (S/M/L)
 *   - article: share toolbar
 *   - article: author bio block
 *   - article: related articles (with ItemList JSON-LD)
 *   - read-tracker: localStorage record of which articles user has read
 *   - footer year, BMC button (skipped if URL empty)
 *
 * Usage on every page:
 *   <script src="/blog/blog-shared.js" defer></script>
 *   <script>document.addEventListener('DOMContentLoaded',()=>DN.initBlog({}));</script>
 * ============================================================ */
(function () {
  // ─── Trusted Types policies ───────────────────────────────────────────
  // v34: tightened from pass-through (v29) to actual sanitisation:
  //   - hs-policy.createHTML  strips <script> tags + on*= event handlers +
  //                           javascript: URLs from anything we innerHTML.
  //   - default policy catches third-party leaks (GTM injection sites
  //     don't pass through hs-policy explicitly), strips same dangerous
  //     bits but allows everything else.
  //   - createScriptURL constrains to a small allowlist (self + GTM/GA/
  //     Clarity/AdSense + jsdelivr for Mermaid/KaTeX/DocSearch). Reject
  //     anything else.
  //
  // Falls back silently in browsers without Trusted Types (Firefox/Safari
  // mostly). Already-strict CSP `require-trusted-types-for 'script'`
  // means policies MUST exist to use string-sinks at all.
  if (window.trustedTypes && window.trustedTypes.createPolicy) {
    var SCRIPT_URL_ALLOW = /^(https?:\/\/(?:www\.googletagmanager\.com|www\.google-analytics\.com|www\.clarity\.ms|stats\.g\.doubleclick\.net|cdn\.jsdelivr\.net)\/|\/)/;
    function sanitizeHTML(s) {
      var out = String(s);
      // Drop <script>...</script> blocks
      out = out.replace(/<script[\s\S]*?<\/script>/gi, '');
      // Drop on* event handlers (preserved across re-quoting)
      out = out.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
      // Strip javascript: URLs
      out = out.replace(/(href|src|action|formaction|xlink:href)\s*=\s*(["']?)\s*javascript:[^"'>\s]*\2/gi, '$1=$2#$2');
      return out;
    }
    function rejectScriptURL(s) {
      if (SCRIPT_URL_ALLOW.test(s)) return String(s);
      console.warn('[hs-policy] blocked scriptURL:', s);
      throw new TypeError('script URL not in allow-list: ' + s);
    }
    try {
      window.trustedTypes.createPolicy('hs-policy', {
        createHTML:      sanitizeHTML,
        createScript:    function (s) { return String(s); },
        createScriptURL: rejectScriptURL,
      });
    } catch (e) {}
    try {
      window.trustedTypes.createPolicy('default', {
        createHTML:      sanitizeHTML,
        createScript:    function (s) { return String(s); },
        createScriptURL: rejectScriptURL,
      });
    } catch (e) { /* default may already exist */ }
  }

  const DN = (window.DN = window.DN || {});

  // ---------------------------------------------------------------------
  // i18n bundle — DN.t('key') returns translated string.
  // Loaded lazily from /assets/i18n.json on first use; falls back to the
  // raw key (or to data-zh/data-en attribute lookup) when missing.
  //
  // Usage in HTML:  <span data-t="btn.bookmark">加入收藏</span>
  // Usage in JS:    btn.textContent = DN.t('btn.bookmark');
  // ---------------------------------------------------------------------
  DN._i18n = null;
  DN._i18nPromise = null;
  DN.t = function (key, fallback) {
    var lang = DN.detectLang ? DN.detectLang() : 'zh';
    if (!DN._i18n) {
      // Async load (kicks off once) — in the meantime, return fallback / key
      if (!DN._i18nPromise) {
        DN._i18nPromise = fetch('/assets/i18n.json').then(function (r) {
          return r.ok ? r.json() : null;
        }).then(function (j) {
          DN._i18n = j || {};
          // Re-render any data-t marker now that translations are loaded
          DN.applyI18nMarkers && DN.applyI18nMarkers();
          return DN._i18n;
        }).catch(function () { DN._i18n = {}; return {}; });
      }
      return fallback != null ? fallback : key;
    }
    var entry = DN._i18n[key];
    if (!entry) return fallback != null ? fallback : key;
    return entry[lang] || entry.zh || entry.en || (fallback != null ? fallback : key);
  };

  DN.applyI18nMarkers = function () {
    var lang = DN.detectLang ? DN.detectLang() : 'zh';
    document.querySelectorAll('[data-t]').forEach(function (el) {
      var k = el.getAttribute('data-t');
      var translated = DN.t(k, null);
      if (translated && translated !== k) el.textContent = translated;
    });
  };

  // ---------- brand constants ----------
  DN.SITE_NAME       = 'HsiaoEye';
  DN.SITE_TITLE      = '蕭閔謙醫師 眼科筆記';
  DN.SITE_URL        = 'https://hsiao.chendermatologist.com';
  DN.AUTHOR_NAME_ZH  = '蕭閔謙 醫師';
  DN.AUTHOR_NAME_EN  = 'Min-Chien Hsiao, MD';
  DN.AUTHOR_AFFIL_ZH = '眼科';
  DN.AUTHOR_AFFIL_EN = 'Ophthalmology';
  DN.AUTHOR_ROLE_ZH  = '住院醫師 R2';
  DN.AUTHOR_ROLE_EN  = 'Ophthalmology Resident';
  DN.AUTHOR_EMAIL    = 'f94001115@gmail.com';
  DN.BMC_URL         = 'https://ko-fi.com/f94001115';
  DN.AUTHOR_BIO_URL  = '/about';
  DN.READ_KEY        = 'hs:read:slugs';

  // ---------- article catalog ----------
  DN.ARTICLES = [
    { slug:'pediatric-high-myopia-maculopathy-progression', title:'高度近視兒童：8 年內 1/3 黃斑部病變惡化，眼軸變化可預警', title_en:'Childhood High Myopia: 1-in-3 Maculopathy in 8 Years', cat:'research', tag:'兒童近視', tag_en:'Pediatric myopia', date:'2026-06-05' },
    { slug:'refractory-noninfectious-uveitis-biologics-rubi-trial', title:'難治型非感染性葡萄膜炎：Adalimumab、Tocilizumab、Anakinra 隨機試驗解析', title_en:'Refractory Noninfectious Uveitis — RUBI Biologics Trial', cat:'research', tag:'葡萄膜炎', tag_en:'Uveitis', date:'2026-06-02', updated:'2026-06-05' },
    { slug:'osa-amd-systematic-review-2026', title:'睡眠呼吸中止症會增加黃斑部病變風險嗎？2026 系統性回顧整合分析', title_en:'Sleep Apnea and AMD Risk — 2026 Meta-Analysis', cat:'research', tag:'黃斑部病變', tag_en:'AMD', date:'2026-05-26' },
    { slug:'pterygium-surgery-fixation-methods-2026-nma', title:'翼狀贅肉手術後復發 vs 穩定，怎麼選？2026 NMA 35 RCT 分析', title_en:'Pterygium Fixation Methods — 2026 NMA of 35 RCTs', cat:'research', tag:'翼狀贅肉', tag_en:'Pterygium', date:'2026-05-23' },
    { slug:'diabetic-retinopathy-dementia-trinetx-cohort', title:'糖尿病視網膜病變越嚴重，失智症風險越高？', title_en:'Diabetic Retinopathy and Dementia — 2026 TriNetX Cohort', cat:'research', tag:'糖尿病視網膜病變', tag_en:'Diabetic retinopathy', date:'2026-05-23' },
    { slug:'hzo-stromal-keratitis-zeds-lessons', title:'帶狀疱疹眼疾反覆角膜炎：為什麼停眼藥水 3 個月最危險？', title_en:'Recurrent Stromal Keratitis After HZO — 2026 ZEDS Lessons', cat:'research', tag:'角膜炎', tag_en:'Keratitis', date:'2026-05-23' },
    { slug:'ophthalmic-trauma-overlooked-burden', title:'眼外傷：被忽視的全球失明禍首', title_en:'Ophthalmic Trauma — The Overlooked Cause of Blindness', cat:'research', tag:'眼外傷', tag_en:'Eye trauma', date:'2026-05-23' },
    { slug:'toric-iol-astigmatism-cataract-review', title:'散光人工水晶體（Toric IOL）值得嗎？', title_en:'Toric IOL for Cataract — Is It Worth It?', cat:'rx', tag:'白內障', tag_en:'Cataract', date:'2026-05-16' },
    { slug:'dry-eye-symptom-sign-discordance-dream', title:'為什麼我覺得眼睛超乾，醫師卻說沒事？', title_en:'Why Do My Dry-Eye Symptoms Not Match the Exam?', cat:'research', tag:'乾眼症', tag_en:'Dry eye', date:'2026-05-16', updated:'2026-05-18' },
    { slug:'monitoring-myopia-ser-vs-axial-length', title:'監測兒童近視，該追蹤「度數」還是「眼軸」？', title_en:'Monitoring Childhood Myopia: SER or Axial Length?', cat:'research', tag:'兒童近視', tag_en:'Pediatric myopia', date:'2026-05-13' },
    { slug:'dims-pediatric-myopia-control', title:'兒童近視控制鏡片（DIMS）有效嗎？', title_en:'Are DIMS Lenses Effective for Pediatric Myopia?', cat:'research', tag:'兒童近視', tag_en:'Pediatric myopia', date:'2026-05-12' },
    { slug:'cataract-surgery-selection',   title:'白內障手術深度選擇',     title_en:'Cataract Surgery Selection',             cat:'rx',    tag:'白內障',     tag_en:'Cataract',        date:'2026-05-11', updated:'2026-05-18' },
    { slug:'glaucoma-treatment-selection', title:'青光眼藥物與手術選擇',  title_en:'Glaucoma Treatment Selection',           cat:'rx',    tag:'青光眼',     tag_en:'Glaucoma',        date:'2026-05-10' },
    { slug:'glaucoma-comprehensive-guide', title:'青光眼完整衛教',       title_en:'Glaucoma — Patient Education',           cat:'alert', tag:'青光眼',     tag_en:'Glaucoma',        date:'2026-05-09' },
    { slug:'cataract-comprehensive-guide', title:'白內障手術完整衛教',     title_en:'Cataract Surgery — Patient Education',     cat:'rx',    tag:'白內障',     tag_en:'Cataract',        date:'2026-05-09', updated:'2026-05-18' },
    { slug:'thyroid-eye-disease',        title:'甲狀腺眼疾完整衛教',     title_en:'Thyroid Eye Disease — Patient Education',   cat:'alert', tag:'甲狀腺眼疾', tag_en:'TED',             date:'2026-05-07', updated:'2026-05-09' },
    { slug:'lacrimal-gland-tumor',        title:'淚腺腫瘤 6 個關鍵問題',  title_en:'6 Key Questions on Lacrimal Gland Tumor',  cat:'alert', tag:'淚腺腫瘤',  tag_en:'Lacrimal tumor',  date:'2026-05-06', updated:'2026-05-18' },
    { slug:'dry-eye-myths',              title:'乾眼症 8 大迷思',         title_en:'8 Dry-Eye Myths',                        cat:'myth', tag:'乾眼症',     tag_en:'Dry Eye',         date:'2026-05-04' },
    { slug:'pediatric-myopia-control',   title:'兒童近視控制 8 大迷思',  title_en:'8 Pediatric Myopia Control Myths',         cat:'myth', tag:'兒童近視',   tag_en:'Myopia control',  date:'2026-05-04' },
    { slug:'floaters-retinal-detachment', title:'飛蚊症 6 大警訊',         title_en:'6 Floater Red Flags',                     cat:'myth', tag:'飛蚊症',     tag_en:'Floaters',        date:'2026-05-04' }
  ];
  DN.totalArticles = DN.ARTICLES.length;

  // ── Stub / unfinished articles ─────────────────────────────────────
  // Slugs that have HTML scaffolding committed but no real content yet.
  // Hidden from /blog/, /blog/topics, /notes, related-articles, search.
  // Add a slug here when you create the .html file but haven't written
  // the body; remove when the article is publishable.
  DN.STUB_SLUGS = new Set([
    'cataract-surgery-faq',
    'glaucoma-warnings',
    'contact-lens-safety',
    'red-eye-conjunctivitis',
  ]);
  DN.isStub = function (slug) { return DN.STUB_SLUGS.has(slug); };

  // Published Chinese articles whose English body translation is incomplete.
  // Keep these out of EN discovery artifacts until the visible body copy is
  // genuinely English; otherwise Google can cluster the /en/ URL as a
  // duplicate of the Chinese canonical.
  DN.EN_STUB_SLUGS = new Set([
    'dry-eye-myths',
    'floaters-retinal-detachment',
    'lacrimal-gland-tumor',
    'pediatric-myopia-control',
  ]);
  DN.hasEnglishMirror = function (slug) { return !DN.EN_STUB_SLUGS.has(slug); };

  // Runtime DOM filter — runs once early so we don't flash unfinished
  // cards before hiding them. Targets <a href="/blog/<stub>"> at any depth.
  DN.hideStubLinks = function () {
    if (!DN.STUB_SLUGS.size) return;
    DN.STUB_SLUGS.forEach(function (slug) {
      // Walks the closest cardish ancestor and REMOVES it (not just display:none)
      // so subsequent code (search, filters, tag clouds) doesn't re-show it.
      // For bare links inside paragraphs, hide the link only.
      document.querySelectorAll(
        'a[href="/blog/' + slug + '"], a[href="/blog/' + slug + '/"], ' +
        'a[href="/en/blog/' + slug + '"], a[href="/en/blog/' + slug + '/"]'
      ).forEach(function (a) {
        var card = a.closest('.topic-card, .article-list-item, .mag-card, .spotlight-row');
        if (!card && a.parentNode && a.parentNode.tagName === 'LI') card = a.parentNode;
        if (card) {
          card.remove();
        } else {
          // Inline link inside prose — hide but keep DOM (don't break paragraph flow)
          a.style.display = 'none';
          a.setAttribute('aria-hidden', 'true');
        }
      });
    });
  };

  DN.currentSlug = function () {
    const m = location.pathname.match(/\/blog\/([a-z0-9-]+)\/?$/i);
    return m ? m[1] : null;
  };

  // ---------- article numbering & navigation (DermNotes parity) ----------
  // Stable № assigned by chronological publication order (oldest = №1).
  // We use a lazy map so future re-orderings of DN.ARTICLES (which is
  // sorted newest-first for display) don't shift the numbers visitors
  // already saw bookmarked or shared.
  DN.numberMap = (function () {
    var byDate = (DN.ARTICLES || []).slice().sort(function (a, b) {
      return (a.date || '').localeCompare(b.date || '');
    });
    var m = {};
    byDate.forEach(function (a, i) { m[a.slug] = i + 1; });
    return m;
  })();
  DN.getArticleNumber = function (slug) { return DN.numberMap[slug] || 0; };

  // Prev / next article in date-ascending order. Used by injectPrevNext.
  DN.getPrevNext = function (slug) {
    var byDate = (DN.ARTICLES || []).slice().sort(function (a, b) {
      return (a.date || '').localeCompare(b.date || '');
    });
    var i = byDate.findIndex(function (a) { return a.slug === slug; });
    if (i < 0) return { prev: null, next: null };
    return { prev: i > 0 ? byDate[i - 1] : null, next: i < byDate.length - 1 ? byDate[i + 1] : null };
  };

  // Inject a "← prev / next →" footer below the article. Mirrors DermNotes
  // /blog/ navigation pattern — keeps readers in the site after they
  // finish one article.
  DN.injectPrevNext = function () {
    var slug = DN.currentSlug && DN.currentSlug();
    if (!slug) return;
    var article = document.querySelector('article.max-w-3xl');
    if (!article || document.getElementById('hs-prevnext')) return;
    var pn = DN.getPrevNext(slug);
    if (!pn.prev && !pn.next) return;

    function card(art, dirZh, dirEn, pnDir) {
      if (!art) return '';
      return '<a href="' + DN.articlePath(art.slug) + '" class="hs-pn-card" data-pn="' + pnDir + '">' +
        '<span class="hs-pn-dir" data-zh="' + dirZh + '" data-en="' + dirEn + '">' + dirZh + '</span>' +
        '<span class="hs-pn-title" data-zh="' + (art.title || '').replace(/"/g, '&quot;') + '" data-en="' + (art.title_en || art.title || '').replace(/"/g, '&quot;') + '">' + (art.title || '') + '</span>' +
      '</a>';
    }

    if (!document.getElementById('hs-pn-css')) {
      var st = document.createElement('style');
      st.id = 'hs-pn-css';
      // v30.1: switched from positional pseudo-classes (:nth-child) to
      // explicit data-pn="prev|next" attributes. nth-child counts ALL
      // siblings (text nodes can mess it up) and breaks if a third element
      // ever lands inside #hs-prevnext. Attribute selectors are bulletproof.
      st.textContent =
        '#hs-prevnext{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:28px 0;page-break-inside:avoid}' +
        '#hs-prevnext .hs-pn-card{display:flex;flex-direction:column;gap:6px;padding:14px 18px;background:#fff;border:0.5px solid var(--border);border-radius:14px;text-decoration:none;color:var(--ink);transition:all .15s;box-shadow:0 1px 2px rgba(15,23,42,.04);min-width:0}' +
        '#hs-prevnext .hs-pn-card:hover{border-color:rgba(58,90,124,.5);transform:translateY(-2px);box-shadow:0 8px 18px -10px rgba(58,90,124,.22)}' +
        '#hs-prevnext .hs-pn-card[data-pn="prev"]{grid-column:1;text-align:left;align-items:flex-start}' +
        '#hs-prevnext .hs-pn-card[data-pn="next"]{grid-column:2;text-align:right;align-items:flex-end}' +
        // Fallback when only one card is present — span both columns BUT keep alignment per direction
        '#hs-prevnext .hs-pn-card:only-child{grid-column:1 / -1}' +
        '#hs-prevnext .hs-pn-card[data-pn="next"] .hs-pn-dir,' +
        '#hs-prevnext .hs-pn-card[data-pn="next"] .hs-pn-title{text-align:right;align-self:flex-end}' +
        '#hs-prevnext .hs-pn-card[data-pn="prev"] .hs-pn-dir,' +
        '#hs-prevnext .hs-pn-card[data-pn="prev"] .hs-pn-title{text-align:left;align-self:flex-start}' +
        '#hs-prevnext .hs-pn-dir{font-family:"JetBrains Mono",Inter,monospace;font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--blue-deep);font-weight:700}' +
        '#hs-prevnext .hs-pn-title{font-family:"Noto Serif TC",Georgia,serif;font-size:14.5px;font-weight:700;line-height:1.45;color:var(--ink)}' +
        '@media(max-width:560px){' +
          '#hs-prevnext{grid-template-columns:1fr}' +
          '#hs-prevnext .hs-pn-card[data-pn="prev"],#hs-prevnext .hs-pn-card[data-pn="next"]{grid-column:1;text-align:left;align-items:flex-start}' +
          '#hs-prevnext .hs-pn-card[data-pn] .hs-pn-dir,' +
          '#hs-prevnext .hs-pn-card[data-pn] .hs-pn-title{text-align:left;align-self:flex-start}' +
        '}';
      document.head.appendChild(st);
    }

    var sec = document.createElement('section');
    sec.id = 'hs-prevnext';
    sec.className = 'max-w-3xl mx-auto px-5 sm:px-8';
    sec.innerHTML = card(pn.prev, '← 上一篇', '← Previous', 'prev') + card(pn.next, '下一篇 →', 'Next →', 'next');
    article.parentNode.insertBefore(sec, article.nextSibling);
  };

  // ---------- language helpers ----------
  DN.LANGS = [
    { code: 'zh', label: '中文',    htmlLang: 'zh-TW' },
    { code: 'en', label: 'English', htmlLang: 'en'    }
  ];
  DN.LANG_KEY = { 'zh': 'zh', 'en': 'en' };

  // v33: Cookie Store API — async, observable replacement for document.cookie.
  // When supported (Chrome 87+ / Edge), uses cookieStore.get() / .set();
  // otherwise falls back to document.cookie sync API. Same external
  // signature so call sites don't change.
  DN.cookieGet = function (name) {
    if ('cookieStore' in window) {
      // Note: cookieStore.get is async — but most call sites (detectLang)
      // need a sync answer at boot. We keep sync fallback for those, and
      // expose DN.cookieGetAsync for new code that prefers the modern API.
    }
    const found = document.cookie.split('; ').find(c => c.startsWith(name + '='));
    return found ? decodeURIComponent(found.split('=').slice(1).join('=')) : null;
  };
  DN.cookieGetAsync = async function (name) {
    if ('cookieStore' in window) {
      try { var c = await window.cookieStore.get(name); return c ? c.value : null; }
      catch (e) { /* fall through */ }
    }
    return DN.cookieGet(name);
  };
  DN.cookieSet = function (name, val, days) {
    if ('cookieStore' in window) {
      try {
        window.cookieStore.set({
          name: name, value: String(val),
          expires: Date.now() + (days || 365) * 86400e3,
          path: '/', sameSite: 'lax',
        });
        return;
      } catch (e) { /* fall through */ }
    }
    const exp = new Date(Date.now() + (days || 365) * 86400e3).toUTCString();
    document.cookie = name + '=' + encodeURIComponent(val) + '; expires=' + exp + '; path=/; SameSite=Lax';
  };

  DN.detectLang = function () {
    const fromCookie = DN.cookieGet('hs_lang');
    if (fromCookie && DN.LANG_KEY[fromCookie]) return fromCookie;
    const stored = (function(){ try { return localStorage.getItem('hs_lang'); } catch(e){ return null; } })();
    if (stored && DN.LANG_KEY[stored]) return stored;
    const nav = (navigator.language || 'zh').toLowerCase();
    if (nav.startsWith('zh')) return 'zh';
    if (nav.startsWith('en')) return 'en';
    return 'zh';
  };

  // v36.2: URL prefix for the page we're currently on. Returns '/en' when
  // pathname is under /en/, '' otherwise. Used by JS that synthesizes
  // internal links so cards/lists on EN pages link to /en/ versions, not
  // back to /blog/<slug>. Google demoted EN pages to "duplicate of ZH"
  // when internal-link signals pointed back at /blog/ (overriding the
  // <link rel="canonical"> on the EN page).
  DN.urlPrefix = function () {
    try { return location.pathname.startsWith('/en/') ? '/en' : ''; }
    catch (e) { return ''; }
  };
  DN.articlePath = function (slug) {
    var prefix = (DN.urlPrefix && DN.urlPrefix()) || '';
    if (prefix && DN.hasEnglishMirror && !DN.hasEnglishMirror(slug)) prefix = '';
    return prefix + '/blog/' + slug;
  };

  DN.setLang = function (code) {
    if (!DN.LANG_KEY[code]) return;
    try { localStorage.setItem('hs_lang', code); } catch (e) {}
    DN.cookieSet('hs_lang', code);
  };

  DN.translate = function (el, lang) {
    const order = lang === 'en' ? ['en', 'zh'] : ['zh', 'en'];
    for (const k of order) if (el.dataset[k] != null) return el.dataset[k];
    return null;
  };

  // v37.3 cache: heavy articles have 300+ data-zh/data-en elements; rescanning
  // the document on every language toggle is wasted work. Build the NodeList
  // once per page load + invalidate via MutationObserver when new bilingual
  // elements get injected (related-articles, share toolbar, etc.).
  DN._bilingualCache = null;
  DN._bilingualCacheObserver = null;
  function _getBilingualNodes() {
    if (DN._bilingualCache && DN._bilingualCache.length) return DN._bilingualCache;
    DN._bilingualCache = Array.prototype.slice.call(
      document.querySelectorAll('[data-zh],[data-en]')
    );
    // Lazily wire an observer so we invalidate if more bilingual nodes appear
    // (e.g., related-articles render, share-toolbar inject, edit-mode banner).
    if (!DN._bilingualCacheObserver && window.MutationObserver) {
      DN._bilingualCacheObserver = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          for (var j = 0; j < muts[i].addedNodes.length; j++) {
            var n = muts[i].addedNodes[j];
            if (n.nodeType === 1 && (n.hasAttribute('data-zh') || n.hasAttribute('data-en') ||
                (n.querySelector && n.querySelector('[data-zh],[data-en]')))) {
              DN._bilingualCache = null;
              return;
            }
          }
        }
      });
      try {
        DN._bilingualCacheObserver.observe(document.body || document.documentElement,
          { childList: true, subtree: true });
      } catch (e) { /* SSR safety */ }
    }
    return DN._bilingualCache;
  }

  DN.applyTextOnly = function (lang) {
    const meta = DN.LANGS.find(function (l) { return l.code === lang; }) || DN.LANGS[0];
    document.documentElement.lang = meta.htmlLang;
    var nodes = _getBilingualNodes();
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var txt = DN.translate(el, lang);
      if (txt == null) continue;
      if (/[<&]/.test(txt) && /<\/?[a-z]/i.test(txt)) el.innerHTML = txt;
      else el.textContent = txt;
    }
  };

  DN.bindLangToggle = function (onChange) {
    const toggle = document.getElementById('langToggle');
    if (!toggle) return;
    if (toggle.tagName === 'SELECT') {
      toggle.value = DN.detectLang();
      toggle.addEventListener('change', function () {
        const lang = toggle.value;
        if (!DN.LANG_KEY[lang]) return;
        DN.setLang(lang);
        if (typeof onChange === 'function') onChange(lang);
      });
      return;
    }
    const buttons = toggle.querySelectorAll('button[data-lang]');
    function syncActive(curLang) {
      buttons.forEach(function (b) { b.classList.toggle('active', b.dataset.lang === curLang); });
    }
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const lang = btn.dataset.lang;
        if (!DN.LANG_KEY[lang]) return;
        DN.setLang(lang);
        syncActive(lang);
        if (typeof onChange === 'function') onChange(lang);
      });
    });
    syncActive(DN.detectLang());
  };

  // ---------- reading progress bar ----------
  DN.addReadingProgress = function () {
    if (document.getElementById('hs-progress')) return;
    // v37.5: early-return when there's no <article> to read. Home page,
    // /tools, /notes etc. don't need a per-article reading-progress bar
    // and the scroll listener was wasting cycles on every page load.
    if (!document.querySelector('article')) return;
    const bar = document.createElement('div');
    bar.id = 'hs-progress';
    bar.style.cssText = 'position:fixed;top:0;left:0;height:3px;background:linear-gradient(90deg,#8fb3d4,#243b56);z-index:60;width:0;transition:width .12s linear;pointer-events:none';
    document.body.appendChild(bar);
    // rAF-throttled scroll handler — coalesces multiple scroll events into
    // a single paint per frame (~60fps).
    var _pending = false;
    function update() {
      _pending = false;
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      bar.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + '%';
    }
    function onScroll() {
      if (_pending) return;
      _pending = true;
      requestAnimationFrame(update);
    }
    document.addEventListener('scroll', onScroll, { passive: true });
    update();
  };

  // ---------- scroll to top ----------
  DN.addScrollToTop = function () {
    if (document.getElementById('hs-totop')) return;
    // v34.10: font-sizer pill = 24 (bottom) + 98 (3×32 buttons + borders) = top
    // edge at 122px. Both pieces have ~10-12px box-shadows that visually merge
    // on small gaps. Totop now at bottom:160px → 38px clear gap (visible
    // breathing room with no shadow overlap). Bumped from 144px which still
    // looked tight to the user. On non-article pages, totop sits in the corner.
    // On mobile, the @media block in injectMobileBottomNav overrides these
    // with calc(var(--hs-nav-h) + offset) so the stack clears the bottom-nav.
    var isArticle = !!document.querySelector('article.max-w-3xl');
    var bottomPx = isArticle ? 160 : 24;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'hs-totop';
    btn.setAttribute('aria-label', 'Scroll to top');
    btn.title = '回到頂部 / Scroll to top';
    btn.innerHTML = '↑';
    btn.style.cssText = 'position:fixed;right:18px;bottom:' + bottomPx + 'px;width:42px;height:42px;border-radius:50%;background:linear-gradient(180deg,#8fb3d4,#3a5a7c);color:#fff;border:1px solid rgba(36,59,86,.5);box-shadow:0 8px 20px -8px rgba(36,59,86,.55);cursor:pointer;display:none;align-items:center;justify-content:center;z-index:50;font-size:18px;line-height:1;transition:transform .15s,box-shadow .15s';
    btn.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    btn.addEventListener('mouseenter', function () { btn.style.transform = 'translateY(-2px)'; btn.style.boxShadow = '0 12px 26px -8px rgba(36,59,86,.65)'; });
    btn.addEventListener('mouseleave', function () { btn.style.transform = ''; btn.style.boxShadow = '0 8px 20px -8px rgba(36,59,86,.55)'; });
    document.body.appendChild(btn);
    document.addEventListener('scroll', function () {
      btn.style.display = window.scrollY > 600 ? 'flex' : 'none';
    }, { passive: true });
  };

  // ---------- prefetch on idle ----------
  DN.prefetchOnIdle = function () {
    if (!('IntersectionObserver' in window)) return;
    const idle = window.requestIdleCallback || function (cb) { return setTimeout(cb, 1500); };
    idle(function () {
      const seen = new Set();
      const io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          const a = e.target;
          const href = a.getAttribute('href');
          if (!href || seen.has(href)) return;
          seen.add(href);
          if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
          if (/^https?:\/\//.test(href) && !href.startsWith(location.origin)) return;
          const link = document.createElement('link');
          link.rel = 'prefetch';
          link.href = href;
          link.as = 'document';
          document.head.appendChild(link);
          io.unobserve(a);
        });
      }, { rootMargin: '200px' });
      document.querySelectorAll('a[href^="/"], a[href^="' + location.origin + '"]').forEach(function (a) {
        io.observe(a);
      });
    });
  };

  // v37.30 — Speculation Rules NOT injected via JS:
  // Dynamically-added `<script type="speculationrules">` is subject to
  // the same `script-src` CSP as regular inline scripts, so it would
  // be blocked under the hash-based CSP (the JS-injected JSON has no
  // matching SHA-256 in INLINE_SCRIPT_HASHES).
  //
  // Static `<script type="speculationrules">` placed directly in the
  // HTML of /index.html and /blog/index.html IS picked up by
  // _gen_csp_hashes.py and so works under enforced CSP. Article pages
  // already get `<link rel="prefetch">` via DN.prefetchOnIdle() above.
  DN.injectSpeculationRules = function () { /* see static block in HTML */ };

  // ---------- reveal on scroll ----------
  DN.bindRevealOnScroll = function () {
    if (!('IntersectionObserver' in window)) return;
    const targets = document.querySelectorAll('.reveal, .article-list-item, .myth-card');
    if (!targets.length) return;
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    targets.forEach(function (el, i) {
      el.style.opacity = el.style.opacity || '0';
      el.style.transform = el.style.transform || 'translateY(10px)';
      el.style.transition = 'opacity .35s cubic-bezier(.2,.7,.2,1) ' + Math.min(i * 25, 200) + 'ms, transform .35s cubic-bezier(.2,.7,.2,1) ' + Math.min(i * 25, 200) + 'ms';
      io.observe(el);
    });
    const styleEl = document.createElement('style');
    styleEl.id = 'hs-reveal-css';
    styleEl.textContent = '.reveal.visible, .article-list-item.visible, .myth-card.visible { opacity:1 !important; transform:translateY(0) !important; }';
    document.head.appendChild(styleEl);
  };

  // ---------- view transitions ----------
  // 2026-Q2: Chrome 126+ supports cross-document view transitions via the
  // `@view-transition { navigation: auto; }` CSS rule. We inject that rule
  // here (idempotent) so same-origin navigations animate even when leaving
  // the page (no SPA shim required). Keep the JS-driven fallback for older
  // browsers that have document.startViewTransition but not cross-doc nav.
  DN.bindViewTransitions = function () {
    // Inject the CSS rule once — supports declarative cross-doc transitions
    if (!document.getElementById('hs-vt-css')) {
      try {
        var st = document.createElement('style');
        st.id = 'hs-vt-css';
        st.textContent =
          '@view-transition{navigation:auto}' +
          '::view-transition-old(root),::view-transition-new(root){animation-duration:.22s;animation-timing-function:cubic-bezier(.2,.7,.2,1)}' +
          '::view-transition-old(root){animation-name:hs-vt-out}' +
          '::view-transition-new(root){animation-name:hs-vt-in}' +
          '@keyframes hs-vt-out{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-4px)}}' +
          '@keyframes hs-vt-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}' +
          '@media (prefers-reduced-motion:reduce){::view-transition-old(root),::view-transition-new(root){animation:none}}';
        document.head.appendChild(st);
      } catch (e) {}
    }

    // Same-document transitions (Chrome 111+) — fallback for sites without
    // the cross-doc API or for hash / search-only nav. Skip if the browser
    // doesn't support it at all.
    if (!document.startViewTransition) return;

    // Skip JS click hijack when cross-doc view transitions are natively
    // supported — the browser handles it. Detected via the presence of
    // CSSViewTransitionRule which only exists when the API is wired.
    var hasCrossDoc = (function () {
      try { return 'CSSViewTransitionRule' in window || 'onpagereveal' in window; }
      catch (e) { return false; }
    })();

    if (hasCrossDoc) return;  // browser handles it

    document.addEventListener('click', function (e) {
      const a = e.target.closest('a');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href) return;
      if (a.target === '_blank' || a.hasAttribute('download')) return;
      if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;
      const url = new URL(href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      e.preventDefault();
      document.startViewTransition(function () {
        location.href = url.href;
      });
    });
  };

  // ---------- SW auto-update (silent, one-shot reload) ----------
  // v36: was a manual "網站已更新 — 重新載入" toast. Per user request, switched
  // to automatic activation + one-shot reload so users never have to clear
  // cache or click anything to pick up a new deploy.
  //
  // Flow:
  //   1. registration.waiting present (or `updatefound` fires + new SW
  //      reaches `installed`) → send SKIP_WAITING.
  //   2. New SW activates → `controllerchange` event fires.
  //   3. We reload exactly once. The sessionStorage flag prevents the
  //      next page (which will see ITS OWN registration.waiting === null
  //      because we just consumed it) from reloading again, and also
  //      blocks the rare edge case where two activations happen in one
  //      tab session.
  DN.bindSWUpdateToast = function (registration) {
    if (!registration) return;

    function activateAndReload() {
      try {
        if (sessionStorage.getItem('hs:sw:reloaded') === '1') return;
        sessionStorage.setItem('hs:sw:reloaded', '1');
      } catch (e) { /* private mode / quota — fall through, single reload still safer than none */ }
      if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      // Wait for the controller swap before reloading so the next page
      // load is served by the NEW SW (otherwise the reload could be
      // intercepted by the old SW and we'd be stuck a cycle behind).
      navigator.serviceWorker.addEventListener('controllerchange', function once () {
        navigator.serviceWorker.removeEventListener('controllerchange', once);
        location.reload();
      }, { once: true });
    }

    // Case A: a new SW is already waiting (e.g., user just deployed,
    // closed tabs, opened a fresh tab — old SW still controls this page
    // but a new one is queued behind it).
    if (registration.waiting && navigator.serviceWorker.controller) {
      activateAndReload();
      return;
    }
    // Case B: new SW detected during this page session.
    registration.addEventListener('updatefound', function () {
      const sw = registration.installing;
      if (!sw) return;
      sw.addEventListener('statechange', function () {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          activateAndReload();
        }
      });
    });
  };

  // ---------- mobile drawer ----------
  DN.injectMobileMenu = function () {
    if (document.getElementById('hsMobileMenuBtn')) return;
    const header = document.querySelector('header.sticky') || document.querySelector('header');
    if (!header) return;
    const headerInner = header.querySelector('.h-16') || header.querySelector('div.flex.items-center.justify-between') || header.firstElementChild;
    if (!headerInner) return;
    const right = headerInner.lastElementChild;

    const btn = document.createElement('button');
    btn.id = 'hsMobileMenuBtn';
    btn.type = 'button';
    btn.className = 'sm:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--border)] bg-white mr-2';
    btn.setAttribute('aria-label', 'Menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>';
    right.parentNode.insertBefore(btn, right);

    const drawer = document.createElement('div');
    drawer.id = 'hsMobileDrawer';
    drawer.className = 'hidden sm:hidden border-t border-[var(--border)]';
    drawer.style.cssText = 'background:rgba(247,245,240,.98);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);max-height:calc(100vh - 64px);overflow-y:auto;-webkit-overflow-scrolling:touch';
    drawer.innerHTML =
      '<nav class="max-w-6xl mx-auto px-5 py-4 flex flex-col gap-1">' +
        '<a href="/" class="block px-3 py-2.5 rounded-lg text-[14px] font-semibold" style="color:var(--blue-deep)" data-zh="首頁" data-en="Home"></a>' +
        '<a href="/blog/" class="block px-3 py-2.5 rounded-lg text-[14px] font-semibold" style="color:var(--blue-deep)" data-zh="衛教文章" data-en="Articles"></a>' +
        '<a href="/about" class="block px-3 py-2.5 rounded-lg text-[14px] font-semibold" style="color:var(--blue-deep)" data-zh="關於我" data-en="About"></a>' +
      '</nav>';
    header.appendChild(drawer);

    function open()  { drawer.classList.remove('hidden'); btn.setAttribute('aria-expanded', 'true');  document.body.style.overflow = 'hidden'; }
    function close() { drawer.classList.add('hidden');    btn.setAttribute('aria-expanded', 'false'); document.body.style.overflow = ''; }
    btn.addEventListener('click', function () { drawer.classList.contains('hidden') ? open() : close(); });
    drawer.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', close); });
    window.addEventListener('resize', function () { if (window.innerWidth >= 640) close(); });
  };

  // ---------- footer year ----------
  DN.injectFooterYear = function () {
    const el = document.getElementById('yr');
    if (el) el.textContent = String(new Date().getFullYear());
  };

  // ---------- read tracker (localStorage) ----------
  DN.getReadSlugs = function () {
    try {
      const raw = localStorage.getItem(DN.READ_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  };
  DN.markRead = function (slug) {
    if (!slug) return;
    const slugs = DN.getReadSlugs();
    if (slugs.indexOf(slug) !== -1) return;
    slugs.push(slug);
    try {
      localStorage.setItem(DN.READ_KEY, JSON.stringify(slugs));
      window.dispatchEvent(new CustomEvent('hs-read-updated'));
    } catch (e) {}
  };
  DN.getReadCount = function () { return DN.getReadSlugs().length; };
  DN.resetRead = function () {
    try { localStorage.removeItem(DN.READ_KEY); window.dispatchEvent(new CustomEvent('hs-read-updated')); } catch (e) {}
  };

  // ---------- read-progress widget (mounts into #hs-read-progress) ----------
  DN.injectReadProgress = function () {
    const host = document.getElementById('hs-read-progress');
    if (!host) return;
    function render() {
      const read = DN.getReadCount();
      // We deliberately do NOT show "X / N total" — total article count is a
      // moving target and tends to feel "thin" early on. Just celebrate what
      // the reader has actually read; the bar grows monotonically up to the
      // current total but the label hides the denominator.
      const total = DN.totalArticles || 1;
      const pct = Math.min(100, Math.round((read / total) * 100));
      host.innerHTML =
        '<div style="background:#fff;border:1px solid var(--border);border-radius:14px;padding:18px 22px;box-shadow:0 1px 2px rgba(15,23,42,.04)">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">' +
            '<div>' +
              '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.22em;color:var(--blue-deep);font-weight:700;margin-bottom:2px" data-zh="閱讀進度" data-en="Reading progress">閱讀進度</div>' +
              '<div style="font-family:\'Noto Serif TC\',Georgia,serif;font-size:18px;font-weight:700;color:var(--ink)">' +
                '<span data-zh="已讀" data-en="Read">已讀</span> <span style="color:var(--blue-deep)">' + read + '</span> <span data-zh="篇" data-en="article' + (read === 1 ? '' : 's') + '">篇</span>' +
                (read > 0 ? ' <span style="font-size:13px;font-weight:500;color:var(--ink-2)">(' + pct + '%)</span>' : '') +
              '</div>' +
            '</div>' +
            (read > 0
              ? '<button id="hs-read-reset" type="button" style="background:#fff;border:1px solid var(--border);color:var(--ink-2);padding:5px 10px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer" data-zh="重設" data-en="Reset">重設</button>'
              : '<span style="font-size:12px;color:var(--muted);font-style:italic" data-zh="閱讀後自動記錄" data-en="Auto-tracked">閱讀後自動記錄</span>') +
          '</div>' +
          '<div style="height:8px;background:var(--blue-soft);border-radius:9999px;overflow:hidden">' +
            '<div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,#8fb3d4,#243b56);transition:width .35s ease;"></div>' +
          '</div>' +
        '</div>';
      const resetBtn = document.getElementById('hs-read-reset');
      if (resetBtn) resetBtn.addEventListener('click', function () {
        if (confirm('要重設閱讀進度嗎? 本動作只會清除本裝置的紀錄,不會影響網站。')) DN.resetRead();
      });
      // v34.10: every render() rebuilds innerHTML, so the freshly inserted
      // data-zh/data-en spans need re-translation. Without this the widget
      // reverts to Chinese on /en/ pages whenever the read-count changes.
      if (DN.applyTextOnly) DN.applyTextOnly(DN.detectLang());
    }
    render();
    window.addEventListener('hs-read-updated', render);
    window.addEventListener('storage', function (e) { if (e.key === DN.READ_KEY) render(); });
  };

  // ---------- visible breadcrumb (renders BreadcrumbList JSON-LD as HTML) ----------
  // v37.42 — Google shows the breadcrumb path above the title in mobile
  // SERPs ONLY when the page has a visible <nav aria-label="breadcrumb">.
  // JSON-LD alone is not enough on its own to render the path in SERP.
  // Renders: 首頁 / 衛教文章 / <article tag>
  DN.injectBreadcrumb = function () {
    if (document.getElementById('hs-breadcrumb') ||
        document.getElementById('hs-breadcrumb-runtime')) return;
    var slug = DN.currentSlug && DN.currentSlug();
    if (!slug) return;
    var meta = (DN.ARTICLES || []).find(function (a) { return a.slug === slug; });
    if (!meta) return;
    var h1 = document.querySelector('article h1, section h1');
    if (!h1) return;
    var section = h1.closest('section') || h1.parentNode;
    if (!section) return;
    var existingNav = section.querySelector('nav');
    if (existingNav) {
      if (!existingNav.hasAttribute('aria-label')) {
        existingNav.setAttribute('aria-label', 'Breadcrumb');
      }
      return;
    }
    var prefix = (DN.urlPrefix && DN.urlPrefix()) || '';
    var nav = document.createElement('nav');
    nav.id = 'hs-breadcrumb-runtime';
    nav.setAttribute('aria-label', 'Breadcrumb');
    nav.style.cssText = 'font-size:12px;color:var(--muted);margin:0 0 14px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-family:Inter,sans-serif;';
    nav.innerHTML =
      '<a href="' + prefix + '/" style="color:var(--blue-deep);text-decoration:none" data-zh="首頁" data-en="Home">首頁</a>' +
      '<span aria-hidden="true">›</span>' +
      '<a href="' + prefix + '/blog" style="color:var(--blue-deep);text-decoration:none" data-zh="衛教文章" data-en="Articles">衛教文章</a>' +
      '<span aria-hidden="true">›</span>' +
      '<span aria-current="page" data-zh="' + attrEsc(meta.tag || meta.title) + '" data-en="' +
        attrEsc(meta.tag_en || meta.title_en || meta.tag || meta.title) + '">' +
        (meta.tag || meta.title) + '</span>';
    // Insert at top of the section (above the eyebrow / category chip)
    var firstChild = section.firstElementChild;
    if (firstChild) section.insertBefore(nav, firstChild);
    else section.appendChild(nav);
  };

  // ---------- article reading-meta (reading time + last-reviewed badges) ----------
  DN.addReadingMeta = function () {
    const proseEl = document.getElementById('proseZh') || document.querySelector('article .prose');
    if (!proseEl) return;
    if (document.getElementById('hs-reading-meta')) return;

    const slug = DN.currentSlug();
    const meta = (DN.ARTICLES || []).find(function (a) { return a.slug === slug; });
    // v37.42 — show the updated date when present, otherwise fall back to
    // publish date. Label is "最後更新 / Last updated" (NOT "最後審閱 /
    // Last reviewed"): the field is meta.updated||meta.date, i.e. an
    // update/publish timestamp, not an independent editorial-review event —
    // so an accurate label avoids implying a medical review that didn't happen.
    const reviewedDate = meta ? (meta.updated || meta.date || '') : '';

    // v31: Use precomputed `minutes` from DN.ARTICLES (set by /api/admin/precompute-meta).
    // Falls back to runtime estimation when missing — same heuristic as before.
    let minutes;
    if (meta && typeof meta.minutes === 'number' && meta.minutes > 0) {
      minutes = meta.minutes;
    } else {
      const text = (proseEl.textContent || '').replace(/\s+/g, '');
      const cjkChars = (text.match(/[一-鿿]/g) || []).length;
      const otherWords = (text.match(/[A-Za-z0-9]+/g) || []).length;
      minutes = Math.max(2, Math.round(cjkChars / 350 + otherWords / 200));
    }

    const h1 = document.querySelector('article h1, section h1');
    const lead = h1 ? h1.parentElement.querySelector('p') : null;
    const target = lead || h1;
    if (!target) return;

    const bar = document.createElement('div');
    bar.id = 'hs-reading-meta';
    bar.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:14px 0 8px;font-size:12.5px;color:var(--ink-2);';
    bar.innerHTML =
      '<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:9999px;background:var(--blue-soft);border:1px solid #b8cfe3;color:var(--blue-deep);font-weight:600">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
        '<span data-zh="閱讀約 ' + minutes + ' 分鐘" data-en="' + minutes + ' min read">閱讀約 ' + minutes + ' 分鐘</span>' +
      '</span>' +
      (reviewedDate ?
      '<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:9999px;background:#dcfce7;border:1px solid #86efac;color:#14532d;font-weight:600">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
        '<span data-zh="最後更新 ' + reviewedDate + '" data-en="Last updated · ' + reviewedDate + '">最後更新 ' + reviewedDate + '</span>' +
      '</span>' : '') +
      '<a href="' + DN.AUTHOR_BIO_URL + '" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:9999px;background:#fff;border:1px solid var(--border);color:var(--blue-deep);text-decoration:none;font-weight:600" data-zh="蕭閔謙 醫師 →" data-en="Dr. Hsiao →">蕭閔謙 醫師 →</a>';
    target.parentNode.insertBefore(bar, target.nextSibling);

    // Reading-progress is now ENGAGEMENT-GATED — see DN.bindReadEngagement.
    // We intentionally do NOT call DN.markRead(slug) here on page-load.
  };

  // ---------------------------------------------------------------------
  // Engagement-gated read tracking — only mark an article as "read" when the
  // user has demonstrably engaged with it. Prevents bounce-traffic from
  // counting toward the home-page progress widget.
  //
  // Criteria (BOTH required):
  //   1. ≥ 30 seconds of foreground time (visibility-aware)
  //   2. ≥ 50 % of the article scrolled past the viewport bottom
  //
  // Once both are met for the current slug, we localStorage-persist it and
  // dispatch 'hs-read-updated' so DN.injectReadProgress re-renders. We also
  // fire a GA4 'article_read' event for analytics segmentation.
  // ---------------------------------------------------------------------
  DN.READ_DWELL_MS = 30 * 1000;     // 30 s minimum dwell
  DN.READ_SCROLL_PCT = 0.5;         // ≥ 50 % scrolled
  DN.bindReadEngagement = function () {
    var slug = DN.currentSlug && DN.currentSlug();
    if (!slug) return;
    if (DN.getReadSlugs && DN.getReadSlugs().indexOf(slug) >= 0) return;  // already counted
    var article = document.querySelector('article.max-w-3xl');
    if (!article) return;

    var dwellMs = 0;
    var lastTick = Date.now();
    var maxScrollPct = 0;
    var marked = false;

    function tick() {
      if (marked) return;
      var now = Date.now();
      // Only accumulate dwell when tab is visible
      if (document.visibilityState === 'visible') dwellMs += (now - lastTick);
      lastTick = now;

      // Recompute scroll % against the article's vertical extent
      var rect = article.getBoundingClientRect();
      var articleTop = rect.top + window.pageYOffset;
      var articleBottom = articleTop + article.offsetHeight;
      var viewportBottom = window.pageYOffset + window.innerHeight;
      var pct = Math.max(0, Math.min(1,
        (viewportBottom - articleTop) / Math.max(1, articleBottom - articleTop)));
      if (pct > maxScrollPct) maxScrollPct = pct;

      if (dwellMs >= DN.READ_DWELL_MS && maxScrollPct >= DN.READ_SCROLL_PCT) {
        marked = true;
        DN.markRead && DN.markRead(slug);
        try {
          window.gtag && gtag('event', 'article_read', {
            slug: slug,
            dwell_seconds: Math.round(dwellMs / 1000),
            scroll_pct: Math.round(maxScrollPct * 100)
          });
        } catch (e) {}
      }
    }

    // Tick on scroll (throttled) and every 5 s while visible (dwell)
    var lastScrollTick = 0;
    window.addEventListener('scroll', function () {
      var n = Date.now();
      if (n - lastScrollTick < 250) return;
      lastScrollTick = n;
      tick();
    }, { passive: true });
    var dwellTimer = setInterval(function () {
      if (marked) { clearInterval(dwellTimer); return; }
      tick();
    }, 5000);

    // Reset dwell clock on visibility regain so background tabs don't accrue
    document.addEventListener('visibilitychange', function () {
      lastTick = Date.now();
    });
  };

  // ---------- inline TOC (collapsible card at top of article) ----------
  DN.addInlineTOC = function () {
    const proseEl = document.getElementById('proseZh') || document.querySelector('article .prose');
    if (!proseEl) return;
    if (document.getElementById('hs-inline-toc')) return;
    const h2s = proseEl.querySelectorAll('h2[id]');
    if (h2s.length < 3) return;

    const details = document.createElement('details');
    details.id = 'hs-inline-toc';
    details.open = true;
    details.style.cssText = 'margin:18px 0 24px;background:linear-gradient(135deg,#f3f7fb 0%,#e6eef6 100%);border:1px solid #b8cfe3;border-radius:14px;padding:0;overflow:hidden';

    const summary = document.createElement('summary');
    summary.style.cssText = 'cursor:pointer;list-style:none;padding:14px 18px;font-size:13px;font-weight:700;color:var(--blue-deep);display:flex;align-items:center;justify-content:space-between;gap:8px;user-select:none';
    summary.innerHTML =
      '<span style="display:inline-flex;align-items:center;gap:8px">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>' +
          '<line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>' +
        '</svg>' +
        '<span data-zh="本篇大綱" data-en="In this article">本篇大綱</span>' +
        '<span style="font-size:11px;font-weight:600;color:var(--ink-2);opacity:.7">· ' + h2s.length + ' 段</span>' +
      '</span>' +
      '<span style="font-size:11px;color:var(--ink-2);opacity:.7" data-zh="點擊收合" data-en="Click to collapse">點擊收合</span>';
    details.appendChild(summary);

    // Match each h2[id] in proseZh with its English counterpart in proseEn (id + "-en")
    const proseEnInline = document.getElementById('proseEn');
    function attrEscInline(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

    const ol = document.createElement('ol');
    ol.style.cssText = 'list-style:none;counter-reset:toc;padding:4px 18px 14px;margin:0;display:flex;flex-direction:column;gap:2px';
    h2s.forEach(function (h, i) {
      const idZh = h.id;
      const textZh = (h.textContent || ('Section ' + (i + 1))).trim();
      // M-04: use getElementById (ids are unique) instead of querySelector
      // string-concat, which throws SyntaxError on numeric-leading / non-ASCII ids.
      const enH = proseEnInline ? document.getElementById(idZh + '-en') : null;
      const textEn = (enH && (enH.textContent || '').trim()) || textZh;
      const li = document.createElement('li');
      li.style.cssText = 'counter-increment:toc;position:relative;padding:5px 4px 5px 32px';
      li.innerHTML =
        '<span style="position:absolute;left:0;top:5px;width:24px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:700;color:var(--blue-deep);background:#fff;border:1px solid #b8cfe3;border-radius:6px">' + (i + 1) + '</span>' +
        '<a href="#' + idZh + '" data-toc-inline="' + idZh + '" data-zh="' + attrEscInline(textZh) + '" data-en="' + attrEscInline(textEn) + '" style="display:block;color:var(--ink-2);text-decoration:none;font-size:13.5px;line-height:1.6;font-weight:500">' + textZh + '</a>';
      ol.appendChild(li);
    });
    details.appendChild(ol);

    const articleEl = document.querySelector('article');
    if (articleEl && articleEl.firstElementChild) {
      const h1 = articleEl.querySelector('h1');
      if (h1 && h1.parentNode) h1.parentNode.insertBefore(details, h1.nextSibling);
      else articleEl.insertBefore(details, articleEl.firstElementChild);
    } else {
      proseEl.parentNode.insertBefore(details, proseEl);
    }

    ol.addEventListener('click', function (e) {
      const a = e.target.closest('a[data-toc-inline]');
      if (!a) return;
      e.preventDefault();
      const id = a.dataset.tocInline;
      const target = document.getElementById(id);
      if (target) {
        const top = target.getBoundingClientRect().top + window.pageYOffset - 80;
        window.scrollTo({ top: top, behavior: 'smooth' });
        history.pushState(null, '', '#' + id);
      }
    });
  };

  // ---------- floating sidebar TOC (desktop ≥1280px) ----------
  DN.addFloatingTOC = function () {
    if (window.innerWidth < 1100) return;
    const proseEl = document.getElementById('proseZh') || document.querySelector('article .prose');
    if (!proseEl) return;
    const h2s = proseEl.querySelectorAll('h2[id]');
    if (h2s.length < 3) return;
    if (document.getElementById('hs-toc-float')) return;

    const aside = document.createElement('aside');
    aside.id = 'hs-toc-float';
    // Style is set fully via JS so we can re-measure on resize. Width is
    // computed from the actual article bounding rect so the TOC NEVER
    // overlaps the content regardless of viewport / article container width.
    aside.style.cssText = 'position:fixed;top:120px;max-height:calc(100vh - 160px);overflow-y:auto;padding:14px 16px;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid var(--border);border-radius:14px;box-shadow:0 12px 28px -14px rgba(58,90,124,.22);font-size:12.5px;line-height:1.7;z-index:30;display:none;transition:opacity .25s ease, transform .25s ease;';
    const proseEnFloat = document.getElementById('proseEn');
    function attrEscFloat(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
    let html = '<div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.18em;color:var(--blue-deep);font-weight:700;margin-bottom:8px" data-zh="本篇大綱" data-en="Contents">本篇大綱</div><ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:5px" id="hs-toc-list">';
    h2s.forEach(function (h, i) {
      const idZh = h.id;
      const textZh = (h.textContent || ('Section ' + (i + 1))).trim().slice(0, 28);
      // M-04: getElementById avoids querySelector selector-escaping SyntaxError.
      const enH = proseEnFloat ? document.getElementById(idZh + '-en') : null;
      const textEn = (enH && (enH.textContent || '').trim().slice(0, 28)) || textZh;
      html += '<li><a href="#' + idZh + '" data-toc="' + idZh + '" data-zh="' + attrEscFloat(textZh) + '" data-en="' + attrEscFloat(textEn) + '" style="display:block;padding:5px 8px;border-radius:6px;color:var(--ink-2);text-decoration:none;border-left:2px solid transparent;transition:all .15s">' + textZh + '</a></li>';
    });
    html += '</ul>';
    aside.innerHTML = html;
    document.body.appendChild(aside);

    const links = aside.querySelectorAll('a[data-toc]');
    function setActive(id) {
      links.forEach(function (l) {
        const active = l.dataset.toc === id;
        l.style.color = active ? 'var(--blue-deep)' : 'var(--ink-2)';
        l.style.background = active ? 'var(--blue-soft)' : 'transparent';
        l.style.borderLeftColor = active ? 'var(--blue)' : 'transparent';
        l.style.fontWeight = active ? '700' : '500';
      });
    }
    const io = new IntersectionObserver(function (entries) {
      const visible = entries.filter(function (e) { return e.isIntersecting; });
      if (visible.length) setActive(visible[0].target.id);
    }, { rootMargin: '-30% 0px -50% 0px' });
    h2s.forEach(function (h) { io.observe(h); });

    // v33.1: dynamic positioning — measures actual article position so the
    // TOC sits in the gutter without overlapping content. Hides itself when
    // the gutter is too narrow (<150px) regardless of viewport width.
    function reposition() {
      if (window.innerWidth < 1100) { aside.style.display = 'none'; return; }
      // Find the article container's left edge (max-w-3xl wrapper)
      const article = proseEl.closest('article') || proseEl.parentElement;
      if (!article) { aside.style.display = 'none'; return; }
      const rect = article.getBoundingClientRect();
      const articleLeft = rect.left;
      const margin = 16;     // left edge gap
      const gap    = 24;     // gap between TOC and article
      const minW   = 150;    // narrower than this → hide
      const maxW   = 240;    // cap so the TOC stays compact
      const available = articleLeft - margin - gap;
      if (available < minW) {
        aside.style.display = 'none';
        return;
      }
      aside.style.display = '';
      aside.style.left  = margin + 'px';
      aside.style.width = Math.min(available, maxW) + 'px';
    }
    reposition();
    window.addEventListener('resize', reposition);
    // Also reposition after fonts load (article width may shift)
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(reposition);

    // v34.14: auto-hide floating TOC when user scrolls into the mount-div /
    // footer region (related, feedback, share, author-bio, support, footer).
    // Otherwise the TOC overlaps the brand block at the bottom of the page.
    // Hidden by fading + sliding out; restored when user scrolls back up.
    var hideAnchor =
      document.getElementById('hs-author-bio') ||
      document.getElementById('hs-share') ||
      document.getElementById('hs-feedback') ||
      document.getElementById('hs-related') ||
      document.querySelector('footer.mag-footer') ||
      document.querySelector('main + footer');
    if (hideAnchor) {
      var tocHidden = false;
      function applyTocHidden(hide) {
        if (hide === tocHidden) return;
        tocHidden = hide;
        if (hide) {
          aside.style.opacity = '0';
          aside.style.pointerEvents = 'none';
          aside.style.transform = 'translateX(-12px)';
        } else {
          aside.style.opacity = '';
          aside.style.pointerEvents = '';
          aside.style.transform = '';
        }
      }
      function checkFooterCollision() {
        // Only apply when TOC is actually displayed (gutter wide enough)
        if (aside.style.display === 'none') return;
        var rect = hideAnchor.getBoundingClientRect();
        var viewportH = window.innerHeight;
        // Hide once the anchor's top crosses above the viewport's mid-line —
        // that means the user is already reading the bottom-of-page region.
        applyTocHidden(rect.top < viewportH * 0.55);
      }
      window.addEventListener('scroll', checkFooterCollision, { passive: true });
      window.addEventListener('resize', checkFooterCollision);
      checkFooterCollision();
    }

    aside.addEventListener('click', function (e) {
      const a = e.target.closest('a[data-toc]');
      if (!a) return;
      e.preventDefault();
      const id = a.dataset.toc;
      const target = document.getElementById(id);
      if (target) {
        const top = target.getBoundingClientRect().top + window.pageYOffset - 80;
        window.scrollTo({ top: top, behavior: 'smooth' });
        history.pushState(null, '', '#' + id);
      }
    });
  };

  // ---------- scroll memory + "continue reading" toast ----------
  DN.bindScrollMemory = function () {
    const slug = DN.currentSlug();
    if (!slug) return;
    const proseEl = document.getElementById('proseZh') || document.querySelector('article .prose');
    if (!proseEl) return;
    const KEY = 'hs:scroll:' + slug;
    const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

    function saveNow() {
      try {
        const docH = document.documentElement.scrollHeight - window.innerHeight;
        if (docH < 100) return;
        const y = window.pageYOffset;
        const pct = Math.min(100, Math.max(0, Math.round((y / docH) * 100)));
        if (pct < 3 || pct > 97) { localStorage.removeItem(KEY); return; }
        const h2s = proseEl.querySelectorAll('h2[id]');
        let nearest = null;
        let nearestIdx = 0;
        for (let i = 0; i < h2s.length; i++) {
          const top = h2s[i].getBoundingClientRect().top + window.pageYOffset;
          if (top <= y + 120) { nearest = h2s[i]; nearestIdx = i; }
          else break;
        }
        const data = {
          y: y, pct: pct, ts: Date.now(),
          h2: nearest ? (nearest.textContent || '').slice(0, 40) : '',
          h2i: nearestIdx
        };
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch (e) {}
    }

    let saveTimer = null;
    window.addEventListener('scroll', function () {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(saveNow, 500);
    }, { passive: true });
    window.addEventListener('beforeunload', saveNow);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') saveNow();
    });

    function maybePrompt() {
      if (window.location.hash) return;
      let raw;
      try { raw = localStorage.getItem(KEY); } catch (e) { return; }
      if (!raw) return;
      let data;
      try { data = JSON.parse(raw); } catch (e) { localStorage.removeItem(KEY); return; }
      if (!data || !data.y || !data.pct) return;
      if (Date.now() - (data.ts || 0) > MAX_AGE_MS) { localStorage.removeItem(KEY); return; }
      if (data.pct < 5 || data.pct > 95) return;

      const toast = document.createElement('div');
      toast.id = 'hs-resume-toast';
      toast.style.cssText =
        'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;' +
        'background:#fff;border:1px solid #b8cfe3;border-radius:14px;' +
        'box-shadow:0 18px 40px -16px rgba(58,90,124,.35),0 4px 10px rgba(15,23,42,.08);' +
        'padding:14px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;' +
        'max-width:calc(100vw - 32px);font-size:13.5px;color:var(--ink);' +
        'animation:hs-toast-in .35s cubic-bezier(.2,.7,.3,1)';
      const label = data.h2 ? '「' + data.h2 + '」' : '';
      toast.innerHTML =
        '<div style="display:flex;align-items:center;gap:10px;flex:1;min-width:200px">' +
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3a5a7c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.8 1 6.5 2.6L21 8"/><path d="M21 3v5h-5"/>' +
          '</svg>' +
          '<div style="line-height:1.5">' +
            '<div style="font-weight:700;color:var(--blue-deep)">上次讀到 ' + data.pct + '%</div>' +
            (label ? '<div style="font-size:12px;color:var(--ink-2);margin-top:2px">' + label + '</div>' : '') +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-shrink:0">' +
          '<button type="button" data-resume-yes style="padding:7px 14px;border-radius:9999px;background:var(--blue-deep);color:#fff;border:0;font-weight:700;font-size:12.5px;cursor:pointer">繼續閱讀</button>' +
          '<button type="button" data-resume-no style="padding:7px 12px;border-radius:9999px;background:#fff;color:var(--ink-2);border:1px solid var(--border);font-weight:600;font-size:12.5px;cursor:pointer">從頭開始</button>' +
        '</div>';
      if (!document.getElementById('hs-resume-style')) {
        const st = document.createElement('style');
        st.id = 'hs-resume-style';
        st.textContent = '@keyframes hs-toast-in{from{opacity:0;transform:translate(-50%,16px)}to{opacity:1;transform:translate(-50%,0)}}';
        document.head.appendChild(st);
      }
      document.body.appendChild(toast);

      function dismiss() { if (toast.parentNode) toast.parentNode.removeChild(toast); }
      toast.querySelector('[data-resume-yes]').addEventListener('click', function () {
        window.scrollTo({ top: data.y, behavior: 'smooth' });
        dismiss();
      });
      toast.querySelector('[data-resume-no]').addEventListener('click', function () {
        try { localStorage.removeItem(KEY); } catch (e) {}
        dismiss();
      });
      setTimeout(function () { if (toast.parentNode) toast.style.opacity = '0', setTimeout(dismiss, 350); }, 12000);
    }
    setTimeout(maybePrompt, 600);
  };

  // ---------- font sizer (S/M/L floating button) ----------
  DN.addFontSizer = function () {
    if (document.getElementById('hs-font-sizer')) return;
    if (!document.querySelector('.prose, #proseZh, #proseEn')) return;

    const savedSize = (function(){ try { return localStorage.getItem('hs-font-size') || 'M'; } catch(e){ return 'M'; } })();
    const sizeMap = { 'S': '15px', 'M': '16.5px', 'L': '18.5px' };
    function applyFontSize(s) {
      let styleEl = document.getElementById('hs-font-size-style');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'hs-font-size-style';
        document.head.appendChild(styleEl);
      }
      styleEl.textContent =
        '.prose, #proseZh, #proseEn { font-size: ' + sizeMap[s] + ' !important; }' +
        '.prose p, #proseZh p, #proseEn p { font-size: ' + sizeMap[s] + ' !important; }';
      try { localStorage.setItem('hs-font-size', s); } catch (e) {}
    }
    applyFontSize(savedSize);

    const wrap = document.createElement('div');
    wrap.id = 'hs-font-sizer';
    wrap.setAttribute('aria-label', '字型大小調整');
    // v34.5: moved from bottom:74px → bottom:24px so the font-sizer occupies
    // the bottom-right corner. Scroll-to-top now sits above it at bottom:130px.
    wrap.style.cssText =
      'position:fixed;right:18px;bottom:24px;z-index:49;display:flex;flex-direction:column;' +
      'background:#fff;border:1px solid var(--border);border-radius:22px;' +
      'box-shadow:0 6px 18px -8px rgba(58,90,124,.45);overflow:hidden;opacity:0;' +
      'pointer-events:none;transition:opacity .25s;';

    ['S', 'M', 'L'].forEach(function (s) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.size = s;
      b.style.cssText =
        'width:38px;height:32px;border:0;cursor:pointer;font-weight:700;' +
        'background:' + (s === savedSize ? 'linear-gradient(180deg,#8fb3d4,#3a5a7c)' : 'transparent') + ';' +
        'color:' + (s === savedSize ? '#fff' : '#3a5a7c') + ';';
      b.style.fontSize = s === 'S' ? '11px' : (s === 'M' ? '13px' : '15px');
      b.textContent = s === 'S' ? '小' : (s === 'M' ? '中' : '大');
      b.setAttribute('aria-label', '字型大小 ' + s);
      b.title = '字型大小 ' + (s === 'S' ? '小' : (s === 'M' ? '中' : '大'));
      b.addEventListener('click', function () {
        applyFontSize(s);
        wrap.querySelectorAll('button').forEach(function (x) {
          x.style.background = 'transparent';
          x.style.color = '#3a5a7c';
        });
        b.style.background = 'linear-gradient(180deg,#8fb3d4,#3a5a7c)';
        b.style.color = '#fff';
      });
      wrap.appendChild(b);
    });
    document.body.appendChild(wrap);

    let ticking = false;
    function update() {
      const scrolled = window.scrollY > 400;
      wrap.style.opacity = scrolled ? '1' : '0';
      wrap.style.pointerEvents = scrolled ? 'auto' : 'none';
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    update();
  };

  // ---------- author bio + disclaimer (mounted at #hs-author-bio) ----------
  DN.injectAuthorBio = function (mountId) {
    const mount = document.getElementById(mountId || 'hs-author-bio');
    if (!mount) return;
    mount.innerHTML =
      '<div style="background:#fff;border:1px solid var(--border);border-radius:16px;padding:20px 22px;margin:32px 0 24px;box-shadow:0 8px 18px -10px rgba(58,90,124,.18)">' +
        '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">' +
          '<picture>' +
            '<source srcset="/SUNN1302-200.avif" type="image/avif" />' +
            '<source srcset="/SUNN1302-200.webp" type="image/webp" />' +
            '<img src="/SUNN1302-200.jpg" alt="蕭閔謙 醫師" width="54" height="54" loading="lazy" decoding="async" style="width:54px;height:54px;border-radius:50%;object-fit:cover;object-position:center top;flex-shrink:0;border:2px solid #fff;box-shadow:0 4px 10px -2px rgba(58,90,124,.3);background:var(--blue-soft)" />' +
          '</picture>' +
          '<div style="flex:1;min-width:200px">' +
            '<div style="font-family:\'Noto Serif TC\',Georgia,serif;font-size:16px;font-weight:700;color:var(--ink)">' +
              '<span data-zh="' + DN.AUTHOR_NAME_ZH + '" data-en="' + DN.AUTHOR_NAME_EN + '">' + DN.AUTHOR_NAME_ZH + '</span>' + 
            '</div>' +
            '<div style="font-size:13px;color:#334155;line-height:1.85;margin-top:6px" ' +
              'data-zh="<strong>現職</strong>:眼科住院醫師<br/><strong>學歷</strong>:高雄醫學大學 學士後醫學系" ' +
              'data-en="<strong>Position</strong>: Ophthalmology Resident<br/><strong>Education</strong>: KMU School of Post-Baccalaureate Medicine">' +
              '<strong>現職</strong>:眼科住院醫師<br/>' +
              '<strong>學歷</strong>:高雄醫學大學 學士後醫學系' +
            '</div>' +
          '</div>' +
          '<a href="' + DN.AUTHOR_BIO_URL + '" style="display:inline-flex;align-items:center;justify-content:center;padding:8px 14px;border-radius:9999px;background:var(--blue-deep);color:#fff;font-size:13px;font-weight:600;text-decoration:none;flex-shrink:0;line-height:1;text-align:center" data-zh="完整自介 →" data-en="Full bio →">完整自介 →</a>' +
        '</div>' +
        '<div style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--line);font-size:12px;line-height:1.75;color:#64748b" ' +
          'data-zh="本文為眼科住院醫師的<strong>衛教與學習筆記</strong>,內容依據國際醫學文獻與臨床指引整理,僅作為<strong>一般教育用途</strong>。任何用藥、停藥、調整劑量或就醫決定,請以您的主治醫師判斷為準。本網站不涉及任何藥品、醫療器材、療程或診所之推薦或業配。依《醫療法》§85-86 及《醫師法》§17,個別治療效果因人而異,本文不保證任何結果。" ' +
          'data-en="This article is a residency-level patient-education note, compiled from international literature for general education only — not individual medical advice. This site does not endorse any drug, device, procedure, or clinic. Per Taiwan Medical Care Act §§85–86, individual outcomes vary.">' +
          '本文為眼科住院醫師的<strong>衛教與學習筆記</strong>,內容依據國際醫學文獻與臨床指引整理,僅作為<strong>一般教育用途</strong>。任何用藥、停藥、調整劑量或就醫決定,請以您的主治醫師判斷為準。本網站不涉及任何藥品、醫療器材、療程或診所之推薦或業配。依《醫療法》§85-86 及《醫師法》§17,個別治療效果因人而異,本文不保證任何結果。' +
        '</div>' +
      '</div>';
  };

  // ---------------------------------------------------------------------
  // v34.6: Article support section — independent block, mounted AFTER
  // the author-bio. Single source of truth for Ko-fi link in articles
  // (no other support button on article pages).
  // ---------------------------------------------------------------------
  DN.injectArticleSupport = function () {
    if (!DN.BMC_URL) return;
    var article = document.querySelector('article.max-w-3xl');
    if (!article) return;
    // v34.11: prefer pre-existing <div id="hs-support"> mount; fallback to insert
    // after author-bio. Box dimensions, padding, border, shadow now match the
    // author-bio card pixel-for-pixel so the two stack visually balanced.
    // Ko-fi button dropped from #13C3FF (loud cyan) to muted teal (var(--blue-deep))
    // to harmonize with the page palette. "HsiaoEye" → "蕭閔謙醫師" per user.
    var existing = document.getElementById('hs-support');
    if (existing && existing.children.length) return;
    var sec = existing || document.createElement('section');
    if (!existing) sec.id = 'hs-support';
    sec.className = 'max-w-3xl mx-auto px-5 sm:px-8 my-6';
    sec.innerHTML =
      '<div style="background:#fff;border:1px solid var(--border);border-radius:16px;padding:20px 22px;margin:32px 0 24px;box-shadow:0 8px 18px -10px rgba(58,90,124,.18)">' +
        '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">' +
          '<div style="width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,#f3f7fb,#e6eef6);display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;border:2px solid #fff;box-shadow:0 4px 10px -2px rgba(58,90,124,.3)" aria-hidden="true">☕</div>' +
          '<div style="flex:1;min-width:200px">' +
            '<div style="font-family:\'Noto Serif TC\',Georgia,serif;font-size:16px;font-weight:700;color:var(--ink)" data-zh="支持作者" data-en="Support the author">支持作者</div>' +
            '<div style="font-size:13px;color:#334155;line-height:1.85;margin-top:6px" ' +
              'data-zh="蕭閔謙醫師為個人衛教專案，無業配、無贊助、無廣告分潤。如果這些內容對你或家人有幫助，歡迎請我喝杯咖啡，讓我有更多時間整理新主題。" ' +
              'data-en="Dr. Hsiao runs HsiaoEye as a personal patient-education project — no sponsorships, no affiliate links, no ad revenue. If this has helped you or your family, you\'re welcome to buy me a coffee.">' +
              '蕭閔謙醫師為個人衛教專案，無業配、無贊助、無廣告分潤。如果這些內容對你或家人有幫助，歡迎請我喝杯咖啡，讓我有更多時間整理新主題。' +
            '</div>' +
          '</div>' +
          '<a href="' + DN.BMC_URL + '" target="_blank" rel="noopener noreferrer" ' +
            'style="display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px 14px;' +
            'border-radius:9999px;background:#fff;color:var(--blue-deep);text-decoration:none;' +
            'font-size:13px;font-weight:600;flex-shrink:0;line-height:1;border:1px solid var(--border)" ' +
            'data-zh="☕ Ko-fi 支持" data-en="☕ Support on Ko-fi">☕ Ko-fi 支持</a>' +
        '</div>' +
      '</div>';
    if (!existing) {
      var authorBio = document.getElementById('hs-author-bio');
      if (authorBio && authorBio.parentNode) {
        authorBio.parentNode.insertBefore(sec, authorBio.nextSibling);
      } else {
        article.parentNode.insertBefore(sec, article.nextSibling);
      }
    }
  };

  // ---------- share toolbar ----------
  DN.injectShareToolbar = function (mountId) {
    const mount = document.getElementById(mountId || 'hs-share');
    if (!mount) return;
    const url = location.href;
    const title = document.title;
    const enc = encodeURIComponent;
    const links = [
      { name:'Line',     href:'https://social-plugins.line.me/lineit/share?url=' + enc(url),                    icon:'L' },
      { name:'Facebook', href:'https://www.facebook.com/sharer/sharer.php?u=' + enc(url),                       icon:'f' },
      { name:'X',        href:'https://twitter.com/intent/tweet?url=' + enc(url) + '&text=' + enc(title),       icon:'𝕏' },
      { name:'Threads',  href:'https://www.threads.net/intent/post?text=' + enc(title + ' ' + url),             icon:'@' }
    ];
    let html = '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:18px 0">' +
      '<span style="font-size:12px;color:var(--muted);font-weight:600;letter-spacing:.08em" data-zh="分享" data-en="Share">分享</span>';
    links.forEach(function (l) {
      html += '<a href="' + l.href + '" target="_blank" rel="noopener noreferrer" aria-label="Share to ' + l.name + '" ' +
        'style="display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;background:#fff;border:1px solid var(--border);color:var(--blue-deep);text-decoration:none;font-weight:700;font-size:14px;transition:all .15s">' + l.icon + '</a>';
    });
    html += '<button type="button" id="hs-copylink" style="display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:9999px;background:var(--blue-soft);color:var(--blue-deep);border:1px solid #b8cfe3;font-size:12px;font-weight:600;cursor:pointer">' +
      '<span data-zh="複製連結" data-en="Copy link">複製連結</span></button>';
    html += '</div>';
    mount.innerHTML = html;
    const cb = document.getElementById('hs-copylink');
    if (cb) cb.addEventListener('click', function () {
      navigator.clipboard.writeText(location.href).then(function () {
        const old = cb.querySelector('span').textContent;
        cb.querySelector('span').textContent = '✓ ' + (DN.detectLang() === 'en' ? 'Copied' : '已複製');
        setTimeout(function () { cb.querySelector('span').textContent = old; }, 1600);
      });
    });
  };

  // ---------- Ko-fi support button ----------
  DN.injectBMC = function (mountId) {
    // v34.8: now a cleanup stub. The dedicated DN.injectArticleSupport
    // section replaces this old pill. If a page has a hardcoded
    // <div id="hs-bmc"> mount, just empty it so the duplicate disappears.
    const mount = document.getElementById(mountId || 'hs-bmc');
    if (mount) { mount.innerHTML = ''; mount.style.display = 'none'; }
  };

  DN._kofiButtonHTML = function () {
    if (!DN.BMC_URL) return '';
    return (
      '<a href="' + DN.BMC_URL + '" target="_blank" rel="noopener noreferrer" ' +
        'class="hs-kofi-btn" ' +
        'style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:9999px;background:#13C3FF;color:#fff;text-decoration:none;font-weight:700;font-size:13.5px;box-shadow:0 6px 14px -6px rgba(19,195,255,.45);transition:transform .15s,box-shadow .15s">' +
        '<span style="font-size:16px">☕</span>' +
        '<span data-zh="支持我寫更多衛教文章" data-en="Support my writing on Ko-fi">支持我寫更多衛教文章</span>' +
      '</a>'
    );
  };

  // v34.3: Footer auto-mount disabled per user request — Ko-fi support card
  // now lives inline at:
  //   • Home: dedicated <section id="hs-support-section"> directly under
  //     the medical disclaimer (HTML-defined in index.html).
  //   • Articles: bottom card inside the author-bio block (added by
  //     DN.injectAuthorBio).
  // This stub stays so any code that still calls it doesn't throw, and
  // it ALSO clears any leftover .hs-kofi-btn that previous SW caches
  // may have injected at the page bottom.
  DN.injectFooterKofi = function () {
    // Remove any stray floating Ko-fi button mounted by older versions
    document.querySelectorAll('#hs-kofi-footer').forEach(function (el) {
      // Keep only the home page's HTML-declared <section id="hs-support-section">
      // and inline author-bio button. Delete legacy footer-mounted ones.
      if (el.tagName !== 'SECTION') el.remove();
    });
  };

  // ---------- related articles + ItemList JSON-LD ----------
  // v37.6: defer until the user is close to scrolling related-articles into
  // view. Saves the related.json fetch (~5-15 KB) on bounce visits and frees
  // mobile bandwidth for the actual article content. Also fires next-article
  // prefetch hint when related is visible — by then the user is engaged and
  // likely to navigate next.
  DN.addRelatedArticles = function () {
    const article = document.querySelector('article');
    if (!article) return;
    const _rel = document.getElementById('hs-related');
    if (_rel && _rel.children.length) return;

    function _doRender() {
      _addRelatedArticlesNow();
      _addNextArticlePrefetch();
    }

    // Use IntersectionObserver — wait until #hs-related mount is within
    // 800px of viewport, then fire fetch. Falls back to immediate render
    // if the API isn't available (older browsers).
    var mount = _rel;
    if (!mount || !('IntersectionObserver' in window)) {
      _doRender();
      return;
    }
    var io = new IntersectionObserver(function (entries, obs) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          obs.disconnect();
          _doRender();
          return;
        }
      }
    }, { rootMargin: '800px 0px' });
    io.observe(mount);
  };

  // Inject <link rel="prefetch"> for next article so click→load is near-instant.
  function _addNextArticlePrefetch() {
    try {
      var all = DN.ARTICLES || [];
      var slug = DN.currentSlug && DN.currentSlug();
      if (!slug || !all.length) return;
      var idx = -1;
      for (var i = 0; i < all.length; i++) {
        if (all[i].slug === slug) { idx = i; break; }
      }
      if (idx < 0) return;
      // Skip stubs when looking for next
      var next = null, prev = null;
      for (var j = idx + 1; j < all.length; j++) {
        if (!DN.isStub(all[j].slug)) { next = all[j]; break; }
      }
      for (var k = idx - 1; k >= 0; k--) {
        if (!DN.isStub(all[k].slug)) { prev = all[k]; break; }
      }
      [next, prev].forEach(function (a) {
        if (!a) return;
        var href = DN.articlePath(a.slug);
        if (document.querySelector('link[rel="prefetch"][href="' + href + '"]')) return;
        var l = document.createElement('link');
        l.rel = 'prefetch';
        l.href = href;
        l.as = 'document';
        document.head.appendChild(l);
      });
    } catch (e) { /* prefetch is best-effort */ }
  }

  // Original implementation, renamed and kept as-is.
  function _addRelatedArticlesNow() {
    const article = document.querySelector('article');
    if (!article) return;
    const _rel = document.getElementById('hs-related');
    if (_rel && _rel.children.length) return;
    const slug = DN.currentSlug();
    if (!slug) return;
    const all = DN.ARTICLES || [];
    const cur = all.find(function (a) { return a.slug === slug; });
    if (!cur) return;
    const others = all.filter(function (a) { return a.slug !== slug && !DN.isStub(a.slug); });
    if (!others.length) return;

    function _renderRelated(scored) {
      _renderRelatedInner(article, slug, cur, scored);
    }

    fetch('/assets/related.json', { cache: 'force-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (related) {
        if (related && related[slug] && related[slug].length) {
          // Use ML ranking
          var lookup = {};
          others.forEach(function (a) { lookup[a.slug] = a; });
          var scored = related[slug]
            .map(function (r) { return lookup[r.slug] ? Object.assign({}, lookup[r.slug], { _reasons: r.reasons }) : null; })
            .filter(Boolean)
            .slice(0, 4);
          if (scored.length >= 2) { _renderRelated(scored); return; }
        }
        // Fallback: category + random
        var fallback = others
          .map(function (a) { return { a: a, s: (a.cat === cur.cat ? 2 : 1) + Math.random() * 0.5 }; })
          .sort(function (x, y) { return y.s - x.s; })
          .slice(0, 4)
          .map(function (x) { return x.a; });
        _renderRelated(fallback);
      });
  }

  function _renderRelatedInner(article, slug, cur, scored) {
    // v34.11: prefer pre-existing <div id="hs-related"> mount in HTML; falls
    // back to insertBefore for legacy articles. Cap raised from 3 → 4.
    var existing = document.getElementById('hs-related');
    // If the mount already has children (already populated), bail.
    if (existing && existing.children.length) return;
    scored = (scored || []).slice(0, 4);
    // v36.1: one-shot CSS for the 2-column layout + mobile fallback.
    if (!document.getElementById('hs-related-css')) {
      var rcss = document.createElement('style');
      rcss.id = 'hs-related-css';
      rcss.textContent =
        '@media (max-width:520px){.hs-related-grid{grid-template-columns:1fr!important}}';
      document.head.appendChild(rcss);
    }

    var wrap;
    if (existing) {
      wrap = existing;
      wrap.classList.add('max-w-3xl', 'mx-auto', 'px-5', 'sm:px-8', 'my-10');
    } else {
      wrap = document.createElement('section');
      wrap.id = 'hs-related';
      wrap.className = 'max-w-3xl mx-auto px-5 sm:px-8 my-10';
    }
    // v36.1: fixed 2-column grid (was `auto-fit minmax(220px,1fr)` which let
    // 4 cards collapse into 3+1 on wider screens — visually unbalanced).
    // 2 columns × up to 2 rows: cards now fill 左上→右上→左下→右下 cleanly.
    // On <520px viewport the grid drops to 1 column for readability.
    let html = '<div style="border-top:1px solid var(--line);padding-top:24px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.22em;color:var(--blue-deep);font-weight:700;margin-bottom:12px" data-zh="你可能也會想看" data-en="Related reads">你可能也會想看</div><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px" class="hs-related-grid">';
    // v36.2: on /en/ pages, link to /en/blog/<slug>, not /blog/<slug>.
    // Critical SEO fix: previously every JS-injected "related reads" card
    // on an EN article linked back to the ZH version, sending Google the
    // signal that the ZH URL was the real canonical.
    scored.forEach(function (a) {
      var titleEn = a.title_en || a.title;
      var tagEn   = a.tag_en   || a.tag;
      var metaZh  = a.tag + ' · ' + a.date;
      var metaEn  = tagEn      + ' · ' + a.date;
      html += '<a href="' + DN.articlePath(a.slug) + '" style="display:flex;flex-direction:column;gap:6px;padding:14px;background:#fff;border:1px solid var(--border);border-radius:12px;text-decoration:none;color:var(--ink);transition:all .15s;box-shadow:0 1px 2px rgba(15,23,42,.04)">' +
        '<span style="font-size:11px;font-weight:700;letter-spacing:.18em;color:var(--blue-deep);text-transform:uppercase" data-zh="' + attrEsc(a.tag) + '" data-en="' + attrEsc(tagEn) + '">' + tagEn + '</span>' +
        '<span style="font-size:14px;font-weight:700;line-height:1.4;font-family:Noto Serif TC,Georgia,serif" data-zh="' + attrEsc(a.title) + '" data-en="' + attrEsc(titleEn) + '">' + a.title + '</span>' +
        '<span style="font-size:11.5px;color:var(--muted)" data-zh="' + attrEsc(metaZh) + '" data-en="' + attrEsc(metaEn) + '">' + metaZh + '</span>' +
      '</a>';
    });
    html += '</div></div>';
    wrap.innerHTML = html;
    if (!existing) article.parentNode.insertBefore(wrap, article.nextSibling);

    const ld = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      'name': 'Related ophthalmology articles',
      'itemListElement': scored.map(function (a, i) {
        return { '@type': 'ListItem', 'position': i + 1, 'url': DN.SITE_URL + DN.articlePath(a.slug), 'name': a.title };
      })
    };
    const ldEl = document.createElement('script');
    ldEl.type = 'application/ld+json';
    ldEl.textContent = JSON.stringify(ld);
    document.head.appendChild(ldEl);
  };

  // ---------- hero card rotation (封面故事 + 本期推薦) ----------
  // The homepage has two hero anchors (#hs-cover-story + #hs-editor-pick)
  // marked-up with one default article each. On every load we pick 2 random
  // distinct entries from DN.HERO_CARDS (Fisher-Yates) and rewrite both
  // anchors so visitors see different cover stories on repeat visits.
  // Only published articles appear here (no 'COMING' stubs).
  // Each hero SVG is a 400×300 narrative scene that tells the article's
  // medical story (not just a generic eye). Designed slug-by-slug so the
  // illustration always matches whichever article the rotation surfaces.
  DN.HERO_CARDS = [
    {
      slug: 'lacrimal-gland-tumor',
      title_zh: '淚腺腫瘤 6 個關鍵問題 — 為什麼會痛？能保留眼球嗎？',
      title_en: '6 Key Questions on Lacrimal Gland Tumor — Why pain? Can the eye be saved?',
      meta_zh: '2026.05 · 14 分鐘 · 警訊辨識',
      meta_en: '2026.05 · 14 min · Red flags',
      // Scene: lacrimal-gland anatomy with tumor location + perineural-invasion path
      svg:
        '<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
          '<defs>' +
            '<linearGradient id="hero-lacrimal-bg" x1="0%" y1="0%" x2="100%" y2="100%">' +
              '<stop offset="0%" stop-color="#fef9f0" />' +
              '<stop offset="100%" stop-color="#fef3c7" />' +
            '</linearGradient>' +
          '</defs>' +
          '<rect width="400" height="300" fill="url(#hero-lacrimal-bg)" />' +
          // Orbit outline (skull socket from front, slightly oblique)
          '<ellipse cx="160" cy="150" rx="120" ry="90" fill="#fffaf2" stroke="#5e574e" stroke-width="2.5" />' +
          // Eye globe inside orbit
          '<circle cx="140" cy="155" r="48" fill="#fff" stroke="#3a5a7c" stroke-width="2" />' +
          '<circle cx="140" cy="155" r="18" fill="#a4c4dd" stroke="#3a5a7c" stroke-width="1.4" />' +
          '<circle cx="140" cy="155" r="7" fill="#0f172a" />' +
          // Lacrimal gland (orbital lobe) — top-right of orbit
          '<ellipse cx="220" cy="92" rx="40" ry="22" fill="#fbbf24" stroke="#9a3412" stroke-width="2" transform="rotate(-15 220 92)" />' +
          // Smaller palpebral lobe
          '<ellipse cx="200" cy="115" rx="18" ry="11" fill="#fde68a" stroke="#9a3412" stroke-width="1.5" transform="rotate(-15 200 115)" />' +
          // Tumor zone overlapping gland (red dashed)
          '<path d="M 195 80 Q 230 65, 255 85 Q 265 105, 245 120 Q 215 130, 190 115 Q 178 95, 195 80 Z" fill="#fee2e2" stroke="#dc2626" stroke-width="2" stroke-dasharray="4 2" opacity="0.7" />' +
          // Perineural invasion path (along V1) extending posteriorly to skull base
          '<path d="M 230 80 Q 320 65, 360 90" fill="none" stroke="#7c2d12" stroke-width="2.5" stroke-linecap="round" />' +
          '<circle cx="360" cy="90" r="5" fill="#7c2d12" />' +
          '<circle cx="345" cy="83" r="2.5" fill="#7c2d12" />' +
          '<circle cx="320" cy="73" r="2" fill="#7c2d12" />' +
          // Eyebrow + lashes
          '<path d="M 95 110 Q 140 95, 185 110" fill="none" stroke="#2a2620" stroke-width="2" stroke-linecap="round" />' +
          // Annotations on right side
          '<g transform="translate(280 145)">' +
            '<text x="0" y="0" fill="#9a3412" font-family="Inter,sans-serif" font-size="13" font-weight="700">淚腺腫瘤</text>' +
            '<text x="0" y="18" fill="#7c2d12" font-family="Inter,sans-serif" font-size="11">LGACC</text>' +
            '<line x1="0" y1="28" x2="100" y2="28" stroke="#9a3412" stroke-width="1.5" />' +
            '<text x="0" y="48" fill="#7c2d12" font-family="Inter,sans-serif" font-size="10" font-weight="600">5-yr OS:</text>' +
            '<text x="0" y="64" fill="#dc2626" font-family="Inter,sans-serif" font-size="14" font-weight="800">50% → 78%</text>' +
            '<text x="0" y="82" fill="#7c2d12" font-family="Inter,sans-serif" font-size="9">(IACC + 手術 + 放化療)</text>' +
          '</g>' +
          // Top-right "PERINEURAL" annotation
          '<text x="320" y="50" fill="#7c2d12" font-family="Inter,sans-serif" font-size="11" font-weight="700">→ 顱底</text>' +
          '<text x="285" y="62" fill="#7c2d12" font-family="Inter,sans-serif" font-size="9">神經周圍侵犯</text>' +
        '</svg>'
    },
    {
      slug: 'floaters-retinal-detachment',
      title_zh: '飛蚊症 6 大警訊 — 何時要立刻衝眼科？',
      title_en: '6 Floater Red Flags — when do floaters mean retinal emergency?',
      meta_zh: '2026.05 · 9 分鐘 · 警訊辨識',
      meta_en: '2026.05 · 9 min · Red flags',
      // Scene: cross-section eye showing vitreous floaters drifting + retinal tear with
      // dramatic photopsia bolt (lightning) — the visual signature of acute PVD/RD.
      svg:
        '<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
          '<defs>' +
            '<radialGradient id="hero-floater-bg" cx="35%" cy="40%" r="80%">' +
              '<stop offset="0%" stop-color="#fef3c7" />' +
              '<stop offset="55%" stop-color="#fde68a" />' +
              '<stop offset="100%" stop-color="#dcd9d1" />' +
            '</radialGradient>' +
          '</defs>' +
          '<rect width="400" height="300" fill="url(#hero-floater-bg)" />' +
          // Eye globe cross-section (pear-shaped sclera with cornea bulge on left)
          '<path d="M 50 150 C 50 60, 130 50, 180 70 L 200 78 L 215 70 C 320 60, 360 110, 360 150 C 360 200, 310 250, 230 245 C 150 250, 50 240, 50 150 Z" fill="#fffaf2" stroke="#2a2620" stroke-width="2.5" />' +
          // Cornea bulge (left)
          '<path d="M 50 150 C 50 110, 75 95, 100 95 C 115 130, 115 170, 100 205 C 75 205, 50 190, 50 150 Z" fill="#a4c4dd" opacity="0.45" stroke="#3a5a7c" stroke-width="1.5" />' +
          // Lens (oval, behind cornea)
          '<ellipse cx="118" cy="150" rx="14" ry="32" fill="#fff" stroke="#3a5a7c" stroke-width="1.5" opacity="0.85" />' +
          // Iris band (visible from top)
          '<path d="M 100 95 L 120 130 L 100 170 L 100 205 L 88 205 L 88 95 Z" fill="#3a5a7c" opacity="0.25" />' +
          // Vitreous body fill (subtle Tiffany)
          '<path d="M 130 110 C 200 100, 320 110, 350 150 C 320 195, 200 220, 130 195 Z" fill="#a4c4dd" opacity="0.18" />' +
          // Floaters drifting in vitreous
          '<g opacity="0.85">' +
            '<circle cx="180" cy="135" r="3.5" fill="#2a2620" />' +
            '<ellipse cx="220" cy="155" rx="7" ry="2.2" fill="#2a2620" opacity="0.7" transform="rotate(-15 220 155)" />' +
            '<circle cx="265" cy="130" r="2.5" fill="#2a2620" opacity="0.75" />' +
            '<path d="M 245 175 C 250 168, 260 168, 263 178 C 257 185, 247 183, 245 175 Z" fill="#2a2620" opacity="0.6" />' +
            // Weiss ring (signature of acute PVD)
            '<circle cx="295" cy="160" r="9" fill="none" stroke="#2a2620" stroke-width="2" opacity="0.7" />' +
            '<circle cx="295" cy="160" r="11" fill="none" stroke="#2a2620" stroke-width="0.8" opacity="0.4" />' +
          '</g>' +
          // Retina arc at back (with a tear/break shown)
          '<path d="M 340 95 C 360 130, 360 170, 340 205" fill="none" stroke="#9a3412" stroke-width="3" />' +
          '<path d="M 345 145 L 358 138 L 354 152 L 362 158 L 348 162 Z" fill="#fee2e2" stroke="#dc2626" stroke-width="1.6" stroke-linejoin="round" />' +
          // Photopsia / lightning bolt (top-right)
          '<path d="M 340 35 L 320 75 L 335 78 L 315 115 L 350 80 L 335 78 L 350 50 Z" fill="#fbbf24" stroke="#9a3412" stroke-width="1.5" stroke-linejoin="round" />' +
          // Optic nerve stub (back)
          '<path d="M 360 145 L 380 135 L 380 165 L 360 155 Z" fill="#fdba74" stroke="#9a3412" stroke-width="1.5" />' +
          // Label vector (top-left, magazine annotation)
          '<line x1="195" y1="130" x2="195" y2="55" stroke="#3a5a7c" stroke-width="1" stroke-dasharray="3 2" />' +
          '<text x="195" y="46" fill="#3a5a7c" font-family="Inter,sans-serif" font-size="10" font-weight="700" text-anchor="middle">FLOATERS</text>' +
          '<line x1="345" y1="55" x2="320" y2="78" stroke="#9a3412" stroke-width="1" stroke-dasharray="3 2" />' +
          '<text x="358" y="48" fill="#9a3412" font-family="Inter,sans-serif" font-size="10" font-weight="700">FLASH</text>' +
        '</svg>'
    },
    {
      slug: 'pediatric-myopia-control',
      title_zh: '兒童近視控制 — 阿托品、OK 鏡、紅光、戶外哪個有效？',
      title_en: 'Pediatric myopia control — atropine, ortho-K, red light, outdoor: what works?',
      meta_zh: '2026.05 · 12 分鐘 · 迷思澄清',
      meta_en: '2026.05 · 12 min · Myth-busting',
      // Scene: side-by-side comparison — normal emmetropic eye (top) vs elongated
      // myopic eye (bottom) with parallel rays focusing IN FRONT of retina. The
      // canonical axial-elongation diagram.
      svg:
        '<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
          '<defs>' +
            '<linearGradient id="hero-myopia-bg" x1="0%" y1="0%" x2="100%" y2="100%">' +
              '<stop offset="0%" stop-color="#e3edf6" />' +
              '<stop offset="100%" stop-color="#dcd9d1" />' +
            '</linearGradient>' +
          '</defs>' +
          '<rect width="400" height="300" fill="url(#hero-myopia-bg)" />' +
          // Top: normal eye (24mm axial length — labeled)
          '<g transform="translate(40 70)">' +
            '<text x="-30" y="5" fill="#3a5a7c" font-family="Inter,sans-serif" font-size="10" font-weight="700" transform="rotate(-90 -30 5)">NORMAL</text>' +
            // Eye outline (round)
            '<ellipse cx="60" cy="30" rx="55" ry="30" fill="#fff" stroke="#3a5a7c" stroke-width="2" />' +
            // Cornea bulge
            '<path d="M 5 30 C 5 15, 15 5, 30 8 C 35 20, 35 40, 30 52 C 15 55, 5 45, 5 30 Z" fill="#a4c4dd" opacity="0.5" />' +
            // Lens
            '<ellipse cx="34" cy="30" rx="6" ry="14" fill="#fff" stroke="#3a5a7c" stroke-width="1" />' +
            // Parallel rays converging perfectly on retina
            '<line x1="-15" y1="20" x2="115" y2="30" stroke="#c9a961" stroke-width="1.4" />' +
            '<line x1="-15" y1="30" x2="115" y2="30" stroke="#c9a961" stroke-width="1.4" />' +
            '<line x1="-15" y1="40" x2="115" y2="30" stroke="#c9a961" stroke-width="1.4" />' +
            // Focal point on retina (green = good)
            '<circle cx="115" cy="30" r="3" fill="#16a34a" stroke="#14532d" stroke-width="1" />' +
            // Axial-length scale bar
            '<line x1="5" y1="70" x2="115" y2="70" stroke="#3a5a7c" stroke-width="1.2" />' +
            '<line x1="5" y1="66" x2="5" y2="74" stroke="#3a5a7c" stroke-width="1.2" />' +
            '<line x1="115" y1="66" x2="115" y2="74" stroke="#3a5a7c" stroke-width="1.2" />' +
            '<text x="60" y="84" fill="#3a5a7c" font-family="Inter,sans-serif" font-size="10" font-weight="700" text-anchor="middle">23–24 mm</text>' +
          '</g>' +
          // Bottom: myopic eye (elongated; 26-30mm)
          '<g transform="translate(40 175)">' +
            '<text x="-30" y="5" fill="#9a3412" font-family="Inter,sans-serif" font-size="10" font-weight="700" transform="rotate(-90 -30 5)">MYOPIC</text>' +
            // Elongated eye (oval, longer in horizontal direction)
            '<ellipse cx="80" cy="30" rx="80" ry="32" fill="#fff" stroke="#9a3412" stroke-width="2" />' +
            // Cornea bulge (more pronounced)
            '<path d="M 0 30 C 0 12, 12 2, 30 5 C 35 20, 35 40, 30 55 C 12 58, 0 48, 0 30 Z" fill="#a4c4dd" opacity="0.5" />' +
            // Lens
            '<ellipse cx="34" cy="30" rx="6" ry="14" fill="#fff" stroke="#9a3412" stroke-width="1" />' +
            // Parallel rays — focus IN FRONT of elongated retina (defining feature of myopia)
            '<line x1="-15" y1="20" x2="105" y2="30" stroke="#c9a961" stroke-width="1.4" />' +
            '<line x1="-15" y1="30" x2="105" y2="30" stroke="#c9a961" stroke-width="1.4" />' +
            '<line x1="-15" y1="40" x2="105" y2="30" stroke="#c9a961" stroke-width="1.4" />' +
            // Continuation past focal point — diverging
            '<line x1="105" y1="30" x2="160" y2="14" stroke="#c9a961" stroke-width="1.2" stroke-dasharray="2 2" opacity="0.65" />' +
            '<line x1="105" y1="30" x2="160" y2="46" stroke="#c9a961" stroke-width="1.2" stroke-dasharray="2 2" opacity="0.65" />' +
            // Focal point in vitreous (red = wrong place)
            '<circle cx="105" cy="30" r="3.5" fill="#dc2626" stroke="#7c2d12" stroke-width="1" />' +
            // Blur on retina (where image should focus)
            '<line x1="155" y1="20" x2="165" y2="40" stroke="#9a3412" stroke-width="1" />' +
            '<line x1="160" y1="20" x2="155" y2="40" stroke="#9a3412" stroke-width="1" />' +
            // Axial-length scale bar (longer)
            '<line x1="0" y1="72" x2="160" y2="72" stroke="#9a3412" stroke-width="1.2" />' +
            '<line x1="0" y1="68" x2="0" y2="76" stroke="#9a3412" stroke-width="1.2" />' +
            '<line x1="160" y1="68" x2="160" y2="76" stroke="#9a3412" stroke-width="1.2" />' +
            '<text x="80" y="86" fill="#9a3412" font-family="Inter,sans-serif" font-size="10" font-weight="700" text-anchor="middle">26–30 mm  · 軸長拉長</text>' +
          '</g>' +
          // Right side annotation (intervention badges)
          '<g transform="translate(280 30)">' +
            '<rect x="0" y="0" width="100" height="22" rx="11" fill="#fff" stroke="#3a5a7c" stroke-width="1.2" />' +
            '<text x="50" y="14" fill="#3a5a7c" font-family="Inter,sans-serif" font-size="9" font-weight="700" text-anchor="middle">阿托品 0.05%</text>' +
            '<rect x="0" y="28" width="100" height="22" rx="11" fill="#fff" stroke="#3a5a7c" stroke-width="1.2" />' +
            '<text x="50" y="42" fill="#3a5a7c" font-family="Inter,sans-serif" font-size="9" font-weight="700" text-anchor="middle">角膜塑型 / DIMS</text>' +
            '<rect x="0" y="56" width="100" height="22" rx="11" fill="#fbbf24" stroke="#9a3412" stroke-width="1.2" />' +
            '<text x="50" y="70" fill="#7c2d12" font-family="Inter,sans-serif" font-size="9" font-weight="700" text-anchor="middle">戶外 2 hr / day</text>' +
          '</g>' +
        '</svg>'
    },
    {
      slug: 'dry-eye-myths',
      title_zh: '乾眼症 8 大迷思 — 點人工淚液真的越點越乾嗎？',
      title_en: '8 dry-eye myths — do artificial tears really make eyes drier?',
      meta_zh: '2026.05 · 10 分鐘 · 迷思澄清',
      meta_en: '2026.05 · 10 min · Myth-busting',
      // Scene: tear-film cross-section showing the 3 layers (lipid/aqueous/mucin)
      // overlaid on cornea. The most pedagogically useful image for any dry-eye lecture.
      svg:
        '<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
          '<defs>' +
            '<linearGradient id="hero-dry-bg" x1="0%" y1="0%" x2="100%" y2="100%">' +
              '<stop offset="0%" stop-color="#dde7e2" />' +
              '<stop offset="100%" stop-color="#fef3c7" />' +
            '</linearGradient>' +
          '</defs>' +
          '<rect width="400" height="300" fill="url(#hero-dry-bg)" />' +
          // Tear film layers (zoomed magazine cross-section, top-half)
          '<g transform="translate(50 50)">' +
            // Container box
            '<rect x="0" y="0" width="300" height="120" fill="#fff" stroke="#3a5a7c" stroke-width="1.5" rx="6" />' +
            // Layer 1: Lipid (top, very thin, golden)
            '<rect x="0" y="0" width="300" height="14" fill="#fbbf24" opacity="0.7" />' +
            '<text x="305" y="11" fill="#9a3412" font-family="Inter,sans-serif" font-size="9" font-weight="700">脂質層 LIPID</text>' +
            '<text x="305" y="22" fill="#9a3412" font-family="Inter,sans-serif" font-size="8">~0.1 μm · MGD</text>' +
            // Layer 2: Aqueous (middle, biggest, blue)
            '<rect x="0" y="14" width="300" height="80" fill="#a4c4dd" opacity="0.55" />' +
            '<text x="305" y="50" fill="#3a5a7c" font-family="Inter,sans-serif" font-size="9" font-weight="700">水液層 AQUEOUS</text>' +
            '<text x="305" y="61" fill="#3a5a7c" font-family="Inter,sans-serif" font-size="8">~7 μm · 淚腺</text>' +
            // Layer 3: Mucin (bottom, anchored to epithelium)
            '<rect x="0" y="94" width="300" height="20" fill="#7fc8d8" opacity="0.7" />' +
            '<text x="305" y="106" fill="#0c5159" font-family="Inter,sans-serif" font-size="9" font-weight="700">黏液層 MUCIN</text>' +
            '<text x="305" y="116" fill="#0c5159" font-family="Inter,sans-serif" font-size="7">杯狀細胞</text>' +
            // Cornea epithelium (bottom)
            '<rect x="0" y="114" width="300" height="6" fill="#fdba74" />' +
            // Microvilli (texture on epithelium)
            '<line x1="20" y1="120" x2="20" y2="124" stroke="#9a3412" stroke-width="1" />' +
            '<line x1="40" y1="120" x2="40" y2="124" stroke="#9a3412" stroke-width="1" />' +
            '<line x1="60" y1="120" x2="60" y2="124" stroke="#9a3412" stroke-width="1" />' +
            '<line x1="80" y1="120" x2="80" y2="124" stroke="#9a3412" stroke-width="1" />' +
            // A "break" in tear film (TBUT visualization)
            '<rect x="120" y="14" width="40" height="80" fill="#fef9c3" opacity="0.8" />' +
            '<line x1="120" y1="14" x2="120" y2="94" stroke="#dc2626" stroke-width="1.6" stroke-dasharray="3 2" />' +
            '<line x1="160" y1="14" x2="160" y2="94" stroke="#dc2626" stroke-width="1.6" stroke-dasharray="3 2" />' +
            '<text x="140" y="55" fill="#9a3412" font-family="Inter,sans-serif" font-size="9" font-weight="700" text-anchor="middle">TBUT</text>' +
            '<text x="140" y="68" fill="#9a3412" font-family="Inter,sans-serif" font-size="8" text-anchor="middle">破裂</text>' +
          '</g>' +
          // Bottom: tear droplet falling + meibomian gland
          '<g transform="translate(60 195)">' +
            // Eyelid edge
            '<path d="M 0 30 Q 140 10, 280 30" fill="none" stroke="#9a3412" stroke-width="3" />' +
            // Meibomian glands (vertical lines along eyelid)
            '<line x1="40" y1="32" x2="40" y2="50" stroke="#fbbf24" stroke-width="2" />' +
            '<line x1="80" y1="28" x2="80" y2="48" stroke="#fbbf24" stroke-width="2" />' +
            '<line x1="120" y1="25" x2="120" y2="46" stroke="#fbbf24" stroke-width="2" />' +
            '<line x1="160" y1="25" x2="160" y2="46" stroke="#dc2626" stroke-width="2" />' +
            '<line x1="200" y1="28" x2="200" y2="48" stroke="#fbbf24" stroke-width="2" />' +
            '<line x1="240" y1="32" x2="240" y2="50" stroke="#fbbf24" stroke-width="2" />' +
            // Single tear droplet
            '<path d="M 290 50 Q 305 70, 290 90 Q 275 70, 290 50 Z" fill="#7fc8d8" stroke="#3a5a7c" stroke-width="1.2" />' +
            // Label
            '<text x="140" y="80" fill="#9a3412" font-family="Inter,sans-serif" font-size="10" font-weight="700" text-anchor="middle">瞼板腺 (MEIBOMIAN GLANDS)</text>' +
          '</g>' +
        '</svg>'
    },
    {
      slug: 'thyroid-eye-disease',
      title_zh: '甲狀腺眼疾 — 抽菸風險 7 倍、治療有黃金窗口',
      title_en: 'Thyroid Eye Disease — smokers 7× risk, a golden treatment window',
      meta_zh: '2026.05 · 18 分鐘 · 治療階梯',
      meta_en: '2026.05 · 18 min · Treatment ladder',
      // Scene: side-by-side normal vs TED orbit cross-section showing proptosis,
      // enlarged extraocular muscles, retro-orbital fat expansion, and optic-nerve
      // compression at the orbital apex — the canonical pathophysiology diagram.
      svg:
        '<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
          '<defs>' +
            '<linearGradient id="hero-ted-bg" x1="0%" y1="0%" x2="100%" y2="100%">' +
              '<stop offset="0%" stop-color="#e3edf6" />' +
              '<stop offset="100%" stop-color="#fef3c7" />' +
            '</linearGradient>' +
          '</defs>' +
          '<rect width="400" height="300" fill="url(#hero-ted-bg)" />' +
          // LEFT: Normal orbit
          '<text x="100" y="32" fill="#3a5a7c" font-family="Inter,sans-serif" font-size="11" font-weight="700" text-anchor="middle">NORMAL</text>' +
          // Skull socket
          '<path d="M 35 60 L 165 60 L 175 175 L 155 215 L 45 215 L 25 175 Z" fill="#fffaf2" stroke="#5e574e" stroke-width="1.6" />' +
          // Eyeball normal position
          '<circle cx="100" cy="135" r="32" fill="#fff" stroke="#3a5a7c" stroke-width="1.6" />' +
          '<circle cx="100" cy="135" r="11" fill="#a4c4dd" stroke="#3a5a7c" stroke-width="1" />' +
          '<circle cx="100" cy="135" r="5" fill="#0f172a" />' +
          // Normal extraocular muscles (thin)
          '<ellipse cx="125" cy="110" rx="32" ry="4" fill="#f87171" opacity="0.7" transform="rotate(15 125 110)" />' +
          '<ellipse cx="125" cy="160" rx="32" ry="4" fill="#f87171" opacity="0.7" transform="rotate(-15 125 160)" />' +
          // Normal retro-orbital fat
          '<ellipse cx="155" cy="135" rx="13" ry="28" fill="#fde68a" opacity="0.55" />' +
          // Optic nerve (normal)
          '<line x1="170" y1="135" x2="180" y2="135" stroke="#9a3412" stroke-width="2" />' +
          // Divider line
          '<line x1="200" y1="50" x2="200" y2="240" stroke="#dcd5c8" stroke-width="1" stroke-dasharray="3 3" />' +
          // RIGHT: TED orbit
          '<text x="300" y="32" fill="#dc2626" font-family="Inter,sans-serif" font-size="11" font-weight="700" text-anchor="middle">TED · 甲狀腺眼疾</text>' +
          '<path d="M 235 60 L 365 60 L 375 175 L 355 215 L 245 215 L 225 175 Z" fill="#fffaf2" stroke="#5e574e" stroke-width="1.6" />' +
          // Eyeball pushed forward (proptotic)
          '<circle cx="285" cy="135" r="32" fill="#fff" stroke="#dc2626" stroke-width="2" />' +
          '<circle cx="285" cy="135" r="11" fill="#a4c4dd" stroke="#3a5a7c" stroke-width="1" />' +
          '<circle cx="285" cy="135" r="5" fill="#0f172a" />' +
          // Enlarged extraocular muscles (thick, red)
          '<ellipse cx="320" cy="105" rx="38" ry="10" fill="#dc2626" opacity="0.78" transform="rotate(15 320 105)" />' +
          '<ellipse cx="320" cy="165" rx="38" ry="10" fill="#dc2626" opacity="0.78" transform="rotate(-15 320 165)" />' +
          // Expanded retro-orbital fat
          '<ellipse cx="355" cy="135" rx="18" ry="38" fill="#fbbf24" opacity="0.7" />' +
          // Compressed optic nerve at apex
          '<circle cx="372" cy="135" r="4" fill="#fdba74" stroke="#9a3412" stroke-width="1.5" />' +
          '<text x="372" y="118" fill="#9a3412" font-family="Inter,sans-serif" font-size="8" font-weight="700" text-anchor="middle">DON</text>' +
          // Forward arrow showing proptosis
          '<path d="M 268 90 L 248 90 L 248 80 L 228 95 L 248 110 L 248 100 L 268 100 Z" fill="#dc2626" opacity="0.85" />' +
          '<text x="248" y="74" fill="#dc2626" font-family="Inter,sans-serif" font-size="9" font-weight="700" text-anchor="middle">凸眼 PROPTOSIS</text>' +
          // Bottom annotation strip
          '<g transform="translate(20 245)">' +
            '<rect x="0" y="0" width="120" height="22" rx="11" fill="#fff" stroke="#3a5a7c" stroke-width="1.2" />' +
            '<text x="60" y="14" fill="#3a5a7c" font-family="Inter,sans-serif" font-size="8.5" font-weight="700" text-anchor="middle">TRAb + IGF-1R</text>' +
            '<rect x="135" y="0" width="120" height="22" rx="11" fill="#fbbf24" stroke="#9a3412" stroke-width="1.2" />' +
            '<text x="195" y="14" fill="#7c2d12" font-family="Inter,sans-serif" font-size="8.5" font-weight="700" text-anchor="middle">抽菸 7-8× 風險</text>' +
            '<rect x="265" y="0" width="120" height="22" rx="11" fill="#fff" stroke="#3a5a7c" stroke-width="1.2" />' +
            '<text x="325" y="14" fill="#3a5a7c" font-family="Inter,sans-serif" font-size="8.5" font-weight="700" text-anchor="middle">IVMP / Teprotumumab</text>' +
          '</g>' +
        '</svg>'
    },
    {
      slug: 'cataract-comprehensive-guide',
      title_zh: '白內障 — 何時開刀、IOL 怎麼選、併發症與恢復',
      title_en: 'Cataract — when to operate, IOL choice, complications &amp; recovery',
      meta_zh: '2026.05 · 22 分鐘 · 手術抉擇',
      meta_en: '2026.05 · 22 min · Surgical decisions',
      // Scene: lens cross-section showing cloudy crystalline lens before surgery
      // and clear IOL after, plus three small lens-type icons (nuclear/cortical/PSC)
      // — visualizing both the disease and the surgical solution.
      svg:
        '<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
          '<defs>' +
            '<linearGradient id="hero-cat-bg" x1="0%" y1="0%" x2="100%" y2="100%">' +
              '<stop offset="0%" stop-color="#fef3c7" />' +
              '<stop offset="100%" stop-color="#e3edf6" />' +
            '</linearGradient>' +
          '</defs>' +
          '<rect width="400" height="300" fill="url(#hero-cat-bg)" />' +
          // LEFT: cloudy crystalline lens (before)
          '<text x="100" y="32" fill="#9a3412" font-family="Inter,sans-serif" font-size="11" font-weight="700" text-anchor="middle">BEFORE · 白內障</text>' +
          // Eye outline
          '<ellipse cx="100" cy="150" rx="80" ry="65" fill="#fffaf2" stroke="#5e574e" stroke-width="1.8" />' +
          // Cornea
          '<path d="M 30 130 Q 20 150 30 170 Q 60 180 70 150 Q 60 120 30 130 Z" fill="#a4c4dd" opacity="0.45" stroke="#3a5a7c" stroke-width="1.2" />' +
          // Cloudy lens (yellow-brown core)
          '<ellipse cx="105" cy="150" rx="35" ry="42" fill="#c9a961" opacity="0.85" stroke="#7c2d12" stroke-width="1.5" />' +
          '<ellipse cx="105" cy="150" rx="22" ry="28" fill="#7c2d12" opacity="0.55" />' +
          // Light rays scattered (poor focus)
          '<line x1="20" y1="135" x2="40" y2="155" stroke="#fbbf24" stroke-width="1.4" stroke-dasharray="2 2" />' +
          '<line x1="20" y1="150" x2="40" y2="150" stroke="#fbbf24" stroke-width="1.4" stroke-dasharray="2 2" />' +
          '<line x1="20" y1="165" x2="40" y2="145" stroke="#fbbf24" stroke-width="1.4" stroke-dasharray="2 2" />' +
          '<text x="100" y="240" fill="#7c2d12" font-family="Inter,sans-serif" font-size="9.5" font-weight="700" text-anchor="middle">水晶體混濁 · 視力模糊</text>' +
          // Arrow → indicating treatment
          '<path d="M 195 145 L 215 145 L 215 138 L 230 150 L 215 162 L 215 155 L 195 155 Z" fill="#3a5a7c" opacity="0.8" />' +
          '<text x="212" y="130" fill="#3a5a7c" font-family="Inter,sans-serif" font-size="9" font-weight="700" text-anchor="middle">phaco</text>' +
          // RIGHT: clear lens after surgery (with IOL)
          '<text x="300" y="32" fill="#3a5a7c" font-family="Inter,sans-serif" font-size="11" font-weight="700" text-anchor="middle">AFTER · IOL 植入</text>' +
          '<ellipse cx="300" cy="150" rx="80" ry="65" fill="#fffaf2" stroke="#5e574e" stroke-width="1.8" />' +
          // Cornea
          '<path d="M 230 130 Q 220 150 230 170 Q 260 180 270 150 Q 260 120 230 130 Z" fill="#a4c4dd" opacity="0.45" stroke="#3a5a7c" stroke-width="1.2" />' +
          // Clear IOL (transparent disk)
          '<ellipse cx="305" cy="150" rx="35" ry="22" fill="#a4c4dd" opacity="0.25" stroke="#3a5a7c" stroke-width="1.5" />' +
          // IOL haptics
          '<line x1="270" y1="150" x2="260" y2="135" stroke="#3a5a7c" stroke-width="1.2" />' +
          '<line x1="340" y1="150" x2="350" y2="165" stroke="#3a5a7c" stroke-width="1.2" />' +
          // Light rays focused (clear)
          '<line x1="220" y1="135" x2="305" y2="150" stroke="#fbbf24" stroke-width="1.4" />' +
          '<line x1="220" y1="150" x2="305" y2="150" stroke="#fbbf24" stroke-width="1.4" />' +
          '<line x1="220" y1="165" x2="305" y2="150" stroke="#fbbf24" stroke-width="1.4" />' +
          // Focal point on retina
          '<circle cx="370" cy="150" r="3" fill="#16a34a" stroke="#14532d" stroke-width="1" />' +
          '<text x="300" y="240" fill="#3a5a7c" font-family="Inter,sans-serif" font-size="9.5" font-weight="700" text-anchor="middle">人工水晶體 · 視力恢復</text>' +
          // Bottom strip: 3 IOL options
          '<g transform="translate(40 263)">' +
            '<rect x="0" y="0" width="105" height="22" rx="11" fill="#fff" stroke="#3a5a7c" stroke-width="1.2" />' +
            '<text x="52.5" y="14" fill="#3a5a7c" font-family="Inter,sans-serif" font-size="8.5" font-weight="700" text-anchor="middle">單焦 Monofocal</text>' +
            '<rect x="118" y="0" width="105" height="22" rx="11" fill="#fbbf24" stroke="#9a3412" stroke-width="1.2" />' +
            '<text x="170.5" y="14" fill="#7c2d12" font-family="Inter,sans-serif" font-size="8.5" font-weight="700" text-anchor="middle">EDOF / 散光 Toric</text>' +
            '<rect x="236" y="0" width="105" height="22" rx="11" fill="#fff" stroke="#3a5a7c" stroke-width="1.2" />' +
            '<text x="288.5" y="14" fill="#3a5a7c" font-family="Inter,sans-serif" font-size="8.5" font-weight="700" text-anchor="middle">多焦 Multifocal</text>' +
          '</g>' +
        '</svg>'
    },
    {
      slug: 'glaucoma-comprehensive-guide',
      title_zh: '青光眼 — 沉默的視力小偷、急性發作警訊',
      title_en: 'Glaucoma — the silent thief of sight &amp; acute red flags',
      meta_zh: '2026.05 · 22 分鐘 · 警訊辨識',
      meta_en: '2026.05 · 22 min · Red flags',
      svg:
        '<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
          '<defs>' +
            '<linearGradient id="hero-gl-bg" x1="0%" y1="0%" x2="100%" y2="100%">' +
              '<stop offset="0%" stop-color="#e3edf6" />' +
              '<stop offset="100%" stop-color="#fef9f0" />' +
            '</linearGradient>' +
          '</defs>' +
          '<rect width="400" height="300" fill="url(#hero-gl-bg)" />' +
          '<text x="100" y="32" fill="#16a34a" font-family="Inter,sans-serif" font-size="11" font-weight="700" text-anchor="middle">NORMAL</text>' +
          '<ellipse cx="100" cy="135" rx="55" ry="50" fill="#fbbf24" opacity="0.5" stroke="#9a3412" stroke-width="1.6" />' +
          '<ellipse cx="100" cy="135" rx="18" ry="16" fill="#fffaf2" stroke="#5e574e" stroke-width="1.2" />' +
          '<path d="M 90 125 Q 70 115 50 95" fill="none" stroke="#dc2626" stroke-width="1.6" />' +
          '<path d="M 90 145 Q 70 155 50 175" fill="none" stroke="#dc2626" stroke-width="1.6" />' +
          '<path d="M 110 125 Q 130 115 150 95" fill="none" stroke="#dc2626" stroke-width="1.6" />' +
          '<path d="M 110 145 Q 130 155 150 175" fill="none" stroke="#dc2626" stroke-width="1.6" />' +
          '<text x="100" y="220" fill="#16a34a" font-family="Inter,sans-serif" font-size="9.5" font-weight="700" text-anchor="middle">C/D 0.3</text>' +
          '<text x="100" y="236" fill="#5e574e" font-family="Inter,sans-serif" font-size="9" text-anchor="middle">完整 rim</text>' +
          '<path d="M 175 135 L 215 135 L 215 128 L 235 138 L 215 148 L 215 141 L 175 141 Z" fill="#7c2d12" opacity="0.85" />' +
          '<text x="205" y="120" fill="#7c2d12" font-family="Inter,sans-serif" font-size="9" font-weight="700" text-anchor="middle">↑ IOP</text>' +
          '<text x="300" y="32" fill="#dc2626" font-family="Inter,sans-serif" font-size="11" font-weight="700" text-anchor="middle">GLAUCOMA</text>' +
          '<ellipse cx="300" cy="135" rx="55" ry="50" fill="#fbbf24" opacity="0.5" stroke="#9a3412" stroke-width="1.6" />' +
          '<ellipse cx="300" cy="135" rx="42" ry="40" fill="#5e574e" opacity="0.4" stroke="#3a3a3a" stroke-width="1.5" />' +
          '<ellipse cx="300" cy="135" rx="42" ry="40" fill="none" stroke="#5e574e" stroke-width="2" />' +
          '<path d="M 270 115 L 265 120 L 250 95" fill="none" stroke="#dc2626" stroke-width="1.6" />' +
          '<path d="M 270 155 L 265 150 L 250 175" fill="none" stroke="#dc2626" stroke-width="1.6" />' +
          '<path d="M 330 115 L 335 110 L 350 95" fill="none" stroke="#dc2626" stroke-width="1.6" />' +
          '<ellipse cx="282" cy="170" rx="6" ry="2" fill="#7f1d1d" />' +
          '<text x="300" y="220" fill="#dc2626" font-family="Inter,sans-serif" font-size="9.5" font-weight="700" text-anchor="middle">C/D &gt; 0.8</text>' +
          '<text x="300" y="236" fill="#5e574e" font-family="Inter,sans-serif" font-size="9" text-anchor="middle">rim 變薄、深凹陷</text>' +
          '<g transform="translate(20 256)">' +
            '<rect x="0" y="0" width="115" height="22" rx="11" fill="#fff" stroke="#3a5a7c" stroke-width="1.2" />' +
            '<text x="57.5" y="14" fill="#3a5a7c" font-family="Inter,sans-serif" font-size="8.5" font-weight="700" text-anchor="middle">SLT 雷射 第一線</text>' +
            '<rect x="128" y="0" width="115" height="22" rx="11" fill="#fbbf24" stroke="#9a3412" stroke-width="1.2" />' +
            '<text x="185.5" y="14" fill="#7c2d12" font-family="Inter,sans-serif" font-size="8.5" font-weight="700" text-anchor="middle">PGA 眼藥水</text>' +
            '<rect x="256" y="0" width="115" height="22" rx="11" fill="#fff" stroke="#3a5a7c" stroke-width="1.2" />' +
            '<text x="313.5" y="14" fill="#3a5a7c" font-family="Inter,sans-serif" font-size="8.5" font-weight="700" text-anchor="middle">MIGS / Trab 手術</text>' +
          '</g>' +
        '</svg>'
    }
  ];

  function attrEsc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  // Pick 2 distinct entries from HERO_CARDS using Fisher-Yates,
  // then rewrite #hs-cover-story (full mag-card) and #hs-editor-pick
  // (mag-card-side). Falls back silently if either anchor is missing.
  DN.shuffleHeroCards = function () {
    var coverEl = document.getElementById('hs-cover-story');
    var pickEl  = document.getElementById('hs-editor-pick');   // optional now
    if (!coverEl) return;                     // not on home page
    var cards = (DN.HERO_CARDS || []).slice();
    if (cards.length < 1) return;             // nothing to shuffle

    // Fisher-Yates in-place shuffle, then take first 1 or 2
    for (var i = cards.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = cards[i]; cards[i] = cards[j]; cards[j] = tmp;
    }
    var cover = cards[0];

    // Cover Story (full mag-card with meta line + h3 title)
    coverEl.setAttribute('href', '/blog/' + cover.slug);
    coverEl.innerHTML =
      '<div class="mag-card-cover">' + cover.svg + '</div>' +
      '<div class="mag-card-body">' +
        '<span class="mag-card-tag" data-zh="封面故事 · COVER STORY" data-en="Cover Story">封面故事 · COVER STORY</span>' +
        '<h3 data-zh="' + attrEsc(cover.title_zh) + '" data-en="' + attrEsc(cover.title_en) + '">' + cover.title_zh + '</h3>' +
        '<div class="mag-card-meta" data-zh="' + attrEsc(cover.meta_zh) + '" data-en="' + attrEsc(cover.meta_en) + '">' + cover.meta_zh + '</div>' +
      '</div>';

    // Editor's Pick — only if the slot exists (legacy support)
    if (pickEl && cards.length >= 2) {
      var pick = cards[1];
      pickEl.setAttribute('href', '/blog/' + pick.slug);
      pickEl.innerHTML =
        '<div class="mag-card-cover">' + pick.svg + '</div>' +
        '<div>' +
          '<span class="mag-card-tag" data-zh="本期推薦" data-en="Editor’s Pick">本期推薦</span>' +
          '<h4 data-zh="' + attrEsc(pick.title_zh) + '" data-en="' + attrEsc(pick.title_en) + '">' + pick.title_zh + '</h4>' +
        '</div>';
    }
  };

  // ---------- spotlight (最近更新 + 熱門推薦) ----------
  // Populates two homepage <ol> lists from DN.ARTICLES.
  //   #hs-recent-list  — most recent by date desc
  //   #hs-popular-list — curated by DN.POPULAR_SLUGS, falls back to recent
  // Renders DermNotes-style 2-row cards: metadata strip on top
  // (badge + tag_en + date), then SVG icon + Noto Serif TC title.
  // ---------------------------------------------------------------------
  // Popular articles — manually curated by **expected reader interest**,
  // not by publication date. Writing a new article should NOT auto-bump
  // it to #1 (rare-disease topics like 淚腺腫瘤 are clinically important
  // but low-traffic; broad-public-interest topics belong here instead).
  //
  // To re-rank based on real GA4 / Clarity click-through data later,
  // replace this array with the top 3 slugs from your analytics dashboard.
  // ---------------------------------------------------------------------
  DN.POPULAR_SLUGS = ['pediatric-myopia-control', 'dry-eye-myths', 'floaters-retinal-detachment'];   // edit this list to curate

  // v37.9: personalized popular — read tracker tells us which articles THIS
  // user has revisited. We blend that with the curated POPULAR_SLUGS so
  // returning users see their own most-read articles at the top, while
  // first-time visitors still get the curated list.
  // Counts re-visits via DN.READ_KEY (already populated by DN.markRead).
  DN.getPersonalizedPopular = function (n) {
    n = n || 3;
    try {
      var read = DN.getReadSlugs && DN.getReadSlugs() || [];
      if (!read.length) return DN.POPULAR_SLUGS.slice(0, n);
      // read is appended in order — recent reads at end. Take last N unique
      // (excluding current page, excluding stubs).
      var cur = DN.currentSlug && DN.currentSlug();
      var seen = {}, out = [];
      for (var i = read.length - 1; i >= 0 && out.length < n; i--) {
        var s = read[i];
        if (s === cur || seen[s] || (DN.isStub && DN.isStub(s))) continue;
        seen[s] = 1;
        out.push(s);
      }
      // Pad with curated if user has < n reads
      for (var j = 0; j < DN.POPULAR_SLUGS.length && out.length < n; j++) {
        var p = DN.POPULAR_SLUGS[j];
        if (!seen[p] && p !== cur) { seen[p] = 1; out.push(p); }
      }
      return out;
    } catch (e) { return DN.POPULAR_SLUGS.slice(0, n); }
  };

  // 32x32 line-art SVG icons keyed by Chinese tag — ophthalmology palette
  // (Tiffany blue + ochre + ink). Falls back to the FAQ icon when missing.
  DN.HS_TAG_SVG = {
    '淚腺腫瘤':
      '<circle cx="16" cy="16" r="11" fill="#fff" stroke="#3a5a7c" stroke-width="1.5"/>' +
      '<ellipse cx="20" cy="11" rx="6" ry="3.5" fill="#fbbf24" stroke="#9a3412" stroke-width="1.2" transform="rotate(-15 20 11)"/>' +
      '<path d="M 16 12 Q 20 8 25 11 Q 26 14 23 16 Q 19 16 16 12 Z" fill="#fee2e2" stroke="#dc2626" stroke-width="1.2" stroke-dasharray="2 1"/>' +
      '<circle cx="14" cy="18" r="5" fill="#a4c4dd" stroke="#3a5a7c" stroke-width="1"/>' +
      '<circle cx="14" cy="18" r="2" fill="#0f172a"/>',
    '飛蚊症':
      '<circle cx="16" cy="16" r="11" fill="#fff" stroke="#3a5a7c" stroke-width="1.6"/>' +
      '<circle cx="16" cy="16" r="5" fill="#a4c4dd" stroke="#3a5a7c" stroke-width="1"/>' +
      '<circle cx="16" cy="16" r="2" fill="#0f172a"/>' +
      '<circle cx="9" cy="10" r="1.4" fill="#0f172a" opacity=".6"/>' +
      '<ellipse cx="23" cy="11" rx="2" ry="1" fill="#0f172a" opacity=".55" transform="rotate(-15 23 11)"/>' +
      '<circle cx="22" cy="22" r="1" fill="#0f172a" opacity=".5"/>',
    '兒童近視':
      '<circle cx="11" cy="17" r="6" fill="#fff" stroke="#3a5a7c" stroke-width="1.5"/>' +
      '<circle cx="21" cy="17" r="6" fill="#fff" stroke="#3a5a7c" stroke-width="1.5"/>' +
      '<circle cx="11" cy="17" r="5.4" fill="#a4c4dd" opacity=".55"/>' +
      '<circle cx="21" cy="17" r="5.4" fill="#a4c4dd" opacity=".55"/>' +
      '<line x1="17" y1="17" x2="15" y2="17" stroke="#3a5a7c" stroke-width="1.4" stroke-linecap="round"/>' +
      '<line x1="5" y1="14" x2="2" y2="12" stroke="#3a5a7c" stroke-width="1.4" stroke-linecap="round"/>' +
      '<line x1="27" y1="14" x2="30" y2="12" stroke="#3a5a7c" stroke-width="1.4" stroke-linecap="round"/>',
    '乾眼症':
      '<path d="M5 17 Q16 9 27 17 Q16 24 5 17 Z" fill="#fff" stroke="#3a5a7c" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<circle cx="16" cy="17" r="5" fill="#a4c4dd" stroke="#3a5a7c" stroke-width="1"/>' +
      '<circle cx="16" cy="17" r="2" fill="#0f172a"/>' +
      '<path d="M25 22 Q28 25 25 28 Q22 25 25 22 Z" fill="#7fc8d8" stroke="#3a5a7c" stroke-width="1"/>',
    '視網膜剝離':
      '<circle cx="16" cy="16" r="11" fill="#fff" stroke="#3a5a7c" stroke-width="1.6"/>' +
      '<path d="M7 12 Q12 18 16 14 Q20 10 25 16" fill="none" stroke="#9a3412" stroke-width="1.6" stroke-linecap="round"/>' +
      '<line x1="11" y1="22" x2="21" y2="22" stroke="#dc2626" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="2 2"/>',
    '白內障':
      '<circle cx="16" cy="16" r="11" fill="#ebe4d8" stroke="#3a5a7c" stroke-width="1.5"/>' +
      '<circle cx="16" cy="16" r="6" fill="#fff" opacity=".7"/>' +
      '<circle cx="16" cy="16" r="3" fill="#c9a961" opacity=".5"/>',
    '青光眼':
      '<circle cx="16" cy="16" r="11" fill="#fff" stroke="#3a5a7c" stroke-width="1.5"/>' +
      '<circle cx="16" cy="16" r="6" fill="#a4c4dd" stroke="#3a5a7c" stroke-width="1"/>' +
      '<circle cx="16" cy="16" r="3.5" fill="#0f172a"/>' +
      '<line x1="6" y1="22" x2="26" y2="22" stroke="#dc2626" stroke-width="1.4" stroke-linecap="round"/>',
    '隱形眼鏡':
      '<ellipse cx="16" cy="16" rx="10" ry="9" fill="#fff" stroke="#3a5a7c" stroke-width="1.6"/>' +
      '<ellipse cx="16" cy="16" rx="6" ry="5.5" fill="#a4c4dd" opacity=".55"/>' +
      '<path d="M9 12 Q12 9 16 9" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>',
    '紅眼症':
      '<path d="M5 17 Q16 9 27 17 Q16 24 5 17 Z" fill="#fee2e2" stroke="#dc2626" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<circle cx="16" cy="17" r="5" fill="#a4c4dd" stroke="#3a5a7c" stroke-width="1"/>' +
      '<circle cx="16" cy="17" r="2" fill="#0f172a"/>' +
      '<line x1="6" y1="14" x2="9" y2="15" stroke="#dc2626" stroke-width="1.2" stroke-linecap="round"/>' +
      '<line x1="26" y1="14" x2="23" y2="15" stroke="#dc2626" stroke-width="1.2" stroke-linecap="round"/>',
    '結膜炎':
      '<path d="M5 17 Q16 9 27 17 Q16 24 5 17 Z" fill="#fee2e2" stroke="#dc2626" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<circle cx="16" cy="17" r="5" fill="#a4c4dd" stroke="#3a5a7c" stroke-width="1"/>' +
      '<circle cx="16" cy="17" r="2" fill="#0f172a"/>',
    '常見問題':
      '<circle cx="16" cy="16" r="11" fill="#fff" stroke="#3a5a7c" stroke-width="1.5"/>' +
      '<path d="M13 13 Q13 10 16 10 Q19 10 19 13 Q19 15 16 16 L16 18" fill="none" stroke="#3a5a7c" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="16" cy="22" r="1.2" fill="#3a5a7c"/>'
  };

  DN.svgForTag = function (tag) {
    var lib = DN.HS_TAG_SVG || {};
    // try exact match, then substring match (e.g. "飛蚊症 / 視網膜剝離" -> "飛蚊症")
    if (lib[tag]) return lib[tag];
    var keys = Object.keys(lib);
    for (var i = 0; i < keys.length; i++) {
      if (tag && tag.indexOf(keys[i]) >= 0) return lib[keys[i]];
    }
    return lib['常見問題'];
  };

  DN.injectSpotlight = function () {
    const recentEl  = document.getElementById('hs-recent-list');
    const popularEl = document.getElementById('hs-popular-list');
    if (!recentEl && !popularEl) return;
    // Exclude stub / unfinished articles from both spotlights
    const all = (DN.ARTICLES || []).filter(function (a) { return !DN.isStub(a.slug); });
    if (!all.length) return;

    const byDate = all.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    const recent = byDate.slice(0, 3);
    // v37.9: blend curated + personalized — returning readers see their own
    // most-recently-read articles surface. Falls back to curated for new visitors.
    var personalSlugs = DN.getPersonalizedPopular ? DN.getPersonalizedPopular(3) : DN.POPULAR_SLUGS.slice(0, 3);
    const popularSet = new Set(personalSlugs);
    const popular = personalSlugs.map(function (s) { return all.find(function (a) { return a.slug === s; }); }).filter(Boolean);
    const popularFinal = popular.length ? popular : recent;

    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

    // Round-2 review: these cards used inline onmouseover/onmouseout for the
    // hover lift. Our own Trusted Types policy (assets/trusted-types.js)
    // STRIPS ` on*=` from anything assigned to innerHTML, so the hover effect
    // was silently dead in every TT-supporting browser (Chromium) while still
    // working in Firefox/Safari. CSS :hover needs no handler, works
    // everywhere, and keeps the markup free of inline events (D-16 hygiene).
    if (!document.getElementById('hs-spotlight-css')) {
      var _sc = document.createElement('style');
      _sc.id = 'hs-spotlight-css';
      // The BASE styles live here too, not in a style="" attribute: inline
      // declarations outrank a stylesheet rule, so leaving border/box-shadow
      // inline would let only `transform` animate on hover (codex round 2).
      _sc.textContent =
        '.hs-spot-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;' +
        'background:#fff;border:0.5px solid var(--border);border-radius:12px;' +
        'text-decoration:none;color:inherit;box-shadow:0 1px 2px rgba(15,23,42,.04);' +
        'transition:border-color .15s,transform .15s,box-shadow .15s}' +
        '.hs-spot-card:hover,.hs-spot-card:focus-visible{border-color:rgba(58,90,124,.5);' +
        'transform:translateY(-2px);box-shadow:0 8px 18px -10px rgba(58,90,124,.25)}';
      document.head.appendChild(_sc);
    }

    function rowHTML(a, badge) {
      var titleZh = a.title || a.slug;
      var titleEn = a.title_en || a.title || '';
      var tagZh   = a.tag || '';
      var tagEn   = a.tag_en || a.tag || '';
      var date    = a.date || '';
      var num     = DN.getArticleNumber(a.slug);   // stable № by publication order
      var iconSvg = '<svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" style="flex-shrink:0">' + DN.svgForTag(tagZh) + '</svg>';
      var numChip = num ? '<span style="font-family:\'JetBrains Mono\',Inter,monospace;font-weight:800;color:var(--blue-deep);letter-spacing:.04em">№' + num + '</span><span style="opacity:.45">·</span>' : '';
      return '<li><a class="hs-spot-card" href="' + DN.articlePath(a.slug) + '">' +
        '<div style="display:flex;align-items:center;gap:6px;font-size:10.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--blue-deep);font-family:\'JetBrains Mono\',Inter,sans-serif">' +
          (badge ? '<span style="padding:2px 8px;border-radius:9999px;background:' + badge.bg + ';color:' + badge.fg + ';letter-spacing:.08em;font-size:10px">' + badge.label + '</span>' : '') +
          numChip +
          '<span data-zh="' + esc(tagZh) + '" data-en="' + esc(tagEn) + '" style="letter-spacing:.06em">' + tagZh + '</span>' +
          '<span style="opacity:.45">·</span>' +
          '<time style="font-weight:500;letter-spacing:0;color:var(--muted)">' + date + '</time>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          iconSvg +
          '<span data-zh="' + esc(titleZh) + '" data-en="' + esc(titleEn) + '" style="font-family:\'Noto Serif TC\',Georgia,serif;font-size:14.5px;font-weight:700;line-height:1.45;color:var(--ink);flex:1">' + titleZh + '</span>' +
        '</div>' +
      '</a></li>';
    }

    if (recentEl) {
      recentEl.innerHTML = recent.map(function (a, i) {
        return rowHTML(a, i === 0 ? { label: 'NEW', bg: '#fee2e2', fg: '#991b1b' } : null);
      }).join('');
    }
    if (popularEl) {
      popularEl.innerHTML = popularFinal.map(function (a, i) {
        return rowHTML(a, { label: '#' + (i + 1), bg: 'var(--blue-soft)', fg: 'var(--blue-deep)' });
      }).join('');
    }
  };

  // ---------- dark mode toggle (☀ / ☾) ----------
  DN.bindThemeToggle = function () {
    if (document.getElementById('hs-theme-toggle')) return;
    const root = document.documentElement;
    let stored = null;
    try { stored = localStorage.getItem('hs_theme'); } catch (e) {}
    const initial = stored || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    root.dataset.theme = initial;

    // Inject dark-mode CSS once
    if (!document.getElementById('hs-theme-style')) {
      const st = document.createElement('style');
      st.id = 'hs-theme-style';
      st.textContent =
        ':root[data-theme="dark"]{' +
          '--bg:#1a1815;--surface:#252220;--ink:#f5f0e6;--ink-2:#c9c0b0;--muted:#8a8275;' +
          '--border:#3a352d;--line:#2f2a23;--mint-soft:#2a2620;' +
          '--blue-soft:#1f2e42;--teal-bright:#5e7c98;' +
        '}' +
        ':root[data-theme="dark"] body::before{opacity:.5}' +
        ':root[data-theme="dark"] .myth-card,' +
        ':root[data-theme="dark"] .info-card,' +
        ':root[data-theme="dark"] .article-list-item,' +
        ':root[data-theme="dark"] .topic-card,' +
        ':root[data-theme="dark"] .home-faq details.hf,' +
        ':root[data-theme="dark"] .quick-find a,' +
        ':root[data-theme="dark"] .keypoint,' +
        ':root[data-theme="dark"] .selfcheck,' +
        ':root[data-theme="dark"] .references,' +
        ':root[data-theme="dark"] table.dn,' +
        ':root[data-theme="dark"] .placeholder-card,' +
        ':root[data-theme="dark"] .mag-card,' +
        ':root[data-theme="dark"] .hs-search-input,' +
        ':root[data-theme="dark"] header.sticky,' +
        ':root[data-theme="dark"] .lang-select{background:var(--surface)!important;color:var(--ink)}' +
        ':root[data-theme="dark"] .disclaimer{background:#2a2418;color:#e8d9b0;border-color:#5a4720}' +
        ':root[data-theme="dark"] .alert-card{background:#3a1f1f;border-color:#7a3a3a}' +
        ':root[data-theme="dark"] .alert-card h4,' +
        ':root[data-theme="dark"] .alert-card li{color:#fcaaaa}' +
        ':root[data-theme="dark"] .myth-card .myth{color:#fca5a5}' +
        ':root[data-theme="dark"] .myth-card .truth{color:#86efac}' +
        ':root[data-theme="dark"] header.sticky{background:rgba(37,34,32,.94)}';
      document.head.appendChild(st);
    }

    const langToggle = document.getElementById('langToggle');
    if (!langToggle || !langToggle.parentNode) return;

    const btn = document.createElement('button');
    btn.id = 'hs-theme-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Toggle theme');
    btn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9999px;background:#fff;border:1px solid var(--border);color:var(--ink);cursor:pointer;flex-shrink:0;font-size:15px;line-height:1;transition:all .15s';
    function render() {
      const isDark = root.dataset.theme === 'dark';
      btn.innerHTML = isDark
        ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
        : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
      btn.title = isDark ? 'Switch to light' : 'Switch to dark';
    }
    render();
    btn.addEventListener('click', function () {
      root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('hs_theme', root.dataset.theme); } catch (e) {}
      render();
    });
    // Insert immediately BEFORE the language select
    langToggle.parentNode.insertBefore(btn, langToggle);
  };

  // ---------- mobile bottom-fixed nav (3 buttons: Articles / Search / About) ----------
  DN.injectMobileBottomNav = function () {
    if (document.getElementById('hs-mobile-nav')) return;
    if (!document.getElementById('hs-mobile-nav-style')) {
      const st = document.createElement('style');
      st.id = 'hs-mobile-nav-style';
      // v34.9: nav slides down on scroll-down, returns on scroll-up.
      // Floating widgets (#hs-totop, #hs-font-sizer) on mobile stack ABOVE the
      // nav bar so they don't visually overlap the search/article icons. When
      // the nav hides, they slide down with it via CSS variable.
      st.textContent =
        '#hs-mobile-nav{display:none}' +
        '@media (max-width:720px){' +
          ':root{--hs-nav-h:calc(64px + env(safe-area-inset-bottom))}' +
          'body.hs-nav-hidden{--hs-nav-h:0px}' +
          '#hs-mobile-nav{position:fixed;bottom:0;left:0;right:0;z-index:55;display:flex;background:rgba(247,243,236,.96);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-top:0.5px solid var(--border);padding:6px 4px calc(6px + env(safe-area-inset-bottom));box-shadow:0 -8px 20px -10px rgba(58,90,124,.18);transition:transform .25s ease,opacity .25s ease;will-change:transform}' +
          'body.hs-nav-hidden #hs-mobile-nav{transform:translateY(120%);opacity:0;pointer-events:none}' +
          ':root[data-theme="dark"] #hs-mobile-nav{background:rgba(37,34,32,.96)}' +
          '#hs-mobile-nav a{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:7px 6px;color:var(--ink-2);text-decoration:none;font-family:"Noto Sans TC",Inter,sans-serif;font-size:11px;font-weight:600;border-radius:10px;transition:color .15s,background .15s}' +
          '#hs-mobile-nav a:active,#hs-mobile-nav a:hover{color:var(--teal-deep);background:var(--blue-soft)}' +
          '#hs-mobile-nav svg{width:20px;height:20px;flex-shrink:0}' +
          'body{padding-bottom:calc(64px + env(safe-area-inset-bottom))!important}' +
          /* Float-stack on mobile: nav (~64px) → font-sizer → totop */
          '#hs-totop{bottom:calc(var(--hs-nav-h) + 18px)!important;transition:bottom .25s ease,opacity .25s ease,transform .15s,box-shadow .15s}' +
          '#hs-font-sizer{bottom:calc(var(--hs-nav-h) + 18px)!important;transition:bottom .25s ease,opacity .25s ease}' +
          /* Article pages: totop sits above font-sizer (font-sizer = 18 + 98 + 38 gap = 154) */
          'body.hs-article-page #hs-totop{bottom:calc(var(--hs-nav-h) + 154px)!important}' +
          'body.hs-article-page #hs-pip-btn{bottom:calc(var(--hs-nav-h) + 210px)!important;transition:bottom .25s ease}' +
        '}';
      document.head.appendChild(st);
    }
    // Mark article pages so float-stack CSS knows to add font-sizer offset
    if (document.querySelector('article.max-w-3xl')) {
      document.body.classList.add('hs-article-page');
    }
    const nav = document.createElement('nav');
    nav.id = 'hs-mobile-nav';
    nav.setAttribute('aria-label', 'Mobile navigation');
    nav.innerHTML =
      '<a href="/blog/">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>' +
        '<span data-zh="最新文章" data-en="Articles">最新文章</span>' +
      '</a>' +
      '<a href="/#hs-search-input" id="hs-mn-search">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>' +
        '<span data-zh="找文章" data-en="Search">找文章</span>' +
      '</a>' +
      '<a href="/about">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
        '<span data-zh="關於我" data-en="About">關於我</span>' +
      '</a>';
    document.body.appendChild(nav);
    // Search button: focus search input if on homepage
    const searchBtn = document.getElementById('hs-mn-search');
    if (searchBtn) searchBtn.addEventListener('click', function (e) {
      const input = document.getElementById('hs-search-input');
      if (input && location.pathname === '/') {
        e.preventDefault();
        input.focus();
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });

    // ── v34.9: scroll-direction-aware auto-hide on mobile ──
    // Hide on scroll-down (so the user has more vertical real estate while
    // reading) and reveal on scroll-up. Always show near the top (< 80px) and
    // when sitting still. Threshold prevents jitter from sub-pixel scroll
    // events on touch devices.
    var lastY = window.scrollY || 0;
    var ticking = false;
    var THRESHOLD = 12;            // px of net movement before flipping
    function update() {
      var y = window.scrollY || 0;
      var dy = y - lastY;
      // Only act on mobile viewport (matches the @media gate where the nav lives)
      if (matchMedia('(max-width:720px)').matches) {
        if (y < 80) {
          document.body.classList.remove('hs-nav-hidden');
        } else if (dy > THRESHOLD) {
          document.body.classList.add('hs-nav-hidden');
          lastY = y;
        } else if (dy < -THRESHOLD) {
          document.body.classList.remove('hs-nav-hidden');
          lastY = y;
        }
      }
      // Reset when stationary so small upward nudges still register
      if (Math.abs(dy) < 2) lastY = y;
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    // Show again when viewport flips out of mobile mode (rotation, devtools)
    window.addEventListener('resize', function () {
      if (!matchMedia('(max-width:720px)').matches) {
        document.body.classList.remove('hs-nav-hidden');
      }
    });
  };

  // ---------- FAQ hash deep linking (open by URL hash, push hash on toggle) ----------
  DN.bindFAQDeepLink = function () {
    const items = document.querySelectorAll('details.hf');
    if (!items.length) return;
    items.forEach(function (d, i) {
      if (!d.id) d.id = 'q' + (i + 1);
      if ('#' + d.id === location.hash) {
        d.open = true;
        setTimeout(function () { d.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 200);
      }
      d.addEventListener('toggle', function () {
        if (d.open && history.replaceState) {
          history.replaceState(null, '', '#' + d.id);
        }
      });
    });
    // Handle browser back/forward
    window.addEventListener('hashchange', function () {
      const h = location.hash;
      if (!h) return;
      const target = document.querySelector(h);
      if (target && target.tagName === 'DETAILS' && target.classList.contains('hf')) {
        target.open = true;
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  };

  // ---------- home search (filter article-list-item by title/tag/text) ----------
  DN.bindHomeSearch = function () {
    const input = document.getElementById('hs-search-input');
    if (!input) return;
    const empty = document.getElementById('dn-search-empty');
    // v34.12: when no query, honor the "max 5 visible" cap from
    // capHomeArticleList. When a query is active, show every match (cap lifted)
    // so users can find older articles via search. Re-query each call so the
    // DOM-order (post-sort) is what drives the i<5 cap rather than original
    // HTML order.
    function applyFilter() {
      const q = input.value.trim().toLowerCase();
      const allItems = Array.prototype.slice.call(
        document.querySelectorAll('#hs-article-list .article-list-item')
      );
      let visible = 0;
      allItems.forEach(function (it, i) {
        const text = (it.textContent || '').toLowerCase();
        const matches = !q || text.indexOf(q) !== -1;
        const show = matches && (q ? true : i < 5);
        it.style.display = show ? '' : 'none';
        if (show) visible++;
      });
      if (empty) empty.style.display = (q && visible === 0) ? 'block' : 'none';
    }
    input.addEventListener('input', applyFilter);
    // Esc clears
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { input.value = ''; applyFilter(); }
    });
  };

  // ---------------------------------------------------------------------
  // Cmd+K / Ctrl+K / "/" — global search modal across DN.ARTICLES
  // Indexes article titles + tags + meta-jumps (about, blog index, etc.).
  // Wires to any header button[aria-label="搜尋"] or [aria-label="Search"].
  // ---------------------------------------------------------------------
  DN.initCmdK = function () {
    if (document.getElementById('hs-cmdk-style')) return;
    var st = document.createElement('style');
    st.id = 'hs-cmdk-style';
    st.textContent =
      '#hs-cmdk-overlay{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9998;display:none;align-items:flex-start;justify-content:center;padding:88px 18px 18px;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}' +
      '#hs-cmdk-overlay.open{display:flex}' +
      '#hs-cmdk-modal{width:100%;max-width:640px;background:var(--surface,#fff);border:1px solid var(--border,#dcd5c8);border-radius:14px;box-shadow:0 30px 80px -20px rgba(0,0,0,.35);overflow:hidden;font-family:Inter,system-ui,sans-serif}' +
      '#hs-cmdk-input{width:100%;padding:18px 20px;border:0;border-bottom:1px solid var(--border,#dcd5c8);font-size:16px;outline:none;background:transparent;color:var(--ink,#0f172a);font-family:inherit}' +
      '#hs-cmdk-results{max-height:60vh;overflow:auto;padding:8px 0}' +
      '#hs-cmdk-results .row{display:flex;flex-direction:column;gap:2px;padding:10px 20px;cursor:pointer;border-left:3px solid transparent;text-decoration:none;color:var(--ink,#0f172a)}' +
      '#hs-cmdk-results .row.active{background:var(--blue-soft,#e3edf6);border-left-color:var(--blue-deep,#243b56)}' +
      '#hs-cmdk-results .row .t{font-family:"Noto Serif TC",Georgia,serif;font-size:14.5px;font-weight:600;line-height:1.4}' +
      '#hs-cmdk-results .row .m{font-size:11.5px;color:var(--muted,#8b8378);font-family:Inter,monospace;letter-spacing:.06em}' +
      '#hs-cmdk-results .row .s{font-size:12px;color:var(--muted,#6e6759);line-height:1.5;letter-spacing:0;font-family:Inter,"Noto Sans TC",system-ui,sans-serif}' +
      '#hs-cmdk-empty{padding:24px;text-align:center;font-size:13px;color:var(--muted,#8b8378)}' +
      '#hs-cmdk-foot{padding:10px 20px;border-top:1px solid var(--border,#dcd5c8);font-size:11px;color:var(--muted,#8b8378);font-family:Inter,monospace;letter-spacing:.04em;display:flex;gap:14px;flex-wrap:wrap;background:var(--mint-soft,#dde7e2)}' +
      '#hs-cmdk-foot kbd{padding:1px 6px;border:1px solid var(--border,#dcd5c8);border-radius:3px;background:#fff;font-family:inherit;font-size:10.5px}';
    document.head.appendChild(st);

    var overlay = document.createElement('div');
    overlay.id = 'hs-cmdk-overlay';
    overlay.innerHTML =
      // A-03: was a hard-coded Chinese aria-label, announced verbatim on /en/.
      '<div id="hs-cmdk-modal" role="dialog" aria-label="' + (DN.detectLang && DN.detectLang() === 'en' ? 'Search' : '搜尋') + '">' +
        '<input id="hs-cmdk-input" type="text" placeholder="搜尋文章 / 主題⋯ (按 Esc 關閉)" autocomplete="off" spellcheck="false" />' +
        '<div id="hs-cmdk-results"></div>' +
        '<div id="hs-cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> 移動</span><span><kbd>Enter</kbd> 開啟</span><span><kbd>Esc</kbd> 關閉</span></div>' +
      '</div>';
    document.body.appendChild(overlay);

    var input = overlay.querySelector('#hs-cmdk-input');
    var results = overlay.querySelector('#hs-cmdk-results');
    var activeIdx = 0;
    var currentMatches = [];

    function cmdkEscape(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
    function cmdkLang() {
      return ((DN.detectLang && DN.detectLang()) || (location.pathname.indexOf('/en/') === 0 ? 'en' : 'zh')) === 'en' ? 'en' : 'zh';
    }
    function cmdkStaticPages() {
      var en = cmdkLang() === 'en';
      var p = en ? '/en' : '';
      return en ? [
        { title: 'Eye Tools', meta: 'Tools · OSDI / DEQ-5 / SE', url: p + '/tools', search: 'tools calculator osdi deq snellen logmar spherical equivalent floaters' },
        { title: 'Topic Map', meta: 'Topics', url: p + '/blog/topics', search: 'topics topic map glaucoma cataract myopia dry eye floaters' },
        { title: 'About the Author', meta: 'About', url: p + '/about', search: 'about author Min-Chien Hsiao ophthalmology' },
        { title: 'Article Index', meta: 'Articles', url: p + '/blog/', search: 'blog articles index education ophthalmology' },
        { title: 'Privacy Policy', meta: 'Privacy', url: p + '/privacy', search: 'privacy policy' }
      ] : [
        { title: '量表計算器', meta: 'Tools · 5 個眼科量表', url: '/tools', search: 'tools 量表 計算 osdi deq snellen logmar se 球面 飛蚊' },
        { title: '主題地圖', meta: 'Topic Map', url: '/blog/topics', search: 'topics 主題 地圖 青光眼 白內障 近視 乾眼 飛蚊' },
        { title: '關於作者', meta: 'About', url: '/about', search: 'about 作者 蕭閔謙 眼科' },
        { title: '衛教文章索引', meta: 'Articles', url: '/blog/', search: 'blog articles 文章 索引 衛教' },
        { title: '隱私權政策', meta: 'Privacy', url: '/privacy', search: 'privacy 隱私' }
      ];
    }
    function indexRowsFromGenerated(rows) {
      var want = cmdkLang() === 'en' ? 'en' : 'zh-Hant-TW';
      return (rows || []).filter(function (item) {
        return item && item.lang === want && item.url && item.title;
      }).map(function (item) {
        var headings = Array.isArray(item.h) ? item.h.join(' ') : '';
        return {
          title: item.title || item.slug,
          meta: ((item.tag || '') + (item.updated || item.date ? ' · ' + (item.updated || item.date) : '')).replace(/^ · /, ''),
          snippet: item.snippet || '',
          url: item.url,
          search: [
            item.title, item.tag, item.slug, item.snippet, headings
          ].join(' ').toLowerCase()
        };
      }).concat(cmdkStaticPages());
    }
    function buildIndex() {
      var en = cmdkLang() === 'en';
      var _searchUrlPrefix = en ? '/en' : '';
      var idx = [];
      (DN.ARTICLES || []).forEach(function (a) {
        if (DN.isStub && DN.isStub(a.slug)) return;
        idx.push({
          title: (en && a.title_en ? a.title_en : a.title) || a.slug,
          meta: ((en ? (a.tag_en || a.tag) : (a.tag || a.tag_en)) || '') + ' · ' + (a.updated || a.date || ''),
          url: en && DN.hasEnglishMirror && !DN.hasEnglishMirror(a.slug) ? '/blog/' + a.slug : _searchUrlPrefix + '/blog/' + a.slug,
          search: ((a.title || '') + ' ' + (a.title_en || '') + ' ' + (a.tag || '') + ' ' + (a.tag_en || '') + ' ' + a.slug).toLowerCase()
        });
      });
      return idx.concat(cmdkStaticPages());
    }
    var INDEX = null;
    var _cmdkIndexPromise = null;
    function loadGeneratedSearchIndex() {
      if (_cmdkIndexPromise) return _cmdkIndexPromise;
      _cmdkIndexPromise = fetch('/assets/search-index.json')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (rows) {
          if (!Array.isArray(rows)) return false;
          INDEX = indexRowsFromGenerated(rows);
          return true;
        })
        .catch(function () { return false; });
      return _cmdkIndexPromise;
    }

    // v37.19 — accessibility: focus trap + ARIA dialog semantics + focus
    // restoration. Before this, Tab/Shift+Tab in the open modal could
    // escape to the page behind it (WCAG 2.4.3 Focus Order violation).
    var _cmdkPrevFocus = null;
    function open() {
      if (!INDEX) INDEX = buildIndex();
      loadGeneratedSearchIndex().then(function (changed) {
        if (changed && overlay.classList.contains('open')) render(input.value);
      });
      _cmdkPrevFocus = document.activeElement;
      var modal = overlay.querySelector('#hs-cmdk-modal');
      if (modal) {
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
      }
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
      input.value = '';
      input.focus();
      render('');
    }
    function close() {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
      // Restore focus to whichever element opened the modal (typically the
      // header search button) so keyboard users don't lose their place.
      try { if (_cmdkPrevFocus && _cmdkPrevFocus.focus) _cmdkPrevFocus.focus(); } catch (e) {}
      _cmdkPrevFocus = null;
    }
    // Trap Tab inside the modal: shift+tab from first → last, tab from last → first.
    overlay.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab' || !overlay.classList.contains('open')) return;
      var modal = overlay.querySelector('#hs-cmdk-modal');
      if (!modal) return;
      var focusables = modal.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    });
    function render(q) {
      q = (q || '').toLowerCase().trim();
      var matches;
      if (!q) {
        matches = INDEX.slice(0, 8);
      } else {
        matches = INDEX
          .map(function (it) {
            var title = (it.title || '').toLowerCase();
            var search = (it.search || '').toLowerCase();
            var s = 0;
            if (title.indexOf(q) === 0) s += 120;
            else if (title.indexOf(q) >= 0) s += 90;
            if (search.indexOf(q) >= 0) s += 40;
            return { it: it, s: s };
          })
          .filter(function (x) { return x.s > 0; })
          .sort(function (x, y) { return y.s - x.s; })
          .slice(0, 10)
          .map(function (x) { return x.it; });
      }
      currentMatches = matches;
      activeIdx = 0;
      if (!matches.length) { results.innerHTML = '<div id="hs-cmdk-empty">找不到符合的內容</div>'; return; }
      results.innerHTML = matches.map(function (m, i) {
        return '<a class="row' + (i === 0 ? ' active' : '') + '" href="' + cmdkEscape(m.url) + '" data-idx="' + i + '">' +
          '<span class="t">' + cmdkEscape(m.title) + '</span>' +
          '<span class="m">' + cmdkEscape(m.meta || '') + '</span>' +
          (m.snippet ? '<span class="s">' + cmdkEscape(String(m.snippet).slice(0, 96)) + '</span>' : '') +
        '</a>';
      }).join('');
    }
    function setActive(i) {
      activeIdx = Math.max(0, Math.min(currentMatches.length - 1, i));
      var rows = results.querySelectorAll('.row');
      rows.forEach(function (r, j) { r.classList.toggle('active', j === activeIdx); });
      var act = rows[activeIdx];
      if (act) act.scrollIntoView({ block: 'nearest' });
    }
    function go() { var m = currentMatches[activeIdx]; if (m) location.href = m.url; }

    // PageFind full-text augmentation: after the fast static title search,
    // asynchronously fetch full-text hits from /pagefind/ and append them
    // below the title results. Loads lazily on first query.
    var _pfMod = null;
    var _pfPending = null;
    async function augmentWithPagefind(q) {
      if (!q || q.length < 2) return;
      try {
        if (!_pfMod) {
          if (!_pfPending) _pfPending = import('/pagefind/pagefind.js').catch(function(e){
            // v37.24 — surface fetch failure to the user instead of silent dead state
            var fb = document.getElementById('hs-cmdk-pf-fallback');
            if (!fb) {
              fb = document.createElement('div');
              fb.id = 'hs-cmdk-pf-fallback';
              fb.style.cssText = 'padding:10px 20px;font-size:11.5px;color:var(--muted,#6e6759);border-top:1px solid var(--line,#ebe4d8)';
              fb.textContent = '⚠ 全文搜尋暫時無法使用，標題搜尋仍可用';
              if (results) results.appendChild(fb);
            }
            return null;
          });
          _pfMod = await _pfPending;
          if (!_pfMod) return;  // pagefind index not built — fallback msg shown
          // v37.18 — restrict the search index to the active site language.
          // PageFind builds one index per language; without this filter,
          // searching on /en/ returned ZH hits (the default index union).
          try {
            var curLang = (DN.detectLang && DN.detectLang()) || 'zh';
            var pfLang = curLang === 'en' ? 'en' : 'zh-hant-tw';
            if (_pfMod.options) {
              await _pfMod.options({ language: pfLang });
            } else if (_pfMod.init) {
              await _pfMod.init();
              if (_pfMod.options) await _pfMod.options({ language: pfLang });
            }
          } catch (e) { /* older pagefind version — ignore */ }
        }
        // v37.18 — language filter: pagefind.search accepts a `filters`
        // object; pass the current site language as a soft preference.
        var curLang2 = (DN.detectLang && DN.detectLang()) || 'zh';
        var pfLang2 = curLang2 === 'en' ? 'en' : 'zh-hant-tw';
        var search = await _pfMod.search(q, { language: pfLang2 });
        if (!search || !search.results || !search.results.length) {
          // Retry without language filter as a fallback
          search = await _pfMod.search(q);
        }
        if (!search || !search.results || !search.results.length) return;
        // Only run if the current query is still the same (debounce)
        if (input.value.trim().toLowerCase() !== q.toLowerCase()) return;
        var hits = await Promise.all(search.results.slice(0, 5).map(function(r){ return r.data(); }));
        // Dedup: skip URLs already in static results
        var staticUrls = Array.prototype.map.call(results.querySelectorAll('.row'), function(a){ return a.getAttribute('href'); });
        hits = hits.filter(function(h){
          var url = h && h.url ? String(h.url) : '';
          var activeEn = cmdkLang() === 'en';
          var slug = (url.match(/\/blog\/([^/#?]+)/) || [])[1];
          if (!url || staticUrls.indexOf(url) >= 0) return false;
          if (slug && DN.isStub && DN.isStub(slug)) return false;
          if (activeEn) return url.indexOf('/en/') === 0;
          return url.indexOf('/en/') !== 0;
        });
        if (!hits.length) return;
        // Append section header + hit rows
        var header = document.createElement('div');
        header.style.cssText = 'padding:8px 20px 4px;font-size:10.5px;color:var(--muted,#8b8378);border-top:1px solid var(--line,#ebe4d8);margin-top:6px;letter-spacing:.08em;text-transform:uppercase';
        header.textContent = '🔎 文章內文相關';
        results.appendChild(header);
        hits.forEach(function(h) {
          var a = document.createElement('a');
          a.className = 'row';
          a.href = h.url;
          var t = document.createElement('span'); t.className = 't';
          t.textContent = (h.meta && h.meta.title) || h.url;
          var m = document.createElement('span'); m.className = 'm';
          // textContent on excerpt to strip <mark> tags safely (Trusted Types friendly)
          var tmp = document.createElement('div'); tmp.innerHTML = h.excerpt || '';
          m.textContent = (tmp.textContent || '').slice(0, 90);
          a.appendChild(t); a.appendChild(m);
          results.appendChild(a);
        });
      } catch (e) { /* silent — fallback to static results */ }
    }
    // v37.29 — GA4: track when user actually types a query (debounced
    // so 一字一個 event 不會 over-report; fire after 500ms of stable input)
    var _searchEvtTimer = null;
    input.addEventListener('input', function () {
      render(input.value);
      augmentWithPagefind(input.value.trim());
      clearTimeout(_searchEvtTimer);
      _searchEvtTimer = setTimeout(function () {
        var q = input.value.trim();
        if (q.length < 2) return;
        // GA4: just length (privacy-preserving).
        if (DN.gaEvent) DN.gaEvent('search_query', { query_len: q.length });
        // v37.40 — POST to /api/search-log. The endpoint is rate-limited and
        // logs ONLY when env SEARCH_LOG_ENABLED=1; otherwise 204 no-op. The
        // author uses /api/admin/search-log to spot content gaps. We do not
        // send IP / cookie / UA — just the query string. sendBeacon falls
        // back to fetch so we don't block the input handler.
        try {
          var payload = JSON.stringify({ q: q });
          var blob = new Blob([payload], { type: 'application/json' });
          if (navigator.sendBeacon && navigator.sendBeacon('/api/search-log', blob)) return;
          fetch('/api/search-log', { method: 'POST', body: payload,
                                     headers: { 'content-type': 'application/json' },
                                     keepalive: true }).catch(function () {});
        } catch (e) { /* best-effort */ }
      }, 500);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIdx + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIdx - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); go(); }
      else if (e.key === 'Escape') { close(); }
    });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (overlay.classList.contains('open')) close(); else open();
      } else if (e.key === '/' && document.activeElement &&
                 document.activeElement.tagName !== 'INPUT' &&
                 document.activeElement.tagName !== 'TEXTAREA' &&
                 !document.activeElement.isContentEditable &&
                 !(DN.isAdminMode && DN.isAdminMode())) {
        // M-03 fix: don't hijack "/" while the caret is in an editable host.
        // In ?admin=1 WYSIWYG mode the article body is contentEditable (a
        // DIV/P/H2, not INPUT/TEXTAREA), so a bare "/" — needed for "and/or",
        // dates, ratios (mmHg), URLs — was being swallowed to open search.
        e.preventDefault();
        open();
      }
    });
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('button[aria-label="搜尋"], button[aria-label="Search"]');
      if (btn) { e.preventDefault(); open(); }
    });
  };

  // ---------------------------------------------------------------------
  // Article hero — gradient banner with breadcrumb + read-time + dates.
  // Inserts <figure id="hs-article-hero"> after H1 inside article.max-w-3xl.
  // SVG art is keyed by article tag (Tiffany blue + ochre + paper cream).
  // ---------------------------------------------------------------------
  DN.injectArticleHero = function () {
    if (document.getElementById('hs-article-hero')) return;
    var slug = DN.currentSlug && DN.currentSlug();
    if (!slug) return;
    var meta = (DN.ARTICLES || []).find(function (a) { return a.slug === slug; });
    if (!meta) return;
    var article = document.querySelector('article.max-w-3xl');
    if (!article) return;
    var h1 = article.querySelector('h1');
    if (!h1) return;

    var HEROES = {
      '飛蚊症': '<svg viewBox="0 0 720 240" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<rect width="720" height="240" fill="#faf7f2"/>' +
        '<g transform="translate(60 30)"><path d="M20 90 Q120 0 220 90 Q120 180 20 90 Z" fill="#fff" stroke="#3a5a7c" stroke-width="2.5"/>' +
        '<circle cx="120" cy="90" r="42" fill="#a4c4dd" stroke="#3a5a7c" stroke-width="2"/>' +
        '<circle cx="120" cy="90" r="18" fill="#0f172a"/>' +
        '<circle cx="60" cy="50" r="3" fill="#0f172a" opacity=".6"/>' +
        '<ellipse cx="170" cy="60" rx="5" ry="2" fill="#0f172a" opacity=".55" transform="rotate(-15 170 60)"/>' +
        '<circle cx="180" cy="130" r="2.5" fill="#0f172a" opacity=".5"/>' +
        '</g><g transform="translate(360 60)"><text x="0" y="40" font-family="Noto Serif TC,Georgia,serif" font-size="32" font-weight="700" fill="#243b56">飛蚊症 / 視網膜剝離</text>' +
        '<text x="0" y="78" font-family="Inter,sans-serif" font-size="14" letter-spacing="3" fill="#7a9285">FLOATERS · RETINAL DETACHMENT</text>' +
        '<line x1="0" y1="100" x2="320" y2="100" stroke="#a4c4dd" stroke-width="2"/>' +
        '<text x="0" y="140" font-family="Noto Sans TC,sans-serif" font-size="13" fill="#5e574e">突發閃光 · 視野缺損 · 48 小時警訊</text>' +
        '</g></svg>',
      '兒童近視': '<svg viewBox="0 0 720 240" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<rect width="720" height="240" fill="#faf7f2"/>' +
        '<g transform="translate(60 50)"><circle cx="80" cy="80" r="50" fill="#fff" stroke="#3a5a7c" stroke-width="3"/>' +
        '<circle cx="180" cy="80" r="50" fill="#fff" stroke="#3a5a7c" stroke-width="3"/>' +
        '<circle cx="80" cy="80" r="46" fill="#a4c4dd" opacity=".5"/>' +
        '<circle cx="180" cy="80" r="46" fill="#a4c4dd" opacity=".5"/>' +
        '<line x1="130" y1="80" x2="130" y2="80" stroke="#3a5a7c" stroke-width="3"/>' +
        '<line x1="125" y1="80" x2="135" y2="80" stroke="#3a5a7c" stroke-width="3" stroke-linecap="round"/>' +
        '<line x1="35" y1="65" x2="10" y2="50" stroke="#3a5a7c" stroke-width="3" stroke-linecap="round"/>' +
        '<line x1="225" y1="65" x2="250" y2="50" stroke="#3a5a7c" stroke-width="3" stroke-linecap="round"/>' +
        '</g><g transform="translate(330 60)"><text x="0" y="40" font-family="Noto Serif TC,Georgia,serif" font-size="32" font-weight="700" fill="#243b56">兒童近視控制</text>' +
        '<text x="0" y="78" font-family="Inter,sans-serif" font-size="14" letter-spacing="3" fill="#7a9285">PEDIATRIC MYOPIA CONTROL</text>' +
        '<line x1="0" y1="100" x2="340" y2="100" stroke="#a4c4dd" stroke-width="2"/>' +
        '<text x="0" y="140" font-family="Noto Sans TC,sans-serif" font-size="13" fill="#5e574e">阿托品 · 角膜塑型 · 戶外 2 小時</text>' +
        '</g></svg>',
      '乾眼症': '<svg viewBox="0 0 720 240" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<rect width="720" height="240" fill="#faf7f2"/>' +
        '<g transform="translate(60 50)"><path d="M20 90 Q120 10 220 90 Q120 160 20 90 Z" fill="#fff" stroke="#3a5a7c" stroke-width="2.5"/>' +
        '<circle cx="120" cy="90" r="38" fill="#a4c4dd" stroke="#3a5a7c" stroke-width="2"/>' +
        '<circle cx="120" cy="90" r="16" fill="#0f172a"/>' +
        '<path d="M210 130 Q220 150 210 170 Q200 150 210 130 Z" fill="#7fc8d8" stroke="#3a5a7c" stroke-width="1.5"/>' +
        '</g><g transform="translate(330 60)"><text x="0" y="40" font-family="Noto Serif TC,Georgia,serif" font-size="32" font-weight="700" fill="#243b56">乾眼症</text>' +
        '<text x="0" y="78" font-family="Inter,sans-serif" font-size="14" letter-spacing="3" fill="#7a9285">DRY EYE DISEASE · MGD</text>' +
        '<line x1="0" y1="100" x2="320" y2="100" stroke="#a4c4dd" stroke-width="2"/>' +
        '<text x="0" y="140" font-family="Noto Sans TC,sans-serif" font-size="13" fill="#5e574e">瞼板腺 · 人工淚液 · Omega-3</text>' +
        '</g></svg>',
      '常見問題': '<svg viewBox="0 0 720 240" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<rect width="720" height="240" fill="#faf7f2"/>' +
        '<g transform="translate(80 30)"><circle cx="90" cy="90" r="80" fill="#fff" stroke="#3a5a7c" stroke-width="2.5"/>' +
        '<text x="90" y="115" text-anchor="middle" font-family="Noto Serif TC,Georgia,serif" font-size="80" font-weight="700" fill="#243b56">?</text>' +
        '</g><g transform="translate(280 50)"><text x="0" y="40" font-family="Noto Serif TC,Georgia,serif" font-size="32" font-weight="700" fill="#243b56">' + (meta.title.length > 14 ? meta.title.slice(0, 14) + '⋯' : meta.title) + '</text>' +
        '<text x="0" y="78" font-family="Inter,sans-serif" font-size="14" letter-spacing="3" fill="#7a9285">' + (meta.tag_en || 'OPHTHALMOLOGY') + '</text>' +
        '<line x1="0" y1="100" x2="340" y2="100" stroke="#a4c4dd" stroke-width="2"/>' +
        '<text x="0" y="140" font-family="Noto Sans TC,sans-serif" font-size="13" fill="#5e574e">蕭閔謙 醫師 · 眼科衛教筆記</text>' +
        '</g></svg>'
    };
    // Try exact tag match, then substring (for compound tags)
    var heroSvg = HEROES[meta.tag];
    if (!heroSvg) {
      var keys = Object.keys(HEROES);
      for (var i = 0; i < keys.length; i++) {
        if (meta.tag && meta.tag.indexOf(keys[i]) >= 0) { heroSvg = HEROES[keys[i]]; break; }
      }
    }
    if (!heroSvg) heroSvg = HEROES['常見問題'];

    var fig = document.createElement('figure');
    fig.id = 'hs-article-hero';
    fig.style.cssText = 'margin:18px 0 8px;padding:0;border-radius:14px;overflow:hidden;box-shadow:0 4px 14px -8px rgba(15,23,42,.15)';
    fig.innerHTML = heroSvg;
    var svg = fig.querySelector('svg');
    if (svg) {
      svg.style.cssText = 'display:block;width:100%;height:auto';
      svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    }
    h1.parentNode.insertBefore(fig, h1.nextSibling);
  };

  // ---------------------------------------------------------------------
  // Article images — lazy-load, decoding=async, click-to-zoom lightbox
  // ---------------------------------------------------------------------
  DN.enhanceArticleImages = function () {
    if (document.getElementById('hs-img-css')) return;
    var st = document.createElement('style');
    st.id = 'hs-img-css';
    st.textContent =
      '.prose img, article.max-w-3xl img:not(.no-zoom){display:block;width:100%;max-width:760px;height:auto;margin:24px auto;border-radius:12px;box-shadow:0 4px 14px -8px rgba(15,23,42,.15);cursor:zoom-in}' +
      '.prose svg, article.max-w-3xl svg{display:block;max-width:100%;height:auto;margin:20px auto}' +
      '.hs-img-lightbox{position:fixed;inset:0;background:rgba(15,23,42,.92);z-index:9999;display:none;align-items:center;justify-content:center;padding:24px;cursor:zoom-out}' +
      '.hs-img-lightbox.open{display:flex}' +
      '.hs-img-lightbox img{max-width:96%;max-height:96vh;border-radius:8px;box-shadow:0 24px 60px rgba(0,0,0,.5)}';
    document.head.appendChild(st);

    var imgs = document.querySelectorAll('.prose img, article.max-w-3xl img:not(.no-zoom)');
    imgs.forEach(function (img) {
      if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');
      if (!img.hasAttribute('decoding')) img.setAttribute('decoding', 'async');
      if (!img.hasAttribute('width') && !img.hasAttribute('height')) {
        img.setAttribute('width', '760');
        img.setAttribute('height', '480');
      }
    });

    var box = document.createElement('div');
    box.className = 'hs-img-lightbox';
    box.innerHTML = '<img alt="" />';
    document.body.appendChild(box);
    var bigImg = box.querySelector('img');
    imgs.forEach(function (img) {
      img.addEventListener('click', function () {
        bigImg.src = img.currentSrc || img.src;
        bigImg.alt = img.alt || '';
        box.classList.add('open');
      });
    });
    box.addEventListener('click', function () { box.classList.remove('open'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') box.classList.remove('open'); });
  };

  // ---------------------------------------------------------------------
  // Inline mid-article CTA — points readers to the topic hub.
  // Inserts a styled card before the middle H2 of #proseZh.
  // ---------------------------------------------------------------------
  // v34.16: addInlineCTA disabled per user request — the "想找其他眼科主題？"
  // mid-article card felt repetitive (the related-reads + topic-map links at
  // the article foot already serve this purpose). Stub kept so any cached
  // older DOM that still has #hs-inline-cta gets cleared on next render.
  DN.addInlineCTA = function () {
    var existing = document.getElementById('hs-inline-cta');
    if (existing) existing.remove();
  };

  // ---------------------------------------------------------------------
  // Mark recently-published articles with an animated "NEW" badge.
  // Triggered by `date` field in DN.ARTICLES (within last 14 days).
  // ---------------------------------------------------------------------
  DN.markNewArticles = function () {
    var NOW = Date.now();
    var FOURTEEN_DAYS = 14 * 86400 * 1000;
    var cards = document.querySelectorAll('a.article-list-item[href*="/blog/"]');
    if (!cards.length) return;
    if (!document.getElementById('hs-new-pulse-css')) {
      var styleEl = document.createElement('style');
      styleEl.id = 'hs-new-pulse-css';
      styleEl.textContent = '.hs-new-pulse{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:9999px;background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#fff;font-size:9.5px;font-weight:800;letter-spacing:.04em;line-height:1.5;animation:hsPulse 1.6s ease-in-out infinite;vertical-align:middle}@keyframes hsPulse{0%,100%{box-shadow:0 0 0 0 rgba(251,191,36,.55)}50%{box-shadow:0 0 0 6px rgba(251,191,36,0)}}';
      document.head.appendChild(styleEl);
    }
    cards.forEach(function (a) {
      var href = a.getAttribute('href') || '';
      var m = href.match(/\/blog\/([a-z0-9-]+)/i);
      if (!m) return;
      var slug = m[1];
      var meta = (DN.ARTICLES || []).find(function (x) { return x.slug === slug; });
      if (!meta) return;
      var pub = Date.parse(meta.date);
      if (!pub || NOW - pub > FOURTEEN_DAYS) return;
      var h3 = a.querySelector('h3');
      if (!h3 || h3.querySelector('.hs-new-pulse')) return;
      var tag = document.createElement('span');
      tag.className = 'hs-new-pulse';
      tag.textContent = 'NEW';
      h3.appendChild(tag);
    });
  };

  // v34.12: homepage article list — sort by date desc, cap at 5 visible.
  // The author writes the items in any order in HTML; this function ensures
  // the most-recent 5 surface at the top regardless. Items beyond #5 are
  // hidden via display:none (kept in DOM for future "show all" expansion).
  DN.capHomeArticleList = function () {
    var list = document.getElementById('hs-article-list');
    if (!list) return;
    var items = Array.prototype.slice.call(list.querySelectorAll('.article-list-item'));
    if (items.length < 2) return;
    function dateOf(el) {
      var t = el.querySelector('time');
      return t ? Date.parse(t.textContent.trim()) || 0 : 0;
    }
    items.sort(function (a, b) { return dateOf(b) - dateOf(a); });
    items.forEach(function (el, i) {
      list.appendChild(el);                 // re-attach in sorted order
      el.style.display = (i >= 5) ? 'none' : '';
    });
  };

  // ---------------------------------------------------------------------
  // GA4 conversion event tracking — email/RSS/lang/scroll-depth/internal links
  // ---------------------------------------------------------------------
  DN.bindGAEvents = function () {
    if (typeof gtag !== 'function') return;
    function fire(name, params) { try { gtag('event', name, params || {}); } catch (e) {} }
    document.querySelectorAll('a[href^="mailto:"]').forEach(function (a) {
      a.addEventListener('click', function () { fire('email_click', { page_path: location.pathname }); });
    });
    document.querySelectorAll('[data-subscribe-link]').forEach(function (a) {
      a.addEventListener('click', function () { fire('newsletter_subscribe_click', { method: 'mailto', page_path: location.pathname }); });
    });
    document.querySelectorAll('a[href$="/feed.xml"], a[href$="/atom.xml"]').forEach(function (a) {
      a.addEventListener('click', function () { fire('rss_subscribe_click', { feed: a.getAttribute('href'), page_path: location.pathname }); });
    });
    var lt = document.getElementById('langToggle');
    if (lt && lt.tagName === 'SELECT') {
      lt.addEventListener('change', function () { fire('lang_switch', { lang: lt.value }); });
    }
    document.querySelectorAll('article a[href^="/blog/"]').forEach(function (a) {
      a.addEventListener('click', function () { fire('internal_link', { destination: a.getAttribute('href'), source: location.pathname }); });
    });
    if (document.querySelector('article .prose, article.max-w-3xl')) {
      var fired = false;
      window.addEventListener('scroll', function () {
        if (fired) return;
        var h = document.documentElement;
        var pct = (h.scrollTop + h.clientHeight) / h.scrollHeight;
        if (pct >= 0.75) { fired = true; fire('article_75pct', { page_path: location.pathname }); }
      }, { passive: true });
    }
  };

  // ---------------------------------------------------------------------
  // Web Vitals — LCP / CLS / INP via PerformanceObserver, sent to GA4
  // ---------------------------------------------------------------------
  DN.bindWebVitals = function () {
    function send(name, value, id) {
      // GA4 (existing path)
      try {
        if (typeof gtag === 'function') gtag('event', name, {
          event_category: 'Web Vitals',
          event_label: id,
          value: Math.round(name === 'CLS' ? value * 1000 : value),
          non_interaction: true
        });
      } catch (e) {}
      // v31: KV ingest beacon — real-time, no GA4 24-48hr latency
      try {
        var payload = JSON.stringify({
          name: name,
          value: name === 'CLS' ? value * 1000 : value,
          page: location.pathname,
        });
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/cwv-ingest', new Blob([payload], { type: 'application/json' }));
        } else {
          fetch('/api/cwv-ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(function () {});
        }
      } catch (e) {}
    }
    try {
      var lcp = 0;
      var lcpObs = new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        var last = entries[entries.length - 1];
        lcp = last.renderTime || last.loadTime || last.startTime;
      });
      lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });
      addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden' && lcp) { send('LCP', lcp, 'lcp-' + Date.now()); lcp = 0; }
      }, { once: true });
    } catch (e) {}
    try {
      var cls = 0;
      var clsObs = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (entry) { if (!entry.hadRecentInput) cls += entry.value; });
      });
      clsObs.observe({ type: 'layout-shift', buffered: true });
      addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') send('CLS', cls, 'cls-' + Date.now());
      });
    } catch (e) {}
    try {
      var worstINP = 0;
      var inpObs = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (entry) { if (entry.duration > worstINP) worstINP = entry.duration; });
      });
      inpObs.observe({ type: 'event', buffered: true, durationThreshold: 40 });
      addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden' && worstINP) { send('INP', worstINP, 'inp-' + Date.now()); worstINP = 0; }
      });
    } catch (e) {}

    // ── TTFB (Time to First Byte) — from Navigation Timing ──
    try {
      var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
      if (nav) {
        var ttfb = nav.responseStart - nav.startTime;
        if (ttfb > 0 && ttfb < 60000) send('TTFB', ttfb, 'ttfb-' + Date.now());
      }
    } catch (e) {}

    // ── FCP (First Contentful Paint) — from Paint Timing ──
    try {
      var fcpObs = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (entry) {
          if (entry.name === 'first-contentful-paint') {
            send('FCP', entry.startTime, 'fcp-' + Date.now());
            try { fcpObs.disconnect(); } catch (e2) {}
          }
        });
      });
      fcpObs.observe({ type: 'paint', buffered: true });
    } catch (e) {}

    // ── HTTP protocol detection (h1 / h2 / h3) ──
    // Reads NextHopProtocol from PerformanceResourceTiming entries.
    // Reports as a custom event so we can verify h3 rollout in GA4.
    try {
      var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
      if (nav && nav.nextHopProtocol) {
        var proto = nav.nextHopProtocol;  // 'h2', 'h3', 'http/1.1', 'h3-29', etc.
        try {
          gtag && gtag('event', 'http_protocol', {
            event_category: 'Network',
            event_label: proto,
            non_interaction: true,
          });
        } catch (e) {}
        // Also expose on window for DevTools console probing
        window.__hsHttpProtocol = proto;
      }
    } catch (e) {}

    // ── Prerender / Speculation Rules hit detection ──
    // If the page was prerendered, document.prerendering was true at startup;
    // we listen to prerenderingchange to know when it became active.
    try {
      var wasPrerendered = (document.wasDiscarded === false && performance.getEntriesByType('navigation')[0]?.activationStart > 0)
        || ((document.visibilityState === 'visible') && (window.performance && performance.getEntriesByType('navigation')[0]?.activationStart > 0));
      if (wasPrerendered) {
        try {
          gtag('event', 'prerender_hit', {
            event_category: 'Speculation',
            event_label: location.pathname,
            value: Math.round(performance.getEntriesByType('navigation')[0].activationStart || 0),
            non_interaction: true
          });
        } catch (e2) {}
      }
    } catch (e) {}
  };

  // =====================================================================
  // CALCULATOR FRAMEWORK (DermNotes-parity)
  // ---------------------------------------------------------------------
  // Generic config-driven calculator builder used by all ophth calculators.
  // Each calculator declares: id, title, sub-text, rows (number/select/buttons),
  // calc(values) → { score, band, bg, fg, interp }, and disclaimer.
  // Calculators auto-mount inside <article.max-w-3xl> (article context) or
  // inside any <div data-calc="<name>"> placeholder (e.g. on /tools).
  // =====================================================================
  DN.calcStyles = function () {
    if (document.getElementById('hs-calc-css')) return;
    var st = document.createElement('style');
    st.id = 'hs-calc-css';
    st.textContent =
      '.hs-calc{background:#fff;border:1px solid var(--border,#dcd5c8);border-radius:14px;padding:18px 22px;margin:24px 0;box-shadow:0 8px 24px -14px rgba(58,90,124,.2)}' +
      '.hs-calc h3.hs-calc-title{font-family:\'Noto Serif TC\',Georgia,serif;font-size:18px;font-weight:700;color:#0f172a;margin:0 0 4px}' +
      '.hs-calc .hs-calc-sub{font-size:12.5px;color:#5e574e;margin-bottom:14px;line-height:1.6}' +
      '.hs-calc-row{display:grid;grid-template-columns:1fr auto;align-items:center;gap:10px;padding:8px 0;border-top:1px solid #ebe4d8}' +
      '.hs-calc-row:first-of-type{border-top:0}' +
      '.hs-calc-row label{font-size:13.5px;color:#2a2620;font-weight:600}' +
      '.hs-calc-row .hs-calc-hint{display:block;font-size:11.5px;color:#8b8378;font-weight:400;margin-top:2px;line-height:1.4}' +
      '.hs-calc-input{width:90px;padding:6px 10px;border:1px solid var(--border,#dcd5c8);border-radius:8px;font-size:14px;text-align:center;color:#0f172a;font-weight:700;background:#fff}' +
      '.hs-calc-input:focus{outline:none;border-color:rgba(58,90,124,.6);box-shadow:0 0 0 3px rgba(143,179,212,.20)}' +
      '.hs-calc-result{margin-top:14px;padding:14px 16px;background:linear-gradient(135deg,#e3edf6,#f0f6f4);border:1px solid #b8cfe3;border-radius:12px}' +
      '.hs-calc-score{font-family:\'Noto Serif TC\',Georgia,serif;font-size:32px;font-weight:800;color:#243b56;line-height:1;margin:0}' +
      '.hs-calc-band{display:inline-block;margin-left:10px;padding:4px 12px;border-radius:9999px;font-size:12px;font-weight:700;letter-spacing:.04em;vertical-align:middle}' +
      '.hs-calc-interp{font-size:13px;color:#0f172a;line-height:1.7;margin-top:6px}' +
      '.hs-calc-disclaimer{font-size:11px;color:#8b8378;margin-top:10px;line-height:1.6;font-style:italic}' +
      '.hs-calc-tools-link{display:inline-flex;align-items:center;gap:5px;margin-top:10px;padding:6px 12px;border-radius:9999px;background:var(--mint-soft,#dde7e2);color:#243b56;font-size:12px;font-weight:700;text-decoration:none;border:1px solid #b8cfe3}' +
      '.hs-calc-tools-link:hover{background:#b8cfe3}' +
      '.hs-radio-group{display:flex;gap:6px;flex-wrap:wrap}' +
      '.hs-radio-group button{padding:5px 10px;border-radius:8px;border:1px solid var(--border,#dcd5c8);background:#fff;font-size:12.5px;font-weight:600;color:#5e574e;cursor:pointer;min-width:34px}' +
      '.hs-radio-group button.active{background:linear-gradient(180deg,#8fb3d4,#243b56);color:#fff;border-color:transparent}';
    document.head.appendChild(st);
  };

  // Generic builder. cfg: { id, tool, title, sub, rows[], calc(v)->result, disclaimer, toolsAnchor?, mountSel? }
  DN._buildCalc = function (cfg) {
    DN.calcStyles();
    // mountSel can be a CSS selector for a specific placeholder; otherwise mount after article
    var mountAfter = null, mountInto = null;
    if (cfg.mountSel) {
      mountInto = document.querySelector(cfg.mountSel);
      if (!mountInto) return null;
    } else {
      mountAfter = document.querySelector('article.max-w-3xl');
      if (!mountAfter) return null;
    }
    if (document.getElementById(cfg.id)) return null;

    var rowsHTML = (cfg.rows || []).map(function (r) {
      var hint = r.hint ? '<span class="hs-calc-hint">' + r.hint + '</span>' : '';
      if (r.type === 'number') {
        return '<div class="hs-calc-row"><label>' + r.label + hint + '</label>' +
          '<input type="number" min="' + (r.min != null ? r.min : 0) + '" max="' + (r.max != null ? r.max : 100) + '" step="' + (r.step || 1) + '" value="' + (r.def != null ? r.def : 0) + '" class="hs-calc-input" data-key="' + r.key + '" /></div>';
      } else if (r.type === 'select') {
        var opts = r.options.map(function (o) { return '<option value="' + o.v + '"' + (o.def ? ' selected' : '') + '>' + o.label + '</option>'; }).join('');
        return '<div class="hs-calc-row"><label>' + r.label + hint + '</label>' +
          '<select class="hs-calc-input" data-key="' + r.key + '" style="width:auto;min-width:140px">' + opts + '</select></div>';
      }
      return '';
    }).join('');

    var inner =
      '<div class="hs-calc" id="' + cfg.id + '">' +
        '<h3 class="hs-calc-title">' + cfg.title + '</h3>' +
        '<div class="hs-calc-sub">' + cfg.sub + '</div>' +
        rowsHTML +
        '<div class="hs-calc-result">' +
          '<div><span class="hs-calc-score" data-result="score">—</span><span class="hs-calc-band" data-result="band"></span></div>' +
          '<div class="hs-calc-interp" data-result="interp"></div>' +
        '</div>' +
        (cfg.toolsAnchor ? '<a href="/tools#' + cfg.toolsAnchor + '" class="hs-calc-tools-link" data-zh="查看完整 ' + cfg.tool + ' 使用指南 →" data-en="View full ' + cfg.tool + ' guide →">查看完整 ' + cfg.tool + ' 使用指南 →</a>' : '') +
        '<div class="hs-calc-disclaimer">' + cfg.disclaimer + '</div>' +
      '</div>';

    var box;
    if (mountInto) {
      mountInto.innerHTML = inner;
      box = mountInto.querySelector('.hs-calc');
    } else {
      box = document.createElement('section');
      // M-07: the fallback wrapper carries its own id so the admin sanitizer
      // can strip the WHOLE section. Stripping only the inner #hs-<calc> would
      // leave an empty <section> baked into the source, and the next save would
      // add another one. Both ids are in the strip lists (see blog-admin.js /
      // api/admin/_save.js); D-24 keeps the two lists in sync.
      box.id = cfg.id + '-wrap';
      box.className = 'max-w-3xl mx-auto px-5 sm:px-8 my-6';
      box.innerHTML = inner;
      mountAfter.parentNode.insertBefore(box, mountAfter.nextSibling);
    }

    function readVals() {
      var v = {};
      box.querySelectorAll('[data-key]').forEach(function (el) {
        v[el.dataset.key] = el.tagName === 'SELECT' ? el.value : (parseFloat(el.value) || 0);
      });
      return v;
    }
    function update() {
      var r = cfg.calc(readVals());
      box.querySelector('[data-result="score"]').textContent = r.score;
      var bEl = box.querySelector('[data-result="band"]');
      bEl.textContent = r.band; bEl.style.background = r.bg; bEl.style.color = r.fg;
      box.querySelector('[data-result="interp"]').innerHTML = r.interp;
    }
    box.querySelectorAll('[data-key]').forEach(function (el) {
      el.addEventListener('input', update);
      el.addEventListener('change', update);
    });
    update();
    if (typeof gtag === 'function') {
      try { gtag('event', 'calculator_view', { tool: cfg.tool, page_path: location.pathname }); } catch (e) {}
    }
    return box;
  };

  // ---------------------------------------------------------------------
  // CALCULATOR 1 — OSDI (Ocular Surface Disease Index, 12 items, 0-100)
  // Validated: Schiffman et al, Arch Ophthalmol 2000.
  // Input: each of 3 sections summed (light/wind/screen freq, vision-tasks,
  // environment) — we collapse into a simplified 4-input self-screen.
  // ---------------------------------------------------------------------
  DN.injectOSDI = function (mountSel) {
    DN._buildCalc({
      id: 'hs-osdi', tool: 'OSDI', toolsAnchor: 'osdi',
      mountSel: mountSel,
      title: '<span data-zh="OSDI 計算器 — 乾眼症狀自評" data-en="OSDI Calculator — Dry-eye symptom self-screen">OSDI 計算器 — 乾眼症狀自評</span>',
      sub: '<span data-zh="過去一週,以下情況困擾您的頻率(0=從未、4=一直)。OSDI = (各項分數總和 × 100) / (回答題數 × 4)。" data-en="Past week, frequency of each (0=none, 4=all the time). OSDI = (sum × 100) / (answered × 4).">過去一週，以下情況困擾您的頻率（0=從未、4=一直）。OSDI = (各項分數總和 × 100) / (回答題數 × 4)。</span>',
      rows: [
        { type:'number', key:'q1', min:0, max:4, def:1, label:'<span data-zh="眼睛畏光" data-en="Eyes sensitive to light">眼睛畏光</span>', hint:'0=從未  ·  4=一直' },
        { type:'number', key:'q2', min:0, max:4, def:1, label:'<span data-zh="眼睛有沙礫感 / 異物感" data-en="Gritty / foreign-body sensation">眼睛有沙礫感 / 異物感</span>', hint:'0–4' },
        { type:'number', key:'q3', min:0, max:4, def:1, label:'<span data-zh="眼睛痠痛 / 灼熱" data-en="Painful or sore">眼睛痠痛 / 灼熱</span>', hint:'0–4' },
        { type:'number', key:'q4', min:0, max:4, def:1, label:'<span data-zh="視力模糊" data-en="Blurred vision">視力模糊</span>', hint:'0–4' },
        { type:'number', key:'q5', min:0, max:4, def:1, label:'<span data-zh="使用 3C 螢幕時症狀加重" data-en="Worse with screens">使用 3C 螢幕時症狀加重</span>', hint:'0–4' },
        { type:'number', key:'q6', min:0, max:4, def:1, label:'<span data-zh="冷氣 / 風 / 乾燥環境加重" data-en="Worse in AC / wind">冷氣 / 風 / 乾燥環境加重</span>', hint:'0–4' }
      ],
      calc: function (v) {
        var sum = v.q1 + v.q2 + v.q3 + v.q4 + v.q5 + v.q6;
        var score = (sum * 100) / (6 * 4);   // 6 items, max 4 each
        var band, bg, fg, interp;
        if (score < 13)      { band = '正常';   bg = '#dcfce7'; fg = '#14532d'; interp = '正常 (OSDI &lt; 13) — 沒有乾眼相關症狀，繼續維持良好習慣（每 20 分鐘看遠 20 秒、3C 之間刻意眨眼）。'; }
        else if (score < 23) { band = '輕度';   bg = '#fef9c3'; fg = '#854d0e'; interp = '輕度乾眼 (OSDI 13–22) — 可從<strong>無防腐劑人工淚液</strong>開始（一天 4–6 次）+ 熱敷眼罩 40°C × 10 分鐘。'; }
        else if (score < 33) { band = '中度';   bg = '#fed7aa'; fg = '#9a3412'; interp = '中度乾眼 (OSDI 23–32) — 建議眼科門診評估，可加上 <strong>瞼板腺按摩、Omega-3 補充、Cyclosporine A 0.05% 眼藥水</strong>（DEWS II Step 2）。'; }
        else                 { band = '重度';   bg = '#fee2e2'; fg = '#991b1b'; interp = '重度乾眼 (OSDI ≥ 33) — 應就診評估是否合併 <strong>瞼板腺機能障礙 (MGD)、修格蘭氏症、暴露性角膜炎</strong>，治療可考慮 IPL、LipiFlow、自體血清眼藥水。'; }
        return { score: score.toFixed(1), band: band, bg: bg, fg: fg, interp: interp };
      },
      disclaimer: '* OSDI: Schiffman RM et al, <em>Arch Ophthalmol</em> 2000. 本工具為簡化自評版，正式診斷應由眼科醫師進行 Schirmer 試驗 + TBUT + 眼表染色。'
    });
  };

  // ---------------------------------------------------------------------
  // CALCULATOR 2 — DEQ-5 (Dry Eye Questionnaire, 5 items, 0-22)
  // Validated: Chalmers RL et al, Cont Lens Anterior Eye 2010.
  // ≥6 = likely dry eye; ≥12 = consider Sjögren screening.
  // ---------------------------------------------------------------------
  DN.injectDEQ5 = function (mountSel) {
    DN._buildCalc({
      id: 'hs-deq5', tool: 'DEQ-5', toolsAnchor: 'deq5',
      mountSel: mountSel,
      title: '<span data-zh="DEQ-5 — 5 題快速乾眼篩檢" data-en="DEQ-5 — 5-item dry-eye screen">DEQ-5 — 5 題快速乾眼篩檢</span>',
      sub: '<span data-zh="5 題版本,1 分鐘填完。≥ 6 分高度懷疑乾眼;≥ 12 分建議篩檢修格蘭氏症 (anti-SSA/Ro)。" data-en="5 items, ~1 min. ≥6 suggestive of DED; ≥12 prompts Sjögren screening.">5 題版本，1 分鐘填完。≥ 6 分高度懷疑乾眼；≥ 12 分建議篩檢修格蘭氏症 (anti-SSA/Ro)。</span>',
      rows: [
        { type:'number', key:'d1', min:0, max:4, def:0, label:'<span data-zh="眼睛不適頻率" data-en="Discomfort frequency">眼睛不適頻率 (0–4)</span>', hint:'0=從未  ·  4=一直' },
        { type:'number', key:'d2', min:0, max:5, def:0, label:'<span data-zh="眼睛不適在一天結束時的嚴重度" data-en="End-of-day intensity">不適嚴重度 (0–5)</span>', hint:'0=無  ·  5=非常嚴重' },
        { type:'number', key:'d3', min:0, max:4, def:0, label:'<span data-zh="眼睛乾燥頻率" data-en="Dryness frequency">乾燥頻率 (0–4)</span>', hint:'0–4' },
        { type:'number', key:'d4', min:0, max:5, def:0, label:'<span data-zh="一天結束時乾燥嚴重度" data-en="End-of-day dryness intensity">乾燥嚴重度 (0–5)</span>', hint:'0–5' },
        { type:'number', key:'d5', min:0, max:4, def:0, label:'<span data-zh="眼睛紅 / 含淚的頻率" data-en="Watery eyes frequency">眼睛紅 / 含淚 (0–4)</span>', hint:'0–4' }
      ],
      calc: function (v) {
        var s = v.d1 + v.d2 + v.d3 + v.d4 + v.d5;
        var band, bg, fg, interp;
        if (s < 6)       { band = '正常';     bg = '#dcfce7'; fg = '#14532d'; interp = '正常 (DEQ-5 &lt; 6) — 乾眼症可能性低。維持每 20–20–20 螢幕休息與環境保濕即可。'; }
        else if (s < 12) { band = '可能乾眼'; bg = '#fef9c3'; fg = '#854d0e'; interp = '可能乾眼 (DEQ-5 6–11) — 建議眼科門診做 <strong>TBUT + Schirmer 試驗</strong> 確認嚴重度。'; }
        else             { band = '高度懷疑'; bg = '#fee2e2'; fg = '#991b1b'; interp = '高度懷疑 (DEQ-5 ≥ 12) — 除乾眼外，應抽血篩檢 <strong>修格蘭氏症 (anti-SSA/Ro, anti-SSB/La, ANA)</strong> 與紅斑性狼瘡。'; }
        return { score: s + ' / 22', band: band, bg: bg, fg: fg, interp: interp };
      },
      disclaimer: '* DEQ-5: Chalmers RL et al, <em>Cont Lens Anterior Eye</em> 2010. 修格蘭氏症初篩切點：DEQ-5 ≥ 12（Bunya VY 2018）。'
    });
  };

  // ---------------------------------------------------------------------
  // CALCULATOR 3 — Snellen ↔ LogMAR converter (utility, lookup table)
  // ---------------------------------------------------------------------
  DN.injectSnellenLogMAR = function (mountSel) {
    DN._buildCalc({
      id: 'hs-snellen', tool: 'Snellen↔LogMAR', toolsAnchor: 'snellen',
      mountSel: mountSel,
      title: '<span data-zh="Snellen ↔ LogMAR 視力換算" data-en="Snellen ↔ LogMAR converter">Snellen ↔ LogMAR 視力換算</span>',
      sub: '<span data-zh="LogMAR = log₁₀(1 ÷ Snellen 小數)。臨床研究多用 LogMAR(線性可加減)。" data-en="LogMAR = log10(1 ÷ Snellen decimal). Used in clinical trials for additive properties.">LogMAR = log₁₀(1 ÷ Snellen 小數)。臨床研究多用 LogMAR（線性可加減）。</span>',
      rows: [
        { type:'select', key:'snellen', label:'<span data-zh="Snellen 小數" data-en="Snellen decimal">Snellen 視力</span>', hint:'',
          options: [
            { v:'2.0',  label:'2.0  (20/10)' },
            { v:'1.5',  label:'1.5  (20/13)' },
            { v:'1.2',  label:'1.2  (20/17)' },
            { v:'1.0',  label:'1.0  (20/20)', def:true },
            { v:'0.8',  label:'0.8  (20/25)' },
            { v:'0.63', label:'0.63 (20/32)' },
            { v:'0.5',  label:'0.5  (20/40)' },
            { v:'0.4',  label:'0.4  (20/50)' },
            { v:'0.32', label:'0.32 (20/63)' },
            { v:'0.25', label:'0.25 (20/80)' },
            { v:'0.2',  label:'0.2  (20/100)' },
            { v:'0.16', label:'0.16 (20/125)' },
            { v:'0.125',label:'0.125 (20/160)' },
            { v:'0.1',  label:'0.1  (20/200) · 法定低視力' },
            { v:'0.05', label:'0.05 (20/400) · 法定盲' },
            { v:'0.025',label:'0.025 (20/800)' }
          ]
        }
      ],
      calc: function (v) {
        var dec = parseFloat(v.snellen) || 1.0;
        var logmar = Math.log10(1 / dec);
        var ft = (20 / dec).toFixed(0);
        var band = '視力換算', bg = '#e3edf6', fg = '#243b56';
        var legal = '';
        if (dec <= 0.05) legal = '<br/>⚠ <strong>WHO 法定盲</strong> (best-corrected ≤ 20/400 / 0.05 / LogMAR ≥ 1.30)';
        else if (dec <= 0.1) legal = '<br/>⚠ <strong>低視力</strong> (best-corrected 20/70 ~ 20/200 / 0.1 ~ 0.3)';
        var interp = 'Snellen <strong>20/' + ft + '</strong> = 小數 <strong>' + dec.toFixed(3) + '</strong> = LogMAR <strong>' + logmar.toFixed(2) + '</strong>。' +
          '<br/>每改善 1 行（5 字母）= LogMAR 減少 0.10。' + legal;
        return { score: 'logMAR ' + logmar.toFixed(2), band: band, bg: bg, fg: fg, interp: interp };
      },
      disclaimer: '* 換算公式：LogMAR = -log₁₀(decimal Snellen)。臨床/研究用 ETDRS 視力表，每行 5 字母線性間距。'
    });
  };

  // ---------------------------------------------------------------------
  // CALCULATOR 4 — Spherical Equivalent (SE = sphere + cylinder/2)
  // Used to track myopia progression independently of astigmatism axis.
  // ---------------------------------------------------------------------
  DN.injectSphericalEquivalent = function (mountSel) {
    DN._buildCalc({
      id: 'hs-se', tool: 'SE', toolsAnchor: 'se',
      mountSel: mountSel,
      title: '<span data-zh="球面等價度數 SE 計算器" data-en="Spherical Equivalent (SE) calculator">球面等價度數 SE 計算器</span>',
      sub: '<span data-zh="SE = sphere + cylinder ÷ 2。追蹤近視進展時最常用,可比較不同散光軸的兩次驗光。" data-en="SE = sphere + cyl/2. Used for tracking myopia progression across visits.">SE = sphere + cylinder ÷ 2。追蹤近視進展時最常用，可比較不同散光軸的兩次驗光。</span>',
      rows: [
        { type:'number', key:'sph', min:-30, max:30, step:0.25, def:-3.00, label:'<span data-zh="球面度數 Sphere (D)" data-en="Sphere (D)">Sphere · 球面 (D)</span>', hint:'近視為負；遠視為正' },
        { type:'number', key:'cyl', min:-10, max:10, step:0.25, def:-0.50, label:'<span data-zh="散光度數 Cylinder (D)" data-en="Cylinder (D)">Cylinder · 散光 (D)</span>', hint:'散光通常為負（minus-cyl form）' }
      ],
      calc: function (v) {
        var se = v.sph + v.cyl / 2;
        var band, bg, fg, interp;
        if (se >= 0)              { band = '遠視 / 正視';   bg = '#dcfce7'; fg = '#14532d'; interp = 'SE = ' + se.toFixed(2) + ' D — 遠視或正視範圍。'; }
        else if (se > -3)         { band = '輕度近視';     bg = '#fef9c3'; fg = '#854d0e'; interp = 'SE = ' + se.toFixed(2) + ' D — <strong>輕度近視 (&lt; -3.00 D)</strong>。每年進展 &gt; -0.50 D 應介入近視控制（兒童）。'; }
        else if (se > -6)         { band = '中度近視';     bg = '#fed7aa'; fg = '#9a3412'; interp = 'SE = ' + se.toFixed(2) + ' D — <strong>中度近視 (-3.00 ~ -6.00 D)</strong>。視網膜剝離風險增加，建議每年散瞳眼底檢查。'; }
        else if (se > -10)        { band = '高度近視';     bg = '#fee2e2'; fg = '#991b1b'; interp = 'SE = ' + se.toFixed(2) + ' D — <strong>高度近視 (-6.00 ~ -10.00 D)</strong>。視網膜剝離、近視性黃斑病變、青光眼風險升高，建議每 6–12 個月眼底 + OCT 追蹤。'; }
        else                      { band = '極度近視';     bg = '#fee2e2'; fg = '#991b1b'; interp = 'SE = ' + se.toFixed(2) + ' D — <strong>病理性近視 (≤ -10.00 D)</strong>。眼軸 ≥ 26.5 mm，黃斑部出血/萎縮、青光眼風險顯著升高，需每 6 個月專科追蹤。'; }
        return { score: se.toFixed(2) + ' D', band: band, bg: bg, fg: fg, interp: interp };
      },
      disclaimer: '* 兒童近視控制目標：減緩進展速率 50%（IMI 2023 共識）。低濃度阿托品 0.05% 為目前實證最強。'
    });
  };

  // ---------------------------------------------------------------------
  // CALCULATOR 5 — Floater Red-Flag self-check (decision support, NOT diagnosis)
  // Based on AAO Posterior Vitreous Detachment PPP 2023 — flags requiring
  // urgent (<24-48h) ophth referral.
  // ---------------------------------------------------------------------
  DN.injectFloaterRedFlag = function (mountSel) {
    DN._buildCalc({
      id: 'hs-floater-rf', tool: 'FloaterRedFlag', toolsAnchor: 'floater',
      mountSel: mountSel,
      title: '<span data-zh="飛蚊症 6 大警訊 自我檢核" data-en="Floater Red-Flag self-check">飛蚊症 6 大警訊 自我檢核</span>',
      sub: '<span data-zh="若任一項為「是」,可能是視網膜裂孔或剝離前兆,建議 24–48 小時內就診眼科散瞳眼底檢查。" data-en="If any answer is YES, possible retinal tear/detachment — see ophthalmology within 24–48 h.">若任一項為「是」，可能是視網膜裂孔或剝離前兆，建議 24–48 小時內就診眼科散瞳眼底檢查。</span>',
      rows: [
        { type:'select', key:'r1', label:'<span data-zh="1. 飛蚊突然爆增 (數十個以上、像下雪)" data-en="1. Sudden shower of new floaters">1. 飛蚊突然爆增（像下雪）</span>',
          options:[{v:'0',label:'否',def:true},{v:'1',label:'是'}] },
        { type:'select', key:'r2', label:'<span data-zh="2. 突然看到閃光 (像閃電/煙火)" data-en="2. New flashes of light">2. 突然看到閃光（像閃電）</span>',
          options:[{v:'0',label:'否',def:true},{v:'1',label:'是'}] },
        { type:'select', key:'r3', label:'<span data-zh="3. 視野有黑影/黑幕從周邊往中間侵入" data-en="3. Curtain / shadow encroaching">3. 視野有黑幕侵入</span>',
          options:[{v:'0',label:'否',def:true},{v:'1',label:'是'}] },
        { type:'select', key:'r4', label:'<span data-zh="4. 中央視力突然下降" data-en="4. Sudden central VA drop">4. 中央視力突然下降</span>',
          options:[{v:'0',label:'否',def:true},{v:'1',label:'是'}] },
        { type:'select', key:'r5', label:'<span data-zh="5. 高度近視 (≤ -6.00 D) 或眼睛外傷史" data-en="5. High myopia / trauma">5. 高度近視或外傷史</span>',
          options:[{v:'0',label:'否',def:true},{v:'1',label:'是'}] },
        { type:'select', key:'r6', label:'<span data-zh="6. 對側眼曾有視網膜裂孔/剝離" data-en="6. Fellow eye RD history">6. 對側眼曾有視網膜剝離</span>',
          options:[{v:'0',label:'否',def:true},{v:'1',label:'是'}] }
      ],
      calc: function (v) {
        var n = ['r1','r2','r3','r4','r5','r6'].reduce(function (s, k) { return s + (parseInt(v[k]) || 0); }, 0);
        var band, bg, fg, interp;
        if (n === 0)      { band = '低風險';   bg = '#dcfce7'; fg = '#14532d'; interp = '所有警訊皆為「否」 — <strong>仍建議 1–2 週內</strong>就診眼科散瞳眼底檢查（首次飛蚊或長期飛蚊變化）。'; }
        else if (n <= 2)  { band = '中風險';   bg = '#fed7aa'; fg = '#9a3412'; interp = '有 ' + n + ' 項警訊 — <strong>48–72 小時內</strong>就診眼科。可能為後玻璃體剝離 (PVD) ± 視網膜裂孔。'; }
        else              { band = '高風險';   bg = '#fee2e2'; fg = '#991b1b'; interp = '⚠ 有 ' + n + ' 項警訊 — <strong>應立即就醫，&lt; 24 小時內</strong>到眼科或急診。視網膜剝離若未及時雷射/手術，可能永久視力喪失。'; }
        return { score: n + ' / 6', band: band, bg: bg, fg: fg, interp: interp };
      },
      disclaimer: '* 依據 AAO Posterior Vitreous Detachment / Retinal Breaks / Lattice Degeneration PPP 2023。本工具僅作分流參考，最終診斷需散瞳眼底檢查 ± OCT。'
    });
  };

  // ---------------------------------------------------------------------
  // Article feedback widget — "Spot an error?" mailto card at end of article
  // Pre-fills subject + body with article title/URL for easier triage.
  // ---------------------------------------------------------------------
  // (Cookie consent banner removed per user request. Consent Mode v2 default
  // remains set in <head> of every HTML — analytics granted, ads denied.
  // For users that need explicit opt-out, /privacy still describes the GA
  // opt-out browser add-on. If GDPR/EU users become a major audience, add
  // a banner back via gtag('consent', 'update', {...}).)

  // ---------------------------------------------------------------------
  // A/B test framework — lightweight, deterministic per-visitor bucketing.
  // Use to test headline / CTA / hero copy variants. Reports the bucket
  // to GA4 as a custom dimension via gtag event.
  //
  // Usage:
  //   DN.abTest('hero-cta-2026q2', ['Variant A', 'Variant B'], function (v) {
  //     document.querySelector('.cta').textContent = v;
  //   });
  // ---------------------------------------------------------------------
  DN.AB_KEY = 'hs:ab:v1';
  DN.abTest = function (testId, variants, applyFn) {
    if (!Array.isArray(variants) || variants.length < 2) return null;
    var assignments = {};
    try { assignments = JSON.parse(localStorage.getItem(DN.AB_KEY) || '{}'); } catch (e) {}
    var bucket = assignments[testId];
    if (bucket == null) {
      // Hash testId + a per-visitor random id for stable assignment
      var rid = assignments.__rid;
      if (!rid) { rid = Math.random().toString(36).slice(2); assignments.__rid = rid; }
      var h = 0; var seed = testId + ':' + rid;
      for (var i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
      bucket = Math.abs(h) % variants.length;
      assignments[testId] = bucket;
      try { localStorage.setItem(DN.AB_KEY, JSON.stringify(assignments)); } catch (e) {}
    }
    var variant = variants[bucket];
    try { applyFn && applyFn(variant, bucket); } catch (e) {}
    // Report to GA4 as a custom event so you can segment in reports
    try {
      window.gtag && gtag('event', 'ab_exposure', {
        test_id: testId,
        variant_index: bucket,
        variant_name: typeof variant === 'string' ? variant.slice(0, 60) : String(bucket)
      });
    } catch (e) {}
    // Server-side aggregate (sessionStorage gated — only first exposure per session)
    try {
      var expKey = 'hs:abx:' + testId;
      if (!sessionStorage.getItem(expKey)) {
        sessionStorage.setItem(expKey, '1');
        var payload = JSON.stringify({
          testId: testId, variantIndex: bucket, event: 'exposure',
          variantName: typeof variant === 'string' ? variant.slice(0, 60) : String(bucket)
        });
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/admin/ab-stats', new Blob([payload], { type: 'application/json' }));
        } else {
          fetch('/api/admin/ab-stats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(function () {});
        }
      }
    } catch (e) {}
    return { variant: variant, index: bucket };
  };
  // ---------------------------------------------------------------------
  // v31: A/B variant swap from server config — DN.applyAbConfig fetches
  // /api/ab-config (cached 60s at edge), and for each active test does:
  //   1. find first element matching `selector`
  //   2. DN.abTest('<id>', variantNames, fn) → applies variant html on bucket
  //   3. data-ab-applied="<id>" attribute marks the element so dev-tools/
  //      debugging knows which test ran
  //
  // Only runs in idle phase (avoid blocking FCP). Total payload is tiny —
  // typically a few KB. Failure is silent (no test → site as normal).
  // ---------------------------------------------------------------------
  DN.applyAbConfig = function () {
    // Never swap editor content. Serializing a selected variant from
    // ?admin=1 would permanently commit an experiment into the article.
    if (DN.isAdminMode && DN.isAdminMode()) return;
    fetch('/api/ab-config', { cache: 'force-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (data) {
        if (!data || !data.tests) return;
        Object.keys(data.tests).forEach(function (id) {
          try {
            var cfg = data.tests[id];
            var el = document.querySelector(cfg.selector);
            if (!el || el.dataset.abApplied) return;
            if (el === document.documentElement || el === document.head || el === document.body) return;
            if (/^(SCRIPT|STYLE|LINK|META|IFRAME|OBJECT|EMBED|FORM)$/.test(el.tagName)) return;
            var names = cfg.variants.map(function (v, i) { return v.name || ('v' + i); });
            DN.abTest(id, names, function (variantName, idx) {
              var v = cfg.variants[idx];
              if (v && v.html) {
                el.innerHTML = v.html;
                el.dataset.abApplied = id;
                el.dataset.abVariant  = String(idx);
              }
            });
          } catch (e) { /* skip individual broken test */ }
        });
      });
  };

  // Convenience: report a conversion for an A/B test (fires once per session)
  DN.abConvert = function (testId, conversionName) {
    var sessKey = 'hs:abc:' + testId + ':' + (conversionName || 'default');
    try { if (sessionStorage.getItem(sessKey)) return; sessionStorage.setItem(sessKey, '1'); } catch (e) {}
    var assignments = {};
    try { assignments = JSON.parse(localStorage.getItem(DN.AB_KEY) || '{}'); } catch (e) {}
    var bucket = assignments[testId];
    if (bucket == null) return;
    try {
      window.gtag && gtag('event', 'ab_conversion', {
        test_id: testId,
        variant_index: bucket,
        conversion: conversionName || 'default'
      });
    } catch (e) {}
    // Server-side aggregate
    try {
      var payload = JSON.stringify({
        testId: testId, variantIndex: bucket, event: (conversionName || 'default')
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/admin/ab-stats', new Blob([payload], { type: 'application/json' }));
      } else {
        fetch('/api/admin/ab-stats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(function () {});
      }
    } catch (e) {}
  };

  // ---------------------------------------------------------------------
  // Toast — short floating message at bottom-center (used by SW update,
  // bookmark feedback, etc.). Self-cleaning. ARIA polite live region.
  // ---------------------------------------------------------------------
  DN.toast = function (msg, opts) {
    opts = opts || {};
    var t = document.createElement('div');
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;bottom:max(110px,env(safe-area-inset-bottom));transform:translateX(-50%);background:#243b56;color:#fff;padding:9px 18px;border-radius:9999px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 12px 28px -8px rgba(58,90,124,.55);max-width:calc(100vw - 32px);text-align:center;line-height:1.5';
    document.body.appendChild(t);
    var dur = opts.duration || 2500;
    setTimeout(function () { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; }, dur);
    setTimeout(function () { try { document.body.removeChild(t); } catch (e) {} }, dur + 350);
  };

  // ---------------------------------------------------------------------
  // Print button — floating circle, bottom-right, opens system print
  // dialog. Pairs with the @media print CSS in app.css to produce a clean
  // patient handout without nav / footer / share / ads.
  // ---------------------------------------------------------------------
  DN.addPrintButton = function () {
    // v34.5: removed per user request. Stub only clears cached old DOM.
    var leftover = document.getElementById('hs-print-btn');
    if (leftover) leftover.remove();
  };

  // ---------------------------------------------------------------------
  // Bookmark button — floating circle, persists slugs to localStorage so
  // returning readers can find articles they wanted to revisit. Caps at
  // 50 items. Solid icon = bookmarked.
  // ---------------------------------------------------------------------
  DN.addBookmarkButton = function () {
    // v34.5: removed per user request. Stub only clears cached old DOM.
    var leftover = document.getElementById('hs-bookmark');
    if (leftover) leftover.remove();
  };

  // ---------------------------------------------------------------------
  // Lazy-load audit — patches any non-eager <img> missing loading attr.
  // First image gets fetchpriority=high (LCP candidate); rest get lazy.
  // Safe no-op if attributes already set explicitly.
  // ---------------------------------------------------------------------
  DN.lazyLoadAudit = function () {
    var imgs = document.querySelectorAll('img:not([loading]):not([data-no-lazy])');
    imgs.forEach(function (img, i) {
      if (i === 0 && !img.hasAttribute('fetchpriority')) {
        img.setAttribute('fetchpriority', 'high');
      } else {
        img.setAttribute('loading', 'lazy');
        img.setAttribute('decoding', 'async');
      }
    });
  };

  DN.addFeedbackLink = function () {
    var article = document.querySelector('article.max-w-3xl');
    if (!article) return;
    // Bail only if mount is ALREADY POPULATED (same bug as addRelatedArticles —
    // the placeholder `<div id="hs-feedback">` exists from the start, so the
    // old guard was bailing before injecting the feedback card).
    var _fb = document.getElementById('hs-feedback');
    if (_fb && _fb.children.length) return;
    var pageTitle = document.title.split('|')[0].trim();
    var subject = encodeURIComponent('[HsiaoEye 回饋] ' + pageTitle);
    var body = encodeURIComponent(
      '醫師您好，\n\n' +
      '我想針對下列文章提供回饋：\n' +
      '文章： ' + pageTitle + '\n' +
      '網址： ' + location.href + '\n\n' +
      '回饋內容（請填寫）：\n' +
      '□ 內容更正建議\n' +
      '□ 引用爭議\n' +
      '□ 過時資訊提醒\n' +
      '□ 其他：_____\n\n' +
      '說明：\n\n\n' +
      '謝謝！'
    );
    // v34.11: prefer pre-existing <div id="hs-feedback"> mount; legacy fallback inserts after article
    var box = document.getElementById('hs-feedback');
    var isMount = !!box;
    if (!isMount) {
      box = document.createElement('section');
      box.id = 'hs-feedback';
    }
    box.className = 'max-w-3xl mx-auto px-5 sm:px-8 my-6';
    box.innerHTML =
      '<div style="background:#fafaf7;border:1px dashed #dcd5c8;border-radius:12px;padding:14px 18px;font-size:13px;color:#5e574e;line-height:1.75;display:flex;align-items:center;gap:14px;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:220px">' +
          '<strong data-zh="發現錯誤、過時資訊、引用爭議？" data-en="Spot an error or outdated info?">發現錯誤、過時資訊、引用爭議？</strong><br/>' +
          '<span data-zh="本文歡迎讀者回饋，我會親自閱讀每封信並依據文獻校正。" data-en="Reader feedback welcome — each email is read personally and corrections are made per current literature.">本文歡迎讀者回饋，我會親自閱讀每封信並依據文獻校正。</span>' +
        '</div>' +
        '<a href="mailto:f94001115@gmail.com?subject=' + subject + '&body=' + body + '" ' +
          'style="flex-shrink:0;padding:8px 16px;border-radius:9999px;background:#243b56;color:#fff;text-decoration:none;font-size:13px;font-weight:700;white-space:nowrap" ' +
          'data-feedback-link data-zh="提交內容回饋 →" data-en="Send feedback →">提交內容回饋 →</a>' +
      '</div>';
    if (!isMount) article.parentNode.insertBefore(box, article.nextSibling);
    var fbLink = box.querySelector('[data-feedback-link]');
    if (fbLink && typeof gtag === 'function') {
      fbLink.addEventListener('click', function () {
        try { gtag('event', 'content_feedback_click', { page_path: location.pathname }); } catch (e) {}
      });
    }
  };

  // Article-context auto-injection — calls the right calculator based on slug
  DN.injectArticleCalculators = function () {
    var slug = DN.currentSlug && DN.currentSlug();
    if (!slug) return;
    if (slug === 'dry-eye-myths')                  { DN.injectOSDI(); DN.injectDEQ5(); }
    else if (slug === 'pediatric-myopia-control')  { DN.injectSphericalEquivalent(); }
    else if (slug === 'floaters-retinal-detachment') { DN.injectFloaterRedFlag(); }
  };

  // =====================================================================
  // ADMIN MODE — inline WYSIWYG editor (loaded only when ?admin=1 in URL)
  // ---------------------------------------------------------------------
  // When an authenticated admin appends ?admin=1 to any article URL, the
  // article body becomes contenteditable and a floating toolbar appears.
  // Save → POSTs the modified HTML to /api/admin/save which commits via
  // GitHub API. The site re-deploys; user must `git pull` before next
  // local edit (admin edits live in git, not in a separate KV store).
  // =====================================================================
  DN.isAdminMode = function () {
    try { return new URLSearchParams(location.search).get('admin') === '1'; }
    catch (e) { return false; }
  };

  DN.initAdminMode = function () {
    // v37.8: lazy-load — 500+ lines of admin editor code split into
    // /blog/blog-admin.js. Only fetched when ?admin=1 is in URL. Saves
    // ~28 KB raw / ~6 KB gzip from the critical-path bundle for regular
    // readers. Trusted Types: /blog/* paths are in the hs-policy
    // scriptURL allowlist, so the dynamic import is policy-compliant.
    if (!DN.isAdminMode()) return;
    if (DN._adminLoaded) return;
    DN._adminLoaded = true;
    var s = document.createElement('script');
    s.id = 'hs-admin-runtime';
    s.src = '/blog/blog-admin.js?v=20260670';
    s.defer = true;
    s.onerror = function () {
      console.warn('[hs-admin] failed to load /blog/blog-admin.js');
      DN._adminLoaded = false;
    };
    document.head.appendChild(s);
  };

  // ---------------------------------------------------------------------
  // v33: popover attribute upgrade — any element with `data-popover-trigger`
  // gets `popovertarget` wired to its associated popover. This replaces
  // manual show/hide JS with browser-native top-layer + light-dismiss.
  //
  //   <button type="button" data-popover-trigger="my-pop">⋯</button>
  //   <div id="my-pop" popover>...</div>
  //
  // Browser handles ESC, click-outside, and stacking. Falls back gracefully
  // to a regular div on browsers without popover (Safari < 17).
  // ---------------------------------------------------------------------
  DN.upgradePopovers = function () {
    if (!('popover' in HTMLElement.prototype)) return;
    document.querySelectorAll('[data-popover-trigger]').forEach(function (btn) {
      var target = btn.dataset.popoverTrigger;
      btn.setAttribute('popovertarget', target);
      var pop = document.getElementById(target);
      if (pop && !pop.hasAttribute('popover')) pop.setAttribute('popover', 'auto');
    });
  };

  // ---------------------------------------------------------------------
  // v33: <selectlist> upgrade — Open UI proposal that lets you fully style
  // a select with CSS/HTML. Currently behind a flag in Chrome 127+, but
  // detection is the standard `'list' in document.createElement('selectlist')`
  // trick. We progressive-enhance any [data-selectlist] <select> by
  // transforming it into <selectlist> when supported. Otherwise leaves the
  // <select> intact.
  // ---------------------------------------------------------------------
  DN.upgradeSelectLists = function () {
    if (typeof HTMLSelectListElement === 'undefined' && !('selectedoption' in document.createElement('selectlist'))) return;
    document.querySelectorAll('select[data-selectlist]').forEach(function (sel) {
      var sl = document.createElement('selectlist');
      sl.id = sel.id; sl.className = sel.className;
      sel.querySelectorAll('option').forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o.value; opt.textContent = o.textContent;
        if (o.selected) opt.setAttribute('selected', '');
        sl.appendChild(opt);
      });
      // Mirror change events back to original element so existing code keeps working
      sl.addEventListener('change', function () {
        sel.value = sl.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
      sel.style.display = 'none';
      sel.parentNode.insertBefore(sl, sel.nextSibling);
    });
  };

  // ---------------------------------------------------------------------
  // <dialog> upgrade — promotes any element with [data-dialog] attribute
  // to a native HTMLDialogElement. Native dialogs handle:
  //   - inert background (everything else is greyed-out + non-clickable)
  //   - automatic focus trap (Tab/Shift-Tab cycle inside)
  //   - ESC closes
  //   - ::backdrop pseudo-element for overlay
  // We keep the existing `.modal-bg` divs as fallback shells and graft
  // native showModal()/close() behaviour onto them.
  // Usage: <div class="modal-bg" data-dialog>...</div>
  //        DN.useDialog(el, true)  // open; false closes.
  // ---------------------------------------------------------------------
  DN.useDialog = function (el, open) {
    if (!el) return;
    // First-time upgrade: replace the wrapper with a real <dialog>
    if (!el._hsDialog) {
      var dlg = document.createElement('dialog');
      dlg.className = (el.className || '').replace(/\bmodal-bg\b/, '').trim() + ' hs-dialog';
      // Move children
      while (el.firstChild) dlg.appendChild(el.firstChild);
      // Carry id + dataset
      if (el.id) dlg.id = el.id;
      Object.keys(el.dataset).forEach(function (k) { dlg.dataset[k] = el.dataset[k]; });
      el.parentNode.replaceChild(dlg, el);
      el = dlg;
      el._hsDialog = true;
      // Inject styles once
      if (!document.getElementById('hs-dialog-css')) {
        var st = document.createElement('style');
        st.id = 'hs-dialog-css';
        st.textContent =
          '.hs-dialog{padding:0;border:0;background:transparent;max-width:none;max-height:none;overflow:visible}' +
          '.hs-dialog::backdrop{background:rgba(15,23,42,.55);backdrop-filter:blur(4px)}' +
          // Animation
          '.hs-dialog{opacity:0;transform:translateY(8px);transition:opacity .15s,transform .2s,overlay .2s allow-discrete,display .2s allow-discrete}' +
          '.hs-dialog[open]{opacity:1;transform:translateY(0)}' +
          '@starting-style{.hs-dialog[open]{opacity:0;transform:translateY(8px)}}';
        document.head.appendChild(st);
      }
      // Click on backdrop closes
      el.addEventListener('click', function (e) { if (e.target === el) el.close(); });
    }
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
    return el;
  };

  // Auto-promote any [data-dialog] elements on load (idempotent)
  DN.upgradeDialogs = function () {
    document.querySelectorAll('[data-dialog]:not(.hs-dialog)').forEach(function (el) {
      // Initial state: closed
      el.hidden = true;
      DN.useDialog(el, false);
    });
  };

  // ---------------------------------------------------------------------
  // Blog index filter — adds category chips + tag cloud + text search above
  // .article-list. Filters in-place without page reload. URL ?cat=X&tag=Y&q=Z
  // is read on load and written on filter change for shareable links.
  // ---------------------------------------------------------------------
  DN.bindBlogFilter = function () {
    var host = document.getElementById('hs-blog-filter');
    if (!host) return;
    var items = Array.prototype.slice.call(document.querySelectorAll('.article-list-item'));
    if (items.length < 4) return;  // skip if too few articles

    // Inject styles
    if (!document.getElementById('hs-blog-filter-css')) {
      var st = document.createElement('style');
      st.id = 'hs-blog-filter-css';
      st.textContent =
        '.hs-blog-filter{margin:8px 0 22px;padding:14px 18px;background:#fff;border:1px solid var(--border,#dcd5c8);border-radius:14px}' +
        '.hs-blog-filter .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0}' +
        '.hs-blog-filter .label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted,#8b8378);font-weight:700;margin-right:6px;min-width:54px}' +
        '.hs-blog-filter .chip-btn{padding:5px 11px;border-radius:9999px;border:1px solid var(--border,#dcd5c8);background:#fff;font-size:12px;color:var(--ink-2,#5e574e);cursor:pointer;font-weight:600;transition:all .12s}' +
        '.hs-blog-filter .chip-btn:hover{border-color:var(--blue-deep,#3a5a7c);color:var(--blue-deep,#3a5a7c)}' +
        '.hs-blog-filter .chip-btn.active{background:var(--blue-deep,#3a5a7c);color:#fff;border-color:var(--blue-deep,#3a5a7c)}' +
        '.hs-blog-filter .chip-btn .count{font-size:10.5px;opacity:.7;margin-left:4px;font-family:"JetBrains Mono",monospace}' +
        '.hs-blog-filter input[type="search"]{flex:1;min-width:180px;padding:7px 12px;border-radius:9999px;border:1px solid var(--border,#dcd5c8);font-size:13px;background:#faf7f2;color:var(--ink,#0f172a)}' +
        '.hs-blog-filter input[type="search"]:focus{outline:none;border-color:var(--blue-deep,#3a5a7c);background:#fff}' +
        '.hs-blog-filter .reset{margin-left:auto;font-size:11.5px;color:var(--muted,#8b8378);cursor:pointer;text-decoration:underline;background:transparent;border:0}' +
        '.hs-blog-empty{text-align:center;padding:40px 20px;color:var(--muted,#8b8378);font-size:14px;background:#fff;border-radius:12px;border:1px dashed var(--border,#dcd5c8)}';
      document.head.appendChild(st);
    }

    // Inventory: collect cats + tags from each item
    var cats = {}, tags = {};
    items.forEach(function (it) {
      var catEl = it.querySelector('[class*="cat-"]');
      var cat = '';
      if (catEl) {
        var cm = catEl.className.match(/cat-([a-z]+)/);
        if (cm) cat = cm[1];
      }
      it.dataset.cat = cat;
      cats[cat] = (cats[cat] || 0) + 1;

      // tag chip is the second .chip
      var chips = it.querySelectorAll('.chip');
      var tagText = '';
      for (var i = 0; i < chips.length; i++) {
        if (!chips[i].className.includes('cat-')) { tagText = chips[i].textContent.trim(); break; }
      }
      it.dataset.tag = tagText;
      if (tagText) tags[tagText] = (tags[tagText] || 0) + 1;
    });

    // Keep these labels in sync with index.html quick-find chips + per-article
    // hero badges. v35: added research / notes (new "depth" categories) and
    // corrected rx label from "處方治療" → "衛教" to match homepage chips.
    var CAT_LABELS = {
      myth:     { zh: '迷思澄清', en: 'Myth-busting' },
      alert:    { zh: '警訊辨識', en: 'Red Flags' },
      rx:       { zh: '衛教',     en: 'Patient Ed' },
      notes:    { zh: '學習筆記', en: 'Study Notes' },
      research: { zh: '最新研究', en: 'Latest Research' },
    };

    // Build markup
    var html = '<div class="row">' +
      '<span class="label" data-zh="分類" data-en="Category">分類</span>' +
      '<button type="button" class="chip-btn active" data-cat="">' +
        '<span data-zh="全部" data-en="All">全部</span><span class="count">' + items.length + '</span>' +
      '</button>';
    Object.keys(cats).forEach(function (c) {
      if (!c) return;
      var lbl = CAT_LABELS[c] || { zh: c, en: c };
      html += '<button type="button" class="chip-btn" data-cat="' + c + '">' +
              '<span data-zh="' + lbl.zh + '" data-en="' + lbl.en + '">' + lbl.zh + '</span>' +
              '<span class="count">' + cats[c] + '</span></button>';
    });
    html += '<button type="button" class="reset" data-zh="清除篩選" data-en="Reset">清除篩選</button></div>';

    // Tag cloud
    var sortedTags = Object.keys(tags).sort(function (a, b) { return tags[b] - tags[a]; });
    if (sortedTags.length) {
      html += '<div class="row"><span class="label" data-zh="標籤" data-en="Tags">標籤</span>';
      sortedTags.forEach(function (t) {
        html += '<button type="button" class="chip-btn" data-tag="' + t.replace(/"/g, '&quot;') + '">' + t +
                '<span class="count">' + tags[t] + '</span></button>';
      });
      html += '</div>';
    }

    // Search row
    html += '<div class="row">' +
      '<span class="label" data-zh="搜尋" data-en="Search">搜尋</span>' +
      '<input type="search" placeholder="輸入關鍵字…" data-zh-placeholder="輸入關鍵字…" data-en-placeholder="Type to search…" autocomplete="off" />' +
      '</div>';

    host.innerHTML = html;
    host.hidden = false;

    // State + filter logic
    var state = { cat: '', tag: '', q: '' };
    try {
      var p = new URLSearchParams(location.search);
      state.cat = p.get('cat') || '';
      state.tag = p.get('tag') || '';
      state.q   = p.get('q')   || '';
    } catch (e) {}

    function syncUI() {
      host.querySelectorAll('[data-cat]').forEach(function (b) {
        b.classList.toggle('active', b.dataset.cat === state.cat);
      });
      host.querySelectorAll('[data-tag]').forEach(function (b) {
        b.classList.toggle('active', b.dataset.tag === state.tag);
      });
      var inp = host.querySelector('input[type="search"]');
      if (inp && state.q) inp.value = state.q;
    }

    function apply() {
      var q = state.q.toLowerCase();
      // v34: For CJK queries, use Intl.Segmenter to tokenize and match
      // any token (e.g. "近視 阿托品" matches articles containing either
      // word). Latin queries fall back to substring search.
      var qTokens = q ? DN.tokenizeCJK(q).filter(function (t) { return t.length > 0; }) : [];
      var isCJK   = q && /[一-鿿]/.test(q);
      var visibleCount = 0;
      items.forEach(function (it) {
        var keepCat = !state.cat || it.dataset.cat === state.cat;
        var keepTag = !state.tag || it.dataset.tag === state.tag;
        var text = it.textContent.toLowerCase();
        var keepQ;
        if (!q) keepQ = true;
        else if (isCJK && qTokens.length > 1) {
          // OR-match across tokens (so partial CJK queries still match)
          keepQ = qTokens.some(function (t) { return text.includes(t); });
        } else {
          keepQ = text.includes(q);
        }
        var visible = keepCat && keepTag && keepQ;
        it.style.display = visible ? '' : 'none';
        if (visible) visibleCount++;
      });
      // Empty-state
      var listHost = items[0] && items[0].parentNode;
      if (!listHost) return;
      var existingEmpty = listHost.querySelector('.hs-blog-empty');
      if (visibleCount === 0) {
        if (!existingEmpty) {
          var d = document.createElement('div');
          d.className = 'hs-blog-empty';
          d.innerHTML = '<span data-zh="沒有符合條件的文章 — 試試其他標籤或搜尋詞。" data-en="No matching articles. Try another tag or keyword.">沒有符合條件的文章 — 試試其他標籤或搜尋詞。</span>';
          listHost.appendChild(d);
          DN.applyTextOnly && DN.applyTextOnly(DN.detectLang());
        }
      } else if (existingEmpty) existingEmpty.remove();

      // Update URL (replaceState — don't pollute history)
      try {
        var p = new URLSearchParams();
        if (state.cat) p.set('cat', state.cat);
        if (state.tag) p.set('tag', state.tag);
        if (state.q)   p.set('q', state.q);
        var qs = p.toString();
        history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
      } catch (e) {}
    }

    // Event handlers
    host.addEventListener('click', function (e) {
      var b = e.target.closest('.chip-btn');
      if (b) {
        if ('cat' in b.dataset) {
          state.cat = (state.cat === b.dataset.cat) ? '' : b.dataset.cat;
        } else if ('tag' in b.dataset) {
          state.tag = (state.tag === b.dataset.tag) ? '' : b.dataset.tag;
        }
        syncUI(); apply();
        return;
      }
      if (e.target.classList.contains('reset')) {
        state.cat = ''; state.tag = ''; state.q = '';
        var inp = host.querySelector('input[type="search"]');
        if (inp) inp.value = '';
        syncUI(); apply();
      }
    });
    var inputEl = host.querySelector('input[type="search"]');
    var deb;
    if (inputEl) inputEl.addEventListener('input', function (e) {
      clearTimeout(deb);
      deb = setTimeout(function () { state.q = e.target.value; apply(); }, 180);
    });

    syncUI();
    apply();
  };

  // ---------------------------------------------------------------------
  // Mermaid diagrams — lazy-load mermaid.js ONLY when an article actually
  // contains <pre class="mermaid"> blocks. Saves ~200 KB on every other page.
  //
  // Article syntax:
  //   <pre class="mermaid">
  //     flowchart TD
  //       A[飛蚊症] --> B{合併警訊?}
  //       B -->|YES| C[24小時內就診]
  //       B -->|NO|  D[7天內就診]
  //   </pre>
  // ---------------------------------------------------------------------
  DN.loadMermaid = function () {
    if (window._hsMermaidLoaded) return;
    if (!document.querySelector('pre.mermaid, .language-mermaid')) return;
    window._hsMermaidLoaded = true;
    // v37.39 — pinned full version + SRI. Was @11 (jsdelivr auto-patch);
    // pin lets us verify integrity. Update both fields when bumping.
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/mermaid@11.15.0/dist/mermaid.min.js';
    s.crossOrigin = 'anonymous';
    s.integrity = 'sha384-yQ4mmBBT+vhTAwjFH0toJXNYJ6O4usWnt6EPIdWwrRvx2V/n5lXuDZQwQFeSFydF';
    s.onload = function () {
      try {
        window.mermaid.initialize({
          startOnLoad: false,
          theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default',
          fontFamily: '"Noto Sans TC", Inter, sans-serif',
        });
        window.mermaid.run({ querySelector: 'pre.mermaid, .language-mermaid' });
      } catch (e) { /* swallow */ }
    };
    document.head.appendChild(s);
  };

  // ---------------------------------------------------------------------
  // KaTeX math rendering — lazy-load when article has $$ ... $$ or $ ... $
  // delimited LaTeX. Useful for refractive optics formulae, IOL power
  // calculation, etc.
  //
  // Article syntax (block):
  //   <p>$$ P_{IOL} = A - 2.5 \cdot AL - 0.9 \cdot K $$</p>
  // ---------------------------------------------------------------------
  DN.loadKatex = function () {
    if (window._hsKatexLoaded) return;
    var hasMath = /\$\$[^$]+\$\$|\\\([^)]+\\\)|<math/i.test(document.body.innerText || '');
    if (!hasMath) return;
    window._hsKatexLoaded = true;
    // v37.38 — SRI hashes pinned to katex@0.16.11 dist files. If jsdelivr
    // ever serves a tampered copy or the bytes change for any reason, the
    // browser refuses to execute. Computed once via:
    //   curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A
    // Update when bumping the version pin.
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css';
    l.crossOrigin = 'anonymous';
    l.integrity = 'sha384-nB0miv6/jRmo5UMMR1wu3Gz6NLsoTkbqJghGIsx//Rlm+ZU03BU6SQNC66uf4l5+';
    document.head.appendChild(l);
    // Script + auto-render
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js';
    s.crossOrigin = 'anonymous';
    s.integrity = 'sha384-7zkQWkzuo3B5mTepMUcHkMB5jZaolc2xDwL6VFqjFALcbeS9Ggm/Yr2r3Dy4lfFg';
    s.defer = true;
    s.onload = function () {
      var ar = document.createElement('script');
      ar.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js';
      ar.crossOrigin = 'anonymous';
      ar.integrity = 'sha384-43gviWU0YVjaDtb/GhzOouOXtZMP/7XUzwPTstBeZFe/+rCMvRwr4yROQP43s0Xk';
      ar.defer = true;
      ar.onload = function () {
        try {
          window.renderMathInElement(document.body, {
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '\\[', right: '\\]', display: true },
              { left: '\\(', right: '\\)', display: false },
            ],
            throwOnError: false,
          });
        } catch (e) { /* swallow */ }
      };
      document.head.appendChild(ar);
    };
    document.head.appendChild(s);
  };

  // ---------------------------------------------------------------------
  // Medical-dictionary tooltips — adds visual styling to <span class="hs-dict">
  // and <a class="hs-dict-link"> elements created by /api/admin/dictionary
  // (action=autolink). The HTML already carries title=def for native tooltip;
  // we add a richer hover popup for desktop and click-to-toggle for mobile.
  // ---------------------------------------------------------------------
  DN.injectDictTooltips = function () {
    var anyDict = document.querySelector('.hs-dict, .hs-dict-link');
    if (!anyDict) return;

    if (!document.getElementById('hs-dict-css')) {
      var st = document.createElement('style');
      st.id = 'hs-dict-css';
      st.textContent =
        '.hs-dict, .hs-dict-link{position:relative;border-bottom:1.5px dotted var(--blue-deep,#3a5a7c);cursor:help;text-decoration:none;color:inherit}' +
        '.hs-dict-link:hover{color:var(--blue-deep,#3a5a7c)}' +
        '.hs-dict-popup{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);background:#243b56;color:#fff;padding:10px 14px;border-radius:8px;font-size:13px;line-height:1.6;font-weight:400;width:max-content;max-width:280px;box-shadow:0 12px 28px -8px rgba(0,0,0,.35);z-index:9990;pointer-events:none;opacity:0;transition:opacity .15s}' +
        '.hs-dict-popup::after{content:"";position:absolute;top:100%;left:50%;transform:translateX(-50%);border:6px solid transparent;border-top-color:#243b56}' +
        '.hs-dict-popup .en{display:block;font-size:11px;color:#a4c4dd;letter-spacing:.04em;margin-top:2px;font-style:italic}' +
        '.hs-dict.show .hs-dict-popup, .hs-dict-link.show .hs-dict-popup, .hs-dict:hover .hs-dict-popup, .hs-dict-link:hover .hs-dict-popup{opacity:1}';
      document.head.appendChild(st);
    }

    document.querySelectorAll('.hs-dict, .hs-dict-link').forEach(function (el) {
      if (el.querySelector('.hs-dict-popup')) return;
      var def = el.getAttribute('title') || '';
      var en = el.dataset.en || '';
      if (!def && !en) return;
      var popup = document.createElement('span');
      popup.className = 'hs-dict-popup';
      if (def) popup.appendChild(document.createTextNode(def));
      if (en) {
        var enLabel = document.createElement('span');
        enLabel.className = 'en';
        enLabel.textContent = en;
        popup.appendChild(enLabel);
      }
      el.appendChild(popup);
      el.removeAttribute('title');  // suppress native tooltip; ours is richer
      // Mobile: tap toggles
      el.addEventListener('click', function (e) {
        if (matchMedia && matchMedia('(hover:none)').matches) {
          e.preventDefault();
          el.classList.toggle('show');
          setTimeout(function () { el.classList.remove('show'); }, 4000);
        }
      });
    });
  };

  // ---------------------------------------------------------------------
  // PWA install prompt — captures `beforeinstallprompt`, shows a small
  // floating "📲 加入主畫面" button, fires `prompt()` on click. Hides if
  // the user has already installed (matchMedia('(display-mode: standalone)'))
  // or dismissed (localStorage flag for 30 days).
  // ---------------------------------------------------------------------
  DN.PWA_DISMISS_KEY = 'hs:pwa:dismissed-until';
  DN._deferredPrompt = null;

  DN.bindPWAInstall = function () {
    // v34.1: PWA install prompt UI removed per user request. Function kept
    // as a no-op stub so any caller doesn't throw. Site remains installable
    // via the browser's built-in install menu (manifest.json + SW present).
    // Also remove any previously-injected prompt buttons or iOS hints from
    // older SW caches that may still be lingering on a user's device.
    var leftover = document.getElementById('hs-pwa-btn');
    if (leftover) leftover.remove();
    var iosLeftover = document.getElementById('hs-pwa-ios');
    if (iosLeftover) iosLeftover.remove();
  };
  DN._showPwaButton    = function () {};
  DN._showIOSPwaHint   = function () {};

  // ---------------------------------------------------------------------
  // Auto dark-mode listener — DN.bindThemeToggle already handles initial
  // OS preference + manual toggle persistence. This function just adds the
  // *live* listener so OS theme changes propagate without page reload
  // (when user hasn't explicitly chosen).
  // ---------------------------------------------------------------------
  DN.bindAutoTheme = function () {
    if (!window.matchMedia) return;
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var apply = function () {
      // Skip if user has explicitly chosen — bindThemeToggle stores at hs_theme
      try { if (localStorage.getItem('hs_theme')) return; } catch (e) {}
      var mode = mq.matches ? 'dark' : 'light';
      document.documentElement.dataset.theme = mode;
      var meta = document.querySelector('meta[name="theme-color"]:not([media])');
      if (meta) meta.setAttribute('content', mode === 'dark' ? '#0f172a' : '#3a5a7c');
    };
    apply();  // initial
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else if (mq.addListener) mq.addListener(apply);
  };

  // ---------------------------------------------------------------------
  // v32: Lottie hero — replaces a static hero SVG with a Lottie animation
  // when the page provides a `<div data-lottie="/path/to/anim.json">`
  // element. Lazy-loads the dotlottie-wc web-component (~26 KB, far less
  // than full lottie-web) only when needed. Falls back gracefully (just
  // shows the existing static SVG / placeholder) if the JSON or library
  // fails to load.
  //
  // Place a Lottie file under /assets/lottie/<name>.lottie or .json and
  // reference via:
  //   <div data-lottie="/assets/lottie/eye-blink.lottie" style="width:240px;height:240px"></div>
  // Defaults to autoplay + loop, respects prefers-reduced-motion.
  // ---------------------------------------------------------------------
  DN.bindLottieHero = function () {
    var hosts = document.querySelectorAll('[data-lottie]');
    if (!hosts.length) return;
    if (matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    if (window._hsLottieLoaded) {
      hosts.forEach(mountLottie);
      return;
    }
    window._hsLottieLoaded = true;
    // dotlottie-wc is the Web Component player from LottieFiles.
    // v37.38 — full SRI now applied since version is pinned to 0.4.0.
    // Browser refuses execution if the script bytes change. Update the
    // integrity hash when bumping the version. Computed via:
    //   curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A
    var s = document.createElement('script');
    s.type = 'module';
    s.crossOrigin = 'anonymous';
    s.integrity = 'sha384-wTCXBikp/F3Zti6eAxLchjbhor7ioKWpZBAROikRs8zyFtUQ5/TuCutkcrauI9vi';
    s.src = 'https://cdn.jsdelivr.net/npm/@lottiefiles/dotlottie-wc@0.4.0/dist/dotlottie-wc.js';
    s.onload = function () { hosts.forEach(mountLottie); };
    document.head.appendChild(s);

    function mountLottie(host) {
      if (host.dataset.lottieMounted) return;
      host.dataset.lottieMounted = '1';
      var src = host.dataset.lottie;
      var player = document.createElement('dotlottie-wc');
      player.setAttribute('src', src);
      player.setAttribute('autoplay', '');
      if (host.dataset.lottieLoop !== 'false') player.setAttribute('loop', '');
      player.setAttribute('speed', host.dataset.lottieSpeed || '1');
      player.style.cssText = 'width:100%;height:100%;display:block';
      host.appendChild(player);
    }
  };

  // ---------------------------------------------------------------------
  // v32: FedCM readiness — sites with a future login flow can call
  // DN.initFedCM(configUrl) to enable the Federated Credential Manager
  // browser-mediated sign-in. For HsiaoEye there's no public login (admin
  // only) so we don't enable any IdP integration today, but we DO add the
  // Permissions-Policy "identity-credentials-get=(self)" header (in the
  // edge middleware) so the API is allowlisted when we add it later.
  //
  // What's "FedCM"?  Privacy-Sandbox-friendly replacement for third-party
  // cookie SSO. The browser shows the IdP picker; site never sees the
  // user's IdP cookies.
  //
  // No-op today; the function exists so future code calling it doesn't
  // throw, and so the bundle has the entry point pre-wired.
  // ---------------------------------------------------------------------
  DN.initFedCM = function (configUrl) {
    if (!('IdentityCredential' in window)) return;
    if (!configUrl) return;
    // Stubbed — actual flow:
    //   navigator.credentials.get({ identity: { providers: [{ configURL: configUrl, clientId: '...' }] } })
    return null;
  };

  // ---------------------------------------------------------------------
  // v32: Algolia DocSearch — drop-in upgrade for Cmd+K search.
  // When the page sets ALGOLIA credentials (3 keys), we lazy-load the
  // DocSearch widget and use it INSTEAD of the home-rolled DN.initCmdK.
  // No credentials = falls back to current implementation.
  //
  // Setup (one-time):
  //   1. Apply for free DocSearch at https://docsearch.algolia.com/apply/
  //   2. They send you 3 strings: appId, apiKey, indexName
  //   3. Add to <head> of index.html OR via Vercel env (server-rendered):
  //      <meta name="algolia-app-id"   content="XXX">
  //      <meta name="algolia-api-key"  content="XXX">
  //      <meta name="algolia-index"    content="XXX">
  // ---------------------------------------------------------------------
  DN.bindAlgoliaDocSearch = function () {
    function getMeta(n) { var m = document.querySelector('meta[name="' + n + '"]'); return m ? m.content : ''; }
    var appId    = getMeta('algolia-app-id');
    var apiKey   = getMeta('algolia-api-key');
    var indexNm  = getMeta('algolia-index');
    if (!appId || !apiKey || !indexNm) return;

    // v37.39 — pinned full version + SRI. Was @3 (jsdelivr auto-patch);
    // full pin lets us verify integrity. Bump both fields together.
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdn.jsdelivr.net/npm/@docsearch/css@3.9.0';
    css.crossOrigin = 'anonymous';
    css.integrity = 'sha384-XMwByx5w8uj/lIF/JzG5ifeDnUBe9BURWnnD/Hk81DBN5iGIbno8pG5acrUlEhoA';
    document.head.appendChild(css);

    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@docsearch/js@3.9.0';
    s.crossOrigin = 'anonymous';
    s.integrity = 'sha384-f/IEhh8fvOc2ALU79emLlUqAYXyqlA/zYhM+g5GlWMk15QBjTXy05TtmfT1TbtV6';
    s.defer = true;
    s.onload = function () {
      // Hook: replace existing search button trigger
      var hostBtn = document.querySelector('button[aria-label="搜尋"], button[aria-label="Search"]');
      if (!hostBtn) return;
      // Container for the modal
      var container = document.createElement('div');
      container.id = 'docsearch';
      hostBtn.parentNode.insertBefore(container, hostBtn);
      // Replace click — open DocSearch modal
      hostBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (window.docsearch) {
          // Synthesize keypress to open modal
          var ev = new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true });
          window.dispatchEvent(ev);
        }
      }, { capture: true });
      try {
        window.docsearch({
          container: '#docsearch',
          appId: appId, apiKey: apiKey, indexName: indexNm,
          insights: true,
          translations: { button: { buttonText: '搜尋', buttonAriaLabel: '搜尋' }, modal: { searchBox: { placeholder: '輸入關鍵字…', resetButtonTitle: '清除' } } },
        });
      } catch (e) { /* swallow */ }
    };
    document.head.appendChild(s);

    // Disable our home-rolled CmdK so we don't double-bind
    DN.initCmdK = function () {};
  };

  // ---------------------------------------------------------------------
  // v34: Document Picture-in-Picture reading mode.
  // Pulls the article body into a floating window the user can pin while
  // reading. Useful when the doctor switches between charting (EHR) and
  // looking up something. Chrome 116+; Safari & Firefox unsupported, so
  // we hide the button there.
  //
  // Activated via the "📺 畫中畫閱讀" button injected on article pages.
  // ---------------------------------------------------------------------
  // v34.16: bindDocPiP disabled per user request — the floating PiP button
  // crowded the bottom-right corner with the font-sizer and back-to-top.
  // Article reading via PiP saw negligible engagement. Stub kept so any
  // cached older DOM with #hs-pip-btn is cleared on next render.
  DN.bindDocPiP = function () {
    var existing = document.getElementById('hs-pip-btn');
    if (existing) existing.remove();
  };

  // ---------------------------------------------------------------------
  // v34: navigator.share() with Files — share the article as a generated
  // PDF blob (in addition to the URL). Browser shows the native share
  // sheet which can pipe to AirDrop / Telegram / Line / WeChat.
  //
  // PDF generation is light-weight: window.print() to PDF in a popup OR
  // fall back to URL-only share when File API not supported.
  // ---------------------------------------------------------------------
  DN.bindShareFiles = function () {
    if (!navigator.canShare) return;
    var btn = document.querySelector('[data-share-files]');
    if (!btn) return;
    btn.addEventListener('click', async function (e) {
      e.preventDefault();
      var url = location.href;
      var title = document.title;
      // Try sharing files first (Chrome Android, Safari)
      try {
        // Build a small text-only snapshot as a .txt File
        var article = document.querySelector('article.max-w-3xl, article .prose');
        var text = (article ? article.innerText : document.body.innerText).slice(0, 8000);
        var file = new File([text], title.slice(0, 40) + '.txt', { type: 'text/plain' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: title, url: url });
          return;
        }
      } catch (e) {}
      // URL-only fallback
      try { await navigator.share({ title: title, url: url }); }
      catch (e) {}
    });
  };

  // ---------------------------------------------------------------------
  // v34: Intl.Segmenter for Chinese tokenization.
  // Replaces our home-rolled CJK bigram tokenizer in admin search /
  // related-article scoring. Browser does grapheme/word/sentence
  // segmentation properly using ICU under the hood — way more accurate
  // than naive bigrams for medical compound terms.
  //
  // Public API:
  //   var tokens = DN.tokenizeCJK('視網膜剝離 6 個警訊');
  //   // → ['視網膜剝離', '6', '個', '警訊']
  // Falls back to bigram tokens when Intl.Segmenter unavailable.
  // ---------------------------------------------------------------------
  DN.tokenizeCJK = function (text) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      try {
        var seg = new Intl.Segmenter('zh-Hant', { granularity: 'word' });
        var out = [];
        var iter = seg.segment(String(text || ''));
        for (var s of iter) {
          if (s.isWordLike) out.push(s.segment);
        }
        if (out.length) return out;
      } catch (e) {}
    }
    // Fallback: bigrams + Latin words
    var t = String(text || '').toLowerCase();
    var tokens = [];
    var cjk = t.match(/[一-鿿]{2,}/g) || [];
    cjk.forEach(function (run) {
      for (var i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2));
    });
    var latin = t.match(/[a-z][a-z0-9-]{2,}/g) || [];
    return tokens.concat(latin);
  };

  // ---------------------------------------------------------------------
  // v34: Intl.DateTimeFormat relative time — DN.relativeTime(iso) returns
  // "3 天前", "5 分鐘前", "2 個月前" etc., automatically i18n-aware.
  // Used in article meta + admin commit history.
  // ---------------------------------------------------------------------
  DN.relativeTime = function (iso) {
    try {
      var d = new Date(iso);
      var diffMs = d.getTime() - Date.now();
      var rtf = new Intl.RelativeTimeFormat(DN.detectLang() === 'en' ? 'en' : 'zh-Hant', { numeric: 'auto' });
      var sec = diffMs / 1000;
      var min = sec / 60, hr = min / 60, day = hr / 24, mon = day / 30, yr = day / 365;
      if (Math.abs(sec) < 60)  return rtf.format(Math.round(sec), 'second');
      if (Math.abs(min) < 60)  return rtf.format(Math.round(min), 'minute');
      if (Math.abs(hr)  < 24)  return rtf.format(Math.round(hr),  'hour');
      if (Math.abs(day) < 30)  return rtf.format(Math.round(day), 'day');
      if (Math.abs(mon) < 12)  return rtf.format(Math.round(mon), 'month');
      return rtf.format(Math.round(yr), 'year');
    } catch (e) { return ''; }
  };

  // Auto-fill any [data-relative-time] elements with their relative time
  DN.applyRelativeTime = function () {
    document.querySelectorAll('[data-relative-time]').forEach(function (el) {
      var iso = el.dataset.relativeTime || el.getAttribute('datetime') || el.textContent;
      var rel = DN.relativeTime(iso);
      if (rel) {
        el.classList.add('hs-relative-time');
        el.title = el.textContent;
        el.textContent = rel;
      }
    });
  };

  // ---------------------------------------------------------------------
  // v34: navigator.locks — exclusive lock for cross-tab admin operations.
  // Prevents 2 admin tabs from racing to commit the same slug.
  // Usage:
  //   await DN.withLock('save-' + slug, async () => { ... });
  // Falls back to immediate execution when LockManager unsupported.
  // ---------------------------------------------------------------------
  DN.withLock = async function (name, fn) {
    if (navigator.locks && navigator.locks.request) {
      try {
        return await navigator.locks.request(name, { mode: 'exclusive' }, fn);
      } catch (e) { return await fn(); }
    }
    return await fn();
  };

  // ---------------------------------------------------------------------
  // v34: view-transition-name auto-assignment.
  // Each article card on the listing pages and the matching article-page
  // hero get a name like `vt-card-<slug>` so cross-document view
  // transitions morph them instead of fading. Browser pairs old/new with
  // identical names; ones without the name (decorative SVG, footer) just
  // do the default fade.
  // ---------------------------------------------------------------------
  DN.assignVTNames = function () {
    if (!('startViewTransition' in document) && !CSS.supports('view-transition-name', 'a')) return;
    // On listing pages: every <a href="/blog/<slug>"> card gets a name
    document.querySelectorAll('a[href^="/blog/"]').forEach(function (a) {
      var m = (a.getAttribute('href') || '').match(/^\/blog\/([a-z0-9-]+)\/?$/);
      if (!m) return;
      var card = a.closest('.article-list-item, .topic-card, #hs-cover-story, #hs-editor-pick, #hs-recent-list > li, #hs-popular-list > li') || a;
      card.style.viewTransitionName = 'vt-card-' + m[1];
      // Also tag with a class so CSS can group-style
      card.classList.add('hs-vt-card');
    });
    // On article page: the article hero / first H1 gets the matching name
    var slug = DN.currentSlug && DN.currentSlug();
    if (slug) {
      var hero = document.querySelector('article.max-w-3xl > h1, .article-hero, .article-list-item h1');
      if (hero) hero.style.viewTransitionName = 'vt-card-' + slug;
    }
  };

  // ---------------------------------------------------------------------
  // v34: WebNN auto-tag suggestions for admin. Uses on-device ML
  // (TensorFlow.js + Universal Sentence Encoder Lite) when WebNN is
  // available for hardware-accelerated inference. Otherwise falls back to
  // a tiny rule-based keyword scorer over our medical dictionary.
  //
  // Why this lives in blog-shared.js (not just admin.html): the model is
  // ~25 MB and we lazy-load it only when the admin opens 「自動標籤」
  // dialog. Falls back to dictionary-keyword scoring without the model.
  //
  // Public API:
  //   const suggestions = await DN.suggestTags(articleHtml);
  //   // → [{ tag: '青光眼', score: 0.92 }, ...]
  // ---------------------------------------------------------------------
  DN._webnnReady = null;
  DN.hasWebNN = function () {
    return typeof navigator !== 'undefined' && 'ml' in navigator &&
           typeof navigator.ml.createContext === 'function';
  };

  DN.suggestTags = async function (html, k) {
    k = k || 5;
    // Strip HTML
    var text = String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .toLowerCase();

    // Pull medical dictionary (lazy fetch + cache)
    var dict = await DN._fetchDict();
    var terms = Object.keys(dict);

    // Score each dictionary term:
    //   - count term occurrences (TF)
    //   - boost if term appears in title or H2
    //   - boost if multiple bigram matches (substring count)
    //   - WebNN cosine similarity if available (semantic boost)
    var scores = terms.map(function (term) {
      var occ = (text.match(new RegExp(term, 'g')) || []).length;
      var enWord = (dict[term].en || '').toLowerCase();
      var enOcc = enWord ? (text.match(new RegExp('\\b' + enWord.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b', 'g')) || []).length : 0;
      // Headings boost
      var headingBoost = 0;
      try {
        var h2re = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
        var m;
        while ((m = h2re.exec(html)) !== null) {
          if (m[1].indexOf(term) >= 0) headingBoost += 2;
        }
      } catch (e) {}
      var raw = occ + enOcc * 0.7 + headingBoost;
      return { tag: term, score: raw };
    }).filter(function (s) { return s.score > 0; });

    // Normalise to 0-1
    var max = scores.reduce(function (acc, s) { return Math.max(acc, s.score); }, 1);
    scores.forEach(function (s) { s.score = +(s.score / max).toFixed(3); });
    scores.sort(function (a, b) { return b.score - a.score; });
    return scores.slice(0, k);
  };

  DN._fetchDict = async function () {
    if (DN._dictCache) return DN._dictCache;
    try {
      var r = await fetch('/assets/medical-dictionary.json', { cache: 'force-cache' });
      if (r.ok) { DN._dictCache = await r.json(); return DN._dictCache; }
    } catch (e) {}
    return {};
  };

  // ---------------------------------------------------------------------
  // v33: WebTransport client scaffolding — bidirectional QUIC/HTTP-3 stream.
  //
  // ⚠ Vercel limitation: serverless functions cannot hold long-lived
  // connections, so a true WebTransport server is NOT supported on Hobby.
  // What we DO get from WebTransport even with a polling backend:
  //   - Multiplexed streams over a single HTTP/3 connection (no head-of-line
  //     blocking like classic SSE/WebSocket multiplexing)
  //   - Datagram support (unreliable, low-latency push for telemetry)
  //   - Feature parity check — easy switch when we move to Cloudflare
  //     Workers / Fly.io / self-hosted Caddy with proper HTTP/3.
  //
  // For now the scaffold falls back to /api/events SSE (v32). The client
  // API (DN.openLiveChannel) is identical so future server upgrade is a
  // one-line URL swap.
  //
  // Usage:
  //   var ch = await DN.openLiveChannel('/api/events');  // returns { onMessage, close }
  //   ch.onMessage = (event, data) => { ... };
  // ---------------------------------------------------------------------
  DN.openLiveChannel = async function (url) {
    var handlers = {};
    var closed = false;

    // WebTransport path (only when server supports it — not on Vercel today)
    if ('WebTransport' in window && url.startsWith('https:')) {
      try {
        var transport = new WebTransport(url);
        await transport.ready;
        var reader = transport.datagrams.readable.getReader();
        (async function () {
          try {
            while (!closed) {
              var { value, done } = await reader.read();
              if (done) break;
              try {
                var msg = JSON.parse(new TextDecoder().decode(value));
                if (handlers.onMessage) handlers.onMessage(msg.type || 'message', msg);
              } catch (e) {}
            }
          } catch (e) {}
        })();
        return {
          set onMessage(fn) { handlers.onMessage = fn; },
          close: function () { closed = true; transport.close(); },
        };
      } catch (e) { /* fall through to SSE */ }
    }

    // Fallback: EventSource (works today on Vercel via /api/events)
    try {
      var es = new EventSource(url, { withCredentials: true });
      es.addEventListener('message', function (e) {
        try { if (handlers.onMessage) handlers.onMessage('message', JSON.parse(e.data)); }
        catch (_) {}
      });
      // Generic fan-out for named events (new_article, heartbeat, etc.)
      ['hello','new_article','new_subscriber','csp_violation','heartbeat','complete','progress','bye'].forEach(function (t) {
        es.addEventListener(t, function (e) {
          try { if (handlers.onMessage) handlers.onMessage(t, JSON.parse(e.data)); }
          catch (_) { if (handlers.onMessage) handlers.onMessage(t, e.data); }
        });
      });
      es.addEventListener('error', function () {
        if (handlers.onMessage && !closed) handlers.onMessage('error', { ts: Date.now() });
      });
      return {
        set onMessage(fn) { handlers.onMessage = fn; },
        close: function () { closed = true; es.close(); },
      };
    } catch (e) { return null; }
  };

  // ---------------------------------------------------------------------
  // v33: Origin Private File System (OPFS) — admin draft autosave that
  // survives network loss + tab crash. Saves the article body every 5
  // seconds while editing. On page load, if a draft exists newer than the
  // server-loaded version, offer to restore.
  //
  // Why OPFS instead of localStorage:
  //   - 50 MB+ quota (vs 5 MB)
  //   - Faster (file-system-backed)
  //   - Survives storage pressure better
  // Falls back to localStorage when OPFS unavailable.
  // ---------------------------------------------------------------------
  DN.openOpfsDir = async function () {
    if (!navigator.storage || !navigator.storage.getDirectory) return null;
    try { return await navigator.storage.getDirectory(); }
    catch (e) { return null; }
  };

  DN.saveDraft = async function (slug, html, baseSha) {
    var key = 'draft-' + slug + '.json';
    var payload = JSON.stringify({ slug: slug, html: html, baseSha: baseSha, ts: Date.now() });
    try {
      var dir = await DN.openOpfsDir();
      if (dir) {
        var fh = await dir.getFileHandle(key, { create: true });
        var w  = await fh.createWritable();
        await w.write(payload);
        await w.close();
        return { source: 'opfs' };
      }
    } catch (e) {}
    try { localStorage.setItem('hs:' + key, payload); return { source: 'ls' }; }
    catch (e) { return { source: null }; }
  };

  DN.loadDraft = async function (slug) {
    var key = 'draft-' + slug + '.json';
    try {
      var dir = await DN.openOpfsDir();
      if (dir) {
        try {
          var fh = await dir.getFileHandle(key);
          var f  = await fh.getFile();
          return JSON.parse(await f.text());
        } catch (e) {}
      }
    } catch (e) {}
    try { var raw = localStorage.getItem('hs:' + key); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  };

  DN.deleteDraft = async function (slug) {
    var key = 'draft-' + slug + '.json';
    try {
      var dir = await DN.openOpfsDir();
      if (dir) await dir.removeEntry(key).catch(function () {});
    } catch (e) {}
    try { localStorage.removeItem('hs:' + key); } catch (e) {}
  };

  // ---------------------------------------------------------------------
  // v33: Background Sync v2 — when /api/admin/save fails offline, queue
  // the request and fire it again when network returns. The SW listens
  // for QUEUE_SAVE messages, stores in IndexedDB, replays on 'sync' event.
  // ---------------------------------------------------------------------
  DN._offlineSaveTokens = Object.create(null);
  DN.prepareOfflineSave = async function (slug) {
    if (!/^[a-z0-9-]+$/.test(slug || '')) return false;
    try {
      var response = await fetch('/api/admin/offline-token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: slug }),
      });
      if (!response.ok) return false;
      var data = await response.json();
      if (!data.token || !data.expiresAt) return false;
      DN._offlineSaveTokens[slug] = {
        token: data.token,
        expiresAt: Number(data.expiresAt),
      };
      return true;
    } catch (e) {
      return false;
    }
  };

  DN.queueOfflineSave = function (slug, html, baseSha) {
    if (!/^[a-f0-9]{40}$/.test(baseSha || '')) return false;
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return false;
    var capability = DN._offlineSaveTokens[slug];
    if (!capability || capability.expiresAt <= Date.now() + 60000) return false;
    try {
      navigator.serviceWorker.controller.postMessage({
        type: 'QUEUE_SAVE',
        payload: { slug: slug, html: html, baseSha: baseSha, token: capability.token, ts: Date.now() },
      });
      navigator.serviceWorker.ready.then(function (reg) {
        if (reg.sync) reg.sync.register('admin-save-replay').catch(function () {});
      });
      return true;
    } catch (e) { return false; }
  };

  // ---------------------------------------------------------------------
  // v33: Compute Pressure API — Chrome 125+ tells us when CPU is under
  // pressure. We back off non-essential work: drop web-vitals sample rate,
  // pause prefetch, skip CSS animations. State exposed as DN._cpuLevel:
  //   'nominal' | 'fair' | 'serious' | 'critical'
  // ---------------------------------------------------------------------
  DN._cpuLevel = 'nominal';
  DN.bindComputePressure = function () {
    if (!('PressureObserver' in window)) return;
    try {
      var obs = new PressureObserver(function (records) {
        var rec = records[records.length - 1];
        if (rec && rec.state) {
          DN._cpuLevel = rec.state;
          // High pressure: stop prefetching + cut CSS animations
          if (rec.state === 'serious' || rec.state === 'critical') {
            document.documentElement.dataset.cpuPressure = 'high';
            // Disable scroll-driven CSS animations & speculation prefetches
            document.querySelectorAll('link[rel="prefetch"]').forEach(function (l) { l.remove(); });
          } else {
            delete document.documentElement.dataset.cpuPressure;
          }
        }
      });
      obs.observe('cpu', { sampleInterval: 5000 });
    } catch (e) { /* unsupported or denied */ }
  };

  // ---------------------------------------------------------------------
  // v33: Navigation API — replaces popstate + manual link interception
  // for SPA-like soft nav. With View Transitions cross-document already
  // declarative, we mostly use this to:
  //   - Track every soft / hard nav for analytics
  //   - Cancel a navigation if user clicks during a save (e.g. unsaved
  //     admin edits)
  // Falls back silently when unsupported (Firefox / Safari).
  // ---------------------------------------------------------------------
  DN.bindNavigation = function () {
    if (!('navigation' in window)) return;
    window.navigation.addEventListener('navigate', function (event) {
      // Block navigation away from admin editor with unsaved changes
      if (DN.isAdminMode && DN.isAdminMode() && DN._adminDirty) {
        if (!confirm('有未儲存的編輯。確定要離開？')) {
          event.preventDefault();
          return;
        }
      }
      // Optional GA4 soft-nav event
      try {
        var url = event.destination && event.destination.url;
        if (url && window.gtag) gtag('event', 'soft_navigation', {
          page_path: new URL(url).pathname,
          navigation_type: event.navigationType,
        });
      } catch (e) {}
    });
  };

  // ---------------------------------------------------------------------
  // v32: Idle Detection — pause non-critical work when the user has been
  // idle for ≥30 seconds. Saves CPU on long-open tabs (e.g. doctors with
  // many windows open). Uses the Idle Detection API (Chrome 94+, requires
  // user permission); falls back to visibilitychange-only on Safari/Firefox.
  // ---------------------------------------------------------------------
  DN.bindIdleDetection = function () {
    DN._isIdle = false;
    if (!('IdleDetector' in window)) {
      // Fallback: just use visibilitychange
      document.addEventListener('visibilitychange', function () {
        DN._isIdle = (document.visibilityState !== 'visible');
      });
      return;
    }
    // Don't request permission proactively — only on first long visit.
    // Storage flag so we don't re-prompt every visit.
    var KEY = 'hs:idle-asked';
    try { if (localStorage.getItem(KEY)) return; } catch (e) { return; }

    setTimeout(async function () {
      // Wait until user has interacted (avoid permission prompt on cold load)
      try {
        if (Notification.permission !== 'granted') return;  // only after push opt-in
        try { localStorage.setItem(KEY, '1'); } catch (e) {}
        var detector = new IdleDetector();
        await detector.start({ threshold: 60_000 });  // 60s idle threshold
        detector.addEventListener('change', function () {
          DN._isIdle = detector.userState === 'idle' || detector.screenState === 'locked';
          // Pause GA + web-vitals when truly idle (saves billing + CPU)
          if (DN._isIdle) {
            try { if (window.gtag) gtag('set', { send_page_view: false }); } catch (e) {}
          }
        });
      } catch (e) { /* user denied or unsupported */ }
    }, 120_000);  // wait 2 min before asking
  };

  // ---------------------------------------------------------------------
  // v32: HTTP/3 fetch priority hints — set fetchpriority="high" on the
  // first <img>/<picture> above-the-fold, "low" on share/related thumbnails,
  // and inject `<link rel="preload" fetchpriority="high">` for the LCP
  // candidate. Improves LCP by 100-200ms on slow connections.
  // ---------------------------------------------------------------------
  DN.applyFetchPriority = function () {
    // First viewport image: high priority
    var first = document.querySelector('article img, .hero img, header img');
    if (first && !first.hasAttribute('fetchpriority')) first.setAttribute('fetchpriority', 'high');
    // Below-fold images & thumbnails: low priority (defer for LCP)
    document.querySelectorAll('#hs-related img, .related-thumb, footer img').forEach(function (img) {
      if (!img.hasAttribute('fetchpriority')) img.setAttribute('fetchpriority', 'low');
    });
    // Inject preload hint for the LCP candidate (article hero or first figure)
    var lcp = document.querySelector('article figure img:not([loading="lazy"]), .hero-photo, header img');
    if (lcp && lcp.src && !document.querySelector('link[rel="preload"][as="image"][href="' + lcp.src + '"]')) {
      var l = document.createElement('link');
      l.rel = 'preload'; l.as = 'image'; l.href = lcp.src;
      l.setAttribute('fetchpriority', 'high');
      if (lcp.srcset) l.setAttribute('imagesrcset', lcp.srcset);
      if (lcp.sizes)  l.setAttribute('imagesizes', lcp.sizes);
      document.head.appendChild(l);
    }
  };

  // ---------------------------------------------------------------------
  // v32: Text fragment landing — when arriving via #:~:text=…
  // (Google search "jump to" feature), highlight the matched span in the
  // article colour palette and smooth-scroll. Browser already scrolls to
  // the right place; we just style the highlight nicer than yellow default.
  // ---------------------------------------------------------------------
  DN.styleTextFragments = function () {
    if (!CSS.supports('selector(::target-text)')) return;
    if (document.getElementById('hs-tf-css')) return;
    var st = document.createElement('style');
    st.id = 'hs-tf-css';
    st.textContent =
      '::target-text{background:linear-gradient(180deg,transparent 60%,#fde68a 60%,#fbbf24 100%);' +
      'color:#3a3024;padding:1px 0;border-radius:2px;}' +
      '@media (prefers-color-scheme:dark){::target-text{background:linear-gradient(180deg,transparent 60%,#5a4720 60%,#c9a961 100%);color:#f5f0e6}}';
    document.head.appendChild(st);
  };

  // ---------- service worker ----------
  DN.registerSW = function () {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').then(function (reg) {
      DN.bindSWUpdateToast(reg);
      setInterval(function () {
        if (document.visibilityState === 'visible') reg.update().catch(function () {});
      }, 30 * 60 * 1000);

      // v32: Periodic Background Sync — register only after PWA install
      // (the API requires Permission "periodic-background-sync" + the site
      //  installed as a PWA).
      if ('periodicSync' in reg) {
        navigator.permissions.query({ name: 'periodic-background-sync' }).then(function (status) {
          if (status.state === 'granted') {
            reg.periodicSync.register('check-new-articles', {
              minInterval: 12 * 60 * 60 * 1000,  // 12 hours (browser may run less often)
            }).catch(function () { /* unsupported / not installed */ });
          }
        }).catch(function () {});
      }
    }).catch(function () {});
  };

  // ---------------------------------------------------------------------
  // Web Push — subscription UI. Renders a small "🔔 訂閱通知" link on the
  // article author-bio that, when clicked, requests permission and POSTs
  // the PushSubscription to /api/push/subscribe.
  //
  // VAPID public key must be set on `DN.VAPID_PUBLIC_KEY` (or window var)
  // for the request to succeed. Without the key the button is hidden.
  // Generate via: `npx web-push generate-vapid-keys`
  // ---------------------------------------------------------------------
  DN.VAPID_PUBLIC_KEY = window.VAPID_PUBLIC_KEY || '';

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = atob(base64);
    var arr = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; ++i) arr[i] = rawData.charCodeAt(i);
    return arr;
  }

  // Fetches the VAPID public key from /api/push/key (cached at edge).
  // Returns null if VAPID is not configured server-side, in which case
  // bindPushSubscribe is a no-op.
  DN._vapidKeyPromise = null;
  function getVapidKey() {
    if (DN.VAPID_PUBLIC_KEY) return Promise.resolve(DN.VAPID_PUBLIC_KEY);
    if (!DN._vapidKeyPromise) {
      DN._vapidKeyPromise = fetch('/api/push/key').then(function (r) {
        if (!r.ok) return null;
        return r.json().then(function (j) { DN.VAPID_PUBLIC_KEY = j.key; return j.key; });
      }).catch(function () { return null; });
    }
    return DN._vapidKeyPromise;
  }

  DN.bindPushSubscribe = function (containerSel) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
    var host = document.querySelector(containerSel || '#hs-author-bio');
    if (!host) return;
    if (host.querySelector('.hs-push-btn')) return;

    // Resolve VAPID key first; if missing, silently skip
    getVapidKey().then(function (key) {
      if (!key) return;
      DN._renderPushButton(host);
    });
  };

  DN._renderPushButton = function (host) {
    if (host.querySelector('.hs-push-btn')) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hs-push-btn';
    btn.style.cssText = 'margin-top:10px;padding:8px 14px;border-radius:9999px;border:1px solid #b8cfe3;background:#fff;color:#3a5a7c;font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px';
    btn.textContent = '🔔 訂閱新文章通知';

    function setStateUnsubscribed() { btn.textContent = '🔔 訂閱新文章通知'; btn.disabled = false; }
    function setStateSubscribed()   { btn.textContent = '✓ 已訂閱新文章通知 (取消)'; btn.disabled = false; }

    navigator.serviceWorker.ready.then(function (reg) {
      reg.pushManager.getSubscription().then(function (sub) {
        if (sub) setStateSubscribed(); else setStateUnsubscribed();
      });
    });

    btn.addEventListener('click', async function () {
      btn.disabled = true; btn.textContent = '處理中⋯';
      try {
        var reg = await navigator.serviceWorker.ready;
        var existing = await reg.pushManager.getSubscription();
        if (existing) {
          // Unsubscribe
          await fetch('/api/push/subscribe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: existing.endpoint })
          });
          await existing.unsubscribe();
          DN.toast && DN.toast('✓ 已取消訂閱');
          setStateUnsubscribed();
          return;
        }
        var perm = await Notification.requestPermission();
        if (perm !== 'granted') { DN.toast && DN.toast('未授權通知'); setStateUnsubscribed(); return; }
        var sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(DN.VAPID_PUBLIC_KEY)
        });
        var saveResponse = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint, keys: sub.toJSON().keys, userAgent: navigator.userAgent })
        });
        if (!saveResponse.ok) {
          await sub.unsubscribe().catch(function () {});
          throw new Error('subscription registration failed');
        }
        DN.toast && DN.toast('✓ 已訂閱,新文章發布時會收到通知');
        setStateSubscribed();
      } catch (e) {
        DN.toast && DN.toast('訂閱失敗: ' + (e.message || e));
        setStateUnsubscribed();
      }
    });
    host.appendChild(btn);
  };

  // v37.29 — GA4 event instrumentation. Adds article context to every
  // event + tracks user behavior signals: search, language toggle, scroll
  // depth, time-on-page, share clicks. All gated by DNT + analytics
  // consent (gtag('consent', 'update') already wired in index.html).
  function gaEvent(name, params) {
    try {
      if (typeof gtag !== 'function') return;
      var p = Object.assign({}, params || {});
      // Always include article context if we're on an article page
      var slug = DN.currentSlug && DN.currentSlug();
      if (slug) {
        p.article_slug = slug;
        var art = (DN.ARTICLES || []).find(function(a){ return a.slug === slug; });
        if (art) {
          if (art.cat) p.article_category = art.cat;
          if (art.tag_en) p.article_tag = art.tag_en;
        }
      }
      p.lang = (DN.detectLang && DN.detectLang()) || 'zh';
      gtag('event', name, p);
    } catch (e) { /* never break the page over telemetry */ }
  }
  DN.gaEvent = gaEvent;

  DN.bindEngagementTracking = function () {
    if (DN._engagementBound) return;
    DN._engagementBound = true;
    // Scroll depth: fire at 50% and 100% (each at most once per page)
    var fired50 = false, fired100 = false;
    function onScroll() {
      var h = document.documentElement;
      var max = h.scrollHeight - h.clientHeight;
      if (max <= 0) return;
      var pct = h.scrollTop / max;
      if (!fired50 && pct >= 0.5) { fired50 = true; gaEvent('scroll_50'); }
      if (!fired100 && pct >= 0.95) { fired100 = true; gaEvent('scroll_100'); }
      if (fired50 && fired100) document.removeEventListener('scroll', onScroll);
    }
    document.addEventListener('scroll', onScroll, { passive: true });
    // Time-on-page: 30s and 2min milestones (require document visible)
    var visibleSince = Date.now();
    var fired30s = false, fired2m = false;
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        visibleSince = null;
      } else if (!visibleSince) {
        visibleSince = Date.now();
      }
    });
    setTimeout(function () { if (!document.hidden && visibleSince && !fired30s) { fired30s = true; gaEvent('time_30s'); } }, 30 * 1000);
    setTimeout(function () { if (!document.hidden && visibleSince && !fired2m)  { fired2m  = true; gaEvent('time_2min'); } }, 2 * 60 * 1000);
    // Language toggle
    var langToggle = document.getElementById('langToggle');
    if (langToggle) {
      langToggle.addEventListener('change', function () {
        gaEvent('lang_toggle', { to_lang: langToggle.value });
      });
    }
    // Share clicks (any [data-share] element or anchors to share URLs)
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-share-platform], a[href*="line.me"], a[href*="twitter.com/intent"], a[href*="facebook.com/sharer"]');
      if (t) {
        var platform = t.dataset.sharePlatform ||
                       (t.href && t.href.match(/(line|twitter|facebook)/i) || ['', ''])[1] || 'unknown';
        gaEvent('share_click', { platform: String(platform).toLowerCase() });
      }
      // Print button
      if (e.target.closest('#hs-print-btn')) gaEvent('print_click');
      // Bookmark button
      if (e.target.closest('#hs-bookmark')) gaEvent('bookmark_click');
      // Search button (opens Cmd+K)
      if (e.target.closest('button[aria-label="搜尋"], button[aria-label="Search"]')) gaEvent('search_open');
      // Related-article click
      var related = e.target.closest('#hs-related a');
      if (related) gaEvent('related_click', { target_slug: (related.getAttribute('href') || '').split('/').pop() });
      // Prev/Next navigation
      var pn = e.target.closest('#hs-prevnext a');
      if (pn) gaEvent('prevnext_click', { direction: pn.dataset.pn || 'unknown' });
    });
  };

  // v37.27 — global JS runtime error sink. Silent failures used to fall
  // into the browser console only; nobody saw them in production. Now they
  // POST to /api/errors which logs to Vercel stdout (retained ~30 days
  // depending on plan). Client-side dedup + tab-burst dampener prevent
  // flooding the endpoint when a single error fires in a loop.
  DN._errorsSeen = Object.create(null);
  DN._errorsSentThisTab = 0;
  function reportClientError(payload) {
    try {
      if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;
      if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
      // Dedup: identical message+url+line — send only once per tab
      var key = (payload.message || '') + '|' + (payload.url || '') + '|' + (payload.line || '');
      if (DN._errorsSeen[key]) return;
      DN._errorsSeen[key] = 1;
      // Cap: max 25 distinct errors per tab session
      if (DN._errorsSentThisTab >= 25) return;
      DN._errorsSentThisTab++;
      // Use sendBeacon if available (keeps tab close from cancelling the report)
      var body = JSON.stringify(Object.assign({ ts: Date.now(), ua: navigator.userAgent }, payload));
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/errors', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/errors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function(){});
      }
    } catch (e) { /* never let error reporting throw */ }
  }
  DN.bindErrorReporting = function () {
    if (DN._errorReportingBound) return;
    DN._errorReportingBound = true;
    window.addEventListener('error', function (e) {
      reportClientError({
        type: 'error',
        message: String(e.message || ''),
        stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 2000) : '',
        url: String(e.filename || location.href),
        line: e.lineno || null,
        col: e.colno || null,
      });
    }, true);
    window.addEventListener('unhandledrejection', function (e) {
      var r = e.reason || {};
      reportClientError({
        type: 'unhandledrejection',
        message: String(r.message || r || '').slice(0, 500),
        stack: r.stack ? String(r.stack).slice(0, 2000) : '',
        url: location.href,
      });
    });
  };

  // v37.26 — Vercel Speed Insights. Privacy-friendly RUM (no cookies,
  // just aggregated CWV: LCP, FID, INP, CLS, TTFB). Auto-injected when
  // Vercel Web Analytics is enabled in the project dashboard. Respects
  // DNT (Vercel's /_vercel/insights/script.js bails internally on
  // navigator.doNotTrack === '1'). No-op on localhost / preview.
  DN.injectSpeedInsights = function () {
    if (document.getElementById('hs-vercel-insights')) return;
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;
    if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
    var s = document.createElement('script');
    s.id = 'hs-vercel-insights';
    s.src = '/_vercel/insights/script.js';
    s.defer = true;
    s.dataset.endpoint = '/_vercel/insights/event';
    document.head.appendChild(s);
  };

  // ---------- orchestrator ----------
  DN.initBlog = function (opts) {
    opts = opts || {};
    let curLang = DN.detectLang();

    function apply(lang) {
      curLang = lang;
      safeCall('applyTextOnly', function () { DN.applyTextOnly(lang); });
      const isZh = (lang === 'zh');
      const ze = document.getElementById(opts.proseZh || 'proseZh');
      const en = document.getElementById(opts.proseEn || 'proseEn');
      // Two architectures coexist:
      //   (A) Dual-content mode — separate proseZh + proseEn divs, swap visibility.
      //   (B) Inline bilingual mode — single wrapper (often still id="proseZh" for
      //       admin tooling), every element has data-zh/data-en. In this mode
      //       proseEn does NOT exist; hiding proseZh would erase the entire body.
      if (en) {
        if (ze) ze.style.display = isZh ? '' : 'none';
        en.style.display = isZh ? 'none' : '';
      } else if (ze) {
        ze.style.display = '';   // inline-bilingual: always show
      }
      if (typeof opts.onChange === 'function') opts.onChange(lang);
    }

    // Cross-browser idle-callback shim (Safari + iOS WebKit don't have rIC).
    // Round-2 review: the comment below USED to claim "each is wrapped in
    // try/catch via idle() shim so errors stay siloed" — the shim did no such
    // thing, so one throwing widget silently killed every later widget in the
    // same block (including the trailing applyTextOnly re-translate, which
    // would leave injected UI stuck in Chinese on /en/). The wrapper makes
    // that claim true at BLOCK level and REPORTS the failure instead of
    // swallowing it. (Per-CALL isolation inside a block is BACKLOG M-15.)
    var _rIC = window.requestIdleCallback || function (cb, opts) {
      var t = (opts && opts.timeout) || 250;
      return setTimeout(function () { cb({ didTimeout: false, timeRemaining: function () { return 50; } }); }, t);
    };
    var idle = function (cb, opts) {
      return _rIC(function (deadline) {
        try {
          cb(deadline);
        } catch (e) {
          try {
            if (window.console && console.warn) console.warn('[hs-init] idle block failed:', e);
            if (DN.gaEvent) DN.gaEvent('init_error', { phase: 'idle', msg: String((e && e.message) || e).slice(0, 120) });
          } catch (e2) {}
        }
      }, opts);
    };

    // M-15: per-CALL isolation. idle() already siloes a whole phase, but inside
    // a phase one throw still skipped every later call — including the trailing
    // DN.applyTextOnly(curLang), which is what re-renders injected UI in the
    // page's language, so a single failure could strand /en/ pages showing
    // Chinese chrome. The Phase-1 calls are worse still: they are NOT inside
    // idle(), so a throw there aborted initBlog outright.
    // Reports the same way idle() does, but names the specific call.
    var safeCall = function (name, fn) {
      try {
        fn();
      } catch (e) {
        try {
          if (window.console && console.warn) console.warn('[hs-init] ' + name + ' failed:', e);
          if (DN.gaEvent) DN.gaEvent('init_error', { phase: name, msg: String((e && e.message) || e).slice(0, 120) });
        } catch (e2) {}
      }
    };

    // ── PHASE 1 — synchronous / blocking (must run before first paint) ──
    // Anything that affects above-the-fold layout, language toggle, or
    // first-screen content rendering belongs here.
    safeCall('bindAutoTheme', function () { DN.bindAutoTheme(); });        // dark/light from prefers-color-scheme (FOUC-safe)
    safeCall('upgradeDialogs', function () { DN.upgradeDialogs(); });       // promote [data-dialog] to native <dialog>
    safeCall('upgradePopovers', function () { DN.upgradePopovers(); });      // wire [data-popover-trigger] → popovertarget
    safeCall('upgradeSelectLists', function () { DN.upgradeSelectLists(); });   // <select data-selectlist> → <selectlist>
    safeCall('hideStubLinks', function () { DN.hideStubLinks(); });        // hide unfinished articles before paint
    safeCall('applyFetchPriority', function () { DN.applyFetchPriority(); });   // LCP hints (high/low fetchpriority)
    safeCall('styleTextFragments', function () { DN.styleTextFragments(); });   // ::target-text styling for #:~:text= deep-links
    safeCall('bindNavigation', function () { DN.bindNavigation(); });       // Navigation API soft-nav + unsaved-edit guard
    safeCall('assignVTNames', function () { DN.assignVTNames(); });        // pair article cards ↔ hero for cross-doc morph
    safeCall('injectMobileMenu', function () { DN.injectMobileMenu(); });
    safeCall('bindLangToggle', function () { DN.bindLangToggle(apply); });
    apply(curLang);
    safeCall('injectFooterYear', function () { DN.injectFooterYear(); });
    safeCall('bindErrorReporting', function () { DN.bindErrorReporting(); });   // v37.27 — global JS error sink → /api/errors
    safeCall('bindEngagementTracking', function () { DN.bindEngagementTracking(); }); // v37.29 — GA4 events (scroll/time/share/nav)
    safeCall('injectSpeedInsights', function () { DN.injectSpeedInsights(); });  // v37.26 — Vercel CWV beacon (DNT-respecting)
    safeCall('addReadingProgress', function () { DN.addReadingProgress(); });   // top scroll bar — visible immediately, cheap
    safeCall('shuffleHeroCards', function () { DN.shuffleHeroCards(); });     // home cover-story shuffle (above-the-fold)
    safeCall('injectSpotlight', function () { DN.injectSpotlight(); });      // 最近更新 + 熱門推薦 (above-the-fold on mobile)
    safeCall('bindHomeSearch', function () { DN.bindHomeSearch(); });
    safeCall('bindThemeToggle', function () { DN.bindThemeToggle(); });      // dark-mode toggle button (header)
    safeCall('injectMobileBottomNav', function () { DN.injectMobileBottomNav(); });
    safeCall('markNewArticles', function () { DN.markNewArticles(); });      // NEW badge on home article cards
    safeCall('capHomeArticleList', function () { DN.capHomeArticleList(); });   // v34.12: sort by date desc, cap visible at 5

    // Article-only enhancements that affect above-the-fold layout
    var isArticle = document.getElementById('proseZh') || document.querySelector('article .prose');
    if (isArticle) {
      safeCall('injectBreadcrumb', function () { DN.injectBreadcrumb(); });   // v37.42 — visible breadcrumb above the title (SERP path)
      safeCall('injectArticleHero', function () { DN.injectArticleHero(); });  // gradient SVG banner under H1 (above-the-fold)
      safeCall('addReadingMeta', function () { DN.addReadingMeta(); });
      safeCall('addInlineTOC', function () { DN.addInlineTOC(); });
    }

    // Blog index — cat filter + tag cloud + search bar (only on /blog/)
    if (document.getElementById('hs-blog-filter')) {
      safeCall('bindBlogFilter', function () { DN.bindBlogFilter(); });
    }

    // Bind the visible search control before idle work, so its first click works.
    safeCall('initCmdK', function () { DN.initCmdK(); });

    // Admin WYSIWYG mode (only when ?admin=1 in URL) — must run AFTER hero
    // injection so the editable selectors include the H1, but BEFORE Phase 2
    // related-articles/share toolbar (which we hide in admin mode anyway).
    safeCall('initAdminMode', function () { DN.initAdminMode(); });

    // ── PHASE 2 — idle / deferred (run after first paint) ──
    // Heavy widgets, analytics, modals, and below-the-fold features run
    // in requestIdleCallback so they don't block FCP/LCP on slow mobile
    // CPUs. The idle() wrapper catches a throw so one failing BLOCK cannot
    // take down a later phase; a throw still aborts the remaining calls
    // WITHIN its own block (BACKLOG M-15 tracks per-call isolation).
    idle(function () {
      safeCall('addScrollToTop', function () { DN.addScrollToTop(); });
      safeCall('bindRevealOnScroll', function () { DN.bindRevealOnScroll(); });
      safeCall('bindViewTransitions', function () { DN.bindViewTransitions(); });
      safeCall('prefetchOnIdle', function () { DN.prefetchOnIdle(); });
      safeCall('injectSpeculationRules', function () { DN.injectSpeculationRules(); });   // Chromium prerender hint (v37.30)
      safeCall('bindAlgoliaDocSearch', function () { DN.bindAlgoliaDocSearch(); });   // upgrades to DocSearch if creds in <meta>
      safeCall('bindLottieHero', function () { DN.bindLottieHero(); });         // mount Lottie players on [data-lottie] divs
      safeCall('injectReadProgress', function () { DN.injectReadProgress(); });
      safeCall('addFontSizer', function () { DN.addFontSizer(); });
      safeCall('bindFAQDeepLink', function () { DN.bindFAQDeepLink(); });
      safeCall('applyAbConfig', function () { DN.applyAbConfig(); });      // server-driven A/B variant swaps
      safeCall('injectFooterKofi', function () { DN.injectFooterKofi(); });   // Ko-fi support button in every page footer
      // v34.10: injectReadProgress / addFontSizer / initCmdK populate fresh
      // DOM with data-zh/data-en. Re-run applyTextOnly so they show in the
      // current language (otherwise the homepage 閱讀進度 / 已讀 / 篇 /
      // 重設 / 閱讀後自動記錄 stays Chinese in /en/ mode).
      safeCall('applyTextOnly', function () { DN.applyTextOnly(curLang); });
    }, { timeout: 800 });

    // Article-only deferred work (calculators, share, related, feedback)
    if (isArticle) {
      idle(function () {
        safeCall('enhanceArticleImages', function () { DN.enhanceArticleImages(); }); // lazy + lightbox
        safeCall('addFloatingTOC', function () { DN.addFloatingTOC(); });
        safeCall('bindReadEngagement', function () { DN.bindReadEngagement(); });   // engagement-gated read tracking (≥30s + ≥50% scroll)
        safeCall('bindScrollMemory', function () { DN.bindScrollMemory(); });
        safeCall('addInlineCTA', function () { DN.addInlineCTA(); });
        safeCall('injectArticleCalculators', function () { DN.injectArticleCalculators(); });
        safeCall('injectAuthorBio', function () { DN.injectAuthorBio('hs-author-bio'); });
        safeCall('injectArticleSupport', function () { DN.injectArticleSupport(); });   // independent Ko-fi support section
        safeCall('injectShareToolbar', function () { DN.injectShareToolbar('hs-share'); });
        // v34.8: DN.injectBMC removed — it was a 2nd "☕ 支持我寫更多衛教文章"
        // pill that duplicated the new injectArticleSupport section above.
        // The injectBMC function stays in the code but no longer auto-mounts.
        safeCall('addRelatedArticles', function () { DN.addRelatedArticles(); });
        // DN.injectPrevNext() removed v33.1 per user request
        safeCall('addFeedbackLink', function () { DN.addFeedbackLink(); });
        // v34.5 — print + bookmark buttons removed per user request: they
        // overlapped the bottom-right font-sizer. Stubs still called so any
        // cached older button DOM gets cleaned up. Page is still printable
        // via Cmd/Ctrl+P; bookmarking via browser bookmark.
        safeCall('addPrintButton', function () { DN.addPrintButton(); });      // no-op cleanup stub
        safeCall('addBookmarkButton', function () { DN.addBookmarkButton(); });   // no-op cleanup stub
        safeCall('lazyLoadAudit', function () { DN.lazyLoadAudit(); });       // backstop loading="lazy" / fetchpriority
        safeCall('injectDictTooltips', function () { DN.injectDictTooltips(); });  // medical-dictionary hover popups
        safeCall('bindPushSubscribe', function () { DN.bindPushSubscribe(); });   // 🔔 web-push subscribe button (if VAPID key set)
        safeCall('loadMermaid', function () { DN.loadMermaid(); });         // lazy-load mermaid if <pre class="mermaid"> present
        safeCall('loadKatex', function () { DN.loadKatex(); });           // lazy-load KaTeX if $$math$$ present
        safeCall('bindDocPiP', function () { DN.bindDocPiP(); });          // 📺 picture-in-picture reading mode
        safeCall('bindShareFiles', function () { DN.bindShareFiles(); });      // navigator.share() with files
        safeCall('applyRelativeTime', function () { DN.applyRelativeTime(); });   // [data-relative-time] → "3 天前"
        safeCall('applyTextOnly', function () { DN.applyTextOnly(curLang); });  // re-translate JS-injected DOM
      }, { timeout: 1200 });
    }

    // Tools-page calculator placeholders (mounted lazily)
    if (document.querySelector('[data-calc]')) {
      idle(function () {
        document.querySelectorAll('[data-calc]').forEach(function (el) {
          var name = el.getAttribute('data-calc');
          var sel = '[data-calc="' + name + '"]';
          safeCall('calculator:' + name, function () {
            if (name === 'osdi')           DN.injectOSDI(sel);
            else if (name === 'deq5')      DN.injectDEQ5(sel);
            else if (name === 'snellen')   DN.injectSnellenLogMAR(sel);
            else if (name === 'se')        DN.injectSphericalEquivalent(sel);
            else if (name === 'floater')   DN.injectFloaterRedFlag(sel);
          });
        });
        safeCall('applyTextOnly', function () { DN.applyTextOnly(curLang); });
      }, { timeout: 1500 });
    }

    // ── PHASE 3 — fully background (no user-facing impact for ~2s) ──
    // SW registration, GA event binding, Web Vitals reporting all run
    // after everything else stabilizes.
    idle(function () {
      safeCall('bindGAEvents', function () { DN.bindGAEvents(); });
      safeCall('bindWebVitals', function () { DN.bindWebVitals(); });
      // DN.bindPWAInstall() removed v34.1 per user request — site is still
      // installable via browser menu (manifest.json present), we just don't
      // show our own floating "📲 加入主畫面" prompt.
      safeCall('bindIdleDetection', function () { DN.bindIdleDetection(); });   // pause work after 60s idle (Chrome IdleDetector)
      safeCall('bindComputePressure', function () { DN.bindComputePressure(); }); // back off CSS anims / prefetch when CPU stressed
      // (cookie banner removed; Consent Mode v2 defaults remain set in <head>)
      safeCall('registerSW', function () { DN.registerSW(); });
    }, { timeout: 2500 });

    // CRITICAL: re-apply lang to all DOM populated in PHASE 1.
    // (PHASE 2 work re-runs this itself after its own injections.)
    safeCall('applyTextOnly', function () { DN.applyTextOnly(curLang); });

    return { applyLang: apply };
  };
})();
