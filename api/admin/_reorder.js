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
import { catalogRecords } from '../_articles.js';

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

    // Record counts alone cannot detect a truncated quoted value. Parse the
    // supported literal grammar and retain each complete source record.
    const records = catalogRecords(file.content);
    if (!records.length) return res.status(500).json({ error: 'No DN.ARTICLES entries parsed' });
    const entries = records.map(row => ({ slug: row.values.slug, raw: file.content.slice(row.start, row.end) }));

    const map = Object.create(null);
    entries.forEach(e => { map[e.slug] = e.raw; });

    // Build new ordered list: requested order first, then any missing slugs
    const seen = new Set();
    const newRaws = [];
    order.forEach(s => {
      if (map[s] && !seen.has(s)) { seen.add(s); newRaws.push(map[s]); }
    });
    entries.forEach(e => { if (!seen.has(e.slug)) newRaws.push(e.raw); });

    // Replace only record spans; preserve the array boundaries and all other
    // source bytes, even if a title contains braces or a literal `];`.
    let patched = file.content;
    for (let i = records.length - 1; i >= 0; i--) {
      patched = patched.slice(0, records[i].start) + newRaws[i] + patched.slice(records[i].end);
    }
    const verified = catalogRecords(patched);
    if (verified.length !== records.length || records.some(row =>
      JSON.stringify(verified.find(v => v.values.slug === row.values.slug)?.values) !== JSON.stringify(row.values))) {
      throw new Error('Catalog verification failed; refusing to reorder');
    }

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
