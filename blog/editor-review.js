// Admin-only, inert document inspection. Never render supplied article HTML.
function text(node) {
  if (!node) return '';
  const clone = node.cloneNode(true);
  clone.querySelectorAll('script,style,template').forEach(el => el.remove());
  return clone.textContent.replace(/\s+/g, ' ').trim();
}

export function checkDocument(doc) {
  const article = doc.querySelector('article.max-w-3xl');
  const prose = article?.querySelector('#proseZh') || article?.querySelector('.prose') || article;
  const blocking = [], warnings = [], issues = [], occurrences = new Map();
  function issue(kind, el, detail, message) {
    // Use authored identity, not sibling positions: removing executable source
    // scripts or inserting a valid paragraph must not turn old issues into new.
    const identity = JSON.stringify([kind,el?.tagName || '',el?.id || '',detail]);
    const occurrence = (occurrences.get(identity) || 0) + 1;
    occurrences.set(identity, occurrence);
    issues.push({ key:JSON.stringify([identity,occurrence]), message });
  }
  if (!article || !text(prose)) blocking.push('正文是空白的，請確認文章內容後再保存。');
  const title = text(doc.querySelector('title'));
  const description = (doc.querySelector('meta[name="description"]')?.content || '').trim();
  if (!title) { warnings.push('搜尋標題目前空白。'); issue('title', null, '', warnings.at(-1)); }
  if (!description) { warnings.push('搜尋摘要目前空白。'); issue('description', null, '', warnings.at(-1)); }
  const ids = new Set(), duplicates = new Set();
  doc.querySelectorAll('[id]').forEach(el => {
    if (ids.has(el.id)) {
      duplicates.add(el.id);
      issue('duplicate-id', el, el.id, '有重複的段落識別名稱：' + el.id);
    }
    ids.add(el.id);
  });
  if (duplicates.size) warnings.push('有重複的段落識別名稱，捷徑可能跳到錯誤的位置。');
  let brokenLinks = 0, imageDescriptions = 0, imageSources = 0, imageDimensions = 0, bilingual = 0;
  article?.querySelectorAll('a[href^="#"]').forEach(el => {
    if (el.getAttribute('href') === '#') return;
    let broken;
    try { broken = !ids.has(decodeURIComponent(el.getAttribute('href').slice(1))); }
    catch { broken = true; }
    if (broken) {
      brokenLinks++;
      issue('fragment', el, [el.getAttribute('href'),text(el)], '段落連結找不到目的段落：' + el.getAttribute('href'));
    }
  });
  article?.querySelectorAll('img').forEach(el => {
    // Explicit empty alt is valid for a decorative image.
    const source = [el.getAttribute('src'), el.getAttribute('srcset')];
    if (!el.hasAttribute('alt')) { imageDescriptions++; issue('alt', el, source, '圖片缺少替代文字，請確認圖片用途。'); }
    if (!(el.getAttribute('src') || '').trim() && !(el.getAttribute('srcset') || '').trim()) {
      imageSources++; issue('image-source', el, source, '圖片沒有來源，請重新選取或移除。');
    }
    if (!(Number(el.getAttribute('width')) > 0 && Number(el.getAttribute('height')) > 0)) {
      imageDimensions++; issue('image-size', el, [...source,el.getAttribute('width'),el.getAttribute('height')], '圖片缺少有效寬高，載入時可能推動正文。');
    }
  });
  article?.querySelectorAll('[data-zh],[data-en]').forEach(el => {
    if (!el.hasAttribute('data-zh') || !el.hasAttribute('data-en')) {
      bilingual++;
      issue('bilingual', el, [el.getAttribute('data-zh'),el.getAttribute('data-en')], '雙語欄位缺少對應屬性，請確認兩種語言。');
    }
  });
  if (brokenLinks) warnings.push(brokenLinks + ' 個段落連結找不到目的段落，請用本機預覽確認。');
  if (imageDescriptions) warnings.push(imageDescriptions + ' 張圖片缺少替代文字；有意義的圖片請補上說明。');
  if (imageSources) warnings.push(imageSources + ' 張圖片沒有來源，請重新選取或移除。');
  if (imageDimensions) warnings.push(imageDimensions + ' 張圖片缺少有效寬高，載入時可能推動正文。');
  if (bilingual) warnings.push(bilingual + ' 個雙語欄位缺少對應屬性，請確認語言切換後內容仍完整。');
  return { blocking, warnings, issues, title, description };
}

export function describeDocument(doc) {
  const article = doc.querySelector('article.max-w-3xl');
  if (!article) throw new Error('版本缺少可比較的文章正文');
  const lines = [];
  article.querySelectorAll('h1,h2,h3,p,li,td,th,figcaption,blockquote,pre,img,svg').forEach(el => {
    if (el.tagName === 'IMG') {
      lines.push('[圖片] ' + (el.getAttribute('alt') || '(無替代文字)') + '\n' +
        (el.getAttribute('src') || '') + '\n' + (el.getAttribute('srcset') || ''));
    } else if (el.tagName === 'SVG') {
      lines.push('[圖表] ' + (el.getAttribute('aria-label') || text(el.querySelector('title')) || '(無標題)'));
    } else {
      const value = text(el);
      if (value) lines.push(value);
      for (const language of ['zh', 'en']) {
        if (el.hasAttribute('data-' + language)) lines.push('[' + language + '] ' + el.getAttribute('data-' + language));
      }
    }
  });
  return { summary: lines.join('\n\n'), source: article.outerHTML };
}
