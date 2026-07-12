/**
 * POST /api/admin/reorder — re-order DN.ARTICLES in blog-shared.js.
 *
 * Body: { order: string[] }   // array of slugs in the desired order (top→bottom)
 *
 * What it does:
 *   1. Parse current DN.ARTICLES = [...] block
 *   2. Reorder the entries to match the requested slug order
 *   3. Append any missing slugs at the end (to be defensive — never lose articles)
 *   4. PUT the patched blog-shared.js
 *
 * Returns { ok, count, commit }.
 */
import { requireAdmin, ghGetFile, ghPutFile } from './_auth.js';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { order } = body || {};

  if (!Array.isArray(order) || order.length === 0) {
    return res.status(400).json({ error: 'order (string[]) required' });
  }
  if (!order.every(s => typeof s === 'string' && /^[a-z0-9-]+$/.test(s))) {
    return res.status(400).json({ error: 'all slugs must match /^[a-z0-9-]+$/' });
  }

  try {
    const file = await ghGetFile('blog/blog-shared.js');
    if (!file) return res.status(500).json({ error: 'blog-shared.js not found in repo' });

    const m = file.content.match(/(DN\.ARTICLES\s*=\s*\[)([\s\S]*?)(\];)/);
    if (!m) return res.status(500).json({ error: 'DN.ARTICLES block not found' });

    const head = m[1];
    const block = m[2];
    const tail = m[3];

    // Parse each entry as { slug, raw } where raw = the full {…} record
    const entryRe = /\{[^{}]*?slug\s*:\s*'([^']+)'[^{}]*?\}/g;
    const entries = [];
    let row;
    while ((row = entryRe.exec(block)) !== null) {
      entries.push({ slug: row[1], raw: row[0] });
    }
    if (entries.length === 0) return res.status(500).json({ error: 'No DN.ARTICLES entries parsed' });

    // Fail-safe against silent data loss: the whole DN.ARTICLES block is
    // REPLACED with a list rebuilt from `entries`. If our per-entry regex
    // (which can't cross nested braces) parsed fewer records than there are
    // `slug:` keys — e.g. some future entry has a `{`/`}` inside a value or an
    // unusual shape — the unparsed article would vanish from the catalog
    // (listings + sitemap). Refuse rather than drop it. The "append missing"
    // step below only re-adds PARSED entries, so it does NOT cover this case.
    const slugKeys = (block.match(/\bslug\s*:/g) || []).length;
    if (entries.length !== slugKeys) {
      return res.status(409).json({
        error: `parse mismatch: ${entries.length} entries parsed vs ${slugKeys} slug keys — refusing to reorder to avoid dropping an article. Fix DN.ARTICLES formatting or reorder manually.`,
      });
    }

    const map = {};
    entries.forEach(e => { map[e.slug] = e.raw; });

    // Build new ordered list: requested order first, then any missing slugs
    const seen = new Set();
    const newRaws = [];
    order.forEach(s => {
      if (map[s] && !seen.has(s)) { seen.add(s); newRaws.push(map[s]); }
    });
    entries.forEach(e => { if (!seen.has(e.slug)) newRaws.push(e.raw); });

    // Re-serialise with consistent indent (4 spaces, comma-separated, newline)
    const newBlock = '\n    ' + newRaws.join(',\n    ') + ',\n  ';
    const patched = file.content.replace(m[0], head + newBlock + tail);

    if (patched === file.content) {
      return res.status(200).json({ ok: true, count: newRaws.length, noop: true });
    }

    const result = await ghPutFile(
      'blog/blog-shared.js',
      patched,
      `admin: reorder DN.ARTICLES (${newRaws.length} entries) via /admin`,
      file.sha
    );
    res.status(200).json({ ok: true, count: newRaws.length, commit: result.commitSha });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
