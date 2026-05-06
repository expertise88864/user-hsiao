/**
 * Lightweight Vercel KV (Upstash Redis) adapter — only the GET / SET / INCR
 * paths we need. Avoids the npm @vercel/kv dependency (which pulls in
 * 30+ transitive deps and bloats Edge bundle size).
 *
 * Required env vars (set automatically by `vercel link` to a KV store):
 *   KV_REST_API_URL    e.g. https://us1-fluent-bee-12345.upstash.io
 *   KV_REST_API_TOKEN  bearer token
 *
 * Falls back gracefully (returns null / no-op) if env vars are absent —
 * callers should check `kvAvailable()` first and use the GitHub blob path
 * as fallback.
 */

export function kvAvailable() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kvCall(commandPath, body) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('KV not configured');
  const r = await fetch(`${url}${commandPath}`, {
    method: body == null ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`KV ${commandPath} → ${r.status} ${await r.text().catch(() => '')}`);
  return r.json();
}

export async function kvGet(key) {
  if (!kvAvailable()) return null;
  try {
    const r = await kvCall(`/get/${encodeURIComponent(key)}`);
    return r.result;
  } catch (e) { return null; }
}

export async function kvSet(key, value, opts = {}) {
  if (!kvAvailable()) return false;
  try {
    const path = `/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}` + (opts.ex ? `?EX=${opts.ex}` : '');
    await kvCall(path);
    return true;
  } catch (e) { return false; }
}

export async function kvGetJSON(key) {
  const v = await kvGet(key);
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (e) { return null; }
}

export async function kvSetJSON(key, value) {
  return kvSet(key, JSON.stringify(value));
}

export async function kvIncr(key, by = 1) {
  if (!kvAvailable()) return null;
  try {
    const r = await kvCall(`/incrby/${encodeURIComponent(key)}/${by}`);
    return r.result;
  } catch (e) { return null; }
}

export async function kvHGetAll(key) {
  if (!kvAvailable()) return null;
  try {
    const r = await kvCall(`/hgetall/${encodeURIComponent(key)}`);
    // Upstash returns flat array [k1, v1, k2, v2, ...]
    if (Array.isArray(r.result)) {
      const obj = {};
      for (let i = 0; i < r.result.length; i += 2) obj[r.result[i]] = r.result[i + 1];
      return obj;
    }
    return r.result;
  } catch (e) { return null; }
}

export async function kvHSet(key, field, value) {
  if (!kvAvailable()) return false;
  try {
    const path = `/hset/${encodeURIComponent(key)}/${encodeURIComponent(field)}/${encodeURIComponent(value)}`;
    await kvCall(path);
    return true;
  } catch (e) { return false; }
}

export async function kvHIncrBy(key, field, by = 1) {
  if (!kvAvailable()) return null;
  try {
    const r = await kvCall(`/hincrby/${encodeURIComponent(key)}/${encodeURIComponent(field)}/${by}`);
    return r.result;
  } catch (e) { return null; }
}
