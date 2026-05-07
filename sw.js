/* HsiaoEye service worker — offline-first for static, network-first for HTML
 * v19: CONTENT POLISH SPRINT — medical illustrations + print + decluttering
 *      + Each article now has 1–2 medically-accurate SVG figures + 1 evidence
 *        table sourced from peer-reviewed lit:
 *        – dry-eye: DEWS II diagnostic flowchart + severity staging (4 levels)
 *        – myopia: axial elongation diagram + 7-intervention efficacy table
 *          (LAMP / ATOM2 / Walline / Lam / Chamberlain / BAMC / Wu)
 *        – floaters: PVD 4-stage progression + AAO PPP triage decision tree
 *      + Hero SVG library redesigned as full slug-specific scenes (no more
 *        generic "eye + dots") — each tells the article's medical story
 *      + @media print rules in app.css: hides nav/footer/share/ads/floating
 *        widgets, expands collapsibles, shows URLs after links — clean A4
 *        handouts ready for clinic
 *      + Removed duplicate footer 作者簡介 link (kept 關於作者)
 *      + Reading-progress widget no longer shows "/ N 篇" total count
 * v18: 3-phase initBlog (rIC), content-visibility:auto, font trim, hr dividers.
 * v17: per-article OG cards, _gen_feeds.py, addFeedbackLink, search button.
 * v16: /en/ mirror, calculator framework + 5 ophth calcs.
 *     cache-bust ?v=20260520
 */
/* v24: LAYOUT + UX SPRINT
 *  + FIX: red-flag/related-articles boxes now render correctly
 *    — added cache-buster `?v=20260525` to /assets/app.css <link> tags
 *      (vercel.json cached app.css for 30 days as immutable, so users
 *      with stale CSS missed the .hs-redflag-box rule added in v20)
 *    — also embedded the rules INLINE in each article as defense-in-depth
 *  + halfwidth_to_fullwidth.py extended with `:` (colon) rule
 *    — caught 260 missed half-width punctuations across 26 files
 *  + REMOVED 本期推薦 (Editor's Pick) hero from home — single Cover Story
 *    rotation only. shuffleHeroCards now no-ops gracefully if pickEl absent.
 *  + POPULAR_SLUGS now reflects realistic public-interest topics
 *    (myopia / dry-eye / floaters), NOT auto-promoting newest article.
 *    Rare-disease lacrimal-tumor stays in 最近更新 only.
 *  + DermNotes parity: ported DN.toast + DN.addPrintButton +
 *    DN.addBookmarkButton + DN.lazyLoadAudit. Articles now have floating
 *    print + bookmark buttons (right-bottom, above scroll-to-top).
 *  + Lacrimal-tumor article: "Goldberg/Esmaeli 2018" citation cleaned up
 *    to credit it as secondhand via Ma 2024 Heliyon (transparent source chain).
 * v23: 50% → 9% epidemiology fix + DN.injectPrevNext + №X prefix.
 * v22: new lacrimal-gland-tumor article. */
/* v26: ARTICLE VISIBILITY + OPTIMIZATION SPRINT
 *  + FIX: lacrimal-gland-tumor article now visible on /blog/index.html
 *    (catalog) and /blog/topics.html (new "Orbit · Oncology" section).
 *    Previously was only in DN.ARTICLES + home spotlight, missing from
 *    the article-list catalog page.
 *  + Extracted ~13 KB of duplicated inline CSS from 4 articles into
 *    /assets/article.css (cacheable). Each article now ~3 KB lighter.
 *  + CSS containment hints (`contain: layout style`) on cards / spotlight
 *    rows / topic cards — speeds up scroll-triggered re-layout in long lists.
 *  + DN.bindCookieConsent — first-visit banner with 「同意統計」/「僅必要功能」
 *    buttons. Drives gtag('consent','update',{...}). Analytics-granted users
 *    get richer data; denied users see no further tracking.
 *  + DN.abTest + DN.abConvert — lightweight A/B testing. Stable per-visitor
 *    bucketing, GA4 ab_exposure / ab_conversion events, sessionStorage-gated
 *    conversion deduplication.
 *  + Service Worker stale-while-revalidate for *.css — CSS edits now
 *    propagate after one extra page load, no manual cache-bust needed.
 * v25: GA4 + Consent Mode v2 + Speculation Rules. */
