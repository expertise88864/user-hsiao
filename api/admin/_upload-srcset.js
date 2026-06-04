/**
 * POST /api/admin/upload-srcset — accepts a bundle of pre-generated image
 * variants (different widths × formats) and commits all of them to the repo.
 *
 * The CLIENT (admin.html / blog-shared.js editor) generates the variants
 * via Canvas + .toBlob('image/webp' / 'image/avif') because Edge runtime
 * lacks sharp / native image decoders. Multiple files in one POST = one
 * commit per file (GitHub Contents API limitation, no batch).
 *
 * Body: {
 *   stem: 'my-photo',     // base filename without extension
 *   folder: 'assets/article-img',
 *   variants: [
 *     { suffix: '-220',  format: 'webp', data: '<base64>' },
 *     { suffix: '-220',  format: 'avif', data: '<base64>' },
 *     { suffix: '-440',  format: 'webp', data: '<base64>' },
 *     { suffix: '-440',  format: 'avif', data: '<base64>' },
 *     { suffix: '-660',  format: 'webp', data: '<base64>' },
 *     { suffix: '-660',  format: 'avif', data: '<base64>' },
 *     { suffix: '-1320', format: 'webp', data: '<base64>' },
 *     { suffix: '',      format: 'webp', data: '<base64>' },  // primary
 *   ],
 * }
 *
 * Returns:
 *   { ok, uploaded: [{ path, url, commit }, ...],
 *     pictureSnippet: '<picture>...</picture>',  // ready to paste into article
 *     imgSnippet:     '<img srcset="..." sizes="..." />' }
 */
import { requireAdmin, getRepoConfig } from './_auth.js';

const MAX_VARIANTS = 12;
const MAX_BYTES_PER = 4 * 1024 * 1024;   // 4 MB per variant
const ALLOWED_FORMATS = new Set(['webp', 'avif', 'jpeg', 'png']);
const ALLOWED_FOLDERS = new Set(['assets', 'assets/og', 'assets/article-img']);

function bad(res, status, msg) { return res.status(status).json({ error: msg }); }

async function ghPutBinary(path, base64, message, sha) {
  const { owner, repo, branch, token } = getRepoConfig();
  if (!token) throw new Error('GITHUB_TOKEN env var not configured');
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const body = { message, content: base64, branch };
  if (sha) body.sha = sha;
  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`GitHub PUT ${path} failed: ${r.status}`);
  const d = await r.json();
  return { commitSha: d.commit?.sha || '' };
}

async function ghGetSha(path) {
  const { owner, repo, branch, token } = getRepoConfig();
  if (!token) return undefined;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`;
  const r = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (r.ok) {
    const j = await r.json();
    return j.sha;
  }
  return undefined;
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return bad(res, 405, 'Method not allowed');

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  let { stem, folder, variants } = body || {};
  folder = folder || 'assets/article-img';

  if (!ALLOWED_FOLDERS.has(folder)) return bad(res, 400, 'folder must be assets, assets/og, or assets/article-img');
  if (!stem || !/^[a-z0-9._-]+$/i.test(stem)) return bad(res, 400, 'invalid stem');
  if (!Array.isArray(variants) || !variants.length) return bad(res, 400, 'variants required');
  if (variants.length > MAX_VARIANTS) return bad(res, 400, `too many variants (>${MAX_VARIANTS})`);

  // Validate each
  for (const v of variants) {
    if (!ALLOWED_FORMATS.has(v.format)) return bad(res, 400, `bad format ${v.format}`);
    if (typeof v.data !== 'string') return bad(res, 400, 'each variant.data must be base64 string');
    if (Math.floor(v.data.length * 0.75) > MAX_BYTES_PER) return bad(res, 413, `variant ${v.suffix||''}.${v.format} too large`);
  }

  const uploaded = [];
  const widthMap = {};   // width → { webp?, avif? } for assembling srcset

  try {
    for (const v of variants) {
      const filename = `${stem}${v.suffix || ''}.${v.format}`;
      const path = `${folder}/${filename}`;
      const sha = await ghGetSha(path);
      const result = await ghPutBinary(path, v.data, sha ? `admin: replace ${path}` : `admin: upload ${path}`, sha);
      uploaded.push({ path, url: '/' + path, commit: result.commitSha });
      // Parse width from suffix
      const wMatch = (v.suffix || '').match(/-(\d+)$/);
      const w = wMatch ? parseInt(wMatch[1], 10) : 'primary';
      if (!widthMap[w]) widthMap[w] = {};
      widthMap[w][v.format] = '/' + path;
    }

    // Build <picture> + <img> snippets for the editor to paste
    const widths = Object.keys(widthMap).filter(k => k !== 'primary').map(Number).sort((a, b) => a - b);
    const primary = widthMap['primary'] || (widthMap[widths[widths.length - 1]] || {});
    const primarySrc = primary.webp || primary.avif || (uploaded[0] && uploaded[0].url);

    let pictureSnippet = '';
    if (widths.length) {
      const avifSrcset = widths.filter(w => widthMap[w].avif).map(w => `${widthMap[w].avif} ${w}w`).join(', ');
      const webpSrcset = widths.filter(w => widthMap[w].webp).map(w => `${widthMap[w].webp} ${w}w`).join(', ');
      const sizes = '(max-width: 720px) calc(100vw - 40px), 720px';
      pictureSnippet = '<picture>\n' +
        (avifSrcset ? `  <source type="image/avif" srcset="${avifSrcset}" sizes="${sizes}" />\n` : '') +
        (webpSrcset ? `  <source type="image/webp" srcset="${webpSrcset}" sizes="${sizes}" />\n` : '') +
        `  <img src="${primarySrc}" alt="" loading="lazy" decoding="async" style="max-width:100%;border-radius:8px" />\n` +
        '</picture>';
    }
    const imgSnippet = `<img src="${primarySrc}" alt="" loading="lazy" decoding="async" style="max-width:100%;border-radius:8px" />`;

    res.status(200).json({ ok: true, uploaded, pictureSnippet, imgSnippet, primary: primarySrc });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e), uploaded });
  }
}
