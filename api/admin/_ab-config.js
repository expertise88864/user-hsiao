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
import { isAdminRequest, requireAdmin, ghGetFile, ghPutFile } from './_auth.js';
import { kvAvailable, kvGetJSON, kvSetJSON } from '../_kv.js';
import { ecAvailable, ecGet, ecSet } from '../_edge_config.js';

const EC_KEY = 'ab_config';   // Edge Config keys must be alphanumeric/underscore
const KV_KEY = 'ab:config';
const BLOB_PATH = 'assets/ab-config.json';

async function load() {
  // Edge Config (preferred — sub-15ms global read)
  if (ecAvailable()) {
    const v = await ecGet(EC_KEY);
    if (v) return v;
    // First time — fall through to KV/GH to seed
  }
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
  // Write Edge Config first when available (REST API ~300ms write, but ~15ms reads)
  if (ecAvailable() && process.env.VERCEL_API_TOKEN && process.env.EDGE_CONFIG_ID) {
    const ok = await ecSet(EC_KEY, state);
    if (ok) return { source: 'edge-config' };
    // fall through if write failed
  }
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
  if (typeof body.id !== 'string' || body.id.length > 80 || !/^[a-z0-9_-]+$/i.test(body.id)) {
    return 'id must be 1-80 alphanumeric characters';
  }
  if (typeof body.selector !== 'string' || !body.selector.trim() || body.selector.length > 200) {
    return 'selector required (max 200 chars)';
  }
  const selector = body.selector.trim();
  const selectorParts = selector.split(/\s+/);
  const safeSelectorPart = part =>
    /^#[A-Za-z][\w-]*$/.test(part) ||
    /^\.[A-Za-z][\w-]*$/.test(part) ||
    /^\[data-[a-z0-9_-]+(?:=(?:"[^"]*"|'[^']*'|[a-z0-9_-]+))?\]$/i.test(part);
  if (/[,:>*+~]/.test(selector) || !selectorParts.every(safeSelectorPart)) {
    return 'selector must use only safe id, class, or data-attribute descendants';
  }
  if (!Array.isArray(body.variants) || body.variants.length < 2 || body.variants.length > 4) return 'need 2-4 variants';
  for (const v of body.variants) {
    if (!v || typeof v.name !== 'string' || typeof v.html !== 'string') return 'each variant needs string name + html';
    if (!v.name.trim() || v.name.length > 80 || !v.html) return 'variant name/html invalid';
    if (v.html.length > 4000) return 'variant html too long (>4000 chars)';
    if (/<\s*(?:script|iframe|object|embed|svg|math|style|form|base|meta|link)\b/i.test(v.html)) {
      return 'variant html contains a blocked active element';
    }
    if (/\son[a-z0-9:_-]+\s*=/i.test(v.html) || /\ssrcdoc\s*=/i.test(v.html)) {
      return 'variant html cannot contain event handlers or srcdoc';
    }
    const decodeCodePoint = (raw, radix) => {
      const codePoint = parseInt(raw, radix);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : '\ufffd';
    };
    const decodedForSafety = v.html
      .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => decodeCodePoint(hex, 16))
      .replace(/&#([0-9]+);?/g, (_, dec) => decodeCodePoint(dec, 10))
      .replace(/&(colon|tab|newline);/gi, (_, name) => ({
        colon: ':',
        tab: '\t',
        newline: '\n',
      })[name.toLowerCase()])
      .replace(/[\u0000-\u0020\u007f]+/g, '');
    if (/(?:href|src|action|formaction|xlink:href)=(['"]?)(?:javascript|vbscript|data:text\/html):/i.test(decodedForSafety)) {
      return 'variant html contains an unsafe URL';
    }
  }
  return null;
}

export { validate as validateAbConfig };

export default async function handler(req, res) {
  // GET is PUBLIC (used by client to fetch active tests). POST/DELETE require admin.
  if (req.method === 'GET') {
    try {
      const state = await load();
      // Strip inactive tests for public response (smaller payload)
      const isAdmin = isAdminRequest(req);
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