/* v30: PERFORMANCE + DEVELOPER-EXPERIENCE SPRINT
 *  + Edge streaming HTML rewriter (middleware.js): per-request CSP nonce
 *    auto-injected into every inline <script>/<style> tag via TransformStream.
 *    'strict-dynamic' enforces nonce-only for script execution; modern
 *    browsers ignore the 'unsafe-inline' fallback. Old browsers (Safari
 *    <15.4) still get 'unsafe-inline' for compat.
 *  + Image CDN srcset pipeline: WYSIWYG editor 📷 button now generates
 *    220/440/660/1320 widths × (webp+avif) on the client + uploads as
 *    one bundle via /api/admin/upload-srcset → returns ready-to-paste
 *    <picture> snippet with proper sizes attribute. AVIF probed at runtime
 *    (Safari 16+ / Chrome 85+); falls back to webp when unsupported.
 *  + A11y CI: axe-core runs on production URLs (push + workflow_dispatch),
 *    wcag2a/wcag2aa/best-practice tags, --exit on violation, JSON report
 *    uploaded as 30-day artifact.
 *  + Markdown mode: /api/admin/md round-trips article HTML ↔ Markdown
 *    (handles h1-h6 / lists / tables / blockquotes / figures / inline
 *    formatting). Admin tab has split-view editor + live preview.
 *  + Offline favourites: bookmark button now postMessages SW with
 *    CACHE_FAVORITE which pre-caches HTML + every image + OG card so
 *    user can read in airplane mode. UNCACHE_FAVORITE on remove.
 *  + Dynamic OG images via @vercel/og — /api/og?slug=<slug> renders 1200×630
 *    PNG from JSX at the edge. Static /assets/og/*.png still preferred
 *    (immutable cache); missing slugs auto-fall through to dynamic.
 *  + Schema helpers: /api/admin/schema-helper extracts Q&A pairs from
 *    <details><summary>, .myth-card, h2-with-? patterns and injects
 *    schema.org FAQPage (or HowTo). Admin row has ❓ FAQ button.
 *  + ETag + If-None-Match on /sitemap.xml + /blog/feed.xml + atom.xml.
 *    Crawler revisits get 304 No Content (no body bytes). Server-Timing
 *    header exposes per-stage timing.
 *  + CWV admin dashboard: /api/admin/cwv pulls LCP/CLS/INP/FCP/TTFB from
 *    GA4 Reporting API via service-account JWT. New "📉 CWV" admin tab
 *    shows p75 + sample count + good/warn/poor band.
 *  + Multi-stage SW pre-cache: install only blocks on critical SHELL
 *    (~10 assets, ~80ms). POPULAR articles + OG cards pre-cached
 *    asynchronously after activate. LAZY tier hits runtime cache.
 *  + i18n JSON: /assets/i18n.json + DN.t('key.path') replaces scattered
 *    data-zh/data-en attributes. Lazy-loaded, falls back to data-zh/en
 *    if key missing. <span data-t="btn.bookmark"> markers auto-resolved.
 *  + Visual regression: Playwright + git-tracked snapshots
 *    (tests/visual/snapshots). 7 pages × 3 viewports = 21 baseline shots.
 *    npx playwright test --update-snapshots to refresh.
 *  + Size budget CI: tracks raw + gzip kB per asset, enforces 5 budgets
 *    (blog-shared.js ≤180 kB raw / ≤50 kB gz, etc.). Top 25 assets logged.
 *  + SRI helper: /api/admin/sri computes sha256/384/512 for any URL +
 *    returns ready-to-paste <script> snippet with integrity attribute.
 *    Warns when URL is GTM/GA (frequent updates → SRI breakage risk).
 *  + Web Components: /assets/components.js defines <hs-myth>, <hs-redflag>,
 *    <hs-keypoint>, <hs-tldr>. Shadow DOM encapsulation, prefers-color-scheme
 *    aware. Article authors can use semantic markup instead of class soup.
 *  + SSE for /en/ regen: /api/admin/regen-en-stream streams progress events
 *    (start, progress, complete). Admin "全部重生" button shows live
 *    "x/N · slug" counter instead of waiting silently 30-60s.
 *  + Workflow fix: regen-en.yml now has `permissions: contents: write` so
 *    the bot can push the regenerated /en/ commit (was failing in v29).
 * v29: ADMIN POLISH + WEB-PUSH ENCRYPT + DYNAMIC FEEDS + KV + CSP ENFORCE
 *  + Web Push payload encryption (aes128gcm RFC 8291) — VAPID JWT + ECDH +
 *    HKDF-SHA256 + AES-128-GCM all via WebCrypto on Edge runtime, no npm
 *    `web-push` dep. Subscribers see real title + body + url, click jumps
 *    to the article. SW renders 2 actions (查看 / 稍後).
 *  + /api/push/key endpoint exposes VAPID public key (cached 1 hr at edge)
 *    so the client subscribe button auto-discovers it without a hardcoded
 *    `<meta>` injection.
 *  + Vercel KV adapter (api/_kv.js) — push subscribers + A/B exposures now
 *    persist to KV (atomic HINCRBY) instead of GitHub blob. Falls back to
 *    GH blob automatically when KV env vars absent.
 *  + Admin auto-fix SEO: /api/admin/seo-fix patches missing canonical /
 *    hreflang / og:image / twitter:card / theme-color / JSON-LD / meta
 *    description in one click. Single + bulk modes in /admin SEO tab.
 *  + Dynamic sitemap (/api/sitemap → /sitemap.xml via rewrite). Pulls
 *    DN.ARTICLES from blog-shared.js + queries actual git lastmod per file
 *    via GitHub commits API. Cached 6 hr at edge.
 *  + Dynamic RSS + Atom (/api/feed → /blog/feed.xml + /blog/atom.xml). NEW
 *    namespaces: media:content, media:thumbnail, content:encoded with
 *    full description + per-article OG image enclosure for Feedly preview.
 *  + Blog index gets cat filter + tag cloud + search bar (DN.bindBlogFilter).
 *    URL ?cat=myth&tag=乾眼症&q=foo is shareable; reset button clears.
 *  + PWA install prompt — beforeinstallprompt captured, "📲 加入主畫面"
 *    floating button after 8s. iOS-specific Safari hint after 12s.
 *    Dismissed for 30 days via localStorage.
 *  + Auto dark-mode listener — DN.bindAutoTheme respects existing
 *    bindThemeToggle but adds live MQ change listener so OS theme flip
 *    updates immediately (when user hasn't manually picked).
 *  + Admin: embedded edit mode via iframe (/admin → ✏️ 編輯 = no context
 *    loss; postMessage on save tells parent dashboard). 🩹 SEO 修 button
 *    per-row + 全部修復 in SEO tab. 📢 push send modal in 維運 tab.
 *  + CSP: Report-Only → enforce (vercel.json + middleware.js). Tighter
 *    nonce-less variant kept in Report-Only header for migration.
 * v28: ADMIN POWER SPRINT + WEB-PUSH + CSP-NONCE + LIGHTHOUSE CI
 *  + NEW: 6 admin endpoints — /api/admin/{upload,regen-en,history,rollback,
 *    reorder,seo-score,spell,dictionary,ab-stats}. Admin can now:
 *      • Upload images (auto WebP-compressed, base64→GitHub blob)
 *      • Regenerate /en/ mirror per-article or whole site
 *      • View git history per file + 1-click rollback (creates forward commit)
 *      • Drag-and-drop reorder DN.ARTICLES
 *      • Run SEO 體檢 (15-check heuristic, A/B/C/D/F grade)
 *      • Run 拼字 / 全形標點 check (8 rule classes)
 *      • Edit medical dictionary + auto-link first-occurrence in articles
 *      • View live A/B exposures + conversions per-variant
 *  + admin.html rewritten as multi-tab dashboard (7 tabs: 文章/SEO/拼字/詞典/
 *    圖片/AB/維運). Drag-drop article reorder, in-tab modals.
 *  + WYSIWYG toolbar gains 📷 圖片 (paste-or-pick) + 👁 預覽 (open clean tab)
 *  + Web Push: /api/push/{subscribe,send} + DN.bindPushSubscribe + sw.js push
 *    handler (VAPID JWT signing in Edge runtime). Subscribers stored in
 *    assets/push-subscribers.json.
 *  + CSP nonce via Vercel Edge Middleware (middleware.js) — Report-Only mode
 *    initially, /api/csp-report endpoint logs violations.
 *  + Trusted Types: hs-policy + default policy registered in blog-shared.js
 *  + View Transitions: cross-document via @view-transition CSS rule (Chrome 126+),
 *    JS hijack only fires when browser lacks native cross-doc support.
 *  + Web Vitals: extended to TTFB + FCP + prerender_hit detection (full 5/5).
 *  + Speculation Rules: split into multi-rule with eagerness=eager prefetch
 *    for /blog/* + moderate prerender (was single moderate rule).
 *  + Lighthouse CI: .github/workflows/lighthouse.yml runs daily + on push,
 *    asserts perf ≥85 / a11y ≥92 / SEO ≥95.
 *  + /en/ regen on push: .github/workflows/regen-en.yml auto-syncs after
 *    Chinese-side commits (skips itself via [skip ci]).
 *  + OG image edge cache: assets/og/* pinned to s-maxage=1y + CDN-Cache-Control.
 *  + AB stats beacon: DN.abTest/abConvert now POST to /api/admin/ab-stats
 *    via sendBeacon (fire-and-forget, sessionStorage-deduped exposures).
 *  + Medical dictionary tooltips: DN.injectDictTooltips renders rich
 *    hover popups for <span class="hs-dict"> from autolink action.
 * v27: ADMIN MODE + UX FIXES
 *  + NEW: /admin dashboard + WYSIWYG editor (?admin=1 on any article)
 *    + /api/admin/{login,list,save,new}.js Vercel serverless routes
 *    + GitHub Contents API integration — admin saves commit straight to repo
 *    + Auth: HMAC-signed httpOnly cookie, 8-hr session
 *    + Required Vercel env vars: ADMIN_PASSWORD, GITHUB_TOKEN,
 *      GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH
 *  + Reading-progress: now engagement-gated (≥30s + ≥50% scroll), not on
 *    page load. Prevents bounce traffic from inflating "已讀" count.
 *  + Floating left-side TOC: breakpoint lowered 1280px → 1100px so 13"
 *    laptops see it. Active section highlight via IntersectionObserver.
 *  + Halfwidth converter: now stashes <script>+attribute values, catches
 *    Latin/digit ↔ Chinese comma boundary (244 more replacements).
 *  + Removed cookie banner per user request (Consent Mode v2 defaults remain).
 *  + SW: skip /admin and /api/* from caching (auth-sensitive, must be fresh).
 * v26: layout fixes, CSS dedup, A/B framework, SW SWR for *.css. */
