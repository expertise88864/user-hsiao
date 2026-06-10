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
import { requireAdmin, verifyOfflineSaveToken, ghGetFile, ghCommitFiles } from './_auth.js';
import { halfwidthToFullwidth } from './_halfwidth.js';

// JS-injected runtime helpers that the WYSIWYG inadvertently serializes
// into outerHTML. These IDs / selectors are re-injected by blog-shared.js
// on every page load, so saving them creates duplicate DOM + CLS issues
// + occasionally empty <img> tags (.hs-img-lightbox) that fail
// validate.py's width/height check. Strip server-side as a safety net,
// even when the client-side _sanitizeForSerialize did its job.
const RUNTIME_HELPER_IDS = [
  'hs-progress', 'hs-mobile-nav', 'hs-totop',
  'hs-cmdk-overlay', 'hs-cmdk-style', 'hs-cmdk-modal',
  'hs-font-sizer',
  'hs-slash-menu',
  'hs-resume-toast', 'hs-en-banner', 'hs-bookmark', 'hs-print-btn',
  'hs-related-css', 'hs-feedback', 'hs-theme-toggle', 'hs-reading-meta',
  'hsMobileMenuBtn', 'hsMobileDrawer',
];

function stripRuntimeHelpers(html) {
  let s = html;
  let count = 0;
  for (const id of RUNTIME_HELPER_IDS) {
    // Match any top-level element with id="...". Use non-greedy match
    // that stops at the matching close tag. Works for self-contained
    // single-tag blocks (most runtime helpers).
    // 1) <tag id="..." ...>...</tag>
    const re1 = new RegExp(
      `<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*\\bid=["']${id}["'][^>]*>[\\s\\S]*?<\\/\\1>`,
      'gi'
    );
    s = s.replace(re1, () => { count++; return ''; });
    // 2) Self-closing: <input id="..." />
    const re2 = new RegExp(
      `<[a-zA-Z][a-zA-Z0-9]*\\b[^>]*\\bid=["']${id}["'][^>]*\\/?>`,
      'gi'
    );
    s = s.replace(re2, () => { count++; return ''; });
  }
  // Strip .hs-img-lightbox container (no fixed ID, class-based)
  s = s.replace(/<div\b[^>]*\bclass=["'][^"']*\bhs-img-lightbox\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
    () => { count++; return ''; });
  return { html: s, count: count };
}

function taipeiToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function updateCatalogModified(source, slug, updated) {
  const block = source.match(/DN\.ARTICLES\s*=\s*\[([\s\S]*?)\];/);
  if (!block) return null;
  const safeSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const row = block[1].match(new RegExp(`\\{[^{}]*?slug\\s*:\\s*'${safeSlug}'[^{}]*?\\}`));
  if (!row) return { content: source, published: false };

  let patchedRow;
  if (/\bupdated\s*:\s*'\d{4}-\d{2}-\d{2}'/.test(row[0])) {
    patchedRow = row[0].replace(
      /\bupdated\s*:\s*'\d{4}-\d{2}-\d{2}'/,
      `updated:'${updated}'`
    );
  } else {
    patchedRow = row[0].replace(
      /(\bdate\s*:\s*'\d{4}-\d{2}-\d{2}')/,
      `$1, updated:'${updated}'`
    );
  }
  return {
    content: source.replace(row[0], patchedRow),
    published: true,
  };
}

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
  const { slug, html: rawHtml } = body || {};

  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: 'Invalid slug (must be lowercase a-z, 0-9, dash)' });
  }
  if (req.headers['x-hsiao-offline-replay'] === '1') {
    const replayToken = req.headers['x-hsiao-offline-token'];
    if (!verifyOfflineSaveToken(replayToken, slug)) {
      return res.status(403).json({ error: 'Invalid or expired offline save token' });
    }
  }
  if (typeof rawHtml !== 'string' || rawHtml.length < 200) {
    return res.status(400).json({ error: 'Invalid html (too short or missing)' });
  }
  if (rawHtml.length > 1024 * 1024) {  // 1 MB hard cap
    return res.status(413).json({ error: 'HTML too large (>1 MB)' });
  }

  // Basic sanity: must contain expected article structure
  if (!rawHtml.includes('<article') || !rawHtml.includes('</html>')) {
    return res.status(400).json({ error: 'HTML missing required structure (<article>, </html>)' });
  }

  // ─── Server-side sanitize before commit ───
  // 1. Strip JS-injected runtime helpers (defense in depth — client also strips)
  const stripResult = stripRuntimeHelpers(rawHtml);
  // 2. Convert half-width punctuation adjacent to Chinese → full-width
  //    (matches halfwidth_to_fullwidth.py used by CI; otherwise CI would
  //    fail the very next push.)
  const hwResult = halfwidthToFullwidth(stripResult.html);
  const html = hwResult.html;
  const stripped = stripResult.count;
  const hwFixed = hwResult.count;

  const path = `blog/${slug}.html`;

  try {
    // Get current sha so we can update (not create-overwrite)
    const existing = await ghGetFile(path);
    if (!existing) {
      return res.status(404).json({ error: `Article ${slug}.html not found in repo. Use /api/admin/new to create.` });
    }

    // Detect no-op: skip commit if HTML identical
    if (existing.content === html) {
      return res.status(200).json({ ok: true, commit: '', noop: true, sanitized: { stripped, hwFixed } });
    }

    const shared = await ghGetFile('blog/blog-shared.js');
    if (!shared) return res.status(500).json({ error: 'blog-shared.js not found in repo' });
    const catalog = updateCatalogModified(shared.content, slug, taipeiToday());
    if (!catalog) return res.status(500).json({ error: 'DN.ARTICLES block not found' });

    const files = [{ path, content: html, expectedSha: existing.sha }];
    if (catalog.published && catalog.content !== shared.content) {
      files.push({
        path: 'blog/blog-shared.js',
        content: catalog.content,
        expectedSha: shared.sha,
      });
    }
    const result = await ghCommitFiles(
      files,
      `admin: edit ${slug} via /admin WYSIWYG${stripped ? ` (-${stripped} runtime DOM)` : ''}${hwFixed ? ` (+${hwFixed} 中文標點)` : ''}`
    );

    res.status(200).json({ ok: true, commit: result.commitSha, sanitized: { stripped, hwFixed } });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
