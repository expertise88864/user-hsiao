/**
 * POST /api/push/send - broadcast a Web Push notification (admin-gated).
 */
import { requireAdmin } from '../admin/_auth.js';
import { sendPush } from './_webpush.js';
import {
  loadSubscriptions,
  pushStorageAvailable,
  removeSubscriptions,
} from './_store.js';

function text(value, max) {
  return String(value || '').trim().slice(0, max);
}

function localPath(value, fallback) {
  const path = text(value, 512);
  return path.startsWith('/') && !path.startsWith('//') ? path : fallback;
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!pushStorageAvailable()) {
    return res.status(503).json({ error: 'Private push storage is not configured' });
  }

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return res.status(500).json({ error: 'VAPID keys are not configured' });
  }
  const subject = VAPID_SUBJECT || 'mailto:noreply@hsiao.chendermatologist.com';

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const {
    title,
    body: msgBody,
    url,
    icon,
    badge,
    tag,
    urgency,
    topic,
    dryRun,
  } = body || {};
  const safeTitle = text(title, 120);
  if (!safeTitle) return res.status(400).json({ error: 'title required' });

  try {
    const subs = await loadSubscriptions();
    if (!subs.length) {
      return res.status(200).json({ ok: true, sent: 0, message: 'No subscribers yet.' });
    }
    if (dryRun) return res.status(200).json({ ok: true, dryRun: true, count: subs.length });

    const payload = JSON.stringify({
      title: safeTitle,
      body: text(msgBody, 360),
      url: localPath(url, '/blog/'),
      icon: localPath(icon, '/icon-192.png'),
      badge: localPath(badge, '/icon-32.png'),
      tag: text(tag, 64) || 'hsiao-newpost',
    });
    const safeUrgency = ['very-low', 'low', 'normal', 'high'].includes(urgency) ? urgency : 'normal';
    const safeTopic = /^[A-Za-z0-9_-]{1,32}$/.test(String(topic || '')) ? String(topic) : undefined;

    let sent = 0;
    let failed = 0;
    const dead = [];
    const queue = subs.slice();
    const workers = [];
    for (let w = 0; w < 10; w++) {
      workers.push((async () => {
        while (queue.length) {
          const subscription = queue.shift();
          if (!subscription) break;
          try {
            const response = await sendPush(
              subscription,
              payload,
              VAPID_PUBLIC_KEY,
              VAPID_PRIVATE_KEY,
              subject,
              { ttl: 86400, urgency: safeUrgency, topic: safeTopic }
            );
            if (response.status === 200 || response.status === 201) sent++;
            else if (response.status === 404 || response.status === 410) dead.push(subscription.endpoint);
            else failed++;
          } catch (e) {
            failed++;
          }
        }
      })());
    }
    await Promise.all(workers);

    let pruned = 0;
    if (dead.length) {
      try { pruned = await removeSubscriptions(dead); } catch (e) {}
    }
    return res.status(200).json({ ok: true, sent, failed, pruned, total: subs.length });
  } catch (e) {
    return res.status(503).json({ error: 'Push subscription storage unavailable' });
  }
}
