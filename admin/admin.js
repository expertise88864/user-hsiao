/* HsiaoEye Admin · Vanilla-JS CMS for static-site editing
 * --------------------------------------------------------------
 * - GitHub Contents API for file read/write (commits direct to main)
 * - WebP image compression in-browser before upload
 * - LocalStorage autosave + dirty-flag beforeunload guard
 * - Behind-main warning by comparing local known SHA vs remote HEAD
 * - No build step; no external runtime dependencies
 */
(function () {
'use strict';

/* ──────────────────────────────────────────────
 *  CONFIG
 * ────────────────────────────────────────────── */
const CFG = {
  owner: 'expertise88864',
  repo: 'user-hsiao',
  branch: 'main',
  tokenKey: 'hs:admin:gh-pat',
  draftKeyPrefix: 'hs:admin:draft:',
  lastSeenShaKey: 'hs:admin:lastSeenSha',
  uploadDir: 'assets/uploads',
  apiBase: 'https://api.github.com',
};

/* ──────────────────────────────────────────────
 *  Utilities
 * ────────────────────────────────────────────── */
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
function el(tag, attrs, children) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'style') e.style.cssText = attrs[k];
    else if (k.startsWith('on')) e[k.toLowerCase()] = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else e.setAttribute(k, attrs[k]);
  }
  if (children) (Array.isArray(children) ? children : [children]).forEach(c => {
    if (c == null) return;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return e;
}
function debounce(fn, ms) {
  let t; return function () { clearTimeout(t); const args = arguments; t = setTimeout(() => fn.apply(null, args), ms); };
}
function fmtDate(d) {
  const dd = d instanceof Date ? d : new Date(d);
  return dd.toISOString().slice(0, 10);
}
function toBase64(arrayBufOrStr) {
  if (typeof arrayBufOrStr === 'string') {
    return btoa(unescape(encodeURIComponent(arrayBufOrStr)));
  }
  // ArrayBuffer / Uint8Array → base64 (chunked to avoid call-stack overflow)
  const bytes = arrayBufOrStr instanceof Uint8Array ? arrayBufOrStr : new Uint8Array(arrayBufOrStr);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
function fromBase64ToString(b64) {
  return decodeURIComponent(escape(atob(b64)));
}
function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[一-鿿　-〿＀-￯]/g, '')
    .replace(/[^a-z0-9\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

/* ──────────────────────────────────────────────
 *  Toast notifications
 * ────────────────────────────────────────────── */
const Toast = {
  host: null,
  ensure() {
    if (!this.host) {
      this.host = el('div', { class: 'ad-toast-host', id: 'ad-toast-host' });
      document.body.appendChild(this.host);
    }
  },
  show(msg, type) {
    this.ensure();
    const t = el('div', { class: 'ad-toast' + (type ? ' ' + type : '') }, msg);
    this.host.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transition = 'opacity .25s';
      setTimeout(() => t.remove(), 260);
    }, 3000);
  },
  ok(m)    { this.show(m, 'success'); },
  err(m)   { this.show(m, 'error'); },
  warn(m)  { this.show(m, 'warn'); },
};

/* ──────────────────────────────────────────────
 *  GitHub API wrapper
 * ────────────────────────────────────────────── */
const GH = {
  token: null,
  load() { this.token = localStorage.getItem(CFG.tokenKey) || null; return this.token; },
  save(t) { localStorage.setItem(CFG.tokenKey, t); this.token = t; },
  clear() { localStorage.removeItem(CFG.tokenKey); this.token = null; },

  async _fetch(path, opts) {
    opts = opts || {};
    const headers = Object.assign({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }, opts.headers || {});
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    if (opts.body && typeof opts.body !== 'string') {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const url = path.startsWith('http') ? path : (CFG.apiBase + path);
    const r = await fetch(url, Object.assign({}, opts, { headers }));
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
    if (!r.ok) {
      const msg = (data && data.message) || ('HTTP ' + r.status);
      const err = new Error(msg);
      err.status = r.status;
      err.body = data;
      throw err;
    }
    return data;
  },

  // Quick check: does the token work + can it see the repo?
  async checkToken() {
    const data = await this._fetch(`/repos/${CFG.owner}/${CFG.repo}`);
    return data;
  },

  async getBranchSha(branch) {
    const data = await this._fetch(`/repos/${CFG.owner}/${CFG.repo}/branches/${branch || CFG.branch}`);
    return data.commit.sha;
  },

  // Get file content + SHA (returns null if not found)
  async getFile(path) {
    try {
      const data = await this._fetch(`/repos/${CFG.owner}/${CFG.repo}/contents/${encodeURI(path)}?ref=${CFG.branch}`);
      // GitHub returns content as base64-encoded. content may be split with newlines.
      const decoded = fromBase64ToString(data.content.replace(/\n/g, ''));
      return { content: decoded, sha: data.sha, path: data.path };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  },

  // Create or update a file. If sha is provided, it's an update; otherwise a create.
  async putFile(path, content, message, sha) {
    const body = {
      message: message || ('Edit ' + path),
      content: typeof content === 'string' ? toBase64(content) : toBase64(content),
      branch: CFG.branch,
      committer: {
        name: 'HsiaoEye Admin',
        email: 'f94001115@gmail.com',
      },
    };
    if (sha) body.sha = sha;
    return await this._fetch(`/repos/${CFG.owner}/${CFG.repo}/contents/${encodeURI(path)}`, {
      method: 'PUT',
      body,
    });
  },

  // List directory entries
  async listDir(path) {
    try {
      const data = await this._fetch(`/repos/${CFG.owner}/${CFG.repo}/contents/${encodeURI(path)}?ref=${CFG.branch}`);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      if (e.status === 404) return [];
      throw e;
    }
  },
};

/* ──────────────────────────────────────────────
 *  Image upload (in-browser WebP compression)
 * ────────────────────────────────────────────── */
const ImageOps = {
  // Compress + convert to WebP. Returns { blob, filename, sizeKB }
  async toWebP(file, opts) {
    opts = opts || {};
    const maxDim = opts.maxDim || 1920;
    const quality = opts.quality || 0.85;

    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = URL.createObjectURL(file);
    });
    // Compute target dimensions
    let { width, height } = img;
    if (width > maxDim || height > maxDim) {
      const scale = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/webp', quality);
    });
    URL.revokeObjectURL(img.src);
    return { blob, width, height, sizeKB: Math.round(blob.size / 1024) };
  },

  // Upload a WebP blob to GitHub at /assets/uploads/{name}
  async upload(blob, filename) {
    const arrayBuf = await blob.arrayBuffer();
    const path = `${CFG.uploadDir}/${filename}`;
    await GH.putFile(path, new Uint8Array(arrayBuf), 'admin: upload image ' + filename);
    return '/' + path;
  },

  generateName(slug) {
    const ts = Date.now().toString(36);
    return (slug ? (slugify(slug) + '-') : '') + ts + '.webp';
  },
};

