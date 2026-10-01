// Authenticated editor only. Values are plain author text, never HTML sinks.
import { normalizeMetadataText } from '/blog/editor-punctuation.js?v=20260691';
const markerName = 'hs-editor-metadata';
const fields = [
  ['titleZh', '文章標題（中文）', 512],
  ['titleEn', '文章標題（英文）', 512],
  ['searchTitleZh', '搜尋標題（中文，含站名）', 512],
  ['descriptionZh', '搜尋摘要（中文）', 2000],
  ['descriptionEn', '搜尋摘要（英文；空白時沿用正文摘要）', 2000]
];

export function readOverrides(doc) {
  const nodes = doc.querySelectorAll('meta[name="' + markerName + '"]');
  if (!nodes.length) return {};
  if (nodes.length !== 1) throw new Error('標題／摘要資料重複，請先確認來源版本。');
  const value = JSON.parse(decodeURIComponent(nodes[0].getAttribute('content')));
  if (value.version !== 1 || Object.keys(value).some(key => !['version', 'catalogBaseSha'].includes(key) && !fields.some(field => field[0] === key))) {
    throw new Error('標題／摘要資料格式無效。');
  }
  if ('catalogBaseSha' in value && !/^[a-f0-9]{40}$/.test(value.catalogBaseSha)) throw new Error('文章目錄版本無效。');
  for (const [key, , max] of fields) if (key in value &&
      (typeof value[key] !== 'string' || value[key].length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value[key]))) {
    throw new Error('標題／摘要資料格式無效。');
  }
  for (const [key] of fields) if (key in value) value[key] = normalizeMetadataText(value[key]);
  return value;
}

function titleNode(doc) {
  const heading = doc.matches?.('h1') ? doc : doc.querySelector('h1');
  return heading && (heading.matches('[data-zh][data-en]') ? heading : heading.querySelector('[data-zh][data-en]'));
}

