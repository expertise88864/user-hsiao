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
/* v28: ADMIN POWER SPRINT + WEB-PUSH + CSP-NONCE + LIGHTHOUSE CI
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
const CACHE = 'hs-v28';
const RUNTIME = 'hs-runtime-v28';
const RUNTIME_MAX_ENTRIES = 60;

const PRECACHE = [
  '/',
  '/index.html',
  '/about',
  '/privacy',
  '/404.html',
  '/offline.html',
  '/icon.svg',
  '/favicon.ico',
  '/icon-32.png',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/logo-512.png',
  '/manifest.json',
  '/SUNN1302-220.webp',
  '/SUNN1302-220.avif',
  '/SUNN1302-440.webp',
  '/blog/',
  '/assets/app.css',
  '/assets/article.css',
  '/blog/blog-shared.js',
  '/blog/feed.xml',
  '/blog/atom.xml',
  '/blog/dry-eye-myths',
  '/blog/pediatric-myopia-control',
  '/blog/floaters-retinal-detachment',
  '/blog/topics',
  '/blog/cataract-surgery-faq',
  '/blog/glaucoma-warnings',
  '/blog/contact-lens-safety',
  '/blog/red-eye-conjunctivitis',
  '/blog/lacrimal-gland-tumor',
  '/notes',
  '/tools',
  // Per-article OG cards (1200×630) — used by social link previews
  '/assets/og/dry-eye-myths.png',
  '/assets/og/pediatric-myopia-control.png',
  '/assets/og/floaters-retinal-detachment.png',
  '/assets/og/lacrimal-gland-tumor.png',
  // English mirror (/en/) — kept lightweight; runtime cache covers the rest
  '/en/',
  '/en/about',
  '/en/tools',
  '/en/blog/'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE && k !== RUNTIME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
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

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
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
