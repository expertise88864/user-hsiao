/**
 * Single-function dispatcher for ALL admin endpoints.
 *
 * Vercel Hobby plan caps Serverless Functions at 12 per deployment.
 * Instead of 26 separate function bundles, this catch-all routes every
 * /api/admin/<op>(?action=...) request to the right `_<op>.js` handler
 * via dynamic import. Handlers are kept in `api/admin/_*.js` files
 * (Vercel ignores `_`-prefixed files as routes — they're treated as
 * private modules).
 *
 * Total Serverless Functions impact: 26 → 1.
 *
 * Adding a new endpoint: drop `api/admin/_my-op.js` and register it in
 * the HANDLERS map below. URL = `/api/admin/my-op`.
 *
 * `op` comes from the dynamic [op] segment of the URL — preserved by
 * Vercel as `req.query.op`.
 */
import { isAdminRequest } from './_auth.js';

// Module loaders (dynamic-import lazily to keep the cold-start small).
// Each handler exports its `(req, res)` function as default.
const HANDLERS = {
  'login':            () => import('./_login.js'),
  'list':             () => import('./_list.js'),
  'save':             () => import('./_save.js'),
  'offline-token':    () => import('./_offline-token.js'),
  'new':              () => import('./_new.js'),
  'upload':           () => import('./_upload.js'),
  'upload-srcset':    () => import('./_upload-srcset.js'),
  'history':          () => import('./_history.js'),
  'indexnow':         () => import('./_indexnow.js'),
  'rollback':         () => import('./_rollback.js'),
  'reorder':          () => import('./_reorder.js'),
  'seo-score':        () => import('./_seo-score.js'),
  'seo-fix':          () => import('./_seo-fix.js'),
  'spell':            () => import('./_spell.js'),
  'dictionary':       () => import('./_dictionary.js'),
  'ab-stats':         () => import('./_ab-stats.js'),
  'ab-config':        () => import('./_ab-config.js'),
  'batch':            () => import('./_batch.js'),
  'build-related':    () => import('./_build-related.js'),
  'csp':              () => import('./_csp.js'),
  'cwv':              () => import('./_cwv.js'),
  'errors':           () => import('./_errors.js'),
  'push-stats':       () => import('./_push-stats.js'),
  'search-log':       () => import('./_search-log.js'),
  'md':               () => import('./_md.js'),
  'precompute-meta':  () => import('./_precompute-meta.js'),
  'purge':            () => import('./_purge.js'),
  'schema-helper':    () => import('./_schema-helper.js'),
  'sri':              () => import('./_sri.js'),
  'suggest-tags':     () => import('./_suggest-tags.js'),
};

// v37.22 — in-memory rate-limit cache (per warm container). Since serverless
// containers are short-lived, this only catches bursts within one container
// session; cross-container DoS still hits per-IP Vercel limits. Sufficient
// against accidental F5 spam and session-token misuse.
const RL = new Map();   // key: session/IP, value: { count, windowStart }
const RL_MAX = 30;      // 30 requests
const RL_WINDOW_MS = 60 * 1000;  // per 60 seconds per session

function rateLimitKey(req) {
  // Only a verified session may select a session bucket.
  const c = (req.headers.cookie || '').match(/hs_admin_session=([^;]+)/);
  if (c && isAdminRequest(req)) return 'sess:' + c[1].slice(0, 16);
  const ip = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
  return 'ip:' + String(ip).split(',')[0].trim();
}

function checkRateLimit(req) {
  const key = rateLimitKey(req);
  const now = Date.now();
  let entry = RL.get(key);
  if (!entry || now - entry.windowStart > RL_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
  }
  entry.count++;
  RL.set(key, entry);
  // Periodic cleanup so the Map doesn't grow unbounded
  if (RL.size > 500) {
    for (const [k, v] of RL) {
      if (now - v.windowStart > RL_WINDOW_MS * 2) RL.delete(k);
    }
  }
  return entry.count <= RL_MAX;
}

// v37.22 — pre-warm the hottest handlers (save, list, login) so the first
// real request doesn't pay the full dynamic-import latency. This module
// loads at container start; the import promises resolve in the background.
const WARM_HANDLERS = ['login', 'list', 'save', 'history'];
const _warmPromises = WARM_HANDLERS.map((op) => HANDLERS[op]().catch(() => null));

const IS_PROD = process.env.VERCEL_ENV === 'production';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  const op = (req.query && req.query.op) || '';
  const loader = HANDLERS[op];
  if (!loader) {
    return res.status(404).json({ error: `Unknown admin op: ${op}`, available: Object.keys(HANDLERS) });
  }
  // v37.22 — rate limit. Returns 429 with Retry-After hint.
  if (!checkRateLimit(req)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'Too many requests — slow down (max 30/min per session)' });
  }
  try {
    const mod = await loader();
    // ESM-CJS interop guard. Depending on Vercel's bundler version, dynamic
    // import of a CommonJS-compiled handler can return either:
    //   { default: handler }              ← clean ESM result
    //   { default: { default: handler } } ← double-wrap when CJS exports.default
    //   handler (raw function)            ← if bundled as CJS directly
    const fn =
      (typeof mod === 'function')                                 ? mod :
      (mod && typeof mod.default === 'function')                  ? mod.default :
      (mod && mod.default && typeof mod.default.default === 'function') ? mod.default.default :
      null;
    if (!fn) {
      // v37.22 — in prod, hide internal module shape (was leaking module
      // structure to client error responses). Dev/preview still see details.
      if (IS_PROD) {
        return res.status(500).json({ error: 'Admin operation failed' });
      }
      return res.status(500).json({
        error: `Dispatcher: op=${op} module has no callable default export.`,
        modShape: {
          topType: typeof mod,
          topKeys: mod && typeof mod === 'object' ? Object.keys(mod).slice(0, 10) : null,
          defaultType: mod && mod.default ? typeof mod.default : null,
        },
      });
    }
    return fn(req, res);
  } catch (e) {
    if (IS_PROD) {
      // Log full error server-side (Vercel will capture stderr), return
      // opaque message to client.
      console.error(`[admin dispatcher] op=${op}`, e);
      return res.status(500).json({ error: 'Admin operation failed' });
    }
    return res.status(500).json({ error: `Dispatcher failed for op=${op}: ${e.message || e}` });
  }
}

// Some admin operations can run longer than the default function window.
export const config = { runtime: 'nodejs', maxDuration: 300 };
