/**
 * POST /api/push/send — broadcast a Web Push notification (admin-gated).
 *
 * Body: { title, body, url?, icon?, badge?, tag?, urgency?, topic? }
 *
 * v29: Now uses RFC 8291 aes128gcm encryption — recipients see the actual
 *      title / body in the notification, not just a "you have a new message"
 *      placeholder.
 *
 * Required env vars (Vercel Dashboard):
 *   VAPID_PUBLIC_KEY  — base64url, 65 bytes (uncompressed P-256 point)
 *   VAPID_PRIVATE_KEY — base64url, 32 bytes (private scalar)
 *   VAPID_SUBJECT     — `mailto:f94001115@gmail.com`
 *
 * Generate with `npx web-push generate-vapid-keys`.
 */
import { requireAdmin } from '../admin/_auth.js';
import { sendPush } from './_webpush.js';
import { kvGetJSON, kvSetJSON, kvAvailable } from '../_kv.js';
import { ghGetFile, ghPutFile } from '../admin/_auth.js';

const KV_KEY = 'push:subscribers';
const SUBSCRIBERS_PATH = 'assets/push-subscribers.json';

async function loadSubs() {
  if (kvAvailable()) {
    const subs = await kvGetJSON(KV_KEY);
    return { subs: subs || [], source: 'kv' };
  }
  const file = await ghGetFile(SUBSCRIBERS_PATH);
  if (!file) return { subs: [], source: 'gh', sha: undefined };
  try { return { subs: JSON.parse(file.content), source: 'gh', sha: file.sha }; }
  catch (e) { return { subs: [], source: 'gh', sha: file.sha }; }
}

async function persistSubs(subs, sha) {
  if (kvAvailable()) {
    await kvSetJSON(KV_KEY, subs);
  } else {
    await ghPutFile(SUBSCRIBERS_PATH, JSON.stringify(subs, null, 2), `push: prune dead subscribers`, sha);
  }
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return res.status(500).json({
      error: 'VAPID keys missing. Generate via `npx web-push generate-vapid-keys` and set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in Vercel env vars.'
    });
  }
  const subject = VAPID_SUBJECT || 'mailto:noreply@hsiao.chendermatologist.com';

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { title, body: msgBody, url, icon, badge, tag, urgency, topic, dryRun } = body || {};
  if (!title) return res.status(400).json({ error: 'title required' });

  try {
    const { subs, sha } = await loadSubs();
    if (!subs.length) return res.status(200).json({ ok: true, sent: 0, message: 'No subscribers yet.' });

    if (dryRun) return res.status(200).json({ ok: true, dryRun: true, count: subs.length });

    const payload = JSON.stringify({
      title,
      body: msgBody || '',
      url:  url   || '/blog/',
      icon: icon  || '/icon-192.png',
      badge: badge || '/icon-32.png',
      tag:  tag   || 'hsiao-newpost',
    });

    let sent = 0, failed = 0, dead = [];
    // Limit concurrency to 10 (push services rate-limit; serial is too slow)
    const queue = subs.slice();
    const workers = [];
    const concurrency = 10;
    for (let w = 0; w < concurrency; w++) {
      workers.push((async () => {
        while (queue.length) {
          const s = queue.shift();
          if (!s) break;
          try {
            const r = await sendPush(s, payload, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, subject, { ttl: 86400, urgency: urgency || 'normal', topic });
            if (r.status === 201 || r.status === 200) { sent++; }
            else if (r.status === 404 || r.status === 410) { dead.push(s.endpoint); }
            else { failed++; }
          } catch (e) { failed++; }
        }
      })());
    }
    await Promise.all(workers);

    // Auto-prune dead subscriptions
    let pruned = 0;
    if (dead.length) {
      const live = subs.filter(s => !dead.includes(s.endpoint));
      if (live.length !== subs.length) {
        try { await persistSubs(live, sha); pruned = subs.length - live.length; } catch (e) {}
      }
    }

    res.status(200).json({ ok: true, sent, failed, pruned, total: subs.length });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