const CACHE = 'hs-v30';
const RUNTIME = 'hs-runtime-v30';
const RUNTIME_MAX_ENTRIES = 60;

// v30: Multi-stage cache. Install only blocks on the truly critical
// shell — fonts/CSS/icon + home + blog index. Everything else is moved
// to a deferred `cache.add()` after `activate` completes (or on first use
// via runtime cache). This shaves install time from ~2-4s to ~300-500ms,
// which matters because slow installs delay first paint on poor networks.
const SHELL = [
  '/',
  '/index.html',
  '/offline.html',
  '/icon.svg',
  '/favicon.ico',
  '/manifest.json',
  '/blog/',
  '/assets/app.css',
  '/assets/article.css',
  '/blog/blog-shared.js',
];

// Top-5 most-visited articles + their OG cards. Pre-cached AFTER install
// completes so it doesn't block. Re-evaluated on activation.
const POPULAR = [
  '/blog/dry-eye-myths',
  '/blog/pediatric-myopia-control',
  '/blog/floaters-retinal-detachment',
  '/blog/lacrimal-gland-tumor',
  '/assets/og/dry-eye-myths.png',
  '/assets/og/pediatric-myopia-control.png',
  '/assets/og/floaters-retinal-detachment.png',
  '/assets/og/lacrimal-gland-tumor.png',
];

