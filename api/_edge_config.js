/**
 * Vercel Edge Config adapter — sub-15ms global config store.
 *
 * Use case fit: A/B test config (read-heavy, write-rarely, edge-replicated).
 * KV is still better for high-write counters (push subscribers, AB exposures).
 *
 * Required env vars (set automatically by `vercel link` to an Edge Config):
 *   EDGE_CONFIG  — the connection string (vercel://edge-config/<id>?token=...)
 * OR
 *   EDGE_CONFIG_ID + VERCEL_API_TOKEN  — for write operations via REST API
 *
 * Falls back to null when not configured; callers should use Vercel KV
 * fallback (`api/_kv.js`) when Edge Config absent.
 *
 * Reads are served from the local edge node (replicated globally; ~15 ms p99).
 * Writes go through the Vercel REST API (300-800 ms typical) — fine for
 * admin updates which happen at most a few times per day.
 */

export function ecAvailable() {
  return Boolean(process.env.EDGE_CONFIG);
}

// Parse the connection string vercel://edge-config/<id>?token=<token>
function parseConn() {
  const url = process.env.EDGE_CONFIG;
  if (!url) return null;
  try {
    const m = url.match(/edge-config\/([^?]+)\?token=(.+)$/);
    if (m) return { id: m[1], token: m[2] };
  } catch (e) {}
  return null;
}

export async function ecGet(key) {
  const conn = parseConn();
  if (!conn) return null;
  try {
    const r = await fetch(`https://edge-config.vercel.com/${conn.id}/item/${encodeURIComponent(key)}?token=${conn.token}`, {
      headers: { Accept: 'application/json' },
    });
    if (r.status === 404) return null;
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

export async function ecGetAll() {
  const conn = parseConn();
  if (!conn) return null;
  try {
    const r = await fetch(`https://edge-config.vercel.com/${conn.id}/items?token=${conn.token}`, {
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

/**
 * Write key → value via Vercel REST API. Requires EDGE_CONFIG_ID +
 * VERCEL_API_TOKEN env vars (different from the read token).
 */
export async function ecSet(key, value) {
  const id = process.env.EDGE_CONFIG_ID;
  const token = process.env.VERCEL_API_TOKEN;
  if (!id || !token) return false;
  try {
    const r = await fetch(`https://api.vercel.com/v1/edge-config/${id}/items`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [{ operation: 'upsert', key, value }],
      }),
    });
    return r.ok;
  } catch (e) { return false; }
}

export async function ecDelete(key) {
  const id = process.env.EDGE_CONFIG_ID;
  const token = process.env.VERCEL_API_TOKEN;
  if (!id || !token) return false;
  try {
    const r = await fetch(`https://api.vercel.com/v1/edge-config/${id}/items`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [{ operation: 'delete', key }],
      }),
    });
    return r.ok;
  } catch (e) { return false; }
}
