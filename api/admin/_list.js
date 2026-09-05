/**
 * GET /api/admin/list — return article catalog (slug, title, tag, date, number).
 *
 * Source of truth: parse DN.ARTICLES from blog/blog-shared.js. We don't need
 * a separate database — the array in blog-shared.js is canonical.
 */
import { requireAdmin, ghGetFile } from './_auth.js';
import { catalogRecords } from '../_articles.js';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const file = await ghGetFile('blog/blog-shared.js');
    if (!file) return res.status(500).json({ error: 'blog-shared.js not found in repo' });

    // Parse DN.ARTICLES = [...] block
    const m = file.content.match(/DN\.ARTICLES\s*=\s*(\[[\s\S]*?\]);/);
    if (!m) return res.status(500).json({ error: 'DN.ARTICLES not found in blog-shared.js' });

    const articles = [];
    const getField = (body, key) => body[key] || '';
    for (const { values: body } of catalogRecords(file.content)) {
      const slug = getField(body, 'slug');
      if (!slug) continue;
      articles.push({
        slug,
        title: getField(body, 'title'),
        title_en: getField(body, 'title_en'),
        cat: getField(body, 'cat'),
        tag: getField(body, 'tag'),
        tag_en: getField(body, 'tag_en'),
        date: getField(body, 'date'),
      });
    }

    // Sort newest first by date desc, then assign stable numbers by date asc
    const ordered = [...articles].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const byOldest = [...articles].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const numberMap = {};
    byOldest.forEach((a, i) => { numberMap[a.slug] = i + 1; });
    ordered.forEach(a => { a.number = numberMap[a.slug]; });

    const draftFile = await ghGetFile('_cms/admin-drafts.json');
    let drafts = [];
    if (draftFile) {
      try {
        const state = JSON.parse(draftFile.content);
        drafts = Object.values(state.drafts || {}).map(draft => ({
          ...draft,
          draft: true,
          number: null,
        }));
      } catch (e) { drafts = []; }
    }

    res.status(200).json({
      articles: [...drafts.sort((a, b) => (b.date || '').localeCompare(a.date || '')), ...ordered],
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
