/**
 * Content rules for the admin exam editor (api/admin/_exam-draft.js).
 *
 * Pure functions only: no network, no secrets, no filesystem. Everything fails
 * closed — a note or explanation that does not match what _gen_exam.py accepts
 * today is rejected with a readable Traditional-Chinese reason, never silently
 * rewritten. The repository data the rules need (question tags, outline labels,
 * BCSC sections, the simplified-character list) is passed in by the caller,
 * read from the same main commit the edit is based on.
 */
import { parse, parseFragment } from 'parse5';

export class ExamContentError extends Error {
  constructor(code, reason) { super(code); this.code = code; this.reason = reason; }
}
function reject(code, reason) { throw new ExamContentError(code, reason); }

// Chapter keys are "<BCSC section>-<chapter>" (notes file data/exam/notes/bcsc<key>.htm);
// question ids are the bank's question numbers ("1".."1774").
export const NOTE_KEY = /^[1-9]\d?-[1-9]\d?$/;
export const QUESTION_ID = /^[1-9]\d{0,4}$/;
export const MAX_NOTE_BYTES = 600_000;
const encoder = new TextEncoder();

// ------------------------------------------------------------------ shared
// _gen_exam.py check_traditional(): the last line of data/exam/simplified_chars.txt.
export function simplifiedSet(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  return new Set(Array.from(lines[lines.length - 1] || ''));
}
function checkTraditional(text, simplified, code, label) {
  const bad = [...new Set(Array.from(text).filter(c => simplified.has(c)))];
  if (bad.length) reject(code, `${label}含有簡體字：${bad.slice(0, 20).join('')}`);
}

// _gen_exam.py ANSWER_LEAK (public notes never disclose an answer). Python's `\b`
// after an option letter is a Unicode word boundary, hence the lookahead.
export const ANSWER_LEAK = new RegExp(
  '官方答案|官方解答|官方\\s*key|本題答案|考題答案|正確答案(?:為|是)|答案(?:為|是|選)\\s*[（(]?[A-E](?![\\p{L}\\p{N}_])' +
  '|故選\\s*[A-E](?![\\p{L}\\p{N}_])|(?:題目|考題|出題者)(?:要的|想考的)答案|exam\\s+convention|answer\\s+key', 'u');

// ------------------------------------------------------------------ notes
// _gen_exam.py check_note_markup(): the tags, classes and attributes it accepts.
export const NOTE_TAGS = new Set(['h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'i', 'mark', 'br', 'span', 'div',
  'table', 'thead', 'tbody', 'tr', 'th', 'td']);
export const NOTE_CLASSES = new Set(['ref', 'num', 'ex-trap', 'keypoint', 'hs-tip-box', 'hs-warn-box', 'ted-table', 'ex-ddx']);
const NOTE_ATTRS = new Set(['class', 'id', 'scope', 'colspan', 'rowspan']);

