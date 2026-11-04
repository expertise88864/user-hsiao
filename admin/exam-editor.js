/* 考試內容 editor for /admin: chapter study notes (data/exam/notes/bcsc<key>.htm)
 * and one question's explanation (data/exam/explanations.json) at a time.
 * Saves go to the cloud draft branch cms-exam/drafts through /api/admin/exam-draft
 * only; nothing here edits main or publishes. Everything from the API is rendered
 * as text (no innerHTML), and the live note preview is a script-less sandboxed
 * iframe. The overlay is self-contained and never touches the article editor. */
(function () {
  'use strict';
  const panel = document.getElementById('tab-exam');
  const host = document.getElementById('examList');
  const dashboard = document.getElementById('dashboard');
  if (!panel || !host || !dashboard) return;
  const API = '/api/admin/exam-draft';
  const SAVED = '已存入雲端草稿（cms-exam/drafts），尚未上線。上線需由維護者整合、重新產生頁面、通過 CI 與 PR 審查後才會發佈。';
  const QID = /^[1-9]\d{0,4}$/;
  const MESSAGES = {
    login_required: '登入已失效，請重新登入後台；畫面上的文字已保留。',
    conflict: '版本衝突：雲端草稿或正式版在你載入後已變更。請按「重新載入」取得最新版；你目前的文字仍保留在輸入框，並已備份在這個瀏覽器。',
    same_origin_required: '請求被拒絕（需同源），請重新整理後台頁面再試。',
    too_large: '內容太大，超過上限（單次 1 MB，重點 600 KB）。',
    invalid_request: '請求格式不正確，請重新整理後台頁面再試；畫面上的文字已保留。',
    json_required: '請求格式不正確，請重新整理後台頁面再試；畫面上的文字已保留。',
    unknown_note: '找不到這一章的重點檔。',
    unknown_question: '找不到這個題號的詳解。',
    invalid_id: '題號需為數字，例如 128。',
    invalid_chapter: '章節代號不正確。',
    invalid_revision: '版本資訊不正確，請按「重新載入」。',
    invalid_draft_record: '雲端草稿紀錄異常，已停止寫入；請聯絡維護者檢查 cms-exam/drafts 分支。',
    invalid_repository_ref: '雲端資料異常，已停止；請聯絡維護者。',
    invalid_repository_content: '雲端資料異常，已停止；請聯絡維護者。',
    format_mismatch: '詳解檔格式與產生器預期不符，為避免破壞資料已停止寫入（未存檔）；請聯絡維護者。',
    save_not_verified: '雲端未能核對剛才的存檔，請按「重新載入」確認結果後再決定是否重存。',
    github_not_configured: '伺服器尚未設定 GitHub 連線（GITHUB_TOKEN），請聯絡維護者。',
    github_token_invalid: '伺服器的 GitHub token 無效或已過期，請聯絡維護者更新；畫面上的文字已保留。',
    github_forbidden: 'GitHub 拒絕存取：伺服器 token 權限不足（需要 Contents 讀寫）；畫面上的文字已保留。',
    github_rate_limited: 'GitHub API 使用量已達上限，請稍後再試；畫面上的文字已保留。',
    github_timeout: '連線 GitHub 逾時，請稍後再試；畫面上的文字已保留。',
    github_fetch_failed: '暫時無法連線 GitHub，請稍後再試；畫面上的文字已保留。',
    draft_unavailable: '暫時無法連線，請稍後再試；畫面上的文字已保留。',
  };
  function describe(error) {
    const code = error && error.code;
    if (code === 'invalid_note') return '重點內容被拒絕：' + (error.reason || '格式不符');
    if (code === 'invalid_entry') return '詳解內容被拒絕：' + (error.reason || '格式不符');
    if (code === 'too_large' && error.reason) return '內容太大：' + error.reason;
    if (code && Object.prototype.hasOwnProperty.call(MESSAGES, code)) return MESSAGES[code];
    return '操作未完成（' + (code || 'request_failed') + '）；畫面上的文字已保留。';
  }

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs || {})) {
      if (name === 'text') node.textContent = value;
      else if (name === 'class') node.className = value;
      else if (value === true) node.setAttribute(name, '');
      else if (value !== false && value != null) node.setAttribute(name, String(value));
    }
    node.append(...children);
    return node;
  }
  async function api(query, options) {
    let response;
    try {
      response = await fetch(API + query, Object.assign({ credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'application/json' } }, options || {}));
    } catch (_) {
      const failure = new Error('network'); failure.code = 'draft_unavailable'; throw failure;
    }
    let data = null;
    try { data = await response.json(); } catch (_) { data = null; }
    if (!response.ok || !data || data.ok !== true) {
      const failure = new Error('exam-draft request failed');
      failure.code = data && typeof data.error === 'string' ? data.error : 'request_failed';
      failure.reason = data && typeof data.reason === 'string' ? data.reason : '';
      throw failure;
    }
    return data;
  }
  function post(body) {
    return api('', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  const signedIn = () => !dashboard.hidden;

  // ------------------------------------------------------------ local backup
  const backupKey = (kind, key) => 'hs-exam-draft-backup:' + kind + ':' + key;
  function stash(kind, key, value) {
    try { localStorage.setItem(backupKey(kind, key), JSON.stringify({ value, at: Date.now() })); } catch (_) { /* best effort */ }
  }
  function stashed(kind, key) {
    try { const item = JSON.parse(localStorage.getItem(backupKey(kind, key))); return item && item.value !== undefined ? item.value : null; }
    catch (_) { return null; }
  }
  function unstash(kind, key) { try { localStorage.removeItem(backupKey(kind, key)); } catch (_) { /* ignore */ } }

  // ------------------------------------------------------------ panel
  const model = { notes: [], draft: { exists: false, notes: [], explanations: [], updated: null }, error: '', loaded: false };
  const filter = document.getElementById('examFilter');
  const summary = document.getElementById('examDraftSummary');
  const openId = document.getElementById('examExplOpenId');
  const openButton = document.getElementById('examExplOpen');
  const refresh = document.getElementById('examRefresh');
  let generation = 0, loading = false;
  const label = item => 'Ch.' + item.key.split('-')[1] + (item.title ? ' ' + item.title : '') + (item.zh ? '（' + item.zh + '）' : '');
  function row(text, drafted, attrs, action) {
    const node = el('button', Object.assign({ type: 'button', class: 'exam-item' }, attrs), el('span', { class: 'exam-item-name', text }));
    if (drafted) node.append(el('span', { class: 'exam-draft-mark', text: '雲端草稿' }));
    node.addEventListener('click', () => action(node));
    return node;
  }
  function render() {
    if (!signedIn()) { host.replaceChildren(); if (summary) summary.replaceChildren(); return; }
    if (model.error) {
      const retry = el('button', { type: 'button', class: 'btn', id: 'examRetry', text: '重試' });
      retry.addEventListener('click', () => load(true));
      host.replaceChildren(el('p', { class: 'exam-note', role: 'status', text: model.error }), retry);
      return;
    }
    if (!model.loaded) { host.replaceChildren(el('div', { class: 'loading', text: '載入章節清單⋯' })); return; }
    if (summary) {
      const kids = [el('strong', { text: model.draft.exists ? '雲端草稿：' : '目前沒有雲端草稿。' })];
      if (model.draft.exists) {
        kids.push(el('span', { text: '重點 ' + model.draft.notes.length + ' 章、詳解 ' + model.draft.explanations.length + ' 題（尚未上線）。' }));
        for (const id of model.draft.explanations) {
          kids.push(row('第 ' + id + ' 題詳解', true, { 'data-exam-expl': id, class: 'exam-item exam-chip' }, node => openExplanation(id, node)));
        }
      }
      summary.replaceChildren(...kids);
    }
    const words = (filter && filter.value || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    const marked = new Set(model.draft.notes);
    const groups = new Map();
    for (const item of model.notes) {
      const text = (item.key + ' ' + (item.book || '') + ' ' + (item.title || '') + ' ' + (item.zh || '')).toLowerCase();
      if (words.some(word => !text.includes(word))) continue;
      const book = item.key.split('-')[0];
      if (!groups.has(book)) groups.set(book, { title: item.book || '', rows: [] });
      groups.get(book).rows.push(row(label(item), marked.has(item.key), { 'data-exam-note': item.key, title: item.title || '' },
        node => openNote(item.key, node)));
    }
    const kids = [];
    for (const [book, group] of groups) {
      kids.push(el('section', { class: 'exam-book' },
        el('h3', { class: 'exam-group-title', text: 'BCSC ' + book + (group.title ? ' · ' + group.title : '') }),
        el('div', { class: 'exam-rows' }, ...group.rows)));
    }
    if (!kids.length) kids.push(el('p', { class: 'exam-note', text: '沒有符合篩選的章節。' }));
    host.replaceChildren(...kids);
  }
  async function load(force) {
    if (!signedIn()) { generation++; model.loaded = false; model.notes = []; render(); return; }
    if (loading || (!force && model.loaded)) return;
    const mine = ++generation;
    loading = true; model.error = ''; render();
    try {
      const data = await api('?mode=list');
      if (mine !== generation) return;
      model.notes = Array.isArray(data.notes) ? data.notes : []; model.draft = data.draft; model.loaded = true;
    } catch (error) {
      if (mine !== generation) return;
      model.error = '考試內容清單暫時無法讀取：' + describe(error);
      model.loaded = false;
    } finally { if (mine === generation) loading = false; }
    render();
  }
  function updateDraft(draft) {
    if (draft && Array.isArray(draft.notes) && Array.isArray(draft.explanations)) { model.draft = draft; render(); }
  }

  // ------------------------------------------------------------ overlay
  let overlay = null, mode = null, returnFocus = null, returnSelector = '', busy = false;
  // Editor session token: bumped on every open, close and load. A response that
  // arrives after the dialog was closed, reopened or reloaded belongs to an old
  // session and must not touch the current form (or mark it clean).
  let epoch = 0;
  const note = { key: null, base: '', blobSha: null, source: '', loaded: false };
  const expl = { id: null, blobSha: null, snapshot: '', source: '', fields: null, loaded: false };

  function buildOverlay() {
    const title = el('h2', { id: 'examDialogTitle', text: '' });
    const close = el('button', { type: 'button', id: 'examClose', class: 'exam-btn', text: '關閉' });
    const status = el('p', { id: 'examStatus', class: 'exam-status', role: 'status', 'aria-live': 'polite' });
    const save = el('button', { type: 'button', id: 'examSave', class: 'exam-btn exam-primary', text: '存成雲端草稿' });
    const reload = el('button', { type: 'button', id: 'examReload', class: 'exam-btn', text: '重新載入' });
    const restore = el('button', { type: 'button', id: 'examRestore', class: 'exam-btn', hidden: true, text: '還原本機備份' });
    const source = el('textarea', { id: 'examNoteSource', class: 'exam-source', spellcheck: 'false', wrap: 'off' });
    const preview = el('iframe', { id: 'examPreview', class: 'exam-preview', title: '課本重點預覽' });
    preview.setAttribute('sandbox', '');
    const notePanel = el('div', { class: 'exam-panel exam-note-panel', id: 'examNotePanel', hidden: true },
      el('div', { class: 'exam-pane' },
        el('label', { class: 'exam-label', for: 'examNoteSource', text: '原始碼（僅限考試區允許的標籤與 class；題號標記寫成 {{q:題號}}）' }), source),
      el('div', { class: 'exam-pane' }, el('span', { class: 'exam-label', text: '預覽（套用考試區樣式，不執行任何腳本）' }), preview));
    const explId = el('input', { id: 'examExplId', class: 'exam-input', type: 'text', inputmode: 'numeric', placeholder: '128', autocomplete: 'off', maxlength: '5' });
    const explLoad = el('button', { type: 'button', id: 'examExplLoad', class: 'exam-btn', text: '載入' });
    const form = el('div', { id: 'examExplForm', class: 'exam-form' });
    const explPanel = el('div', { class: 'exam-panel exam-expl-panel', id: 'examExplPanel', hidden: true },
      el('div', { class: 'exam-idrow' }, el('label', { class: 'exam-label', for: 'examExplId', text: '題號' }), explId, explLoad),
      el('p', { class: 'exam-hint', text: '只能修改既有題目的詳解，四個選項中必須剛好有一個是正確答案。摘要、標籤與說明不可換行。參考頁碼格式為「冊:頁碼」，範圍用 276-277，多筆以分號分隔，例如 1:276; 9:303-304。' }),
      form);
    const dialog = el('div', { class: 'exam-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'examDialogTitle', tabindex: '-1' },
      el('header', { class: 'exam-dialog-head' }, title, close),
      el('div', { class: 'exam-dialog-body' }, notePanel, explPanel),
      el('footer', { class: 'exam-dialog-foot' }, status, el('div', { class: 'exam-actions' }, restore, reload, save)));
    const root = el('div', { class: 'exam-overlay', id: 'examOverlay', hidden: true }, dialog);
    document.body.append(root);
    close.addEventListener('click', requestClose);
    save.addEventListener('click', () => (mode === 'note' ? saveNote() : saveExplanation()));
    reload.addEventListener('click', () => (mode === 'note' ? reloadNote() : reloadExplanation()));
    restore.addEventListener('click', () => (mode === 'note' ? restoreNote() : restoreExplanation()));
    explLoad.addEventListener('click', () => loadExplanation(explId.value.trim(), true));
    explId.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); loadExplanation(explId.value.trim(), true); } });
    let timer = 0;
    source.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(renderPreview, 300); });
    root.addEventListener('keydown', trapTab);
    return { root, dialog, title, status, save, reload, restore, source, preview, notePanel, explPanel, explId, explLoad, form };
  }
  // The page shows {{q:N}} as superscript question labels (expand_hits); the preview does the same.
  function previewMarkup(source) {
    return source.replace(/\{\{q:([0-9,\s]+)\}\}/g, (_, list) =>
      '<sup class="ex-qref">' + list.split(',').map(n => n.trim()).filter(Boolean).map(n => '<span>Q' + n + '</span>').join(' ') + '</sup>');
  }
  function renderPreview() {
    if (!overlay) return;
    overlay.preview.srcdoc = '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="/admin/exam-preview.css"></head><body><main class="ex-main"><div class="ex-note">' +
      previewMarkup(overlay.source.value) + '</div></main></body></html>';
  }
  function setStatus(text, kind) {
    overlay.status.textContent = text || '';
    overlay.status.className = 'exam-status' + (kind ? ' exam-' + kind : '');
  }
  const isLoaded = () => (mode === 'note' ? note.loaded : expl.loaded);
  function setBusy(value) {
    busy = value;
    overlay.save.disabled = value || !isLoaded() || !signedIn();
    overlay.reload.disabled = value;
    overlay.explLoad.disabled = value;
  }
  function dirty() {
    if (!overlay || overlay.root.hidden) return false;
    if (mode === 'note') return note.loaded && overlay.source.value !== note.base;
    return expl.loaded && rawState() !== expl.snapshot;
  }
  function openOverlay(kind, titleText, trigger) {
    overlay = overlay || buildOverlay();
    mode = kind;
    returnFocus = trigger || document.activeElement;
    const data = returnFocus && returnFocus.dataset ? returnFocus.dataset : {};
    returnSelector = data.examNote ? '[data-exam-note="' + data.examNote + '"]' : data.examExpl ? '[data-exam-expl="' + data.examExpl + '"]' : '';
    overlay.title.textContent = titleText;
    overlay.notePanel.hidden = kind !== 'note';
    overlay.explPanel.hidden = kind !== 'expl';
    overlay.restore.hidden = true;
    overlay.root.hidden = false;
    dashboard.inert = true;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey, true);
    epoch++;
    setStatus('');
    setBusy(false);
  }
  function closeOverlay() {
    overlay.root.hidden = true;
    dashboard.inert = false;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey, true);
    epoch++; busy = false;
    note.loaded = false; expl.loaded = false;
    overlay.preview.srcdoc = '';
    const target = returnFocus && document.contains(returnFocus) ? returnFocus : returnSelector ? panel.querySelector(returnSelector) : null;
    if (target && typeof target.focus === 'function') target.focus();
    returnFocus = null; returnSelector = '';
  }
  function requestClose() {
    if (dirty() && !window.confirm('有尚未存成雲端草稿的修改，確定要關閉嗎？（關閉後這些修改會遺失）')) return false;
    closeOverlay();
    return true;
  }
  function onKey(event) {
    if (!overlay || overlay.root.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); requestClose(); return; }
    // While the dialog is open, Ctrl/Cmd+S belongs to it (a no-op while a save runs).
    if ((event.ctrlKey || event.metaKey) && typeof event.key === 'string' && event.key.toLowerCase() === 's') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!busy) (mode === 'note' ? saveNote() : saveExplanation());
    }
  }
  function trapTab(event) {
    if (event.key !== 'Tab') return;
    const nodes = Array.from(overlay.dialog.querySelectorAll('button, textarea, input, [tabindex]:not([tabindex="-1"])'))
      .filter(node => !node.disabled && !node.closest('[hidden]'));
    if (!nodes.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === overlay.dialog)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  const sourceName = source => (source === 'draft' ? '雲端草稿' : '正式版 main');

  // ------------------------------------------------------------ note editor
  async function openNote(key, trigger) {
    const item = model.notes.find(row => row.key === key);
    openOverlay('note', '課本重點 · BCSC ' + key.split('-')[0] + ' ' + (item ? label(item) : 'Ch.' + key.split('-')[1]), trigger);
    note.key = key; note.loaded = false;
    overlay.source.value = ''; overlay.source.disabled = true; renderPreview();
    const outcome = await fetchNote();
    if (outcome === 'stale') return;
    if (note.loaded) overlay.source.focus(); else overlay.dialog.focus();
  }
  // Resolves 'applied', 'failed' or 'stale' (the session changed while waiting).
  async function fetchNote() {
    const key = note.key, mine = ++epoch;
    setBusy(true); setStatus('載入中⋯');
    try {
      const data = await api('?kind=note&key=' + encodeURIComponent(key));
      if (mine !== epoch) return 'stale';
      note.base = data.content; note.blobSha = data.blobSha; note.source = data.source; note.loaded = true;
      overlay.source.disabled = false; overlay.source.value = data.content; renderPreview();
      const backup = stashed('note', key);
      overlay.restore.hidden = !(typeof backup === 'string' && backup !== data.content);
      setStatus('已載入（來源：' + sourceName(data.source) + '）。' + (overlay.restore.hidden ? '' : '偵測到先前未存成功的本機備份，可按「還原本機備份」。'));
      setBusy(false);
      return 'applied';
    } catch (error) {
      if (mine !== epoch) return 'stale';
      setStatus(describe(error), 'err');
    }
    setBusy(false);
    return 'failed';
  }
  async function reloadNote() {
    if (dirty() && !window.confirm('重新載入會捨棄目前輸入框的修改（已備份在這個瀏覽器，可按「還原本機備份」取回）。確定嗎？')) return;
    if (dirty()) stash('note', note.key, overlay.source.value);
    await fetchNote();
  }
  function restoreNote() {
    const backup = stashed('note', note.key);
    if (typeof backup !== 'string') return;
    overlay.source.value = backup; renderPreview(); overlay.restore.hidden = true;
    setStatus('已還原本機備份；確認後按「存成雲端草稿」。');
  }
  async function saveNote() {
    if (busy || !note.loaded) return;
    if (!signedIn()) { setStatus(MESSAGES.login_required, 'err'); return; }
    const content = overlay.source.value, key = note.key, mine = epoch;
    setBusy(true); setStatus('正在存入雲端草稿並核對⋯');
    try {
      const result = await post({ kind: 'note', key, content, baseBlobSha: note.blobSha });
      if (mine !== epoch) { unstash('note', key); updateDraft(result.draft); return; }
      note.blobSha = result.blobSha; note.base = content; note.source = 'draft';
      unstash('note', key); overlay.restore.hidden = true;
      updateDraft(result.draft);
      setStatus(SAVED, 'ok');
    } catch (error) {
      stash('note', key, content);
      if (mine !== epoch) return;
      setStatus(describe(error), 'err');
    }
    setBusy(false);
  }

  // ------------------------------------------------------------ explanation editor
  const formatRefs = refs => refs.map(ref => ref[0] + ':' + ref[1]).join('; ');
  function parseRefs(text) {
    return text.split(/[;；]/).map(part => part.trim()).filter(Boolean).map(part => {
      const match = /^(\d{1,2})\s*[:：]\s*(\d{1,4})(?:\s*[-–~]\s*(\d{1,4}))?$/.exec(part);
      if (!match) throw new Error('參考頁碼格式應為「冊:頁碼」，多筆以分號分隔，例如 1:276; 9:303-304');
      return [Number(match[1]), match[3] ? match[2] + '–' + match[3] : match[2]];
    });
  }
  let fieldCount = 0;
  function field(labelText, control, hint) {
    const id = control.id || ('examField' + (++fieldCount));
    control.id = id;
    return el('div', { class: 'exam-field' }, el('label', { class: 'exam-label', for: id, text: labelText }), control,
      hint ? el('span', { class: 'exam-hint', text: hint }) : '');
  }
  function buildExplForm(entry, question) {
    const fields = { summary: el('textarea', { class: 'exam-input exam-area', rows: '2' }), items: [],
      flags: el('textarea', { class: 'exam-input exam-area', rows: '3' }) };
    fields.summary.value = entry.summary;
    fields.flags.value = (entry.flags || []).join('\n');
    const kids = [];
    if (question) {
      kids.push(el('div', { class: 'exam-question' }, el('p', { class: 'exam-label', text: '題目（唯讀）' }),
        el('p', { class: 'exam-stem', text: question.stem })));
    }
    kids.push(field('摘要（summary）', fields.summary));
    entry.items.forEach(item => {
      const parts = { key: item.key, label: el('input', { class: 'exam-input', type: 'text', maxlength: '40' }),
        answer: el('input', { type: 'radio', name: 'examAnswer', value: item.key, id: 'examAnswer' + item.key }),
        text: el('textarea', { class: 'exam-input exam-area', rows: '3' }),
        refs: el('input', { class: 'exam-input', type: 'text', placeholder: '1:276; 9:303-304' }) };
      parts.label.value = item.label; parts.answer.checked = item.answer === true; parts.text.value = item.text; parts.refs.value = formatRefs(item.refs);
      fields.items.push(parts);
      const option = question && question.options && typeof question.options[item.key] === 'string' ? '：' + question.options[item.key] : '';
      kids.push(el('fieldset', { class: 'exam-item-set' }, el('legend', { text: '選項 ' + item.key + option }),
        el('div', { class: 'exam-field exam-check' }, parts.answer, el('label', { for: parts.answer.id, text: '這是正確答案' })),
        field('判定（label，例如「敘述正確」「錯誤」）', parts.label),
        field('說明（text）', parts.text),
        field('參考頁碼（refs）', parts.refs)));
    });
    kids.push(field('附註（flags，每行一則，可留空）', fields.flags));
    overlay.form.replaceChildren(...kids);
    return fields;
  }
  function rawOf(fields) {
    return { summary: fields.summary.value, flags: fields.flags.value,
      items: fields.items.map(item => ({ key: item.key, label: item.label.value, answer: item.answer.checked, text: item.text.value, refs: item.refs.value })) };
  }
  function rawState() { return expl.fields ? JSON.stringify(rawOf(expl.fields)) : ''; }
  function entryFromForm() {
    const raw = rawOf(expl.fields);
    const summaryText = raw.summary.trim();
    if (!summaryText) throw new Error('摘要不可空白。');
    if (/[\r\n]/.test(summaryText)) throw new Error('摘要不可換行，請寫成同一行。');
    const chosen = raw.items.filter(item => item.answer);
    if (chosen.length !== 1) throw new Error('請選定剛好一個正確答案。');
    const items = raw.items.map(item => {
      const labelText = item.label.trim(), body = item.text.trim();
      if (!labelText || !body) throw new Error('選項 ' + item.key + ' 的判定與說明不可空白。');
      if (/[\r\n]/.test(labelText + body)) throw new Error('選項 ' + item.key + ' 的判定與說明不可換行，請寫成同一行。');
      let refs;
      try { refs = parseRefs(item.refs); } catch (error) { throw new Error('選項 ' + item.key + '：' + error.message); }
      return { key: item.key, answer: item.answer, label: labelText, text: body, refs };
    });
    const flags = raw.flags.split('\n').map(line => line.trim()).filter(Boolean);
    return { answer: chosen[0].key, summary: summaryText, flags, items };
  }
  function openExplanation(id, trigger) {
    openOverlay('expl', '題目詳解', trigger);
    expl.loaded = false; expl.fields = null; expl.id = null;
    overlay.form.replaceChildren();
    overlay.explId.value = id || '';
    setStatus(id ? '' : '輸入題號後按「載入」。');
    if (id) loadExplanation(id, false); else overlay.explId.focus();
  }
  async function loadExplanation(id, confirmDiscard) {
    if (busy) return;
    if (!QID.test(id)) { setStatus(MESSAGES.invalid_id, 'err'); return; }
    if (confirmDiscard && dirty() && !window.confirm('載入其他題目會捨棄目前的修改（已備份在這個瀏覽器）。確定嗎？')) return;
    if (dirty()) stash('expl', expl.id, rawOf(expl.fields));
    const mine = ++epoch;
    expl.loaded = false;
    setBusy(true); setStatus('載入中⋯');
    try {
      const data = await api('?kind=expl&id=' + encodeURIComponent(id));
      if (mine !== epoch) return;
      expl.id = id; expl.blobSha = data.blobSha; expl.source = data.source;
      expl.fields = buildExplForm(data.entry, data.question); expl.snapshot = rawState(); expl.loaded = true;
      overlay.explId.value = id;
      overlay.title.textContent = '題目詳解 · 第 ' + id + ' 題';
      const backup = stashed('expl', id);
      overlay.restore.hidden = !(backup && typeof backup === 'object' && JSON.stringify(backup) !== expl.snapshot);
      setStatus('已載入第 ' + id + ' 題（來源：' + sourceName(data.source) + '）。' + (overlay.restore.hidden ? '' : '偵測到先前未存成功的本機備份，可按「還原本機備份」。'));
    } catch (error) {
      if (mine !== epoch) return;
      overlay.form.replaceChildren(); expl.fields = null; overlay.restore.hidden = true;
      setStatus(describe(error), 'err');
    }
    setBusy(false);
  }
  async function reloadExplanation() {
    if (!expl.id) { setStatus('請先輸入題號並載入。'); return; }
    if (dirty() && !window.confirm('重新載入會捨棄目前表單的修改（已備份在這個瀏覽器，可按「還原本機備份」取回）。確定嗎？')) return;
    await loadExplanation(expl.id, false);
  }
  function restoreExplanation() {
    const backup = stashed('expl', expl.id);
    if (!backup || typeof backup !== 'object' || !expl.fields || !Array.isArray(backup.items)) return;
    const fields = expl.fields;
    fields.summary.value = String(backup.summary || ''); fields.flags.value = String(backup.flags || '');
    fields.items.forEach(item => {
      const saved = backup.items.find(candidate => candidate && candidate.key === item.key);
      if (!saved) return;
      item.label.value = String(saved.label || ''); item.answer.checked = saved.answer === true;
      item.text.value = String(saved.text || ''); item.refs.value = String(saved.refs || '');
    });
    overlay.restore.hidden = true;
    setStatus('已還原本機備份；確認後按「存成雲端草稿」。');
  }
  async function saveExplanation() {
    if (busy || !expl.loaded) return;
    if (!signedIn()) { setStatus(MESSAGES.login_required, 'err'); return; }
    let entry;
    try { entry = entryFromForm(); } catch (error) { setStatus(error.message, 'err'); return; }
    const id = expl.id, snapshot = rawState(), raw = rawOf(expl.fields), mine = epoch;
    setBusy(true); setStatus('正在存入雲端草稿並核對⋯');
    try {
      const result = await post({ kind: 'expl', id, entry, baseBlobSha: expl.blobSha });
      if (mine !== epoch) { unstash('expl', id); updateDraft(result.draft); return; }
      expl.blobSha = result.blobSha; expl.source = 'draft'; expl.snapshot = snapshot;
      unstash('expl', id); overlay.restore.hidden = true;
      updateDraft(result.draft);
      setStatus(SAVED, 'ok');
    } catch (error) {
      stash('expl', id, raw);
      if (mine !== epoch) return;
      setStatus(describe(error), 'err');
    }
    setBusy(false);
  }

  // ------------------------------------------------------------ wiring
  document.addEventListener('click', event => {
    if (event.target.closest('.tabs button[data-tab="exam"]')) load(false);
  });
  if (refresh) refresh.addEventListener('click', () => load(true));
  if (filter) filter.addEventListener('input', render);
  if (openButton && openId) {
    const open = () => {
      const id = openId.value.trim();
      if (!QID.test(id)) { openId.setCustomValidity(MESSAGES.invalid_id); openId.reportValidity(); return; }
      openId.setCustomValidity('');
      openExplanation(id, openButton);
    };
    openButton.addEventListener('click', open);
    openId.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); open(); } });
    openId.addEventListener('input', () => openId.setCustomValidity(''));
  }
  // Logging out (or an expired session sending the page back to the login screen)
  // hides the dashboard: forget the list, and keep an open editor's text but block saving.
  new MutationObserver(() => {
    if (signedIn()) { if (panel.classList.contains('active')) load(false); return; }
    generation++; loading = false; model.loaded = false; model.notes = []; model.error = ''; render();
    if (overlay && !overlay.root.hidden) {
      setStatus('登入狀態已變更；畫面上的文字已保留，請重新登入後再存。', 'err');
      overlay.save.disabled = true;
    }
  }).observe(dashboard, { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('beforeunload', event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });
  if (signedIn() && panel.classList.contains('active')) load(false);
})();
