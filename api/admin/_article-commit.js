import { ghCommitFiles, ghGetFile } from './_github.js';
import { catalogRecords, patchCatalogFields } from '../_articles.js';

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
}) {
  const path = `blog/${slug}.html`;
  const shared = await ghGetFile('blog/blog-shared.js');
  if (!shared) throw new Error('blog-shared.js not found in repo');

  const catalog = updateCatalogModified(shared.content, slug);
  if (!catalog) throw new Error('DN.ARTICLES block not found');

  const files = [{ path, content, expectedSha: articleSha }];
  if (catalog.published && catalog.content !== shared.content) {
    files.push({
      path: 'blog/blog-shared.js',
      content: catalog.content,
      expectedSha: shared.sha,
    });
  }
  return ghCommitFiles(files, message);
}
