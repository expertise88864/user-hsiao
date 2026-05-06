/**
 * POST /api/admin/upload — upload an image (or any binary asset) to the repo.
 *
 * Body: { filename: string, contentType: string, data: base64 string, folder?: 'assets' }
 *
 * What it does:
 *   1. Validates filename (slug-style, file extension whitelist)
 *   2. Decodes base64 → Buffer, enforces 8 MB hard cap
 *   3. PUTs to assets/<folder>/<filename> via GitHub Contents API (which
 *      auto-creates a blob for binary files)
 *   4. Returns { ok, path, url, commit }
 *
 * Used by:
 *   - admin.html  → image-edit modal (drop image, crop, optimize, upload)
 *   - blog-shared.js → admin WYSIWYG "📷 圖片" toolbar button (paste-to-upload)
 */
import { requireAdmin, getRepoConfig } from './_auth.js';

const MAX_BYTES = 8 * 1024 * 1024;  // 8 MB
const ALLOWED_EXT = /\.(webp|avif|jpg|jpeg|png|svg|gif)$/i;
const ALLOWED_FOLDERS = new Set(['assets', 'assets/og', 'assets/article-img']);

function bad(res, status, msg) { return res.status(status).json({ error: msg }); }

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return bad(res, 405, 'Method not allowed');

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  let { filename, contentType, data, folder } = body || {};
  folder = folder || 'assets/article-img';

  if (!ALLOWED_FOLDERS.has(folder))           return bad(res, 400, 'folder must be assets, assets/og, or assets/article-img');
  if (!filename || typeof filename !== 'string') return bad(res, 400, 'filename required');
  if (!/^[a-z0-9._-]+$/i.test(filename))      return bad(res, 400, 'filename must be alphanumeric (a-z 0-9 . _ -)');
  if (!ALLOWED_EXT.test(filename))            return bad(res, 400, 'extension must be webp|avif|jpg|jpeg|png|svg|gif');
  if (!data || typeof data !== 'string')      return bad(res, 400, 'data (base64) required');

  // Estimate decoded size from base64 length: 4 chars → 3 bytes
  const approxBytes = Math.floor(data.length * 0.75);
  if (approxBytes > MAX_BYTES) return bad(res, 413, `file too large (>${MAX_BYTES / 1024 / 1024} MB)`);

  // Reject SVG with embedded scripts (XSS surface)
  if (/\.svg$/i.test(filename)) {
    let text = '';
    try { text = Buffer.from(data, 'base64').toString('utf-8'); } catch (e) {}
    if (/<script/i.test(text) || /\son\w+\s*=/i.test(text) || /javascript:/i.test(text)) {
      return bad(res, 400, 'SVG contains <script> / event handlers — not allowed');
    }
  }

  const path = `${folder}/${filename}`;
  const { owner, repo, branch, token } = getRepoConfig();
  if (!token) return bad(res, 500, 'GITHUB_TOKEN env var not configured');

  try {
    // Check if file exists (need sha for update)
    const checkUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`;
    const head = await fetch(checkUrl, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    let existingSha;
    if (head.ok) {
      const j = await head.json();
      existingSha = j.sha;
    }

    const putUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
    const reqBody = {
      message: existingSha ? `admin: replace ${path} via /admin upload` : `admin: upload ${path} via /admin`,
      content: data,
      branch,
    };
    if (existingSha) reqBody.sha = existingSha;

    const r = await fetch(putUrl, {
      method: 'PUT',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(reqBody),
    });
    if (!r.ok) {
      const txt = await r.text();
      return bad(res, 500, `GitHub PUT failed: ${r.status} — ${txt.slice(0, 200)}`);
    }
    const result = await r.json();
    res.status(200).json({
      ok: true,
      path,
      url: `/${path}`,
      commit: result.commit?.sha || '',
      replaced: Boolean(existingSha),
    });
  } catch (e) {
    bad(res, 500, String(e.message || e));
  }
}
