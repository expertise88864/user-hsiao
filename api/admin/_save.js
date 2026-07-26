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
import { requireAdmin, verifyOfflineSaveToken, ghGetFile } from './_auth.js';
import { commitArticleWithModifiedDate } from './_article-commit.js';
import { halfwidthToFullwidth } from './_halfwidth.js';

// JS-injected runtime helpers that the WYSIWYG inadvertently serializes
// into outerHTML. These IDs / selectors are re-injected by blog-shared.js
// on every page load, so saving them creates duplicate DOM + CLS issues
// + occasionally empty <img> tags (.hs-img-lightbox) that fail
// validate.py's width/height check. Strip server-side as a safety net,
// even when the client-side _sanitizeForSerialize did its job.
//
// ⚠ COUPLING (M-06): this list is the CANONICAL runtime-helper set. The
//   client mirror lives in blog/blog-admin.js (_sanitizeForSerialize), which
//   adds only the 3 admin-chrome ids. _check_runtime_helper_sync.py enforces
//   that the two stay identical — edit BOTH or the pre-push gate fails.
const RUNTIME_HELPER_IDS = [
  'hs-progress', 'hs-mobile-nav', 'hs-mobile-nav-style', 'hs-totop',
  'hs-cmdk-overlay', 'hs-cmdk-style', 'hs-cmdk-modal', 'hs-cmdk-pf-fallback',
  'hs-font-sizer', 'hs-font-size-style',
  'hs-slash-menu',
  'hs-resume-toast', 'hs-resume-style', 'hs-en-banner', 'hs-bookmark', 'hs-print-btn',
  'hs-theme-toggle', 'hs-theme-style', 'hs-breadcrumb-runtime', 'hs-reading-meta',
  'hsMobileMenuBtn', 'hsMobileDrawer',
  'hs-article-hero', 'hs-img-css',
  'hs-inline-toc', 'hs-toc-float', 'hs-inline-cta',
  'hs-prevnext', 'hs-pn-css', 'hs-vt-css',
  'hs-new-pulse-css', 'hs-calc-css', 'hs-dialog-css', 'hs-dict-css', 'hs-tf-css',
  'hs-reveal-css', 'hs-admin-runtime', 'hs-vercel-insights',
  // M-06: one-shot style injectors previously missed (no authored mount).
  'hs-related-css', 'hs-blog-filter-css', 'hs-spotlight-css',
];

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

function removeFirstElement(html, openingPattern) {
  const opening = openingPattern.exec(html);
  if (!opening) return null;

  const tag = opening[1].toLowerCase();
  const openingText = opening[0];
  const openingEnd = opening.index + openingText.length;
  if (VOID_TAGS.has(tag) || /\/\s*>$/.test(openingText)) {
    return html.slice(0, opening.index) + html.slice(openingEnd);
  }

  const tokenPattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi');
  tokenPattern.lastIndex = openingEnd;
  let depth = 1;
  let token;
  while ((token = tokenPattern.exec(html)) !== null) {
    if (/^<\s*\//.test(token[0])) {
      depth--;
    } else if (!/\/\s*>$/.test(token[0])) {
      depth++;
    }
    if (depth === 0) {
      return html.slice(0, opening.index) + html.slice(tokenPattern.lastIndex);
    }
  }
  return null;
}

function removeAllElements(html, openingPatternFactory) {
  let output = html;
  let count = 0;
  while (count < 200) {
    const next = removeFirstElement(output, openingPatternFactory());
    if (next == null) break;
    output = next;
    count++;
  }
  return { html: output, count };
}

export function stripRuntimeHelpers(html) {
  let s = html;
  let count = 0;
  for (const id of RUNTIME_HELPER_IDS) {
    const result = removeAllElements(s, () => new RegExp(
      `<([a-zA-Z][a-zA-Z0-9:-]*)\\b[^>]*\\bid\\s*=\\s*(["'])${id}\\2[^>]*>`,
      'i'
    ));
    s = result.html;
    count += result.count;
  }
  const lightboxes = removeAllElements(s, () =>
    /<([a-zA-Z][a-zA-Z0-9:-]*)\b[^>]*\bclass\s*=\s*(["'])[^"']*\bhs-img-lightbox\b[^"']*\2[^>]*>/i
  );
  s = lightboxes.html;
  count += lightboxes.count;
  return { html: s, count: count };
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

    const result = await commitArticleWithModifiedDate({
      slug,
      content: html,
      articleSha: existing.sha,
      message: `admin: edit ${slug} via /admin WYSIWYG${stripped ? ` (-${stripped} runtime DOM)` : ''}${hwFixed ? ` (+${hwFixed} 中文標點)` : ''}`,
    });

    res.status(200).json({ ok: true, commit: result.commitSha, sanitized: { stripped, hwFixed } });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
