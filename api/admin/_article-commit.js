import { ghCommitFiles, ghGetFile, ghGetBlob, GitHubConflictError } from './_github.js';
import { catalogRecords, patchCatalogFields } from '../_articles.js';
import { createHash } from 'node:crypto';

function taipeiToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function updateCatalogModified(source, slug, updated = taipeiToday()) {
  try {
    const row = catalogRecords(source).find(r => r.values.slug === slug);
    if (!row) return { content: source, published: false };
    return { content: patchCatalogFields(source, { [slug]: { updated } }), published: true };
  } catch (e) { return null; }
}

export async function commitArticleWithModifiedDate({
  slug,
  content,
  articleSha,
  message,
  titleUpdates = {},
  catalogBaseSha,
}) {
  const path = `blog/${slug}.html`;
  const shared = await ghGetFile('blog/blog-shared.js');
  if (!shared) throw new Error('blog-shared.js not found in repo');
  if (Object.keys(titleUpdates).length && shared.sha !== catalogBaseSha) {
    if (!/^[a-f0-9]{40}$/.test(catalogBaseSha || '')) throw new GitHubConflictError('blog/blog-shared.js');
    const historical = await ghGetBlob(catalogBaseSha);
    let titlesUnchanged = false;
    if (historical) {
      try {
        const before = catalogRecords(historical.content).find(row => row.values.slug === slug);
        const current = catalogRecords(shared.content).find(row => row.values.slug === slug);
        // A different article or generated bundle may change the catalog SHA.
        // Rebase only when this article's two titles still match its real base;
        // use the fresh entire catalog and retain both atomic blob checks below.
        titlesUnchanged = !before && !current || !!before && !!current &&
          ['title', 'title_en'].every(key => Object.hasOwn(before.values, key) && Object.hasOwn(current.values, key) &&
            typeof before.values[key] === 'string' && typeof current.values[key] === 'string' &&
            before.values[key].trim() && current.values[key].trim() && before.values[key] === current.values[key]);
      } catch { /* Unknown/malformed historical catalog must not authorize a write. */ }
    }
    if (!titlesUnchanged) throw new GitHubConflictError('blog/blog-shared.js');
  }

  const catalog = updateCatalogModified(shared.content, slug);
  if (!catalog) throw new Error('DN.ARTICLES block not found');
  if (catalog.published && Object.keys(titleUpdates).length) catalog.content = patchCatalogFields(catalog.content, { [slug]: titleUpdates });

  const files = [{ path, content, expectedSha: articleSha }];
  if (catalog.published && catalog.content !== shared.content) {
    files.push({
      path: 'blog/blog-shared.js',
      content: catalog.content,
      expectedSha: shared.sha,
    });
  }
  const result = await ghCommitFiles(files, message);
  const bytes = Buffer.from(catalog.content, 'utf8');
  return { ...result, catalogSha: createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex') };
}
