/**
 * /api/admin/ab-config — A/B test config CRUD
 *
 * GET    → list all configured tests
 * POST   → create / update a test  { id, selector, variants: [{name, html}], active }
 * DELETE → remove a test          { id }
 *
 * Storage: KV first, falls back to GitHub blob `assets/ab-config.json`.
 * Schema:
 *   { tests: { <id>: { selector, variants: [{name, html}], created, active } } }
 *
 * The CLIENT (DN.applyAbConfig in blog-shared.js) reads /api/ab-config (public)
 * on page load, runs DN.abTest for each active config, and innerHTML-swaps
 * the matched element with the chosen variant's html.
 */
import { requireAdmin, ghGetFile, ghPutFile } from './_auth.js';
import { kvAvailable, kvGetJSON, kvSetJSON } from '../_kv.js';

const KV_KEY = 'ab:config';
const BLOB_PATH = 'assets/ab-config.json';

async function load() {
  if (kvAvailable()) {
    return (await kvGetJSON(KV_KEY)) || { tests: {} };
  }
  const f = await ghGetFile(BLOB_PATH);
  if (!f) return { tests: {}, _sha: undefined };
  try { return Object.assign(JSON.parse(f.content), { _sha: f.sha }); }
  catch (e) { return { tests: {}, _sha: f.sha }; }
}

async function save(state) {
  const sha = state._sha;
  delete state._sha;
  if (kvAvailable()) {
    await kvSetJSON(KV_KEY, state);
    return { source: 'kv' };
  }
  await ghPutFile(BLOB_PATH, JSON.stringify(state, null, 2),
    `admin: update A/B config (${Object.keys(state.tests).length} tests)`, sha);
  return { source: 'gh' };
}

function validate(body) {
  if (!body || typeof body !== 'object') return 'invalid body';
  if (!body.id || !/^[a-z0-9_-]+$/i.test(body.id)) return 'id must be alphanumeric';
  if (!body.selector || typeof body.selector !== 'string') return 'selector required';
  if (!Array.isArray(body.variants) || body.variants.length < 2 || body.variants.length > 4) return 'need 2-4 variants';
  for (const v of body.variants) {
    if (!v.name || !v.html) return 'each variant needs name + html';
    if (v.html.length > 4000) return 'variant html too long (>4000 chars)';
    if (/<script|<\s*iframe|on\w+=/i.test(v.html)) return 'variant html cannot contain <script>/<iframe>/on* event handlers';
  }
  return null;
}

export default async function handler(req, res) {
  // GET is PUBLIC (used by client to fetch active tests). POST/DELETE require admin.
  if (req.method === 'GET') {
    try {
      const state = await load();
      // Strip inactive tests for public response (smaller payload)
      const isAdmin = req.headers.cookie && req.headers.cookie.includes('hs_admin_session=');
      const tests = state.tests || {};
      if (!isAdmin) {
        const active = {};
        for (const [k, v] of Object.entries(tests)) {
          if (v.active) active[k] = { selector: v.selector, variants: v.variants };
        }
        res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
        return res.status(200).json({ tests: active });
      }
      return res.status(200).json({ tests });
    } catch (e) { return res.status(500).json({ error: String(e.message || e) }); }
  }

  if (!requireAdmin(req, res)) return;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }

  if (req.method === 'POST') {
    const err = validate(body);
    if (err) return res.status(400).json({ error: err });
    try {
      const state = await load();
      state.tests = state.tests || {};
      state.tests[body.id] = {
        selector: body.selector,
        variants: body.variants,
        active: body.active !== false,
        created: state.tests[body.id]?.created || new Date().toISOString(),
        updated: new Date().toISOString(),
      };
      const r = await save(state);
      res.status(200).json({ ok: true, id: body.id, source: r.source });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
    return;
  }

  if (req.method === 'DELETE') {
    if (!body || !body.id) return res.status(400).json({ error: 'id required' });
    try {
      const state = await load();
      if (state.tests && state.tests[body.id]) {
        delete state.tests[body.id];
        const r = await save(state);
        return res.status(200).json({ ok: true, removed: body.id, source: r.source });
      }
      return res.status(200).json({ ok: true, removed: false });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
