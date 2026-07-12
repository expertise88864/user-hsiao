/**
 * GET /api/admin/history?slug=<slug>&limit=20  → recent commits touching that file.
 *
 * Returns: { commits: [{ sha, date, message, author }] }
 *
 * Used by the admin "版本歷史 / 回滾" panel.
 */
import { requireAdmin, getRepoConfig } from './_auth.js';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const slug = (req.query && req.query.slug) || '';
  const limit = Math.min(parseInt((req.query && req.query.limit) || '20', 10) || 20, 50);
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'Invalid slug' });

  const { owner, repo, branch, token } = getRepoConfig();
  if (!token) return res.status(500).json({ error: 'GITHUB_TOKEN env var not configured' });

  try {
    const path = `blog/${slug}.html`;
    const url = `https://api.github.com/repos/${owner}/${repo}/commits?path=${encodeURIComponent(path)}&sha=${branch}&per_page=${limit}`;
    const r = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!r.ok) {
      return res.status(500).json({ error: `GitHub commits ${r.status}: ${(await r.text()).slice(0, 200)}` });
    }
    const data = await r.json();
    const commits = (data || []).map(c => ({
      sha:     c.sha,
      short:   c.sha.slice(0, 7),
      date:    c.commit?.author?.date || c.commit?.committer?.date || '',
      message: c.commit?.message || '',
      author:  c.commit?.author?.name || c.author?.login || '',
    }));
    res.status(200).json({ commits, slug });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
