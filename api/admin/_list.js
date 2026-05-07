/**
 * GET /api/admin/list — return article catalog (slug, title, tag, date, number).
 *
 * Source of truth: parse DN.ARTICLES from blog/blog-shared.js. We don't need
 * a separate database — the array in blog-shared.js is canonical.
 */
import { requireAdmin, ghGetFile } from './_auth.js';

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
    const blockSrc = m[1];
    const lineRe = /\{\s*slug\s*:\s*'([^']+)'[^}]+title\s*:\s*'([^']+)'[^}]*?(?:tag\s*:\s*'([^']*)')?[^}]*?(?:date\s*:\s*'([^']*)')?[^}]*\}/g;
    let row;
    while ((row = lineRe.exec(blockSrc)) !== null) {
      articles.push({
        slug:  row[1],
        title: row[2],
        tag:   row[3] || '',
        date:  row[4] || '',
      });
    }

    // Sort newest first by date desc, then assign stable numbers by date asc
    const ordered = [...articles].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const byOldest = [...articles].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const numberMap = {};
    byOldest.forEach((a, i) => { numberMap[a.slug] = i + 1; });
    ordered.forEach(a => { a.number = numberMap[a.slug]; });

    res.status(200).json({ articles: ordered });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
