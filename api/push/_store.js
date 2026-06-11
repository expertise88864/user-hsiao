/**
 * Private Web Push subscription storage.
 *
 * Each endpoint is an independent hash field so concurrent subscriptions do
 * not overwrite one another. The old JSON-array key is migrated once and is
 * then ignored. Never fall back to a repository file: endpoints and auth keys
 * are private subscriber credentials.
 */
import {
  kvAvailable,
  kvGet,
  kvGetJSON,
  kvHDel,
  kvHGet,
  kvHGetAll,
  kvHLen,
  kvHSet,
  kvSet,
} from '../_kv.js';

const HASH_KEY = 'push:subscribers:v2';
const LEGACY_KEY = 'push:subscribers';
const MIGRATION_KEY = 'push:subscribers:v2:migrated';

export function pushStorageAvailable() {
  return kvAvailable();
}

async function ensureMigrated() {
  if (!kvAvailable()) throw new Error('Private push storage is not configured');
  if (await kvGet(MIGRATION_KEY)) return;

  const count = await kvHLen(HASH_KEY);
  if (count == null) throw new Error('Push storage is unavailable');
  if (Number(count) === 0) {
    const legacy = await kvGetJSON(LEGACY_KEY);
    if (Array.isArray(legacy)) {
      for (const sub of legacy) {
        if (!sub || typeof sub.endpoint !== 'string') continue;
        const stored = await kvHSet(HASH_KEY, sub.endpoint, JSON.stringify(sub));
        if (!stored) throw new Error('Push subscription migration failed');
      }
    }
  }
  if (!(await kvSet(MIGRATION_KEY, '1'))) {
    throw new Error('Push subscription migration marker failed');
  }
}

export async function loadSubscriptions() {
  await ensureMigrated();
  const entries = await kvHGetAll(HASH_KEY);
  if (entries == null) throw new Error('Push storage is unavailable');
  return Object.values(entries).flatMap(value => {
    try {
      const sub = typeof value === 'string' ? JSON.parse(value) : value;
      return sub && typeof sub.endpoint === 'string' ? [sub] : [];
    } catch (e) {
      return [];
    }
  });
}

export async function upsertSubscription(subscription, maxSubscriptions) {
  await ensureMigrated();
  const existing = await kvHGet(HASH_KEY, subscription.endpoint);
  if (existing != null) {
    if (!(await kvHSet(HASH_KEY, subscription.endpoint, JSON.stringify(subscription)))) {
      throw new Error('Push subscription refresh failed');
    }
    return { inserted: false, count: Number(await kvHLen(HASH_KEY)) || 0 };
  }

  const count = await kvHLen(HASH_KEY);
  if (count == null) throw new Error('Push storage is unavailable');
  if (Number(count) >= maxSubscriptions) {
    return { inserted: false, full: true, count: Number(count) };
  }
  if (!(await kvHSet(HASH_KEY, subscription.endpoint, JSON.stringify(subscription)))) {
    throw new Error('Push subscription write failed');
  }
  const nextCount = await kvHLen(HASH_KEY);
  return { inserted: true, count: nextCount == null ? Number(count) + 1 : Number(nextCount) };
}

export async function removeSubscription(endpoint) {
  await ensureMigrated();
  const removed = await kvHDel(HASH_KEY, endpoint);
  if (removed == null) throw new Error('Push storage is unavailable');
  const count = await kvHLen(HASH_KEY);
  return { removed: Number(removed) > 0, count: count == null ? 0 : Number(count) };
}

export async function removeSubscriptions(endpoints) {
  await ensureMigrated();
  let removed = 0;
  for (const endpoint of new Set(endpoints)) {
    const result = await kvHDel(HASH_KEY, endpoint);
    if (result == null) throw new Error('Push storage is unavailable');
    removed += Number(result) || 0;
  }
  return removed;
}