// The editor is stricter than the generator's regex, never looser: every value
// below is in the sets above, and each is the way all 212 committed notes use it.
// The generator later reads the fragment with regexes (PARA_RE, H2_RE, key_marks,
// wrap_tables) that expect canonical double-quoted start tags and literal end tags.
const VOID = new Set(['br']);
const ATTRS = {
  h2: ['id'], h3: ['id'], span: ['class'], div: ['class'], table: ['class'],
  th: ['scope', 'colspan', 'rowspan'], td: ['colspan', 'rowspan'],
};
const CLASSES = {
  span: new Set(['ref', 'num']),
  div: new Set(['ex-trap', 'keypoint', 'hs-tip-box', 'hs-warn-box']),
  table: new Set(['ted-table', 'ted-table ex-ddx']),
};
const REQUIRED = { h2: 'id', span: 'class', div: 'class', table: 'class' };
const TOP_LEVEL = new Set(['h2', 'h3', 'h4', 'p', 'ul', 'ol', 'table', 'div']);
const HEADING_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const RESERVED_ID = /^(?:np-|ex-|q-)|^(?:notes-h|qs-h|links-h|cpts-h|main-content)$/;
const SPAN = /^[1-9]\d?$/;
const SAFE_VALUE = /^[^"<>&{}\x00-\x1f\x7f]*$/;
const QREF = /\{\{q:([0-9,\s]+)\}\}/g;

let context = null;
function divContext() {
  if (!context) {
    context = parse('<div></div>').childNodes.find(n => n.nodeName === 'html')
      .childNodes.find(n => n.nodeName === 'body').childNodes[0];
  }
  return context;
}
function line(source, offset) {
  return `（第 ${source.slice(0, offset).split('\n').length} 行）`;
}

// A literal port of check_note_markup(), so "the editor accepted it" always implies
// "the generator accepts it" even where the structural rules below are looser.
function generatorMarkup(source) {
  for (const m of source.matchAll(/<\s*(\/?)([a-zA-Z0-9]+)([^>]*)>/g)) {
    const tag = m[2].toLowerCase();
    if (!NOTE_TAGS.has(tag)) reject('invalid_note', `不允許的標籤 <${tag}>` + line(source, m.index));
    for (const a of m[3].matchAll(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g)) {
      const tokens = a[2].split(/\s+/).filter(Boolean);
      if (a[1] === 'class' && !tokens.every(t => NOTE_CLASSES.has(t))) {
        reject('invalid_note', `不允許的 class="${a[2].slice(0, 60)}"` + line(source, m.index));
      }
      if (!NOTE_ATTRS.has(a[1])) reject('invalid_note', `<${tag}> 不允許屬性 ${a[1]}` + line(source, m.index));
    }
  }
  const leak = ANSWER_LEAK.exec(source);
  if (leak) reject('invalid_note', `公開的重點不可寫出考題答案：「${leak[0]}」` + line(source, leak.index));
}

/**
 * Validate a chapter note. `rules`:
 *   onPage     Set of question numbers tagged to this chapter (tags.json); {{q:N}} may cite only these
 *   headings   the chapter's toc_en.json labels (object h2 id -> English label)
 *   simplified Set of simplified-only characters
 * Returns the LF-normalised source to store.
 */
export function validateNote(content, rules) {
  if (typeof content !== 'string') reject('invalid_note', '內容必須是文字');
  // UTF-8 encoding would silently replace it, so the post-write check could not match.
  if (LONE_SURROGATE.test(content)) reject('invalid_note', '含有無效的 Unicode 字元');
  const source = content.replace(/\r\n?/g, '\n');
  if (!source.trim()) reject('invalid_note', '內容是空的');
  if (encoder.encode(source).length > MAX_NOTE_BYTES) reject('too_large', '重點內容超過 600 KB');
  const control = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.exec(source);
  if (control) reject('invalid_note', '含有控制字元' + line(source, control.index));
  const decl = /<[!?]/.exec(source);
  if (decl) reject('invalid_note', '不可使用 HTML 註解、<!DOCTYPE> 或 <? … > 宣告' + line(source, decl.index));
  checkTraditional(source, rules.simplified, 'invalid_note', '重點');

  // {{q:N}} question labels: each number must be a question tagged to this chapter
  // (expand_hits); any other {{ … }} would stay an unexpanded placeholder.
  for (const m of source.matchAll(QREF)) {
    const parts = m[1].split(',').map(part => part.trim());
    if (!parts.length || parts.some(part => !/^[1-9]\d{0,4}$/.test(part))) {
      reject('invalid_note', `題號標記需寫成 {{q:12}} 或 {{q:12,34}}，實際為 ${m[0].slice(0, 40)}` + line(source, m.index));
    }
    const bad = parts.filter(part => !rules.onPage.has(Number(part)));
    if (bad.length) reject('invalid_note', `{{q:…}} 引用了不屬於本章的題號：${bad.join(', ')}` + line(source, m.index));
  }
  const stray = /\{\{/.exec(source.replace(QREF, ''));
  if (stray) reject('invalid_note', '只能使用 {{q:題號}} 標記，其他 {{ … }} 不允許' + line(source, stray.index));

  generatorMarkup(source);

  const fragment = parseFragment(divContext(), source, { sourceCodeLocationInfo: true });
  let endTags = 0, startTags = 0;
  const where = node => {
    const at = node && node.sourceCodeLocation;
    return at && Number.isInteger(at.startOffset) ? line(source, at.startOffset) : '';
  };
  function span(node) {
    const at = node.sourceCodeLocation;
    if (!at || !Number.isInteger(at.startOffset) || !Number.isInteger(at.endOffset)) reject('invalid_note', '標籤順序錯亂' + where(node));
    return at;
  }
  function inner(node) {
    if (node === fragment) return [0, source.length];
    const at = span(node);
    return [at.startTag.endOffset, at.endTag ? at.endTag.startOffset : at.startTag.endOffset];
  }
  // Every node must sit inside its parent's source span, after its previous
  // sibling: the parser moves misplaced content (text or <p> directly in a
  // <table> is foster-parented before it), so the page would differ from the source.
  function checkOrder(parent) {
    const [from, to] = inner(parent);
    let cursor = from;
    for (const child of parent.childNodes || []) {
      const at = span(child);
      if (at.startOffset < cursor || at.endOffset > to) reject('invalid_note', '內容被移到不該在的位置（例如表格內直接放文字或段落）' + where(child));
      cursor = at.endOffset;
    }
  }
  const headings = [];
  function visit(node, parent, insideTable) {
    if (node.nodeName === '#text') return;
    if (node.nodeName === '#comment') reject('invalid_note', '不可使用 HTML 註解' + where(node));
    const tag = node.tagName;
    if (!tag || !NOTE_TAGS.has(tag) || node.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
      reject('invalid_note', `不允許的標籤 <${tag || node.nodeName}>` + where(node));
    }
    const location = node.sourceCodeLocation;
    if (!location || !location.startTag) reject('invalid_note', `<${tag}> 缺少開始標籤（標籤順序錯亂）` + where(parent));
    if (!VOID.has(tag)) {
      if (!location.endTag) reject('invalid_note', `<${tag}> 沒有對應的結束標籤` + where(node));
      endTags++;
      const closing = source.slice(location.endTag.startOffset, location.endTag.endOffset);
      if (closing !== '</' + tag + '>') reject('invalid_note', `結束標籤需寫成 </${tag}>，實際為 ${closing.slice(0, 40)}` + where(node));
    }
    startTags++;
    const raw = source.slice(location.startTag.startOffset, location.startTag.endOffset);
    const canonical = '<' + tag + node.attrs.map(a => ` ${a.name}="${a.value}"`).join('') + '>';
    if (raw !== canonical || node.attrs.some(a => !SAFE_VALUE.test(a.value))) {
      reject('invalid_note', `開始標籤格式需為 ${canonical.length > 80 ? '<' + tag + ' 屬性="值">' : canonical}，實際為 ${raw.slice(0, 80)}` + where(node));
    }
    const allowed = ATTRS[tag] || [];
    for (const a of node.attrs) if (!allowed.includes(a.name)) reject('invalid_note', `<${tag}> 不允許屬性 ${a.name}` + where(node));
    const attr = name => (node.attrs.find(a => a.name === name) || {}).value;
    if (REQUIRED[tag] && attr(REQUIRED[tag]) === undefined) reject('invalid_note', `<${tag}> 需要 ${REQUIRED[tag]}` + where(node));
    if (CLASSES[tag] && attr('class') !== undefined && !CLASSES[tag].has(attr('class'))) {
      reject('invalid_note', `<${tag}> 不允許 class="${attr('class')}"（可用：${[...CLASSES[tag]].join('、')}）` + where(node));
    }
    for (const name of ['colspan', 'rowspan']) {
      if (attr(name) !== undefined && !SPAN.test(attr(name))) reject('invalid_note', `${name} 需為 1–99 的數字` + where(node));
    }
    if (attr('scope') !== undefined && !['col', 'row', 'colgroup', 'rowgroup'].includes(attr('scope'))) {
      reject('invalid_note', 'scope 只能是 col、row、colgroup 或 rowgroup' + where(node));
    }
    if (tag === 'h2' || tag === 'h3') {
      const id = attr('id');
      if (id !== undefined && (!HEADING_ID.test(id) || RESERVED_ID.test(id))) {
        reject('invalid_note', `<${tag}> 的 id 需為小寫英數與連字號（例如 ch1-s1），且不可用保留名稱：${id}` + where(node));
      }
      headings.push({ tag, id, node });
    }
    if (tag === 'h2' && parent !== fragment) reject('invalid_note', '<h2> 只能放在最外層' + where(node));
    if (parent === fragment && !TOP_LEVEL.has(tag)) reject('invalid_note', `最外層不能直接放 <${tag}>` + where(node));
    if (tag === 'table' && insideTable) reject('invalid_note', '表格不可巢狀' + where(node));
    checkOrder(node);
    for (const child of node.childNodes || []) visit(child, node, insideTable || tag === 'table');
  }
  checkOrder(fragment);
  let first = null;
  for (const child of fragment.childNodes) {
    if (child.nodeName === '#text') {
      if (child.value.trim()) reject('invalid_note', '最外層不能直接放文字' + where(child));
      continue;
    }
    if (!first) first = child;
    visit(child, fragment, false);
  }
  if (!first || first.tagName !== 'h2') reject('invalid_note', '重點必須以 <h2 id="…"> 開頭');
  // A stray end tag is dropped by the parser but would close page markup around
  // the note on the real page; a start tag the fragment parser discards (<html>,
  // <body>, <head>) leaves no node but would still reach the generated page.
  if ((source.match(/<\/[A-Za-z]/g) || []).length !== endTags) reject('invalid_note', '有多餘或錯置的結束標籤');
  if ((source.match(/<[A-Za-z]/g) || []).length !== startTags) reject('invalid_note', '有被忽略的開始標籤（例如 <html>、<body>、<head>）');

  // anchor_notes(): an <h3> without an id gets "<h2 id>-<n>"; all heading ids must be unique.
  const ids = new Set();
  let h2 = '', n = 0;
  for (const h of headings) {
    let id = h.id;
    if (h.tag === 'h2') { h2 = id; n = 0; } else if (id === undefined) id = `${h2 || 'notes'}-${++n}`;
    if (ids.has(id)) reject('invalid_note', `標題 id 重複：${id}` + where(h.node));
    ids.add(id);
  }
  // load_toc_en(): every <h2> needs an English outline label in data/exam/toc_en.json
  // and every label an <h2>. The editor cannot change toc_en.json.
  const h2Ids = headings.filter(h => h.tag === 'h2').map(h => h.id);
  const labels = rules.headings && typeof rules.headings === 'object' ? Object.keys(rules.headings) : [];
  const missing = h2Ids.filter(id => !labels.includes(id)), extra = labels.filter(id => !h2Ids.includes(id));
  if (missing.length || extra.length) {
    reject('invalid_note', '大標（<h2>）的 id 必須與現有章節目錄一致；新增、刪除或改名 <h2> 需由維護者同步更新 toc_en.json。' +
      (missing.length ? `新的 id：${missing.join(', ')}。` : '') + (extra.length ? `缺少的 id：${extra.join(', ')}。` : ''));
  }
  return source;
}

// ------------------------------------------------------------- explanations
// data/exam/explanations.json is written exactly like
// json.dumps(data, indent=1, ensure_ascii=False) with no trailing newline, which
// JSON.stringify(data, null, 1) reproduces for this data (all keys are question
// numbers in ascending order). Writers verify that identity before changing anything.
const CONTROL = /[\x00-\x1f\x7f\u2028\u2029]/;
// An unpaired UTF-16 surrogate: JSON.stringify escapes it but Python writes it raw,
// so _pull_exam_drafts.py could not reproduce the file (PR #95 review).
export const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const PAGES = /^\d{1,4}(?:–\d{1,4})?$/;
const OPTION_KEYS = ['A', 'B', 'C', 'D'];
function isPlainObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value, keys, path) {
  if (!isPlainObject(value)) reject('invalid_entry', `${path} 必須是物件`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) reject('invalid_entry', `${path} 不允許欄位 ${key}`);
  for (const key of keys) if (!(key in value)) reject('invalid_entry', `${path} 缺少欄位 ${key}`);
}
function text(value, path, max) {
  if (typeof value !== 'string') reject('invalid_entry', `${path} 必須是文字`);
  if (!value.trim()) reject('invalid_entry', `${path} 不可空白`);
  if (value !== value.trim()) reject('invalid_entry', `${path} 前後不可有空白`);
  if (value.length > max) reject('invalid_entry', `${path} 超過 ${max} 字`);
  if (CONTROL.test(value)) reject('invalid_entry', `${path} 含有換行或控制字元`);
  if (LONE_SURROGATE.test(value)) reject('invalid_entry', `${path} 含有無效的 Unicode 字元`);
  return value;
}

/**
 * Returns a new entry in the file's canonical key order. `previous` is the stored
 * entry (the option keys cannot change); `rules.books` is the Set of BCSC section
 * numbers in chapters.json and `rules.simplified` the simplified-character Set.
 * Mirrors _gen_exam.py load(): items A–D, exactly one answer, answer field agrees.
 */
export function validateEntry(input, previous, rules) {
  exactKeys(input, ['answer', 'summary', 'flags', 'items'], 'entry');
  const summary = text(input.summary, 'summary', 1000);
  if (!Array.isArray(input.items) || input.items.length !== OPTION_KEYS.length) reject('invalid_entry', 'items 必須是 A–D 四個選項');
  const items = input.items.map((item, index) => {
    const path = `items[${index}]`;
    exactKeys(item, ['key', 'answer', 'label', 'text', 'refs'], path);
    if (item.key !== OPTION_KEYS[index] || item.key !== previous.items[index].key) reject('invalid_entry', `${path}.key 不可變更`);
    if (typeof item.answer !== 'boolean') reject('invalid_entry', `${path}.answer 必須是 true/false`);
    if (!Array.isArray(item.refs) || item.refs.length > 10) reject('invalid_entry', `${path}.refs 必須是陣列（最多 10 筆）`);
    const refs = item.refs.map((ref, r) => {
      if (!Array.isArray(ref) || ref.length !== 2) reject('invalid_entry', `${path}.refs[${r}] 必須是 [冊, 頁]`);
      const [book, pages] = ref;
      if (!Number.isInteger(book) || !rules.books.has(book)) reject('invalid_entry', `${path}.refs[${r}] 的 BCSC 冊別不存在：${book}`);
      if (typeof pages !== 'string' || !PAGES.test(pages)) reject('invalid_entry', `${path}.refs[${r}] 頁碼須為 276 或 276–277`);
      return [book, pages];
    });
    return { key: item.key, answer: item.answer, label: text(item.label, `${path}.label`, 40),
      text: text(item.text, `${path}.text`, 2000), refs };
  });
  const answers = items.filter(item => item.answer);
  if (answers.length !== 1) reject('invalid_entry', '必須剛好有一個正確答案選項');
  if (input.answer !== answers[0].key) reject('invalid_entry', `answer（${String(input.answer).slice(0, 4)}）與標為答案的選項（${answers[0].key}）不一致`);
  if (!Array.isArray(input.flags) || input.flags.length > 10) reject('invalid_entry', 'flags 必須是陣列（最多 10 筆）');
  const flags = input.flags.map((flag, f) => text(flag, `flags[${f}]`, 1000));
  const entry = { answer: answers[0].key, summary, flags, items };
  checkTraditional(JSON.stringify(entry), rules.simplified, 'invalid_entry', '詳解');
  return entry;
}

export function serializeExplanations(data) { return JSON.stringify(data, null, 1); }

function parseStored(storedText) {
  let data;
  try { data = JSON.parse(storedText); } catch (_) { reject('format_mismatch', '雲端詳解檔不是有效 JSON'); }
  if (!isPlainObject(data) || serializeExplanations(data) !== storedText) reject('format_mismatch', '雲端詳解檔格式與產生器不一致，未寫入');
  return data;
}

// Replace one existing question's entry. Fails closed unless the stored text
// re-serializes byte for byte, so the commit can only change that entry.
export function replaceExplanation(storedText, id, input, rules) {
  if (!QUESTION_ID.test(id || '')) reject('invalid_id', '題號需為數字，例如 128');
  const data = parseStored(storedText);
  if (!Object.prototype.hasOwnProperty.call(data, id)) reject('unknown_question', `沒有題號 ${id} 的詳解`);
  const entry = validateEntry(input, data[id], rules);
  data[id] = entry; // integer-like key: its position never moves
  return { text: serializeExplanations(data), entry };
}

// Current main plus every drafted entry: drafted ids come from the draft copy,
// everything else from main, so a stale branch copy never reverts newer main text.
export function composeExplanations(mainText, draftText, draftedIds) {
  const data = parseStored(mainText);
  if (!draftedIds.length) return mainText;
  const draft = parseStored(draftText);
  for (const id of draftedIds) {
    if (!Object.prototype.hasOwnProperty.call(draft, id) || !Object.prototype.hasOwnProperty.call(data, id)) {
      reject('format_mismatch', `草稿與 main 的題號 ${id} 對不上`);
    }
    data[id] = draft[id];
  }
  return serializeExplanations(data);
}

export function readExplanation(storedText, id) {
  if (!QUESTION_ID.test(id || '')) reject('invalid_id', '題號需為數字，例如 128');
  let data;
  try { data = JSON.parse(storedText); } catch (_) { reject('format_mismatch', '雲端詳解檔不是有效 JSON'); }
  if (!isPlainObject(data) || !Object.prototype.hasOwnProperty.call(data, id)) reject('unknown_question', `沒有題號 ${id} 的詳解`);
  return data[id];
}
