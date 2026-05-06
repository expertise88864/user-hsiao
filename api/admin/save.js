/**
 * POST /api/admin/save — receive modified article HTML, commit to GitHub.
 *
 * Body: { slug: string, html: string }
 * On success: { ok: true, commit: <sha> }
 *
 * Important: this is what makes "git push won't overwrite my edits" work —
 * admin edits ARE the git commits. User must `git pull` before any local
 * edits to get the latest content.
 */
import { requireAdmin, ghGetFile, ghPutFile } from './_auth.js';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Parse body
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { slug, html } = body || {};

  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: 'Invalid slug (must be lowercase a-z, 0-9, dash)' });
  }
  if (typeof html !== 'string' || html.length < 200) {
    return res.status(400).json({ error: 'Invalid html (too short or missing)' });
  }
  if (html.length > 1024 * 1024) {  // 1 MB hard cap
    return res.status(413).json({ error: 'HTML too large (>1 MB)' });
  }

  // Basic sanity: must contain expected article structure
  if (!html.includes('<article') || !html.includes('</html>')) {
    return res.status(400).json({ error: 'HTML missing required structure (<article>, </html>)' });
  }

  const path = `blog/${slug}.html`;

  try {
    // Get current sha so we can update (not create-overwrite)
    const existing = await ghGetFile(path);
    if (!existing) {
      return res.status(404).json({ error: `Article ${slug}.html not found in repo. Use /api/admin/new to create.` });
    }

    // Detect no-op: skip commit if HTML identical
    if (existing.content === html) {
      return res.status(200).json({ ok: true, commit: '', noop: true });
    }

    const result = await ghPutFile(
      path,
      html,
      `admin: edit ${slug} via /admin WYSIWYG`,
      existing.sha
    );

    res.status(200).json({ ok: true, commit: result.commitSha });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
