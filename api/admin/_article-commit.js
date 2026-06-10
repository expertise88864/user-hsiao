import { ghCommitFiles, ghGetFile } from './_github.js';

function taipeiToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function updateCatalogModified(source, slug, updated = taipeiToday()) {
  const block = source.match(/DN\.ARTICLES\s*=\s*\[([\s\S]*?)\];/);
  if (!block) return null;
  const safeSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const row = block[1].match(new RegExp(`\\{[^{}]*?slug\\s*:\\s*'${safeSlug}'[^{}]*?\\}`));
  if (!row) return { content: source, published: false };

  let patchedRow;
  if (/\bupdated\s*:\s*'\d{4}-\d{2}-\d{2}'/.test(row[0])) {
    patchedRow = row[0].replace(
      /\bupdated\s*:\s*'\d{4}-\d{2}-\d{2}'/,
      `updated:'${updated}'`
    );
  } else if (/\bdate\s*:\s*'\d{4}-\d{2}-\d{2}'/.test(row[0])) {
    patchedRow = row[0].replace(
      /(\bdate\s*:\s*'\d{4}-\d{2}-\d{2}')/,
      `$1, updated:'${updated}'`
    );
  } else {
    return null;
  }
  return {
    content: source.replace(row[0], patchedRow),
    published: true,
  };
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
