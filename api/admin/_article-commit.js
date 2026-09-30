import { ghCommitFiles, ghGetFile, GitHubConflictError } from './_github.js';
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
  if (Object.keys(titleUpdates).length && shared.sha !== catalogBaseSha) throw new GitHubConflictError('blog/blog-shared.js');

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
