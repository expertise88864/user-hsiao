/**
 * GET  /api/admin/ab-stats?testId=<id>          → returns aggregated stats
 * POST /api/admin/ab-stats {testId, variantIndex, event}  → record a counter (no auth)
 *
 * v29: Now KV-first storage. Each test stored as a single KV JSON blob at
 *      key `ab:<testId>`. INCR commands keep counters atomic. Falls back
 *      to a single GitHub blob (assets/ab-stats.json) if KV not configured.
 *
 * Why this matters: in v28, every exposure / conversion potentially triggered
 * a GitHub commit (rate-limited to 5000/hour and adds repo noise). KV is
 * essentially free at HsiaoEye's scale.
 */
import { requireAdmin, ghGetFile, ghPutFile } from './_auth.js';
import { kvAvailable, kvGet, kvSetJSON, kvHGetAll, kvHIncrBy, kvHSet } from '../_kv.js';

const STATS_PATH = 'assets/ab-stats.json';
const KV_PREFIX = 'ab:';
const KV_INDEX  = 'ab:_index';

// ── helpers ──
async function loadAllTests() {
  if (kvAvailable()) {
    // Index of testIds is itself a hash: { testId → created_iso }
    const idx = (await kvHGetAll(KV_INDEX)) || {};
    const tests = {};
    for (const testId of Object.keys(idx)) {
      const counters = (await kvHGetAll(KV_PREFIX + testId)) || {};
      // Schema: <i>:exp = N, <i>:cv:<event> = N, <i>:name = string
      const variants = [];
      Object.entries(counters).forEach(([k, v]) => {
        const m = k.match(/^(\d+):(.+)$/);
        if (!m) return;
        const i = parseInt(m[1], 10);
        const sub = m[2];
        while (variants.length <= i) variants.push({ name: '', exposures: 0, conversions: {} });
        if (sub === 'exp')        variants[i].exposures = parseInt(v, 10) || 0;
        else if (sub === 'name')  variants[i].name = String(v);
        else if (sub.startsWith('cv:')) variants[i].conversions[sub.slice(3)] = parseInt(v, 10) || 0;
      });
      tests[testId] = { created: idx[testId], variants };
    }
    return tests;
  }
  // GitHub blob fallback
  const file = await ghGetFile(STATS_PATH);
  if (!file) return {};
  try { return (JSON.parse(file.content).tests || {}); } catch (e) { return {}; }
}

async function recordEventGH(testId, variantIndex, event, variantName) {
  const file = await ghGetFile(STATS_PATH);
  let content = { tests: {} };
  let sha;
  if (file) { sha = file.sha; try { content = JSON.parse(file.content); } catch (e) {} }
  const tests = content.tests = content.tests || {};
  const t = tests[testId] = tests[testId] || { created: new Date().toISOString(), variants: [] };
  while (t.variants.length <= variantIndex) t.variants.push({ name: '', exposures: 0, conversions: {} });
  const v = t.variants[variantIndex];
  if (variantName && !v.name) v.name = String(variantName).slice(0, 60);
  if (event === 'exposure') v.exposures = (v.exposures || 0) + 1;
  else { v.conversions = v.conversions || {}; v.conversions[event] = (v.conversions[event] || 0) + 1; }
  t.last_updated = new Date().toISOString();

  // Throttle commits — only every 5 min OR every 10 exposures
  const lastWrite = parseInt(content._last_write_ms || 0, 10);
  const now = Date.now();
  const shouldCommit = !lastWrite || (now - lastWrite) > 5 * 60 * 1000 || ((v.exposures || 0) % 10 === 0);
  if (shouldCommit) {
    content._last_write_ms = now;
    await ghPutFile(STATS_PATH, JSON.stringify(content, null, 2),
      `admin: A/B stats snapshot (${testId})`, sha);
    return { committed: true };
  }
  return { committed: false };
}

async function recordEventKV(testId, variantIndex, event, variantName) {
  // Atomic: HINCRBY for the counter, HSET for name (only if variant name not yet recorded)
  const subKey = event === 'exposure' ? `${variantIndex}:exp` : `${variantIndex}:cv:${event}`;
  await kvHIncrBy(KV_PREFIX + testId, subKey, 1);
  if (variantName) {
    // Only set name if not yet present — best-effort (no transaction)
    const existing = await kvHGetAll(KV_PREFIX + testId) || {};
    if (!existing[`${variantIndex}:name`]) {
      await kvHSet(KV_PREFIX + testId, `${variantIndex}:name`, String(variantName).slice(0, 60));
    }
  }
  // Track in index
  const idx = (await kvHGetAll(KV_INDEX)) || {};
  if (!idx[testId]) await kvHSet(KV_INDEX, testId, new Date().toISOString());
  return { committed: true };
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    try {
      const tests = await loadAllTests();
      const testId = req.query && req.query.testId;
      if (testId) return res.status(200).json({ test: tests[testId] || null });
      return res.status(200).json({ tests });
    } catch (e) { return res.status(500).json({ error: String(e.message || e) }); }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { testId, variantIndex, event, variantName } = body || {};
  if (!testId || typeof variantIndex !== 'number' || !event) {
    return res.status(400).json({ error: 'testId, variantIndex, event required' });
  }
  if (!/^[a-z0-9_:.-]+$/i.test(testId)) return res.status(400).json({ error: 'invalid testId' });
  if (!/^[a-z0-9_]+$/i.test(event))     return res.status(400).json({ error: 'invalid event name' });

  try {
    if (kvAvailable()) {
      await recordEventKV(testId, variantIndex, event, variantName);
      res.status(200).json({ ok: true, source: 'kv' });
    } else {
      const r = await recordEventGH(testId, variantIndex, event, variantName);
      res.status(200).json({ ok: true, source: 'gh', committed: r.committed });
    }
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
