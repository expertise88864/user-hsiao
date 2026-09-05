/* HsiaoEye service worker
 *
 * Cache tiers, lifecycle and the reasoning behind the current shape live next
 * to the code below. The legacy release notes that used to sit here were 385
 * lines / 25.8 KB — half of this file, shipped to every visitor on every SW
 * update, because sw.js is not minified. Moved verbatim to
 * docs/SW-CHANGELOG.md (BACKLOG P-06); git log remains authoritative.
 * Version annotations still appear inline below where they explain a specific
 * piece of current behaviour — only the standalone history block moved.
 */
// v71 -> v72: install no longer precaches LAZY, a content-shape change, which
// REVIEW-PLAYBOOK §6 requires a bump for (else old installs keep ~19 stale LAZY
// entries: the 404 sweep skips PRECACHE paths and count-trim idles under 50).
const CACHE = 'hs-v72';
const RUNTIME = 'hs-runtime-v35';
const RUNTIME_MAX_ENTRIES = 60;
const GENERATED_JSON = new Set([
  '/assets/search-index.json',
  '/assets/related.json',
  '/assets/i18n.json',
  '/assets/medical-dictionary.json',
]);

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
  '/blog/blog-shared.min.js',
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
// v37.2: stub articles (cataract-surgery-faq / glaucoma-warnings /
// contact-lens-safety / red-eye-conjunctivitis) removed — they're
// noindex placeholders not yet content-complete; precaching them wasted
// ~20 KB of user quota per install.
const LAZY = [
  '/about', '/privacy', '/404.html', '/notes', '/tools',
  '/icon-32.png', '/icon-192.png', '/icon-512.png',
  '/apple-touch-icon.png',
  '/SUNN1302-220.webp', '/SUNN1302-220.avif', '/SUNN1302-440.webp',
  '/blog/feed.xml', '/blog/atom.xml',
  '/blog/topics',
  '/en/', '/en/about', '/en/tools', '/en/blog/',
];

// Combined tier list. Its ONLY consumer is the activate-time 404 sweep, which
// skips these paths as authoritative. NOTE trimCache never reads PRECACHE — it
// TTL-evicts then drops oldest-first, precached entries included. Tiers decide
// what gets FETCHED, not what survives. (An earlier comment here claimed the
// opposite; see BACKLOG P-04.)
const PRECACHE = [...SHELL, ...POPULAR, ...LAZY];

// v33: Storage Buckets API — split favourites cache from runtime cache so
// favourites have their own quota + persistence policy. Falls back to a
// single CacheStorage namespace when Buckets API unsupported (Firefox /
// Safari).
async function getFavBucket() {
  try {
    if (navigator.storageBuckets) {
      const bucket = await navigator.storageBuckets.open('favorites', {
        durability: 'strict',     // require flushed-to-disk before respond
        persisted:  true,          // ask user-agent to NOT auto-evict
        // quota: 50 * 1024 * 1024,  // 50 MB hint (browser may ignore)
      });
      return bucket.caches;
    }
  } catch (e) {}
  return self.caches;
}

self.addEventListener('install', (e) => {
  // Stage 1: only the critical shell (~10 small assets, ~80ms on cable).
  //
  // P-04 — this mapped PRECACHE (~37 URLs) for a year, contradicting the v30
  // header, this comment, and the LAZY array's own "don't pre-cache". Root
  // cause: 2429a36 ported _check_pwa.py, which asserted the literal string
  // `Promise.allSettled(PRECACHE.map`, and bent sw.js to satisfy it. Restored
  // to SHELL; the checker now asserts the real invariant. LAZY reaches the
  // cache via the runtime handler and no longer eats 19 of the 50-entry
  // trimCache budget. Full account + the 8-round audit: BACKLOG P-04.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    Promise.all([
      // v37.34 — Navigation Preload: while this SW is starting up (which can
      // take 50-300 ms on cold boot), the browser pre-fetches the navigation
      // request in parallel. The fetch handler can then `event.preloadResponse`
      // it and skip the cold-start penalty. Pure perf win, no behaviour change.
      // Falls back silently on browsers without `registration.navigationPreload`
      // (older Safari iOS).
      ('navigationPreload' in self.registration)
        ? self.registration.navigationPreload.enable().catch(() => {})
        : Promise.resolve(),
      // Cleanup old version caches
      caches.keys().then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE && k !== RUNTIME).map((k) => caches.delete(k))
      )),
      // v37.23 — Stage 1.5: validate the existing CACHE against the network.
      // If a previously-precached URL now 404s (e.g., article was renamed or
      // an OG image was deleted upstream), the SW would have kept serving
      // the stale cached copy forever. Sweep the cache here: for each entry
      // in CACHE that isn't in PRECACHE list, issue a HEAD; if it returns
      // 404, remove it. Run on each activate so it self-heals over deploys.
      caches.open(CACHE).then(async (c) => {
        try {
          const keys = await c.keys();
          await Promise.all(keys.map(async (req) => {
            // Only validate same-origin entries that look like static assets
            const url = new URL(req.url);
            if (url.origin !== location.origin) return;
            // Skip entries we know are precache — they're authoritative
            if (PRECACHE.includes(url.pathname) || PRECACHE.includes(url.pathname + url.search)) return;
            try {
              const head = await fetch(req, { method: 'HEAD' });
              if (head && head.status === 404) {
                await c.delete(req);
              }
            } catch (e) { /* offline → keep cached */ }
          }));
        } catch (e) { /* ignore — best-effort */ }
      }),
      // NOTE: POPULAR is deliberately NOT precached here — see warmPopular()
      // below the fetch handler for why activate is the wrong place for it.
      self.clients.claim(),
    ])
  );
});

