/* HsiaoEye service worker — offline-first for static, network-first for HTML
 * v18: PERFORMANCE + DECLUTTERING SPRINT
 *      + Reading-progress widget moved BELOW spotlight (per user request)
 *      + Removed redundant home-page sections: AdSense #1 (above article-list)
 *        and 學經歷 timeline (already on /about) — less visual noise
 *      + 3-phase initBlog: PHASE 1 sync (above-fold), PHASE 2 idle (article-only
 *        widgets, calculators, share, related), PHASE 3 background (SW, GA, WV)
 *        via requestIdleCallback shim — much faster mobile FCP/LCP
 *      + content-visibility:auto on FAQ + footer + below-fold sections
 *      + Trimmed Google Fonts (8 weights → 6: dropped Fraunces italic + Inter 400)
 *      + <link rel=preload as=style> for /assets/app.css + fetchpriority=high on logo
 *      + Subtle <hr class=sep> dividers between major sections for cleaner rhythm
 * v17: per-article OG cards, _gen_feeds.py, addFeedbackLink, search button.
 * v16: English mirror (/en/), calculator framework + 5 ophth calcs.
 * v15: Cmd+K, article hero SVG, lazy images, inline CTA, NEW badge, GA4 + WV.
 * v14: home article-list-item proper styling, spotlight SVG icons.
 *     cache-bust ?v=20260519
 */
const CACHE = 'hs-v18';
const RUNTIME = 'hs-runtime-v18';
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
  '/notes',
  '/tools',
  // Per-article OG cards (1200×630) — used by social link previews
  '/assets/og/dry-eye-myths.png',
  '/assets/og/pediatric-myopia-control.png',
  '/assets/og/floaters-retinal-detachment.png',
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