/* ──────────────────────────────────────────────
 *  Article catalog (parsed from blog/blog-shared.js DN.ARTICLES)
 * ────────────────────────────────────────────── */
const Catalog = {
  all: [],
  async load() {
    const file = await GH.getFile('blog/blog-shared.js');
    if (!file) throw new Error('blog/blog-shared.js not found');
    const m = file.content.match(/DN\.ARTICLES\s*=\s*\[([\s\S]*?)\];/);
    if (!m) throw new Error('Could not parse DN.ARTICLES');
    const raw = m[1];
    // Loosely parse the article entries
    const entries = [];
    const lineRe = /\{\s*([^}]*)\}/g;
    let mm;
    while ((mm = lineRe.exec(raw)) !== null) {
      const inner = mm[1];
      const obj = {};
      const fieldRe = /(\w+)\s*:\s*(?:'([^']*)'|"([^"]*)")/g;
      let fm;
      while ((fm = fieldRe.exec(inner)) !== null) {
        obj[fm[1]] = fm[2] != null ? fm[2] : fm[3];
      }
      if (obj.slug) entries.push(obj);
    }
    this.all = entries;
    this.sourceSha = file.sha;
    this.sourceContent = file.content;
    return entries;
  },
};

/* ──────────────────────────────────────────────
 *  Editor state
 * ────────────────────────────────────────────── */
