/**
 * POST /api/admin/rollback — revert an article file to a previous git commit's
 * version. The rollback itself creates a NEW commit on main (so git history
 * stays linear and rollbackable, no force-push).
 *
 * Body: { slug: string, sha: string }   // sha = commit OR blob SHA to restore
 *
 * Strategy:
 *   1. GET the file at that historical commit:
 *        GET /repos/.../contents/<path>?ref=<sha>
 *      → returns the file content AT that commit (decoded base64)
 *   2. PUT current file with that historical content (creates a forward commit)
 *
 * Returns { ok, commit, restored_from }
 */
import { requireAdmin, ghPutFile, ghGetFile, getRepoConfig } from './_auth.js';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { slug, sha } = body || {};

  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'Invalid slug' });
  if (!sha || !/^[a-f0-9]{7,40}$/.test(sha)) return res.status(400).json({ error: 'Invalid commit sha' });

  const { owner, repo, token } = getRepoConfig();
  if (!token) return res.status(500).json({ error: 'GITHUB_TOKEN env var not configured' });

  try {
    const path = `blog/${slug}.html`;

    // Fetch file content at that historical commit
    const histUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${sha}`;
    const histR = await fetch(histUrl, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (histR.status === 404) return res.status(404).json({ error: `File not in commit ${sha.slice(0, 7)}` });
    if (!histR.ok) return res.status(500).json({ error: `GitHub historical fetch ${histR.status}` });
    const histData = await histR.json();
    const histContent = Buffer.from(histData.content, histData.encoding || 'base64').toString('utf-8');

    // Get current sha for forward update
    const current = await ghGetFile(path);
    if (!current) return res.status(404).json({ error: `Article ${slug} not found currently` });
    if (current.content === histContent) {
      return res.status(200).json({ ok: true, noop: true, restored_from: sha.slice(0, 7) });
    }

    const result = await ghPutFile(
      path,
      histContent,
      `admin: rollback ${slug} to ${sha.slice(0, 7)} via /admin`,
      current.sha
    );
    res.status(200).json({ ok: true, commit: result.commitSha, restored_from: sha.slice(0, 7) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
