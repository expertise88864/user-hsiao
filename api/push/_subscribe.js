/**
 * POST /api/push/subscribe — register a Web Push subscription.
 * DELETE /api/push/subscribe — unsubscribe by endpoint.
 *
 * Storage: prefers Vercel KV (key `push:subscribers` = JSON array). Falls
 * back to GitHub blob (`assets/push-subscribers.json`) if KV not configured.
 *
 * v29: KV path eliminates 1-commit-per-subscribe overhead from v28.
 */
import { ghGetFile, ghPutFile } from '../admin/_auth.js';
import { rateLimitOk, sendRateLimit } from '../_rate_limit.js';
import { kvAvailable, kvGetJSON, kvSetJSON } from '../_kv.js';

const KV_KEY = 'push:subscribers';
const SUBSCRIBERS_PATH = 'assets/push-subscribers.json';

async function loadSubs() {
  if (kvAvailable()) {
    const subs = await kvGetJSON(KV_KEY);
    return { subs: subs || [], source: 'kv', sha: undefined };
  }
  const file = await ghGetFile(SUBSCRIBERS_PATH);
  if (!file) return { subs: [], source: 'gh', sha: undefined };
  let subs = [];
  try { subs = JSON.parse(file.content); } catch (e) { subs = []; }
  return { subs, source: 'gh', sha: file.sha };
}

async function saveSubs(subs, sha) {
  if (kvAvailable()) {
    await kvSetJSON(KV_KEY, subs);
    return { source: 'kv' };
  }
  await ghPutFile(SUBSCRIBERS_PATH, JSON.stringify(subs, null, 2),
    `push: ${subs.length} subscribers`, sha);
  return { source: 'gh' };
}

export default async function handler(req, res) {
  // v37.28 — rate limit: a user should subscribe (or unsubscribe) at most
  // a few times per minute, never dozens. Cap at 10/min/IP.
  if (!rateLimitOk(req, { key: 'push-sub', max: 10, windowMs: 60_000 })) {
    return sendRateLimit(res, 60);
  }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }

  if (req.method === 'DELETE') {
    const { endpoint } = body || {};
    if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
    try {
      const { subs, sha } = await loadSubs();
      const filtered = subs.filter(s => s.endpoint !== endpoint);
      if (filtered.length === subs.length) return res.status(200).json({ ok: true, removed: false });
      await saveSubs(filtered, sha);
      return res.status(200).json({ ok: true, removed: true, total: filtered.length });
    } catch (e) {
      return res.status(500).json({ error: String(e.message || e) });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { endpoint, keys, userAgent } = body || {};
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ error: 'endpoint + keys.p256dh + keys.auth required' });
  }
  if (!/^https?:\/\//.test(endpoint)) return res.status(400).json({ error: 'invalid endpoint' });

  try {
    const { subs, sha } = await loadSubs();
    if (subs.find(s => s.endpoint === endpoint)) {
      return res.status(200).json({ ok: true, deduped: true, count: subs.length });
    }
    subs.push({
      endpoint, keys,
      ua: (userAgent || req.headers['user-agent'] || '').slice(0, 120),
      ts: new Date().toISOString(),
    });
    const result = await saveSubs(subs, sha);
    res.status(200).json({ ok: true, count: subs.length, source: result.source });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