const Editor = {
  currentSlug: null,
  currentPath: null,
  currentSha: null,
  currentContent: '',
  dirty: false,
  ta: null,         // main textarea
  tabPanels: {},
  metaForm: null,

  setDirty(v) {
    if (this.dirty === v) return;
    this.dirty = v;
    const status = $('#ad-status');
    if (status) {
      status.classList.toggle('dirty', v);
      $('#ad-status-text').textContent = v ? '未存檔' : '已儲存';
    }
  },

  setSaving(on) {
    const status = $('#ad-status');
    if (status) {
      status.classList.toggle('saving', on);
      if (on) $('#ad-status-text').textContent = '儲存中…';
    }
  },

  // Insert text at cursor (in textarea), wrapping selection if pre/post given
  wrap(pre, post) {
    const ta = this.ta;
    if (!ta) return;
    post = post == null ? '' : post;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const sel = ta.value.slice(start, end);
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    const replacement = pre + sel + post;
    ta.value = before + replacement + after;
    ta.focus();
    if (sel) {
      ta.setSelectionRange(start + pre.length, start + pre.length + sel.length);
    } else {
      ta.setSelectionRange(start + pre.length, start + pre.length);
    }
    this.setDirty(true);
    this.updateStats();
  },

  insert(text) {
    this.wrap(text, '');
  },

  updateStats() {
    const ta = this.ta;
    if (!ta) return;
    const text = ta.value;
    // Count visible Chinese + English words (rough)
    const stripped = text
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<style[\s\S]*?<\/style>/g, '')
      .replace(/<[^>]+>/g, '');
    const cjkChars = (stripped.match(/[一-鿿]/g) || []).length;
    const enWords = (stripped.match(/[A-Za-z]+/g) || []).length;
    const totalWords = cjkChars + enWords;
    // Reading speed: 300 cjk chars/min + 200 en wpm
    const minutes = Math.max(1, Math.round((cjkChars / 300) + (enWords / 200)));
    $('#stat-words').textContent = totalWords.toLocaleString();
    $('#stat-cjk').textContent = cjkChars.toLocaleString();
    $('#stat-en').textContent = enWords.toLocaleString();
    $('#stat-read').textContent = minutes + ' 分';
    $('#stat-bytes').textContent = (new Blob([text]).size / 1024).toFixed(1) + ' KB';
    // Bilingual pair check
    const zhCount = (text.match(/data-zh=/g) || []).length;
    const enCount = (text.match(/data-en=/g) || []).length;
    const pairLabel = zhCount === enCount ? `${zhCount} / ${enCount} ✓` : `${zhCount} / ${enCount}`;
    const pairEl = $('#stat-pair');
    pairEl.textContent = pairLabel;
    pairEl.style.color = (zhCount === enCount) ? 'var(--green)' : 'var(--red)';
  },

  async loadArticle(slug) {
    if (this.dirty) {
      if (!confirm('目前文章尚未儲存，確定要切換嗎？')) return;
    }
    const path = `blog/${slug}.html`;
    Toast.show('載入中…');
    const file = await GH.getFile(path);
    if (!file) {
      Toast.err('找不到 ' + path);
      return;
    }
    this.currentSlug = slug;
    this.currentPath = path;
    this.currentSha = file.sha;
    this.currentContent = file.content;
    this.ta.value = file.content;
    this.setDirty(false);
    this.updateStats();
    this.loadMetaFromContent();

    // Highlight in sidebar
    $$('.ad-item').forEach(it => it.classList.toggle('active', it.dataset.slug === slug));

    // Restore draft if newer than loaded
    const draft = localStorage.getItem(CFG.draftKeyPrefix + slug);
    if (draft) {
      try {
        const parsed = JSON.parse(draft);
        if (parsed.content && parsed.content !== file.content && parsed.ts > Date.now() - 7 * 86400000) {
          if (confirm(`偵測到本機草稿（${new Date(parsed.ts).toLocaleString()}），是否要恢復？`)) {
            this.ta.value = parsed.content;
            this.setDirty(true);
            this.updateStats();
            this.loadMetaFromContent();
          }
        }
      } catch (e) {}
    }
    Toast.ok('已載入');
  },

  loadMetaFromContent() {
    const c = this.ta.value;
    const get = (re) => { const m = c.match(re); return m ? m[1].trim() : ''; };
    $('#meta-title-zh').value = get(/<title>([^<]*)<\/title>/);
    $('#meta-desc').value = get(/<meta name="description" content="([^"]*)"/);
    $('#meta-keywords').value = get(/<meta name="keywords" content="([^"]*)"/);
    $('#meta-og-image').value = get(/<meta property="og:image" content="([^"]*)"/);
    $('#meta-canonical').value = get(/<link rel="canonical" href="([^"]*)"/);
  },

  applyMetaToContent() {
    let c = this.ta.value;
    const setField = (re, val, replacer) => {
      if (!val) return;
      if (re.test(c)) c = c.replace(re, replacer(val));
    };
    setField(/<title>[^<]*<\/title>/,
             $('#meta-title-zh').value, v => `<title>${v}</title>`);
    setField(/<meta name="description" content="[^"]*"/,
             $('#meta-desc').value, v => `<meta name="description" content="${v.replace(/"/g, '&quot;')}"`);
    setField(/<meta name="keywords" content="[^"]*"/,
             $('#meta-keywords').value, v => `<meta name="keywords" content="${v.replace(/"/g, '&quot;')}"`);
    setField(/<meta property="og:image" content="[^"]*"/,
             $('#meta-og-image').value, v => `<meta property="og:image" content="${v}"`);
    setField(/<link rel="canonical" href="[^"]*"/,
             $('#meta-canonical').value, v => `<link rel="canonical" href="${v}"`);
    this.ta.value = c;
    this.setDirty(true);
    Toast.ok('Metadata 已套用至 HTML');
  },

  async save(commitMsg) {
    if (!this.currentSlug) { Toast.warn('請先選擇文章'); return; }
    if (!GH.token) { Toast.err('未設定 GitHub PAT'); return; }
    this.setSaving(true);
    try {
      const content = this.ta.value;
      const msg = commitMsg || `admin: edit ${this.currentSlug} (${new Date().toLocaleString('zh-TW')})`;
      const result = await GH.putFile(this.currentPath, content, msg, this.currentSha);
      this.currentSha = result.content.sha;
      this.currentContent = content;
      this.setDirty(false);
      // Update last-seen SHA so the behind-main banner doesn't immediately flash
      try { localStorage.setItem(CFG.lastSeenShaKey, result.commit.sha); } catch (e) {}
      // Clear the draft for this slug
      localStorage.removeItem(CFG.draftKeyPrefix + this.currentSlug);
      Toast.ok('已儲存並推送到 GitHub');
    } catch (e) {
      console.error(e);
      Toast.err('儲存失敗：' + e.message);
    } finally {
      this.setSaving(false);
    }
  },
};

/* ──────────────────────────────────────────────
 *  Behind-main warning
 * ────────────────────────────────────────────── */