// Lazy tier — don't pre-cache, but added to runtime cache on first hit.
// Listed only for documentation / runtime fallback heuristics.
const LAZY = [
  '/about', '/privacy', '/404.html', '/notes', '/tools',
  '/icon-32.png', '/icon-192.png', '/icon-512.png',
  '/apple-touch-icon.png', '/logo-512.png',
  '/SUNN1302-220.webp', '/SUNN1302-220.avif', '/SUNN1302-440.webp',
  '/blog/feed.xml', '/blog/atom.xml',
  '/blog/topics', '/blog/cataract-surgery-faq', '/blog/glaucoma-warnings',
  '/blog/contact-lens-safety', '/blog/red-eye-conjunctivitis',
  '/en/', '/en/about', '/en/tools', '/en/blog/',
];

// Combined for activate-time cleanup — anything in the cache that ISN'T
// in any tier is fair game to evict in trimCache(...).
const PRECACHE = [...SHELL, ...POPULAR, ...LAZY];

self.addEventListener('install', (e) => {
  // Stage 1: only the critical shell (~10 small assets, ~80ms on cable).
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    Promise.all([
      // Cleanup old version caches
      caches.keys().then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE && k !== RUNTIME).map((k) => caches.delete(k))
      )),
      // Stage 2: pre-cache top-5 articles + OG cards in the background.
      // Wrapped in a setTimeout-style microtask so it runs AFTER claim() so
      // page navigations aren't blocked.
      caches.open(CACHE).then(async (c) => {
        // Don't await: schedule then return immediately
        Promise.allSettled(POPULAR.map((u) => c.add(u))).catch(() => {});
      }),
      self.clients.claim(),
    ])
  );
});

