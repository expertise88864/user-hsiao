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
    for (const u of updates) {
      if (u.err) continue;
      const entryRe = new RegExp(
        `(\\{\\s*slug\\s*:\\s*'${u.slug.replace(/-/g, '\\-')}'[^}]*?)(\\s*\\})`
      );
      patched = patched.replace(entryRe, (_, head, tail) => {
        // Strip any existing words/minutes
        const cleaned = head.replace(/,\s*words\s*:\s*\d+/g, '').replace(/,\s*minutes\s*:\s*\d+/g, '');
        return cleaned + `, words:${u.words}, minutes:${u.minutes}` + tail;
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