async function checkBehindMain() {
  if (!GH.token) return;
  try {
    const sha = await GH.getBranchSha(CFG.branch);
    const lastSeen = localStorage.getItem(CFG.lastSeenShaKey);
    if (lastSeen && lastSeen !== sha) {
      $('#ad-banner').classList.add('show');
      $('.ad-main').classList.add('with-banner');
      $('#ad-banner-msg').textContent = `Remote 有新的 commit（${sha.slice(0, 7)}）。建議先「重新載入文章」再編輯，避免覆蓋衝突。`;
    } else if (!lastSeen) {
      localStorage.setItem(CFG.lastSeenShaKey, sha);
    }
  } catch (e) {
    console.warn('checkBehindMain failed', e);
  }
}

/* ──────────────────────────────────────────────
 *  Article list rendering
 * ────────────────────────────────────────────── */
function renderArticleList(filter) {
  const list = $('#ad-list');
  list.innerHTML = '';
  const items = filter
    ? Catalog.all.filter(a => (a.title + ' ' + a.title_en + ' ' + a.tag + ' ' + a.slug).toLowerCase().includes(filter.toLowerCase()))
    : Catalog.all;
  items.forEach(a => {
    const item = el('div', {
      class: 'ad-item' + (Editor.currentSlug === a.slug ? ' active' : ''),
      'data-slug': a.slug,
      onclick: () => Editor.loadArticle(a.slug),
    });
    item.appendChild(el('div', { class: 'ad-item-title' }, a.title || a.slug));
    item.appendChild(el('div', { class: 'ad-item-meta' }, [
      el('span', { class: 'ad-item-status published' }, '已發布'),
      el('span', null, a.date || ''),
    ]));
    list.appendChild(item);
  });
}

/* ──────────────────────────────────────────────
 *  Format toolbar wiring
 * ────────────────────────────────────────────── */
const FormatActions = {
  bold:        () => Editor.wrap('<strong>', '</strong>'),
  italic:      () => Editor.wrap('<em>', '</em>'),
  underline:   () => Editor.wrap('<u>', '</u>'),
  strike:      () => Editor.wrap('<s>', '</s>'),
  h2:          () => Editor.wrap('\n<h2 id="" data-zh="" data-en="">', '</h2>\n'),
  h3:          () => Editor.wrap('\n<h3 data-zh="" data-en="">', '</h3>\n'),
  p:           () => Editor.wrap('\n<p data-zh="" data-en="">', '</p>\n'),
  ul:          () => Editor.wrap('\n<ul>\n  <li data-zh="" data-en=""></li>\n</ul>\n', ''),
  ol:          () => Editor.wrap('\n<ol>\n  <li data-zh="" data-en=""></li>\n</ol>\n', ''),
  hr:          () => Editor.insert('\n<hr style="margin:36px 0;border:0;border-top:1px solid var(--line)" />\n'),
  blockquote:  () => Editor.wrap('\n<blockquote>\n  ', '\n</blockquote>\n'),
  link:        () => {
    const url = prompt('連結 URL：', 'https://');
    if (url) Editor.wrap('<a href="' + url + '">', '</a>');
  },
  color:       (c) => Editor.wrap('<span style="color:' + c + '">', '</span>'),
  fontSize:    () => {
    const sz = prompt('字體大小（px）：', '16');
    if (sz) Editor.wrap('<span style="font-size:' + parseInt(sz, 10) + 'px">', '</span>');
  },
  bilingualP:  () => openBilingualModal(),
  table:       () => openTableModal(),
  citation:    () => openCitationModal(),
  imageUpload: () => $('#ad-img-file').click(),
};

/* ──────────────────────────────────────────────
 *  Bilingual paragraph modal
 * ────────────────────────────────────────────── */
