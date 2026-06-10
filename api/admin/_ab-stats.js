/**
 * GET  /api/admin/ab-stats?testId=<id> - return aggregated stats (admin only)
 * POST /api/admin/ab-stats {testId, variantIndex, event} - record a counter
 *
 * Public telemetry is KV-only. If KV is unavailable, POST requests are
 * accepted and dropped so anonymous traffic can never create GitHub commits.
 */
import { requireAdmin } from './_auth.js';
import { kvAvailable, kvHGetAll, kvHIncrBy, kvHSet } from '../_kv.js';
import { rateLimitOk, sendRateLimit } from '../_rate_limit.js';

const KV_PREFIX = 'ab:';
const KV_INDEX = 'ab:_index';

async function loadAllTests() {
  if (!kvAvailable()) return {};
  const idx = (await kvHGetAll(KV_INDEX)) || {};
  const tests = {};

  for (const testId of Object.keys(idx)) {
    const counters = (await kvHGetAll(KV_PREFIX + testId)) || {};
    const variants = [];
    Object.entries(counters).forEach(([key, value]) => {
      const match = key.match(/^(\d+):(.+)$/);
      if (!match) return;
      const index = parseInt(match[1], 10);
      const field = match[2];
      while (variants.length <= index) {
        variants.push({ name: '', exposures: 0, conversions: {} });
      }
      if (field === 'exp') variants[index].exposures = parseInt(value, 10) || 0;
      else if (field === 'name') variants[index].name = String(value);
      else if (field.startsWith('cv:')) {
        variants[index].conversions[field.slice(3)] = parseInt(value, 10) || 0;
      }
    });
    tests[testId] = { created: idx[testId], variants };
  }
  return tests;
}

async function recordEventKV(testId, variantIndex, event, variantName) {
  const key = KV_PREFIX + testId;
  const counter = event === 'exposure'
    ? `${variantIndex}:exp`
    : `${variantIndex}:cv:${event}`;
  const incremented = await kvHIncrBy(key, counter, 1);
  if (incremented == null) throw new Error('KV counter write failed');

  if (variantName) {
    const existing = (await kvHGetAll(key)) || {};
    if (!existing[`${variantIndex}:name`]) {
      await kvHSet(key, `${variantIndex}:name`, String(variantName).slice(0, 60));
    }
  }

  const index = (await kvHGetAll(KV_INDEX)) || {};
  if (!index[testId]) await kvHSet(KV_INDEX, testId, new Date().toISOString());
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    try {
      const tests = await loadAllTests();
      const testId = req.query && req.query.testId;
      if (testId) {
        return res.status(200).json({
          test: tests[testId] || null,
          configured: kvAvailable(),
        });
      }
      return res.status(200).json({ tests, configured: kvAvailable() });
    } catch (e) {
      return res.status(500).json({ error: String(e.message || e) });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!rateLimitOk(req, { key: 'ab-stats', max: 60, windowMs: 60_000 })) {
    return sendRateLimit(res, 60);
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { testId, variantIndex, event, variantName } = body || {};
  if (!testId || !Number.isInteger(variantIndex) || variantIndex < 0 || variantIndex > 20 || !event) {
    return res.status(400).json({ error: 'testId, variantIndex, event required' });
  }
  if (String(testId).length > 80 || !/^[a-z0-9_:.-]+$/i.test(testId)) {
    return res.status(400).json({ error: 'invalid testId' });
  }
  if (String(event).length > 40 || !/^[a-z0-9_]+$/i.test(event)) {
    return res.status(400).json({ error: 'invalid event name' });
  }

  try {
    if (!kvAvailable()) return res.status(202).json({ ok: true, source: 'noop' });
    await recordEventKV(testId, variantIndex, event, variantName);
    return res.status(200).json({ ok: true, source: 'kv' });
  } catch (e) {
    return res.status(503).json({ error: String(e.message || e) });
  }
}
