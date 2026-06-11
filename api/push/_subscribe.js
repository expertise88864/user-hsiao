/**
 * POST /api/push/subscribe - register a Web Push subscription.
 * DELETE /api/push/subscribe - unsubscribe by endpoint.
 *
 * Storage is a private Vercel KV hash. The endpoint fails closed if KV is
 * absent; subscriber endpoints and auth keys must never enter the public repo.
 */
import { rateLimitOk, sendRateLimit } from '../_rate_limit.js';
import {
  pushStorageAvailable,
  removeSubscription,
  upsertSubscription,
} from './_store.js';

const MAX_SUBS = 5000;
const ALLOWED_PUSH_HOST = /(^|\.)(googleapis\.com|push\.apple\.com|notify\.windows\.com|wns\.windows\.com|push\.services\.mozilla\.com)$/i;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function validEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length < 12 || endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && ALLOWED_PUSH_HOST.test(url.hostname);
  } catch (e) {
    return false;
  }
}

function validKey(value) {
  return typeof value === 'string' &&
    value.length >= 16 &&
    value.length <= 256 &&
    BASE64URL.test(value);
}

export default async function handler(req, res) {
  if (!rateLimitOk(req, { key: 'push-sub', max: 10, windowMs: 60_000 })) {
    return sendRateLimit(res, 60);
  }
  if (!pushStorageAvailable()) {
    return res.status(503).json({ error: 'Push subscriptions are temporarily unavailable' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }

  if (req.method === 'DELETE') {
    const { endpoint } = body || {};
    if (!validEndpoint(endpoint)) return res.status(400).json({ error: 'valid endpoint required' });
    try {
      const result = await removeSubscription(endpoint);
      return res.status(200).json({ ok: true, removed: result.removed, total: result.count });
    } catch (e) {
      return res.status(503).json({ error: 'Push subscription storage unavailable' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { endpoint, keys, userAgent } = body || {};
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ error: 'endpoint + keys.p256dh + keys.auth required' });
  }
  if (!validEndpoint(endpoint)) return res.status(400).json({ error: 'unsupported push endpoint' });
  if (!validKey(keys.p256dh) || !validKey(keys.auth)) {
    return res.status(400).json({ error: 'invalid push subscription keys' });
  }

  try {
    const subscription = {
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      ua: String(userAgent || req.headers['user-agent'] || '').slice(0, 160),
      ts: new Date().toISOString(),
    };
    const result = await upsertSubscription(subscription, MAX_SUBS);
    if (result.full) return res.status(429).json({ error: 'subscriber limit reached' });
    return res.status(200).json({
      ok: true,
      deduped: !result.inserted,
      count: result.count,
      source: 'kv',
    });
  } catch (e) {
    return res.status(503).json({ error: 'Push subscription storage unavailable' });
  }
}