function openBilingualModal() {
  const modal = $('#ad-modal-bilingual');
  $('#bp-zh').value = '';
  $('#bp-en').value = '';
  $('#bp-tag').value = 'p';
  modal.classList.add('show');
  setTimeout(() => $('#bp-zh').focus(), 50);
}
function insertBilingual() {
  const zh = $('#bp-zh').value.trim();
  const en = $('#bp-en').value.trim();
  const tag = $('#bp-tag').value;
  const zhAttr = zh.replace(/"/g, '&quot;');
  const enAttr = en.replace(/"/g, '&quot;');
  const html = `\n<${tag} data-zh="${zhAttr}" data-en="${enAttr}">${zh}</${tag}>\n`;
  Editor.insert(html);
  $('#ad-modal-bilingual').classList.remove('show');
  Toast.ok('雙語段落已插入');
}

/* ──────────────────────────────────────────────
 *  Table generator modal
 * ────────────────────────────────────────────── */
function openTableModal() {
  $('#ad-modal-table').classList.add('show');
}
function insertTable() {
  const rows = parseInt($('#tbl-rows').value, 10) || 3;
  const cols = parseInt($('#tbl-cols').value, 10) || 3;
  const headers = $('#tbl-headers').value.split('|').map(s => s.trim());
  let html = '\n<table class="ted-table">\n  <thead>\n    <tr>\n';
  for (let c = 0; c < cols; c++) {
    const h = headers[c] || `欄 ${c + 1}`;
    html += `      <th data-zh="${h}" data-en="${h}">${h}</th>\n`;
  }
  html += '    </tr>\n  </thead>\n  <tbody>\n';
  for (let r = 0; r < rows; r++) {
    html += '    <tr>\n';
    for (let c = 0; c < cols; c++) {
      html += `      <td data-zh="" data-en=""></td>\n`;
    }
    html += '    </tr>\n';
  }
  html += '  </tbody>\n</table>\n';
  Editor.insert(html);
  $('#ad-modal-table').classList.remove('show');
  Toast.ok('表格已插入');
}

/* ──────────────────────────────────────────────
 *  Citation modal
 * ────────────────────────────────────────────── */
function openCitationModal() {
  $('#ad-modal-citation').classList.add('show');
  $('#cit-tag').value = '';
  $('#cit-authors').value = '';
  $('#cit-title').value = '';
  $('#cit-journal').value = '';
  $('#cit-year').value = '';
  $('#cit-url').value = '';
}
function insertCitation() {
  const tag = $('#cit-tag').value.trim();
  const authors = $('#cit-authors').value.trim();
  const title = $('#cit-title').value.trim();
  const journal = $('#cit-journal').value.trim();
  const year = $('#cit-year').value.trim();
  const url = $('#cit-url').value.trim();
  let html = '<li>';
  if (tag) html += `<strong>[${tag}]</strong> `;
  html += [authors, title, journal ? `<em>${journal}</em>` : '', year]
    .filter(Boolean).join('. ');
  if (url) html += `. <a href="${url}">${url}</a>`;
  html += '.</li>\n';
  Editor.insert(html);
  $('#ad-modal-citation').classList.remove('show');
  Toast.ok('引用文獻已插入');
}

/* ──────────────────────────────────────────────
 *  Image upload handler
 * ────────────────────────────────────────────── */
async function handleImageFiles(files) {
  if (!files || !files.length) return;
  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      Toast.err('不是圖片：' + file.name);
      continue;
    }
    Toast.show('壓縮中：' + file.name);
    try {
      const { blob, width, height, sizeKB } = await ImageOps.toWebP(file);
      const filename = ImageOps.generateName(Editor.currentSlug);
      Toast.show(`上傳中：${filename} (${sizeKB} KB, ${width}×${height})`);
      const url = await ImageOps.upload(blob, filename);
      Editor.insert(`\n<figure class="article-fig" style="margin:20px auto;text-align:center"><img src="${url}" alt="" loading="lazy" style="max-width:100%;height:auto;border-radius:8px" /><figcaption style="margin-top:8px;font-size:13px;color:var(--ink-2)"></figcaption></figure>\n`);
      Toast.ok('已上傳：' + filename);
    } catch (e) {
      console.error(e);
      Toast.err('上傳失敗：' + e.message);
    }
  }
}

/* ──────────────────────────────────────────────
 *  New article wizard
 * ────────────────────────────────────────────── */
function openNewArticleModal() {
  $('#ad-modal-new').classList.add('show');
  $('#new-slug').value = '';
  $('#new-title-zh').value = '';
  $('#new-title-en').value = '';
  $('#new-cat').value = 'rx';
  $('#new-tag').value = '';
  $('#new-tag-en').value = '';
  $('#new-date').value = fmtDate(new Date());
  setTimeout(() => $('#new-title-zh').focus(), 50);
}

async function createNewArticle() {
  const slug = $('#new-slug').value.trim();
  const titleZh = $('#new-title-zh').value.trim();
  const titleEn = $('#new-title-en').value.trim();
  const cat = $('#new-cat').value;
  const tag = $('#new-tag').value.trim();
  const tagEn = $('#new-tag-en').value.trim();
  const date = $('#new-date').value || fmtDate(new Date());

  if (!slug || !titleZh) { Toast.err('Slug 與中文標題必填'); return; }
  if (!/^[a-z0-9-]+$/.test(slug)) { Toast.err('Slug 只能用 a-z 0-9 -'); return; }

  // Build a basic article HTML using the comprehensive-guide template structure
  const html = buildArticleTemplate({ slug, titleZh, titleEn, cat, tag, tagEn, date });

  try {
    const path = `blog/${slug}.html`;
    Toast.show('建立中…');
    await GH.putFile(path, html, `admin: create new article ${slug}`);

    // Also update DN.ARTICLES in blog-shared.js
    await prependArticleToCatalog({ slug, title: titleZh, title_en: titleEn, cat, tag, tag_en: tagEn, date });

    Toast.ok('已建立 ' + slug);
    $('#ad-modal-new').classList.remove('show');
    await Catalog.load();
    renderArticleList();
    Editor.loadArticle(slug);
  } catch (e) {
    console.error(e);
    Toast.err('建立失敗：' + e.message);
  }
}