async function trimCache(cacheName, max) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    // v37.11: TTL-based eviction layer. Before count-based trimming, evict
    // any entries whose Response has a `Date` header older than maxAgeMs.
    // /pagefind/, /blog/feed.xml, /blog/atom.xml are regenerated on every
    // deploy → 24h TTL keeps them roughly fresh. Other entries get a 30-day
    // TTL as a soft upper bound.
    const now = Date.now();
    const ttlByPath = (url) => {
      if (url.includes('/pagefind/') || url.endsWith('/feed.xml') ||
          url.endsWith('/atom.xml') || url.endsWith('/sitemap.xml')) {
        return 24 * 60 * 60 * 1000; // 1 day
      }
      return 30 * 24 * 60 * 60 * 1000; // 30 days
    };
    const expired = [];
    for (const req of keys) {
      try {
        const resp = await cache.match(req);
        const dateHdr = resp && resp.headers.get('date');
        if (!dateHdr) continue;
        const age = now - new Date(dateHdr).getTime();
        if (age > ttlByPath(req.url)) expired.push(req);
      } catch (e) { /* skip individual failures */ }
    }
    if (expired.length) {
      await Promise.all(expired.map((req) => cache.delete(req)));
    }
    // Then count-based trim if still over budget.
    const remaining = await cache.keys();
    if (remaining.length <= max) return;
    const toDelete = remaining.slice(0, remaining.length - max);
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

