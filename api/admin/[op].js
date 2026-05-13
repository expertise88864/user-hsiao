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

// Module loaders (dynamic-import lazily to keep the cold-start small).
// Each handler exports its `(req, res)` function as default.
const HANDLERS = {
  'login':            () => import('./_login.js'),
  'list':             () => import('./_list.js'),
  'save':             () => import('./_save.js'),
  'new':              () => import('./_new.js'),
  'upload':           () => import('./_upload.js'),
  'upload-srcset':    () => import('./_upload-srcset.js'),
  'regen-en':         () => import('./_regen-en.js'),
  'regen-en-stream':  () => import('./_regen-en-stream.js'),
  'history':          () => import('./_history.js'),
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
  'cwv':              () => import('./_cwv.js'),
  'md':               () => import('./_md.js'),
  'precompute-meta':  () => import('./_precompute-meta.js'),
  'purge':            () => import('./_purge.js'),
  'schema-helper':    () => import('./_schema-helper.js'),
  'sri':              () => import('./_sri.js'),
  'suggest-tags':     () => import('./_suggest-tags.js'),
};

export default async function handler(req, res) {
  const op = (req.query && req.query.op) || '';
  const loader = HANDLERS[op];
  if (!loader) {
    return res.status(404).json({ error: `Unknown admin op: ${op}`, available: Object.keys(HANDLERS) });
  }
  try {
    const mod = await loader();
    // ESM-CJS interop guard. Depending on Vercel's bundler version, dynamic
    // import of a CommonJS-compiled handler can return either:
    //   { default: handler }              ← clean ESM result
    //   { default: { default: handler } } ← double-wrap when CJS exports.default
    //   handler (raw function)            ← if bundled as CJS directly
    // The previous `mod.default(req, res)` only handled the first shape and
    // failed with "mod.default is not a function" on the double-wrapped one.
    const fn =
      (typeof mod === 'function')                                 ? mod :
      (mod && typeof mod.default === 'function')                  ? mod.default :
      (mod && mod.default && typeof mod.default.default === 'function') ? mod.default.default :
      null;
    if (!fn) {
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
    return res.status(500).json({ error: `Dispatcher failed for op=${op}: ${e.message || e}` });
  }
}

// regen-en-stream + events-style endpoints need streaming response.
// The dispatcher doesn't change the runtime — Node streaming still works
// because we use `res.write()` directly inside the inner handler.
export const config = { runtime: 'nodejs', maxDuration: 300 };