function buildArticleTemplate({ slug, titleZh, titleEn, cat, tag, tagEn, date }) {
  const titleEnFinal = titleEn || titleZh;
  return `<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<title>${titleZh} | HsiaoEye · 蕭閔謙醫師</title>
<meta name="description" content="${titleZh}" />
<meta name="theme-color" content="#3a5a7c" />
<meta name="keywords" content="${tag},HsiaoEye,蕭閔謙醫師" />
<meta name="author" content="蕭閔謙 醫師 · HsiaoEye" />

<link rel="canonical" href="https://hsiao.chendermatologist.com/blog/${slug}" />
<link rel="alternate" hreflang="x-default" href="https://hsiao.chendermatologist.com/blog/${slug}" />
<link rel="alternate" hreflang="zh-Hant-TW" href="https://hsiao.chendermatologist.com/blog/${slug}" />
<link rel="alternate" hreflang="en" href="https://hsiao.chendermatologist.com/en/blog/${slug}" />

<link rel="icon" type="image/svg+xml" href="/icon.svg" />

<meta property="og:type" content="article" />
<meta property="og:url" content="https://hsiao.chendermatologist.com/blog/${slug}" />
<meta property="og:title" content="${titleZh}" />
<meta property="og:description" content="${titleZh}" />
<meta property="og:image" content="https://hsiao.chendermatologist.com/assets/og/${slug}.png" />
<meta property="og:locale" content="zh_TW" />
<meta property="og:site_name" content="HsiaoEye" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${titleZh}" />
<meta name="twitter:description" content="${titleZh}" />
<meta name="twitter:image" content="https://hsiao.chendermatologist.com/assets/og/${slug}.png" />

<link rel="preload" as="style" href="/assets/app.css?v=20260648" />
<link rel="stylesheet" href="/assets/app.css?v=20260648" />
<link rel="preload" as="style" href="/assets/article.css?v=20260648" />
<link rel="stylesheet" href="/assets/article.css?v=20260648" />
<style>
  :root{ --bg:#faf7f2; --ink:#2a2620; --ink-2:#5e574e; --blue-deep:#3a5a7c; --blue-soft:#d6e4f0; --border:#dcd5c8; --line:#ebe4d8; }
  html,body{ background:var(--bg); color:var(--ink); font-family:Inter,'Noto Sans TC',sans-serif; }
  .blue-text{ background:linear-gradient(180deg,#6b8caf 0%,#243b56 100%); -webkit-background-clip:text; background-clip:text; color:transparent; }
</style>
</head>
<body class="font-sans antialiased text-ink-900">
<a href="#main-content" class="skip-link" style="position:absolute;left:-999px">跳到主內容</a>

<header class="sticky top-0 z-40 backdrop-blur border-b" style="background:rgba(247,245,240,.92); border-color:var(--border)">
  <div class="max-w-6xl mx-auto px-5 sm:px-8">
    <div class="h-16 flex items-center justify-between gap-4">
      <a href="/" class="flex items-center gap-3">
        <img src="/icon.svg" alt="HsiaoEye" class="w-9 h-9 rounded-lg" />
        <div class="leading-tight">
          <div class="font-semibold text-[16px] sm:text-[18px] blue-text">HsiaoEye</div>
          <div class="text-[10.5px] sm:text-[11.5px] mt-0.5" style="color:#8b8378">蕭閔謙醫師 · 眼科衛教筆記</div>
        </div>
      </a>
      <a href="/blog/" class="hidden sm:inline-flex items-center px-3 py-1.5 rounded-full text-[12px] font-semibold" style="color:var(--blue-deep)">← 文章索引</a>
    </div>
  </div>
</header>

<main id="main-content">
<section class="pt-12 sm:pt-14 pb-6">
  <div class="max-w-3xl mx-auto px-5 sm:px-8">
    <nav style="font-size:12.5px;color:#8b8378;margin-bottom:18px">
      <a href="/" style="color:var(--blue-deep);font-weight:600">首頁</a> /
      <a href="/blog/" style="color:var(--blue-deep);font-weight:600">衛教文章</a> /
      <span data-zh="${titleZh}" data-en="${titleEnFinal}">${titleZh}</span>
    </nav>
    <div class="text-[11px] uppercase tracking-[.24em] font-semibold mb-3" style="color:var(--blue-deep)" data-zh="衛教" data-en="Patient Ed">衛教 <span class="ml-3 inline-block px-2 py-0.5 rounded-full text-[10.5px] font-semibold normal-case tracking-normal" style="background:var(--blue-soft);color:var(--blue-deep)" data-zh="更新日期 · ${date}" data-en="Updated · ${date}">更新日期 · ${date}</span></div>
    <h1 class="font-display font-bold leading-[1.18] text-[32px] sm:text-[44px]" style="color:var(--ink)">
      <span data-zh="${titleZh}" data-en="${titleEnFinal}">${titleZh}</span>
    </h1>
    <p class="mt-6 text-[15.5px] leading-[1.95] tldr" style="color:var(--ink-2)" data-zh="（這裡寫文章摘要 / TL;DR）" data-en="(TL;DR summary)">（這裡寫文章摘要 / TL;DR）</p>
    <div class="disclaimer" data-zh="⚠️ <strong>免責聲明</strong>：本文為一般醫學衛教，無法取代您的眼科醫師面對面評估。" data-en="⚠️ <strong>Disclaimer</strong>: General medical education only — does not replace your doctor's evaluation.">⚠️ <strong>免責聲明</strong>：本文為一般醫學衛教，無法取代您的眼科醫師面對面評估。</div>
  </div>
</section>

<article class="max-w-3xl mx-auto px-5 sm:px-8 mb-16">
<div id="proseZh" class="prose">

<h2 id="overview" data-zh="一、概述" data-en="1. Overview">一、概述</h2>

<p data-zh="（從這裡開始寫內容）" data-en="(Start writing content here)">（從這裡開始寫內容）</p>

</div>
</article>

<div id="hs-related" class="max-w-3xl mx-auto px-5 sm:px-8"></div>
<div id="hs-feedback" class="max-w-3xl mx-auto px-5 sm:px-8"></div>
<div id="hs-share" class="max-w-3xl mx-auto px-5 sm:px-8"></div>
<div id="hs-author-bio" class="max-w-3xl mx-auto px-5 sm:px-8"></div>
<div id="hs-support" class="max-w-3xl mx-auto px-5 sm:px-8"></div>

</main>

<footer class="mag-footer cv-auto-short" style="background:var(--ink);color:var(--bg);padding:60px 24px 32px;margin-top:60px;text-align:center">
  <p style="font-size:14px;color:rgba(247,243,236,.78);max-width:60ch;margin:0 auto">本網站所有內容僅作為一般醫學教育與資訊參考。</p>
  <p style="font-size:11px;color:rgba(247,243,236,.55);margin-top:18px">© 2026 HsiaoEye · 蕭閔謙 醫師</p>
</footer>

<script src="/blog/blog-shared.js?v=20260648" defer></script>
<script>document.addEventListener('DOMContentLoaded',function(){if(window.DN)DN.initBlog({slug:'${slug}'});});</script>
</body>
</html>
`;
}

