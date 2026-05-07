/**
 * POST /api/admin/suggest-tags — auto-suggest article tags using TF + dict
 * weighting.
 *
 * Body: { slug }
 *
 * Returns: { suggestions: [{ tag, score, en }, ...] }
 *
 * Server-side counterpart of DN.suggestTags. Useful when the admin wants
 * to bulk-tag many articles without opening each in the editor.
 *
 * Why server-side too: the article HTML is always available via GitHub API,
 * the medical dictionary is right there, and the same scoring logic doesn't
 * need to round-trip through the browser.
 */
import { requireAdmin, ghGetFile } from './_auth.js';

const DICT_PATH = 'assets/medical-dictionary.json';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { slug, k = 5 } = body || {};
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'Invalid slug' });

  try {
    const file = await ghGetFile(`blog/${slug}.html`);
    if (!file) return res.status(404).json({ error: 'not found' });
    const dictFile = await ghGetFile(DICT_PATH);
    if (!dictFile) return res.status(500).json({ error: 'medical dictionary missing' });
    let dict;
    try { dict = JSON.parse(dictFile.content); } catch (e) { return res.status(500).json({ error: 'dict parse failed' }); }

    const html = file.content;
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .toLowerCase();

    const escape = s => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

    const scored = Object.keys(dict).map(term => {
      const occ = (text.match(new RegExp(escape(term), 'g')) || []).length;
      const en = (dict[term].en || '').toLowerCase();
      const enOcc = en ? (text.match(new RegExp('\\b' + escape(en) + '\\b', 'g')) || []).length : 0;
      let headBoost = 0;
      const h2re = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
      let m;
      while ((m = h2re.exec(html)) !== null) {
        if (m[1].includes(term)) headBoost += 2;
      }
      const raw = occ + enOcc * 0.7 + headBoost;
      return { tag: term, en: dict[term].en || '', score: raw };
    }).filter(s => s.score > 0);

    const max = scored.reduce((a, s) => Math.max(a, s.score), 1);
    scored.forEach(s => s.score = +(s.score / max).toFixed(3));
    scored.sort((a, b) => b.score - a.score);
    res.status(200).json({ slug, suggestions: scored.slice(0, k) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
