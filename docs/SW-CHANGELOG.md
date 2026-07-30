# sw.js 歷史發行說明（legacy release notes）

> 這份檔案是從 `sw.js` 檔頭搬出來的。**搬移原因(BACKLOG P-06)**:`sw.js` 不做 minify,
> 每個註解位元組都會送到每一位訪客的瀏覽器,而這段歷史敘述有 **385 行、25.8 KB,佔全檔 50%**,
> 把 52 KB 的 size-budget 壓到只剩約 1.2 KB 餘裕——下一個需要在 sw.js 裡寫解釋的人就會撞牆
> (2026-07-27 補審期間就撞過一次,CI 的 Size budget job 轉紅)。
>
> 內容**逐字保留**,一個字都沒改。**刻意不標版本範圍**:這個區塊裡的條目大致落在 v16–v34,
> 但 `sw.js` 裡仍有 v37.x 之類的行內註解——它們解釋的是**當前**行為,所以留在程式碼旁邊,沒有搬走。
> 也就是說這裡不是完整的版本史,只是那個獨立的歷史區塊。git log 仍然是最權威的來源。

```
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
/* v34: KO-FI SUPPORT + EDGE CONFIG + WEB NEURAL NETWORK + INTL DEEP-DIVE
 *  + Ko-fi support button — DN.BMC_URL set to https://ko-fi.com/f94001115;
 *    DN.injectFooterKofi auto-mounts a "☕ 支持我寫更多衛教文章" pill at
 *    the top of every page footer (home + articles + tools).
 *  + Edge Config adapter (api/_edge_config.js) — Vercel's sub-15ms global
 *    config store. A/B test config now reads Edge Config FIRST (KV / GH
 *    blob fallback). Writes go via Vercel REST API (~300ms).
 *  + WebNN auto-tag — DN.suggestTags(html) + /api/admin/suggest-tags
 *    endpoint use TF + medical-dictionary + heading boost to suggest 5
 *    relevant tags per article. WebNN-aware (will load Three.js TFJS USE
 *    lite when WebNN advertised), falls back to keyword-only scoring.
 *  + view-transition-name cross-doc morph — DN.assignVTNames stamps
 *    `vt-card-<slug>` on every article card on listing pages and the
 *    matching <h1>/.article-hero on the article page. Browser auto-morphs
 *    them across navigation when @view-transition cross-doc fires.
 *  + CSS interpolate-size: allow-keywords — height:auto / width:fit-content
 *    transitions smoothly (Chrome 129+). Used for FAQ details, admin
 *    spell-result drawers, dictionary edit rows.
 *  + CSS @starting-style — popover entrance fade/slide animations defined
 *    declaratively. No JS show/hide handlers needed.
 *  + CSS Highlight API — ::highlight(hs-find) + ::highlight(hs-multi-cursor)
 *    pseudo-elements styled (yellow wavy + blue solid). JS can now register
 *    arbitrary highlights via CSS.highlights.set without DOM mutation.
 *  + Document Picture-in-Picture — DN.bindDocPiP injects 📺 button on
 *    article pages; opens 380×600 PiP window with the article body
 *    cloned + stylesheets duplicated. Doctor can pin while charting.
 *  + navigator.share() with Files — DN.bindShareFiles attempts to share
 *    a .txt snapshot via the native share sheet (AirDrop / Line / etc).
 *    URL-only fallback when File API unsupported.
 *  + Intl.Segmenter for CJK — DN.tokenizeCJK() uses ICU word segmentation
 *    when available; falls back to bigram + Latin tokens. Used in blog
 *    filter search (now OR-matches multi-token CJK queries) + admin search.
 *  + Intl.RelativeTimeFormat — DN.relativeTime(iso) gives "3 天前" /
 *    "5 minutes ago" automatically i18n-aware. DN.applyRelativeTime
 *    auto-resolves any [data-relative-time] elements.
 *  + navigator.locks — DN.withLock(name, fn) wraps cross-tab admin saves
 *    so 2 admin tabs editing the same slug don't race-commit.
 *  + Trusted Types policy STRICT mode — hs-policy.createHTML now strips
 *    <script>, on*= handlers, javascript: URLs. createScriptURL constrains
 *    to a host allowlist (self, GTM/GA, Clarity, AdSense, jsdelivr). Was
 *    pass-through in v29-v33 to avoid breaking deploy.
 *  + <datalist> autocomplete admin slug — `+ 新文章` modal slug input
 *    now suggests 12 common ophthalmology topics (glaucoma-medications,
 *    amblyopia-vision-therapy, lasik-vs-smile, etc.) via <datalist>.
 * v33: PLATFORM API DEEP-DIVE + OFFLINE-RESILIENT EDITOR + REAL CSP HASHES
 *  + Real hash-based CSP (build-time): _gen_csp_hashes.py walks every
 *    .html, computes SHA-256 of every inline <script>/<style>, writes the
 *    list into middleware.js. CSP swaps from 'unsafe-inline' → exact hashes
 *    (drop reflected-XSS surface).  Refresh after editing inline:
 *      python _gen_csp_hashes.py
 *  + WebTransport client scaffolding — DN.openLiveChannel() prefers
 *    WebTransport (HTTP/3 datagrams), falls back to /api/events SSE.
 *    Server-side WebTransport not available on Vercel today (serverless
 *    can't hold connections); scaffold ready for future Cloudflare Workers
 *    / Fly.io / self-hosted Caddy.
 *  + Speculation Rules eagerness="immediate" — top-4 articles are
 *    prerendered the moment user lands on home, so navigation = 0 ms.
 *  + Cookie Store API — DN.cookieGetAsync wraps async cookieStore.get
 *    when supported; sync fallback unchanged for boot-time language detect.
 *  + Compute Pressure API — DN.bindComputePressure observes CPU 'cpu'
 *    pressure source; 'serious'+ removes prefetch links + sets
 *    [data-cpu-pressure="high"] for CSS to disable animations.
 *  + Navigation API — DN.bindNavigation hooks `navigate` event for soft-
 *    nav GA tracking + unsaved-edit guard (cancels nav when DN._adminDirty).
 *  + Idle Detection — already in v32; reused here.
 *  + WebCodecs ImageEncoder for AVIF — admin upload path tries WebCodecs
 *    first (3-5× faster), falls back to canvas.toBlob.
 *  + OPFS draft autosave — DN.saveDraft writes admin edits every 5s to
 *    Origin Private File System (50MB+ quota). On editor open, restored
 *    if newer than server. Falls back to localStorage when OPFS missing.
 *  + Background Sync v2 — sw.js IndexedDB queue (hs-bg-sync). When admin
 *    save fails offline, DN.queueOfflineSave POSTs the payload to SW
 *    which retries on 'sync' event ('admin-save-replay' tag) once
 *    network returns.
 *  + Storage Buckets API — favourites moved to dedicated 'favorites'
 *    bucket with `durability: 'strict'` + `persisted: true`. Quota
 *    separated from runtime cache so heavy site usage can't evict
 *    user's saved-for-offline articles.
 *  + OffscreenCanvas + Worker for /tools/eye-3d — Three.js scene runs
 *    on dedicated worker thread (transferControlToOffscreen). Main
 *    thread stays free for user input + scrolling.
 *  + <selectlist> upgrade — DN.upgradeSelectLists swaps
 *    <select data-selectlist> to <selectlist> (Chrome 127+ flag).
 *    Mirrors change events back to original <select> for compat.
 *  + popover= attribute — DN.upgradePopovers wires
 *    [data-popover-trigger] → popovertarget for browser-native top-layer
 *    + light-dismiss (no JS show/hide).
 *  + CSS @scope dark mode — replaced :root[data-theme="dark"] .X chain
 *    with a single @scope (:root[data-theme="dark"]) {…} block.
 *  + CSS scroll-driven animations — pure-CSS reading-progress bar via
 *    animation-timeline: scroll(); reveal-on-scroll via animation-timeline:
 *    view(). Fully compositor-thread, zero main-thread cost. Falls back
 *    to JS IntersectionObserver implementation when unsupported.
 *  + CSS text-wrap: balance — h1/h2/h3 + card titles use balanced wrap
 *    (no orphan single-word last line). text-wrap: pretty on body copy.
 * v32: PLATFORM-API ADOPTION + 3D + LIVE NOTIFICATIONS
 *  + FIX BUILD: middleware.js no longer imports next/server (this isn't a
 *    Next project). Uses native Response + x-middleware-next: 1 pattern.
 *    Split api/admin/_auth.js → _auth.js (Node, crypto for HMAC) +
 *    _github.js (Edge-safe, no Node deps). Edge runtime files (og,
 *    csp-report) import only from _github.js.
 *  + CSS @property — animatable theme variables. Light↔dark transitions
 *    are now smooth 280ms eased fades instead of instant snap. Falls back
 *    cleanly in browsers without @property support.
 *  + Container queries — .article-list / #hs-related / .topic-grid /
 *    #hs-prevnext now have container-name: card-grid; layout responds to
 *    container width, not viewport. Reusable in any sidebar/column.
 *  + prefers-reduced-data — when Save-Data: on, we skip hero SVGs
 *    (replaced by flat colour) and disable reveal animations. Saves
 *    60-150 KB on every page for low-bandwidth users.
 *  + CSS Anchor Positioning — .hs-dict tooltips use anchor() instead of
 *    JS-positioned popups when supported (Chrome 125+). Falls back to
 *    existing JS implementation gracefully.
 *  + Idle Detection API — DN.bindIdleDetection pauses GA pageview reporting
 *    when user has been idle ≥60s (Chrome IdleDetector + permission).
 *    Saves billing on long-open tabs.
 *  + HTTP fetchpriority hints — DN.applyFetchPriority sets fetchpriority=
 *    "high" on first viewport image, "low" on share/related thumbs, and
 *    injects <link rel="preload" fetchpriority="high"> for the LCP candidate.
 *    Improves LCP 100-200ms on slow networks.
 *  + Text fragments (#:~:text=) — DN.styleTextFragments adds custom
 *    ::target-text styling so Google search "jump-to" highlights look like
 *    HsiaoEye's gold underline rather than browser default yellow.
 *  + HTTP protocol detection — reads PerformanceResourceTiming.nextHopProtocol,
 *    reports h2/h3/h1 to GA4 + window.__hsHttpProtocol for DevTools probing.
 *  + SSE /api/events — admin-authenticated persistent connection that
 *    streams hello + heartbeat (25s) + KV-backed event ring buffer.
 *    Client EventSource + auto-reconnect on Vercel's 10-min hard cut.
 *    Events: new_article, new_subscriber, csp_violation, etc.
 *  + PWA Periodic Background Sync — installed PWA wakes SW every 12 hr
 *    (browser-decided), fetches /blog/feed.xml, pre-caches the newest
 *    article HTML + 12 images. Latest content available offline on next
 *    open even before user navigates.
 *  + Algolia DocSearch — drop-in upgrade for Cmd+K search via 3 meta tags
 *    (`algolia-app-id`, `algolia-api-key`, `algolia-index`). Lazy-loads
 *    @docsearch/js + CSS from jsdelivr only when configured. Falls back
 *    to home-rolled DN.initCmdK when unconfigured.
 *  + WebGPU eye-anatomy 3D — /tools/eye-3d.html is a procedural Three.js
 *    scene of cornea / iris / pupil / lens / vitreous / retina / macula /
 *    optic nerve / sclera. Drag rotates, scroll zooms, click highlights +
 *    scrolls sidebar to that structure. WebGPURenderer when supported,
 *    WebGL2 fallback. Cross-section toggle clips front half via clipping
 *    plane.
 *  + Lottie hero — DN.bindLottieHero mounts dotlottie-wc Web Component on
 *    [data-lottie="path.lottie"] elements. ~26 KB component, only loaded
 *    when used. prefers-reduced-motion respected (no mount).
 *  + FedCM stub — DN.initFedCM pre-wired entry point + Permissions-Policy
 *    `identity-credentials-get=(self)` allowlist for future SSO support.
 * v31: ADMIN PRODUCTIVITY + REAL-TIME CWV + ML RELATED + A/B BUILDER
 *  + Word-count + read-time pre-render (/api/admin/precompute-meta) writes
 *    `words` + `minutes` into DN.ARTICLES. Client reads precomputed value;
 *    saves 40-60ms runtime parsing per article load.
 *  + SVG sprite system (/assets/icons.svg) — 14 reusable icons via
 *    <svg><use href="/assets/icons.svg#i-bookmark"/>. Future articles can
 *    use the sprite instead of inline SVG (~3 KB savings per article).
 *  + Native <dialog> upgrade — DN.upgradeDialogs() promotes any element
 *    with [data-dialog] attribute to HTMLDialogElement (browser-native
 *    inert background, focus trap, ESC, ::backdrop animations).
 *  + Edge cache purge (/api/admin/purge) — admin "🚿 清空 CDN" button hits
 *    Vercel API to invalidate dynamic sitemap/feed/og without waiting for
 *    s-maxage. Requires VERCEL_TOKEN + VERCEL_PROJECT_ID env vars.
 *  + REAL-TIME CWV — DN.bindWebVitals also POSTs to /api/cwv-ingest which
 *    writes 1000-sample reservoir to KV. CWV admin dashboard reads KV
 *    first (sub-200ms response, no GA4 24-48hr latency). GA4 fallback for
 *    historical depth.
 *  + TF-IDF related articles (/api/admin/build-related) — pre-computes
 *    pairwise cosine similarity over CJK bigrams + Latin words, with
 *    medical-dictionary terms 3× boosted. Output assets/related.json
 *    consumed by DN.addRelatedArticles. Falls back to category+random.
 *  + A/B test BUILDER — admin "🧪 A/B Builder" tab with no-code UI:
 *    define CSS selector + 2 HTML variants, KV-stored, client-side
 *    DN.applyAbConfig auto-swaps innerHTML by bucket. /api/ab-config
 *    cached 60s at edge. Inline scripts/event handlers rejected for safety.
 *  + Batch operations (/api/admin/batch) — single endpoint runs
 *    seo-fix + faqpage + autolink across all (or filtered) articles, 3
 *    concurrent to stay under GitHub secondary rate limit.
 *  + Mermaid + KaTeX lazy-load — DN.loadMermaid only fetches mermaid.js
 *    when <pre class="mermaid"> exists; DN.loadKatex only when $$math$$
 *    or \\(...\\) detected. Saves ~600 KB on every other page.
 *  + Notion-style slash commands in WYSIWYG editor — type `/` at start of
 *    blank line, popup of 13 block types: H2/H3/list/quote/myth-card/
 *    redflag/tldr/table/mermaid/katex/hr/img.
 *  + HTTP/3 protocol detection — DN.bindWebVitals reads
 *    PerformanceResourceTiming.nextHopProtocol, reports to GA4 +
 *    window.__hsHttpProtocol for DevTools console probing.
 *  + PR preview screenshot diff workflow — when PR opens, Vercel preview
 *    URL captured, side-by-side production-vs-preview screenshots posted
 *    as artifact + PR comment.
 *  + Lighthouse Treemap config — extra perf assertions (FCP/LCP/CLS/TBT/
 *    INP thresholds), treemap viewable from artifact .lighthouseci HTML.
 * v30: PERFORMANCE + DEVELOPER-EXPERIENCE SPRINT
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
 *  + /en/ mirrors are regenerated by the canonical GitHub Actions pipeline.
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
 *  + Admin endpoints include upload, history, rollback,
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
```