async function trimCache(cacheName, max) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= max) return;
    const toDelete = keys.slice(0, keys.length - max);
    await Promise.all(toDelete.map((req) => cache.delete(req)));
  } catch (e) { /* ignore */ }
}

async function fetchWithRetry(req, retries = 1) {
  try {
    const r = await fetch(req);
    if (r && (r.ok || r.type === 'opaque')) return r;
    if (retries > 0) return fetchWithRetry(req, retries - 1);
    return r;
  } catch (err) {
    if (retries > 0) return fetchWithRetry(req, retries - 1);
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Never intercept /admin pages or /api/* — these need fresh responses
  // (admin auth, save endpoints, etc.) and stale cache would break login
  // flow / break editor state. Let the network handle them directly.
  if (url.pathname === '/admin' ||
      url.pathname.startsWith('/admin') ||
      url.pathname.startsWith('/api/')) {
    return;
  }

  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    e.respondWith(
      fetchWithRetry(req)
        .then((resp) => {
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return resp;
        })
        .catch(() => caches.match(req).then((r) =>
          r || caches.match('/offline.html').then((o) => o || caches.match('/'))
        ))
    );
    return;
  }

  // ── Stale-while-revalidate for CSS files (app.css / article.css) ──
  // Serves cached version instantly, then re-fetches in background to update
  // the cache for the *next* visit. Removes the need for manual ?v= cache-
  // busting on stylesheets. Same-day CSS edits propagate after one extra page
  // load instead of relying on `?v=YYYYMMDD` on every <link> tag.
  if (url.pathname.endsWith('.css')) {
    e.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetchWithRetry(req).then((resp) => {
          if (resp && resp.status === 200) {
            const copy = resp.clone();
            caches.open(RUNTIME).then((c) => {
              c.put(req, copy);
              trimCache(RUNTIME, RUNTIME_MAX_ENTRIES);
            });
          }
          return resp;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetchWithRetry(req).then((resp) => {
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(RUNTIME).then((c) => {
            c.put(req, copy);
            trimCache(RUNTIME, RUNTIME_MAX_ENTRIES);
          });
        }
        return resp;
      }).catch(() => cached);
    })
  );
});

self.addEventListener('message', async (e) => {
  if (!e.data) return;
  if (e.data.type === 'SKIP_WAITING') { self.skipWaiting(); return; }

  // v30: Offline favourites — when client posts CACHE_FAVORITE the SW pre-caches
  // the article HTML + every image URL referenced in it, so the user can read
  // the article in airplane mode. Posting UNCACHE_FAVORITE removes it.
  if (e.data.type === 'CACHE_FAVORITE' && e.data.url) {
    try {
      const cache = await caches.open(CACHE);
      const url = e.data.url;
      // Cache the HTML
      const htmlResp = await fetch(url);
      if (htmlResp.ok) {
        await cache.put(url, htmlResp.clone());
        // Parse and pre-cache all images + the OG card
        const text = await htmlResp.text();
        const imgs = Array.from(text.matchAll(/<img[^>]+src="([^"]+)"/g)).map(m => m[1]);
        const ogs  = Array.from(text.matchAll(/<meta\s+property="og:image"\s+content="([^"]+)"/g)).map(m => m[1]);
        const all = Array.from(new Set([...imgs, ...ogs])).filter(u => u && !u.startsWith('data:'));
        for (const u of all) {
          try {
            const r = await fetch(u, { mode: 'no-cors' });
            if (r) await cache.put(u, r);
          } catch (err) { /* skip */ }
        }
        if (e.source) e.source.postMessage({ type: 'FAVORITE_CACHED', url, count: all.length + 1 });
      }
    } catch (err) {
      if (e.source) e.source.postMessage({ type: 'FAVORITE_ERROR', error: String(err) });
    }
    return;
  }

  if (e.data.type === 'UNCACHE_FAVORITE' && e.data.url) {
    try {
      const cache = await caches.open(CACHE);
      await cache.delete(e.data.url);
      if (e.source) e.source.postMessage({ type: 'FAVORITE_UNCACHED', url: e.data.url });
    } catch (err) {}
    return;
  }
});

// ── Web Push handler — fired when /api/push/send wakes us up ──
// v29: payload is now aes128gcm-encrypted (RFC 8291) so the browser decrypts
// it and event.data.json() returns the actual title/body/url. SW transparently
// handles decryption via the keys negotiated during pushManager.subscribe.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {
    try { data = { body: event.data ? event.data.text() : '' }; } catch (e2) { data = {}; }
  }
  const title = data.title || 'HsiaoEye · 新文章發布';
  const body  = data.body  || '點擊查看最新眼科衛教筆記。';
  const url   = data.url   || '/blog/';
  const icon  = data.icon  || '/icon-192.png';
  const badge = data.badge || '/icon-32.png';
  const tag   = data.tag   || 'hsiao-newpost';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      tag,
      renotify: false,
      requireInteraction: false,
      data: { url, ts: Date.now() },
      actions: [{ action: 'view', title: '查看' }, { action: 'dismiss', title: '稍後' }],
      lang: 'zh-Hant-TW',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/blog/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes(self.location.origin)) { w.focus(); w.navigate && w.navigate(url); return; }
      }
      return clients.openWindow(url);
    })
  );
});
