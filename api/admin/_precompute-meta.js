/**
 * POST /api/admin/precompute-meta — walks every article HTML, counts words
 * + estimates read time, and PATCHes those numbers back into DN.ARTICLES
 * in blog-shared.js.
 *
 * After this runs, DN.ARTICLES entries gain `words` (int) + `minutes` (int)
 * fields. Client-side reading-meta widget reads them directly instead of
 * counting at runtime — saves ~40-60ms per article load.
 *
 * Body: {} (no params, processes all articles)
 *
 * The CJK word-counting heuristic:
 *   - Each Han ideograph (一-鿿, 㐀-䶿) = 1 "word"
 *   - Each whitespace-separated Latin run = 1 word
 *   - Read time = words / 280 (zh average reading speed) + 5 sec per image/figure
 *   - Round up to nearest minute, min 2 minutes
 *
 * Returns { ok, updates: [{slug, words, minutes}], commit }
 */
import { requireAdmin, ghGetFile, ghPutFile } from './_auth.js';

function countWords(html) {
  // Strip <script>, <style>, <head> blocks first
  const body = html
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' [svg] ');
  // Extract just the visible text
  const text = body
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-zA-Z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Count CJK characters (1 char = 1 word)
  const cjk = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
  // Count Latin words (whitespace-separated runs)
  const latinText = text.replace(/[一-鿿㐀-䶿]/g, ' ');
  const latin = latinText.split(/\s+/).filter(s => /[a-zA-Z0-9]/.test(s)).length;
  // Count figures (each adds ~5 sec / one ad-hoc unit of ~25 words)
  const figures = (html.match(/<figure[\s>]/gi) || []).length;
  const tables  = (html.match(/<table[\s>]/gi) || []).length;
  return { words: cjk + latin, figures, tables };
}

function readMinutes({ words, figures, tables }) {
  // 280 zh chars/min reading speed (medical content slower than fiction)
  // figures: +30 sec each (look + parse caption); tables: +45 sec each
  const sec = words / 280 * 60 + figures * 30 + tables * 45;
  return Math.max(2, Math.ceil(sec / 60));
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sharedJs = await ghGetFile('blog/blog-shared.js');
    if (!sharedJs) return res.status(500).json({ error: 'blog-shared.js not found' });

    // Parse DN.ARTICLES list
    const m = sharedJs.content.match(/DN\.ARTICLES\s*=\s*(\[[\s\S]*?\]);/);
    if (!m) return res.status(500).json({ error: 'DN.ARTICLES not found' });
    const re = /\{\s*slug\s*:\s*'([^']+)'/g;
    const slugs = [];
    let row;
    while ((row = re.exec(m[1])) !== null) slugs.push(row[1]);

    // Compute word counts in parallel
    const updates = await Promise.all(slugs.map(async (slug) => {
      try {
        const f = await ghGetFile(`blog/${slug}.html`);
        if (!f) return { slug, words: 0, minutes: 2, err: 'missing' };
        const counts = countWords(f.content);
        return { slug, words: counts.words, minutes: readMinutes(counts), figures: counts.figures };
      } catch (e) { return { slug, words: 0, minutes: 2, err: String(e.message || e) }; }
    }));

    // Patch DN.ARTICLES inline — for each entry, if it has `words:` field
    // update; else inject before the closing `}`. Only modifies slugs we
    // successfully counted (skip missing files).
    let patched = sharedJs.content;

    // M-09: this rewrite is a regex over JavaScript source — the same fragile
    // shape as M-11 in _reorder.js. `[^}]*?` stops at the FIRST `}`, so a field
    // value containing one truncates the match; and only `-` was escaped in the
    // slug, so any other regex metacharacter would mis-anchor and inject the
    // fields into a different entry. Both failures are SILENT: the response
    // still says ok:true while DN.ARTICLES has been corrupted.
    //
    // So escape the slug properly, and VERIFY each rewrite landed rather than
    // trusting it. The entry-count invariant alone is not sufficient, because a
    // mis-anchored injection leaves the count unchanged.
    const escapeRe = (v) => v.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
    const slugKeysBefore = (patched.match(/\bslug\s*:/g) || []).length;

    for (const u of updates) {
      if (u.err) continue;
      const entryRe = new RegExp(
        `(\\{\\s*slug\\s*:\\s*'${escapeRe(u.slug)}'[^}]*?)(\\s*\\})`
      );
      const before = patched;
      patched = patched.replace(entryRe, (_, head, tail) => {
        // Strip any existing words/minutes
        const cleaned = head.replace(/,\s*words\s*:\s*\d+/g, '').replace(/,\s*minutes\s*:\s*\d+/g, '');
        return cleaned + `, words:${u.words}, minutes:${u.minutes}` + tail;
      });
      if (patched === before) {
        return res.status(409).json({
          error: `no DN.ARTICLES entry matched slug '${u.slug}' — refusing to write. `
               + `The entry may contain a '}' that truncates the match, or its formatting changed.`,
        });
      }
      // The rewrite must have landed inside THIS slug's entry, not a neighbour's.
      const landed = new RegExp(
        `\\{\\s*slug\\s*:\\s*'${escapeRe(u.slug)}'[^}]*?words:${u.words}, minutes:${u.minutes}`
      ).test(patched);
      if (!landed) {
        return res.status(409).json({
          error: `words/minutes for '${u.slug}' did not land inside that slug's entry — `
               + `refusing to write a possibly mis-anchored edit.`,
        });
      }
    }

    const slugKeysAfter = (patched.match(/\bslug\s*:/g) || []).length;
    if (slugKeysAfter !== slugKeysBefore) {
      return res.status(409).json({
        error: `entry count changed while patching (${slugKeysBefore} -> ${slugKeysAfter}) — `
             + `refusing to write to avoid dropping an article.`,
      });
    }

    if (patched === sharedJs.content) {
      return res.status(200).json({ ok: true, updates, noop: true });
    }
    const result = await ghPutFile(
      'blog/blog-shared.js', patched,
      `admin: precompute words+minutes for ${updates.filter(u => !u.err).length} articles`,
      sharedJs.sha
    );
    res.status(200).json({ ok: true, updates, commit: result.commitSha });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