async function prependArticleToCatalog(article) {
  // Re-fetch to get latest sha
  const file = await GH.getFile('blog/blog-shared.js');
  if (!file) throw new Error('blog-shared.js missing');
  const entry = `    { slug:'${article.slug}', title:'${article.title}', title_en:'${article.title_en}', cat:'${article.cat}', tag:'${article.tag}', tag_en:'${article.tag_en}', date:'${article.date}' },\n`;
  // Insert right after `DN.ARTICLES = [` line
  const updated = file.content.replace(/(DN\.ARTICLES\s*=\s*\[\s*\n)/, '$1' + entry);
  if (updated === file.content) throw new Error('Could not find DN.ARTICLES insertion point');
  await GH.putFile('blog/blog-shared.js', updated, `admin: catalog add ${article.slug}`, file.sha);
}

/* ──────────────────────────────────────────────
 *  Tab switching
 * ────────────────────────────────────────────── */
function switchTab(name) {
  $$('.ad-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.ad-tab-panel').forEach(p => p.classList.toggle('active', p.dataset.tab === name));
  if (name === 'preview') refreshPreview();
}

function refreshPreview() {
  const iframe = $('#ad-preview');
  if (!iframe || !Editor.ta) return;
  const blob = new Blob([Editor.ta.value], { type: 'text/html' });
  if (iframe.dataset.url) URL.revokeObjectURL(iframe.dataset.url);
  const url = URL.createObjectURL(blob);
  iframe.src = url;
  iframe.dataset.url = url;
}

/* ──────────────────────────────────────────────
 *  Login flow
 * ────────────────────────────────────────────── */
async function tryLogin(token) {
  try {
    GH.token = token;
    await GH.checkToken();
    GH.save(token);
    return true;
  } catch (e) {
    GH.token = null;
    return false;
  }
}

function showLogin() {
  $('#ad-login').style.display = 'flex';
  $('#ad-app').style.display = 'none';
}
function hideLogin() {
  $('#ad-login').style.display = 'none';
  $('#ad-app').style.display = '';
}

/* ──────────────────────────────────────────────
 *  Boot
 * ────────────────────────────────────────────── */
async function boot() {
  // Wire login
  $('#ad-login-btn').onclick = async () => {
    const t = $('#ad-login-pat').value.trim();
    if (!t) return;
    $('#ad-login-err').classList.remove('show');
    const ok = await tryLogin(t);
    if (ok) { hideLogin(); await initApp(); }
    else { $('#ad-login-err').classList.add('show'); }
  };
  $('#ad-login-pat').onkeydown = (e) => { if (e.key === 'Enter') $('#ad-login-btn').click(); };

  $('#ad-logout').onclick = () => {
    if (Editor.dirty && !confirm('未存檔的編輯會遺失，確定登出？')) return;
    GH.clear();
    location.reload();
  };

  if (GH.load()) {
    try {
      await GH.checkToken();
      hideLogin();
      await initApp();
    } catch (e) {
      // token invalid
      GH.clear();
      showLogin();
    }
  } else {
    showLogin();
  }
}

async function initApp() {
  // Wire global UI
  Editor.ta = $('#ad-ta');
  Editor.ta.addEventListener('input', () => {
    Editor.setDirty(true);
    Editor.updateStats();
  });

  // Tabs
  $$('.ad-tab').forEach(t => t.onclick = () => switchTab(t.dataset.tab));

  // Format toolbar
  $$('[data-fmt]').forEach(b => {
    b.onclick = () => {
      const a = b.dataset.fmt;
      if (a === 'color') {
        FormatActions.color($('#ad-color').value);
      } else if (FormatActions[a]) {
        FormatActions[a]();
      }
    };
  });
  $('#ad-color').onchange = (e) => FormatActions.color(e.target.value);

  // Image upload
  $('#ad-img-file').onchange = (e) => {
    handleImageFiles(e.target.files);
    e.target.value = '';
  };

  // Search
  $('#ad-search-input').oninput = debounce((e) => renderArticleList(e.target.value), 200);

  // New article
  $('#ad-new-btn').onclick = openNewArticleModal;
  $('#new-create-btn').onclick = createNewArticle;
  $('#new-cancel-btn').onclick = () => $('#ad-modal-new').classList.remove('show');

  // Bilingual modal
  $('#bp-insert-btn').onclick = insertBilingual;
  $('#bp-cancel-btn').onclick = () => $('#ad-modal-bilingual').classList.remove('show');

  // Table modal
  $('#tbl-insert-btn').onclick = insertTable;
  $('#tbl-cancel-btn').onclick = () => $('#ad-modal-table').classList.remove('show');

  // Citation modal
  $('#cit-insert-btn').onclick = insertCitation;
  $('#cit-cancel-btn').onclick = () => $('#ad-modal-citation').classList.remove('show');

  // Save
  $('#ad-save-btn').onclick = () => Editor.save();
  $('#ad-meta-apply-btn').onclick = () => Editor.applyMetaToContent();

  // Reload article (fetch from remote)
  $('#ad-reload-btn').onclick = async () => {
    if (!Editor.currentSlug) return;
    if (Editor.dirty && !confirm('未存檔的編輯會遺失，確定重新載入？')) return;
    await Editor.loadArticle(Editor.currentSlug);
  };

  // Pull-latest banner action
  $('#ad-banner-reload').onclick = async () => {
    try {
      const sha = await GH.getBranchSha(CFG.branch);
      localStorage.setItem(CFG.lastSeenShaKey, sha);
      $('#ad-banner').classList.remove('show');
      $('.ad-main').classList.remove('with-banner');
      if (Editor.currentSlug) await Editor.loadArticle(Editor.currentSlug);
      Toast.ok('已同步最新 main');
    } catch (e) { Toast.err('同步失敗：' + e.message); }
  };

  // Mobile drawers: hamburger (sidebar / article list) and tools button
  const sidebar = $('.ad-sidebar');
  const toolsPanel = $('.ad-tools');
  const backdrop = $('#ad-backdrop');
  function closeMobileDrawers() {
    if (sidebar) sidebar.classList.remove('mobile-open');
    if (toolsPanel) toolsPanel.classList.remove('mobile-open');
    if (backdrop) backdrop.classList.remove('show');
  }
  const menuBtn = $('#ad-menu-btn');
  const toolsBtn = $('#ad-tools-btn');
  if (menuBtn) menuBtn.onclick = () => {
    const isOpen = sidebar.classList.contains('mobile-open');
    closeMobileDrawers();
    if (!isOpen) {
      sidebar.classList.add('mobile-open');
      backdrop.classList.add('show');
    }
  };
  if (toolsBtn) toolsBtn.onclick = () => {
    const isOpen = toolsPanel.classList.contains('mobile-open');
    closeMobileDrawers();
    if (!isOpen) {
      toolsPanel.classList.add('mobile-open');
      backdrop.classList.add('show');
    }
  };
  if (backdrop) backdrop.onclick = closeMobileDrawers;
  // close drawers when an article is picked on mobile
  if (sidebar) sidebar.addEventListener('click', (e) => {
    if (window.innerWidth <= 760 && e.target.closest('.ad-list-item')) {
      closeMobileDrawers();
    }
  });
  // escape closes drawers
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMobileDrawers();
  });

  // beforeunload guard
  window.addEventListener('beforeunload', (e) => {
    if (Editor.dirty) {
      e.preventDefault();
      e.returnValue = '尚有未儲存的編輯';
      return '尚有未儲存的編輯';
    }
  });

  // Autosave to localStorage every 30s
  setInterval(() => {
    if (Editor.dirty && Editor.currentSlug) {
      try {
        localStorage.setItem(CFG.draftKeyPrefix + Editor.currentSlug, JSON.stringify({
          content: Editor.ta.value,
          ts: Date.now(),
        }));
      } catch (e) {}
    }
  }, 30000);

  // Drag-drop image onto editor
  const editor = $('#ad-editor');
  editor.addEventListener('dragover', (e) => { e.preventDefault(); editor.classList.add('dragover'); });
  editor.addEventListener('dragleave', () => editor.classList.remove('dragover'));
  editor.addEventListener('drop', (e) => {
    e.preventDefault();
    editor.classList.remove('dragover');
    if (e.dataTransfer && e.dataTransfer.files) handleImageFiles(e.dataTransfer.files);
  });

  // Cmd/Ctrl+S to save
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      Editor.save();
    }
  });

  // Load catalog
  try {
    await Catalog.load();
    renderArticleList();
  } catch (e) {
    Toast.err('載入文章列表失敗：' + e.message);
  }

  // Behind-main check
  await checkBehindMain();
  setInterval(checkBehindMain, 5 * 60 * 1000);

  Toast.ok('後台已就緒');
}

document.addEventListener('DOMContentLoaded', boot);
})();
