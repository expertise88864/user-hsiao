/**
 * GET  /api/admin/ab-stats?testId=<id> - return aggregated stats (admin only)
 * POST /api/admin/ab-stats {testId, variantIndex, event} - record a counter
 *
 * Public telemetry is KV-only. If KV is unavailable, POST requests are
 * accepted and dropped so anonymous traffic can never create GitHub commits.
 */
import { requireAdmin } from './_auth.js';
import { kvAvailable, kvHGetAll, kvPipeline } from '../_kv.js';
import { rateLimitOk, sendRateLimit } from '../_rate_limit.js';
import { telemetryExclusion } from '../_telemetry.js';

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
  // One script updates the counter, optional label and discoverable index.
  // Validate key types before any mutation: Redis scripts are isolated, but
  // runtime errors do not roll back commands already executed.
  const script = `
    for _, key in ipairs(KEYS) do
      local kind = redis.call('TYPE', key).ok
      if kind ~= 'none' and kind ~= 'hash' then
        return redis.error_reply('Invalid A/B storage type')
      end
    end
    local count = redis.call('HINCRBY', KEYS[1], ARGV[1], 1)
    if ARGV[2] ~= '' then redis.call('HSETNX', KEYS[1], ARGV[2], ARGV[3]) end
    redis.call('HSETNX', KEYS[2], ARGV[4], ARGV[5])
    return count
  `;
  const result = await kvPipeline([['EVAL', script, '2', key, KV_INDEX,
    counter, variantName ? `${variantIndex}:name` : '', String(variantName || '').slice(0, 60),
    testId, new Date().toISOString()]]);
  if (!Number.isSafeInteger(result?.[0]?.result) || result[0].result < 1) {
    throw new Error('KV A/B write failed');
  }
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
  const excluded = telemetryExclusion(req);
  if (excluded) return res.status(202).json({ ok: true, stored: false, source: 'noop', reason: excluded });
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
  if (String(testId).length > 80 || !/^[a-z0-9_:.-]+$/i.test(testId) || testId === '_index') {
    return res.status(400).json({ error: 'invalid testId' });
  }
  if (String(event).length > 40 || !/^[a-z0-9_]+$/i.test(event)) {
    return res.status(400).json({ error: 'invalid event name' });
  }

  try {
    if (!kvAvailable()) return res.status(202).json({ ok: true, stored: false, source: 'noop', reason: 'not_configured' });
    await recordEventKV(testId, variantIndex, event, variantName);
    return res.status(200).json({ ok: true, stored: true, source: 'kv' });
  } catch (e) {
    return res.status(503).json({ error: String(e.message || e) });
  }
}