export function createWorkspace(doc, source, parse, changed, catalogSha) {
  const heading = titleNode(source);
  function plain(value) {
    const inert = parse('<body>' + value + '</body>');
    inert.querySelectorAll('script,style,template').forEach(node => node.remove());
    return inert.body.textContent.replace(/\s+/g, ' ').trim();
  }
  const baseline = {
    titleZh: heading ? plain(heading.getAttribute('data-zh')) : source.querySelector('h1')?.textContent.trim() || '',
    titleEn: heading ? plain(heading.getAttribute('data-en')) : '',
    searchTitleZh: source.title,
    descriptionZh: source.querySelector('meta[name="description"]')?.content || '',
    descriptionEn: ''
  };
  const original = readOverrides(source);
  let persisted = original, savedValues;
  Object.assign(baseline, Object.fromEntries(fields.filter(([key]) => key in original).map(([key]) => [key, original[key]])));
  savedValues = { ...baseline };
  const section = doc.createElement('section');
  section.id = 'hs-editor-metadata-workspace';
  section.setAttribute('aria-label', '文章標題與搜尋摘要');
  section.style.cssText = 'max-width:48rem;margin:24px auto;padding:20px;border:1px solid var(--border);border-radius:12px;background:var(--surface,#fff);color:var(--ink,#243b56)';
  const title = doc.createElement('h2'); title.textContent = '文章標題與搜尋摘要'; section.appendChild(title);
  const help = doc.createElement('p');
  help.textContent = '標題說清楚文章回答的問題，摘要說明讀者能得到什麼。修改會與正文一起保留在草稿中；保存至 GitHub 後仍須通過正式發佈檢查。搜尋引擎可能改寫顯示文字。';
  section.appendChild(help);
  const inputs = {};
  for (const [key, label, max] of fields) {
    const wrapper = doc.createElement('label'); wrapper.style.cssText = 'display:block;margin-top:14px';
    const name = doc.createElement('span'); name.textContent = label; wrapper.appendChild(name);
    const input = doc.createElement(key.startsWith('description') ? 'textarea' : 'input');
    input.id = 'hs-editor-' + key; input.value = baseline[key]; input.maxLength = max;
    if (input.tagName === 'TEXTAREA') input.rows = 3; else input.type = 'text';
    // A legacy article lacking paired headings can still edit its summaries.
    if (key === 'titleZh' || key === 'titleEn') input.disabled = !heading || !/^[a-f0-9]{40}$/.test(catalogSha || '');
    input.style.cssText = 'display:block;width:100%;box-sizing:border-box;margin:6px 0;padding:10px;border:1px solid var(--border,#aaa);border-radius:6px;background:var(--surface,#fff);color:inherit;font:inherit';
    const count = doc.createElement('small'); count.id = input.id + '-count';
    input.setAttribute('aria-describedby', count.id);
    function updateCount() { count.textContent = Array.from(input.value).length + ' 字（僅供寫作參考）'; }
    input.updateCount = updateCount;
    input.addEventListener('input', event => { updateCount(); changed(event); });
    wrapper.append(input, count); section.appendChild(wrapper); inputs[key] = input;
    updateCount();
  }
  function overrides() {
    const next = { ...persisted, version: 1 };
    let changedTitle = false;
    for (const [key] of fields) {
      if (inputs[key].value !== savedValues[key]) {
        next[key] = normalizeMetadataText(inputs[key].value);
        if (key === 'titleZh' || key === 'titleEn') changedTitle = true;
      }
    }
    if (changedTitle) next.catalogBaseSha = catalogSha;
    return next;
  }
  function apply(root) {
    const values = overrides(), target = titleNode(root);
    // Keep all authored markup and deliberately distinct search text intact
    // until its own field changes. An empty marker is never added on open.
    if (Object.keys(values).length === 1 && !source.querySelector('meta[name="' + markerName + '"]')) return;
    for (const lang of ['zh', 'en']) {
      const key = lang === 'zh' ? 'titleZh' : 'titleEn';
      if (target && key in values) {
        target.setAttribute('data-hs-text-' + lang, '');
        target.setAttribute('data-' + lang, values[key]);
        if (lang === 'zh') target.textContent = values[key];
      }
    }
    if ('searchTitleZh' in values) {
      root.querySelector('title').textContent = values.searchTitleZh;
      for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) {
        root.querySelectorAll(selector).forEach(node => node.setAttribute('content', values.searchTitleZh));
      }
    }
    if ('descriptionZh' in values) {
      for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) {
        root.querySelectorAll(selector).forEach(node => node.setAttribute('content', values.descriptionZh));
      }
    }
    const canonical = root.querySelector('link[rel="canonical"]')?.getAttribute('href');
    root.querySelectorAll('script[type="application/ld+json"]').forEach(node => {
      let data;
      try { data = JSON.parse(node.textContent); } catch { return; }
      let touched = false;
      function visit(value) {
        if (!value || typeof value !== 'object') return;
        const types = [].concat(value['@type'] || []);
        const belongsToPage = canonical && (value['@id'] === canonical + '#article' || value['@id'] === canonical + '#webpage' ||
          value.url === canonical || value.mainEntityOfPage === canonical || value.mainEntityOfPage?.['@id'] === canonical);
        if (belongsToPage && types.some(type => ['Article', 'BlogPosting', 'MedicalScholarlyArticle', 'MedicalWebPage'].includes(type))) {
          if ('titleZh' in values) {
            const key = types.includes('MedicalWebPage') ? 'name' : 'headline';
            value[key] = values.titleZh; touched = true;
          }
          if ('descriptionZh' in values) { value.description = values.descriptionZh; touched = true; }
        }
        for (const child of Object.values(value)) if (typeof child === 'object') {
          if (Array.isArray(child)) child.forEach(visit); else visit(child);
        }
      }
      visit(data);
      if (touched) node.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
    });
    let marker = root.querySelector('meta[name="' + markerName + '"]');
    if (!marker) { marker = doc.createElement('meta'); marker.name = markerName; root.querySelector('head').appendChild(marker); }
    marker.setAttribute('content', encodeURIComponent(JSON.stringify(values)));
  }
  return {
    element: section, apply,
    heading(lang) {
      const copy = source.querySelector('h1')?.cloneNode(true);
      if (!copy) return null;
      const target = titleNode(copy), values = overrides();
      for (const language of ['zh', 'en']) {
        const key = language === 'zh' ? 'titleZh' : 'titleEn';
        if (target && key in values) {
          target.setAttribute('data-hs-text-' + language, ''); target.setAttribute('data-' + language, values[key]);
        }
      }
      for (const node of [copy, ...copy.querySelectorAll('[data-zh][data-en]')]) {
        if (!node.hasAttribute('data-' + lang)) continue;
        const text = node.getAttribute('data-' + lang);
        if (node.hasAttribute('data-hs-text') || node.hasAttribute('data-hs-text-' + lang)) node.textContent = text; else node.innerHTML = text;
      }
      return copy;
    },
    historyValues() { return JSON.stringify(Object.fromEntries(fields.map(([key]) => [key, inputs[key].value]))); },
    restoreHistory(value) {
      const values = JSON.parse(value);
      for (const [key] of fields) { inputs[key].value = values[key]; inputs[key].updateCount(); }
    },
    accepted(saved, sha) {
      persisted = readOverrides(saved);
      savedValues = { ...baseline, ...persisted };
      // Show acknowledged normalization only when this field still matches the
      // saved value; newer text typed while POST was pending remains untouched.
      for (const [key] of fields) if (key in persisted && normalizeMetadataText(inputs[key].value) === persisted[key]) {
        inputs[key].value = persisted[key]; inputs[key].updateCount();
      }
      catalogSha = /^[a-f0-9]{40}$/.test(sha || '') ? sha : null;
      inputs.titleZh.disabled = inputs.titleEn.disabled = !heading || !catalogSha;
    },
    restore(saved) {
      const values = readOverrides(saved);
      // Recover the draft's expected revision, not the newer GET's revision.
      // Otherwise reopening an old title draft could silently bless an
      // intervening catalog edit while the article blob itself was unchanged.
      if (values.catalogBaseSha && ['titleZh', 'titleEn'].some(key => key in values && values[key] !== savedValues[key])) {
        catalogSha = values.catalogBaseSha;
      }
      for (const [key] of fields) {
        inputs[key].value = key in values ? values[key] : baseline[key];
        inputs[key].updateCount();
      }
    },
    valid() {
      for (const [key] of fields) if (/title/i.test(key) && !inputs[key].disabled && !inputs[key].value.trim()) {
        inputs[key].focus(); return false;
      }
      return true;
    }
  };
}
