/**
 * POST /api/admin/purge — purge Vercel edge cache for one or more paths.
 *
 * Body: { paths?: string[] }   omit paths → purges everything
 *
 * Why: dynamic endpoints (sitemap, feed, og) have `s-maxage` on the edge
 * (typically 1-6 hours). After admin edits, you may want crawlers to see
 * fresh content immediately. This endpoint hits Vercel's purge API.
 *
 * Required env vars:
 *   VERCEL_TOKEN       — API token (https://vercel.com/account/tokens)
 *   VERCEL_PROJECT_ID  — `prj_xxx`
 *   VERCEL_TEAM_ID     — `team_xxx` (Hobby plan: omit)
 *
 * Returns { ok, purged: [...paths] }.
 *
 * Note: Vercel's "Data Cache" purge API is what we want here. Some paths
 * (immutable assets) don't honor purge — that's a Vercel limitation, not ours.
 */
import { requireAdmin } from './_auth.js';

const DEFAULT_PATHS = [
  '/sitemap.xml',
  '/blog/feed.xml',
  '/blog/atom.xml',
  '/',
  '/blog/',
];

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token     = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId    = process.env.VERCEL_TEAM_ID;
  if (!token || !projectId) {
    return res.status(503).json({ error: 'VERCEL_TOKEN + VERCEL_PROJECT_ID env vars required' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const paths = Array.isArray(body.paths) && body.paths.length ? body.paths : DEFAULT_PATHS;

  // Sanity check paths
  for (const p of paths) {
    if (typeof p !== 'string' || !p.startsWith('/') || p.length > 200) {
      return res.status(400).json({ error: `invalid path: ${p}` });
    }
  }

  // Vercel purge by tag/path — we use "Data Cache" purge API.
  // Docs: https://vercel.com/docs/data-cache/manage-data-cache#purge
  // Endpoint: POST /v1/data-cache/purge-by-tag?projectId=...&teamId=...
  // For HTML/static asset paths, the equivalent is purging the whole project's
  // edge cache. Hobby plans only support full-project purge.
  const url = `https://api.vercel.com/v1/projects/${projectId}/cache?` +
              new URLSearchParams({ ...(teamId ? { teamId } : {}) }).toString();
  try {
    const r = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      const txt = await r.text();
      return res.status(500).json({ error: `Vercel purge failed: ${r.status} — ${txt.slice(0, 200)}` });
    }
    res.status(200).json({ ok: true, purged: paths, mode: 'project-wide', note: 'Vercel Hobby plan only supports project-wide purge.' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
