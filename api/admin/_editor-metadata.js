// This marker transports plain author fields through drafts/offline HTML replay.
// It grants no HTML permission; the existing authenticated save boundary stays intact.
import { normalizeMetadataText } from '../../blog/editor-punctuation.js';
export function readEditorMetadata(html, { allowUnnormalized = false } = {}) {
  const head = html.slice(0, html.search(/<\/head\s*>/i));
  const named = [...head.matchAll(/<meta\b[^>]*\bname\s*=\s*["']hs-editor-metadata["'][^>]*>/gi)];
  if (named.length > 1) throw new Error('Duplicate editor metadata');
  const matches = [...head.matchAll(/<meta\s+name="hs-editor-metadata"\s+content="([^"]*)"\s*\/?>/gi)];
  if (!matches.length) {
    if (/<meta\b[^>]*\bname\s*=\s*["']hs-editor-metadata["']/i.test(head)) throw new Error('Unsupported editor metadata serialization');
    return {};
  }
  if (matches.length !== 1) throw new Error('Duplicate editor metadata');
  const data = JSON.parse(decodeURIComponent(matches[0][1]));
  const fields = { titleZh: 512, titleEn: 512, searchTitleZh: 512, descriptionZh: 2000, descriptionEn: 2000 };
  if (!data || data.version !== 1 || Object.keys(data).some(key => !['version', 'catalogBaseSha'].includes(key) && !Object.hasOwn(fields, key))) throw new Error('Invalid editor metadata');
  for (const [key, max] of Object.entries(fields)) if (key in data &&
      (typeof data[key] !== 'string' || data[key].length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(data[key]) || /title/i.test(key) && !data[key].trim())) throw new Error('Invalid editor metadata field');
  // The HTML and encoded marker must already describe the same normalized
  // author text. Reject old/raw replay rather than normalize only the catalog
  // and silently leave the source heading/schema/snippet inconsistent.
  for (const key of Object.keys(fields)) if (key in data) {
    const normalized = normalizeMetadataText(data[key]);
    if (!allowUnnormalized && normalized !== data[key]) throw new Error('Unnormalized editor metadata');
    data[key] = normalized;
  }
  if ('catalogBaseSha' in data && !/^[a-f0-9]{40}$/.test(data.catalogBaseSha)) throw new Error('Invalid catalog version');
  return data;
}