// Stage 2 — warm the POPULAR tier (top articles + their OG cards) from the
// FIRST FETCH EVENT. Not from install (SHELL-only, P-04) and not from activate:
// awaiting there keeps the worker in "activating" until waitUntil settles, so
// with skipWaiting() an update becomes a user-visible stall. e.waitUntil() on a
// fetch event keeps the worker alive without gating activation, and
// respondWith() is unaffected.
//
// State lives in the CACHE, not a module flag — workers restart routinely and
// an in-memory boolean would re-issue all eight requests. The bindings below
// are only a same-lifetime guard: popularWarm dedupes concurrent fetches;
// popularDone latches ONLY on a clean sweep, so an offline attempt retries.
// Rejected earlier shapes and why: BACKLOG P-04.
let popularWarm = null;
let popularDone = false;
function warmPopular(e) {
  if (popularDone || popularWarm) return;
  popularWarm = caches.open(CACHE)
    .then(async (c) => {
      const present = await Promise.all(POPULAR.map((u) => c.match(u)));
      const missing = POPULAR.filter((u, i) => !present[i]);
      if (!missing.length) { popularDone = true; return; }
      const results = await Promise.allSettled(missing.map((u) => c.add(u)));
      // allSettled resolves even if every add rejected, so latch only on a
      // clean sweep — otherwise an offline attempt is recorded as finished.
      popularDone = results.every((r) => r.status === 'fulfilled');
    })
    .catch(() => {})
    .finally(() => { popularWarm = null; });
  try {
    e.waitUntil(popularWarm);
  } catch (err) { /* waitUntil past the event's lifetime — nothing to do */ }
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
  // v37.1: bypass /reset-sw pages so the SW reset flow always hits network
  // (cached copies would defeat the reset). Same for /en/reset-sw.
  if (url.pathname === '/reset-sw' || url.pathname === '/en/reset-sw') {
    return;
  }

  // AFTER the bypasses: above them, /admin, /api and reset-sw traffic would
  // each kick off eight background fetches.
  warmPopular(e);
  // v37.1: cache-busted assets (?v=YYYYMMDD) → network-first; ensures fresh
  // CSS/JS after a stamp bump even if SW served a stale copy from `caches`.
  if (url.search.includes('v=')) {
    e.respondWith(
      fetchWithRetry(req)
        .then((resp) => {
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(RUNTIME).then((c) => c.put(req, copy));
          }
          return resp;
        })
        // P-02: the offline fallback ignores the ?v= query so it can match the
        // SHELL-precached bare-URL copy (/assets/app.css, article.css,
        // blog-shared.min.js) or any cached ?v= copy. Without ignoreSearch a
        // request for `app.css?v=NEW` never matched the precache and the SHELL
        // precache of these versioned assets was dead weight. The primary path
        // above stays network-first, so ONLINE users always get fresh assets;
        // ignoreSearch only affects the offline fallback (stale-but-present >
        // nothing when the network is down).
        .catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }
  // v37.45: generated JSON powers search, related cards, i18n, and medical
  // dictionary tooltips. Prefer fresh network data, then fall back offline.
  if (url.pathname.startsWith('/pagefind/') || GENERATED_JSON.has(url.pathname)) {
    e.respondWith(
      fetchWithRetry(req)
        .then((resp) => {
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(RUNTIME).then((c) => c.put(req, copy));
          }
          return resp;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    // Prefer current HTML when the network responds promptly. A short timeout
    // preserves fast repeat visits and offline resilience without serving a
    // stale article indefinitely after a deploy.
    e.respondWith((async () => {
      const cached = await caches.match(req);
      const networkFetch = (async () => {
        try {
          const preload = await e.preloadResponse;
          const resp = preload || await fetchWithRetry(req);
          if (resp && resp.ok) {
            const copy = resp.clone();
            // v37.46: trim CACHE after writes so HTML doesn't grow without
            // bound over PWA lifetime. 50-entry soft cap (~18 articles + 10
            // shell + 8 popular = 36 typical, 50 leaves headroom). trimCache
            // also TTL-evicts entries older than 30d, so the cache self-heals
            // even if user never reaches the count cap.
            caches.open(CACHE).then((c) => {
              c.put(req, copy);
              trimCache(CACHE, 50);
            });
          }
          return resp;
        } catch (err) {
          return null;
        }
      })();
      if (cached) {
        e.waitUntil(networkFetch.then(() => undefined).catch(() => undefined));
        const fresh = await Promise.race([
          networkFetch,
          new Promise(resolve => setTimeout(() => resolve(null), 900)),
        ]);
        if (fresh) return fresh;
        return cached;
      }
      // No cached copy — wait for the network. Fall back to offline page.
      try {
        const resp = await networkFetch;
        if (resp) return resp;
        throw new Error('no-response');
      } catch (err) {
        // v33: try favourites bucket, then offline page
        try {
          const favCaches = await getFavBucket();
          const fav = await (await favCaches.open('hs-favorites')).match(req);
          if (fav) return fav;
        } catch (e2) { /* skip */ }
        const off = await caches.match('/offline.html');
        return off || caches.match('/');
      }
    })());
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

// v33: Background Sync v2 — IndexedDB-backed queue of pending /api/admin/save
// requests. Replayed when 'sync' fires (browser detects connectivity).
const SYNC_DB = 'hs-bg-sync';
const SYNC_STORE = 'queue';

function openSyncDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SYNC_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(SYNC_STORE, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function enqueueSave(payload) {
  const db = await openSyncDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, 'readwrite');
    const store = tx.objectStore(SYNC_STORE);
    const cursorRequest = store.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) {
        if (cursor.value && cursor.value.slug === payload.slug) cursor.delete();
        cursor.continue();
        return;
      }
      store.add(payload);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function readQueuedSaves() {
  const db = await openSyncDb();
  const tx = db.transaction(SYNC_STORE, 'readonly');
  const store = tx.objectStore(SYNC_STORE);
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function deleteQueuedSave(id) {
  const db = await openSyncDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, 'readwrite');
    tx.objectStore(SYNC_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

let drainSavesPromise = null;
async function drainSavesOnce() {
  const all = await readQueuedSaves();
  let succeeded = 0;
  for (const item of all || []) {
    try {
      const r = await fetch('/api/admin/save', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Hsiao-Offline-Replay': '1',
          'X-Hsiao-Offline-Token': item.token || '',
        },
        body: JSON.stringify({ slug: item.slug, html: item.html, baseSha: item.baseSha }),
      });
      if (r.ok) {
        await deleteQueuedSave(item.id);
        succeeded++;
      } else if (r.status === 409) {
        // Keep conflicting drafts for manual comparison; never rebase them silently.
        const clients = await self.clients.matchAll({ includeUncontrolled: true });
        clients.forEach(c => c.postMessage({ type: 'BG_SYNC_CONFLICT', slug: item.slug }));
        continue;
      } else if (r.status === 401) {
        // Session expired — keep in queue, user must re-login
        break;
      } else if ([400, 403, 413, 422].includes(r.status)) {
        // Invalid payloads and expired capabilities cannot become valid later.
        await deleteQueuedSave(item.id);
      }
    } catch (e) { /* still offline, keep in queue */ break; }
  }
  // Notify any open clients
  if (succeeded) {
    const clientList = await self.clients.matchAll({ includeUncontrolled: true });
    clientList.forEach(c => c.postMessage({ type: 'BG_SYNC_REPLAYED', count: succeeded }));
  }
}

function drainSaves() {
  if (!drainSavesPromise) {
    drainSavesPromise = drainSavesOnce().finally(() => {
      drainSavesPromise = null;
    });
  }
  return drainSavesPromise;
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'admin-save-replay') event.waitUntil(drainSaves());
});

self.addEventListener('message', async (e) => {
  if (!e.data) return;
  if (e.data.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (e.data.type === 'QUEUE_SAVE' && e.data.payload) {
    e.waitUntil((async () => {
      const sourceUrl = e.source && e.source.url ? new URL(e.source.url) : null;
      const payload = e.data.payload;
      const sourceSlug = sourceUrl && sourceUrl.pathname.slice('/blog/'.length);
      const allowedSource = sourceUrl &&
        sourceUrl.origin === self.location.origin &&
        /^\/blog\/[a-z0-9-]+$/.test(sourceUrl.pathname) &&
        sourceUrl.searchParams.get('admin') === '1' &&
        sourceSlug === payload.slug;
      const validPayload =
        payload &&
        /^[a-z0-9-]+$/.test(payload.slug || '') &&
        /^[a-f0-9]{40}$/.test(payload.baseSha || '') &&
        typeof payload.html === 'string' &&
        payload.html.length >= 200 &&
        payload.html.length <= 1024 * 1024 &&
        typeof payload.token === 'string' &&
        payload.token.length <= 256;
      if (!allowedSource || !validPayload) return;
      await enqueueSave({
        slug: payload.slug,
        html: payload.html,
        baseSha: payload.baseSha,
        token: payload.token,
        ts: Number(payload.ts) || Date.now(),
      });
      await drainSaves().catch(() => {});
    })());
    return;
  }

  // v30: Offline favourites — when client posts CACHE_FAVORITE the SW pre-caches
  // the article HTML + every image URL referenced in it, so the user can read
  // the article in airplane mode. Posting UNCACHE_FAVORITE removes it.
  if (e.data.type === 'CACHE_FAVORITE' && e.data.url) {
    try {
      // v33: favourites go to their own Storage Bucket (separate quota, persistent)
      const favCaches = await getFavBucket();
      const cache = await favCaches.open('hs-favorites');
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
      const favCaches = await getFavBucket();
      const cache = await favCaches.open('hs-favorites');
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

// v32: Periodic Background Sync — wakes the SW periodically (browser-decided
// frequency, typically once per 12 hours when the user has the site
// installed as a PWA) to pre-cache the newest article. So when the user
// opens the app on the metro with no signal, the latest content is ready.
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-new-articles') {
    event.waitUntil((async () => {
      try {
        const r = await fetch('/blog/feed.xml');
        if (!r.ok) return;
        const xml = await r.text();
        // Extract first <item><link> as newest article
        const m = xml.match(/<item>[\s\S]*?<link>([^<]+)<\/link>/);
        if (!m) return;
        const url = m[1];
        // Already cached?
        const cache = await caches.open(CACHE);
        if (await cache.match(url)) return;
        // Pre-cache HTML + linked images
        const htmlR = await fetch(url);
        if (htmlR.ok) {
          await cache.put(url, htmlR.clone());
          const text = await htmlR.text();
          const imgs = Array.from(text.matchAll(/<img[^>]+src="([^"]+)"/g)).map(m2 => m2[1]).slice(0, 12);
          for (const u of imgs) {
            try { const ir = await fetch(u, { mode: 'no-cors' }); if (ir) await cache.put(u, ir); }
            catch (e) { /* skip */ }
          }
        }
      } catch (e) { /* ignore */ }
    })());
  }
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
