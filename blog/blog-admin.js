/* ============================================================
 * HsiaoEye — admin mode (lazy-loaded by blog-shared.js when ?admin=1)
 *
 * Extracted from blog-shared.js (v37.8) to keep the critical-path bundle
 * lean for regular readers. This file is only fetched when the URL
 * contains ?admin=1, which is the gate DN.isAdminMode() checks.
 *
 * Architecture:
 *   - blog-shared.js: tiny DN.initAdminMode() loader, dynamic imports this
 *   - This file: original 500-line implementation, wrapped as IIFE
 *
 * Trusted Types: scriptURL allow-list in hs-policy permits same-origin
 * /blog/* paths, so the dynamic import is policy-compliant.
 * ============================================================ */
(async function (DN, window, document) {
  if (!DN || !DN.isAdminMode || !DN.isAdminMode()) return;
  var article = document.querySelector('article.max-w-3xl');
    if (!article) return;
    var slug = DN.currentSlug && DN.currentSlug();
    if (!slug) return;
    if (document.getElementById('hs-admin-bar')) return;
    // Edit a fresh authenticated snapshot, not potentially cached public HTML.
    var baseDocument, baseSha, initialDraft, conflictDraft, savedCommit = '', editorReview, historyModule;
    var editHistory, restoringHistory = false;
    var metadataModule, metadataWorkspace;
    var editorDocumentPolicy;
    function parseEditorDocument(html) {
      if (typeof html !== 'string') throw new Error('文章來源格式無效');
      // Private capability for inert parsing only. The generic UI policy strips
      // scripts and would destroy the source's JSON-LD and page bootstraps.
      // Never expose this policy or insert its complete document into live DOM.
      if (window.trustedTypes) {
        if (!editorDocumentPolicy) editorDocumentPolicy = window.trustedTypes.createPolicy('hs-editor-document', {
          createHTML: function (value) { return value; }
        });
        html = editorDocumentPolicy.createHTML(html);
      }
      return new DOMParser().parseFromString(html, 'text/html');
    }
    function prepareEditableArticle(root) {
      // Generated navigation is reader chrome. Remove it before editing starts:
      // removing it only from a history clone leaves adjacent text nodes that
      // merge on HTML parsing, shifting the saved caret's child-node paths.
      var readerContents = root.querySelector('#hs-inline-toc');
      if (readerContents) { readerContents.remove(); root.normalize(); }
      // Only the article is imported into the active editor. Preserve inert
      // authored data scripts; executable scripts and event sinks stay out.
      root.querySelectorAll('script').forEach(function (node) {
        var type = (node.getAttribute('type') || '').trim().toLowerCase();
        if (type !== 'application/ld+json' && type !== 'application/json') node.remove();
      });
      [root].concat(Array.from(root.querySelectorAll('*'))).forEach(function (node) {
        Array.from(node.attributes).forEach(function (attr) {
          if (/^on/i.test(attr.name) || attr.name === 'srcdoc' ||
              (/^(?:href|src|action|formaction|xlink:href)$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value))) {
            node.removeAttribute(attr.name);
          }
        });
      });
      return root;
    }
    var releaseEditingLock;
    async function acquireEditingLock() {
      if (!navigator.locks || typeof navigator.locks.request !== 'function') {
        throw new Error('瀏覽器無法提供安全的分頁編輯保護，請使用支援 Web Locks 的瀏覽器重新開啟。草稿未更動。');
      }
      return new Promise(function (resolve, reject) {
        navigator.locks.request('hs-admin-edit:' + slug, { mode: 'exclusive', ifAvailable: true }, function (lock) {
          if (!lock) { resolve(false); return; }
          // Hold through loading, recovery, autosave, discard and Git cleanup.
          // Browser termination of this document releases it; do not release
          // on beforeunload, which the author may cancel and keep editing.
          return new Promise(function (release) {
            releaseEditingLock = release;
            resolve(true);
          });
        }).catch(reject);
      });
    }
    try {
      if (!(await acquireEditingLock())) {
        throw new Error('另一個分頁正在編輯這篇文章。請先在該分頁保存並離開，再重新開啟；本分頁不會更動草稿。');
      }
      var sourceResponse = await fetch('/api/admin/save?slug=' + encodeURIComponent(slug), { credentials: 'include', cache: 'no-store' });
      if (!sourceResponse.ok) throw new Error('請登入後重新開啟編輯器');
      var source = await sourceResponse.json();
      if (!/^[a-f0-9]{40}$/.test(source.sha || '')) throw new Error('無法取得文章版本');
      baseDocument = parseEditorDocument(source.html);
      var sourceArticle = baseDocument.querySelector('article.max-w-3xl');
      if (!sourceArticle) throw new Error('文章結構不支援編輯');
      article.replaceWith(document.importNode(prepareEditableArticle(sourceArticle.cloneNode(true)), true));
      article = document.querySelector('article.max-w-3xl');
      // The page header may still be cached even though the body is fresh.
      // Import only the sanitized authored heading, never source page scripts.
      var publicHeading = document.querySelector('h1'), sourceHeading = baseDocument.querySelector('h1');
      if (publicHeading && sourceHeading && !article.contains(publicHeading)) {
        publicHeading.replaceWith(document.importNode(prepareEditableArticle(sourceHeading.cloneNode(true)), true));
      }
      baseSha = source.sha;
      initialDraft = await DN.loadDraft(slug);
      if (initialDraft && initialDraft.html && initialDraft.baseSha !== baseSha) {
        conflictDraft = initialDraft;
        var archived = await DN.saveDraft(slug + '-conflict-' + (initialDraft.ts || Date.now()), initialDraft.html, initialDraft.baseSha);
        if (!archived.source) throw new Error('舊草稿備份失敗，請先匯出草稿再編輯');
        initialDraft = null;
      }
      DN.applyTextOnly(DN.detectLang());
      editorReview = await import('/blog/editor-review.js?v=20260713');
      historyModule = await import('/blog/editor-history.js?v=20260713');
      metadataModule = await import('/blog/editor-metadata.js?v=20260713');
      metadataWorkspace = metadataModule.createWorkspace(document, baseDocument, parseEditorDocument, function (event) {
        if (event.target.id === 'hs-editor-titleZh' || event.target.id === 'hs-editor-titleEn') refreshMetadataHeading();
        markDirty(event);
      }, source.catalogSha);
    } catch (e) {
      if (releaseEditingLock) releaseEditingLock();
      var notice = document.createElement('p');
      notice.setAttribute('role', 'alert');
      notice.textContent = '無法開啟編輯：' + e.message;
      article.before(notice);
      var retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = '重新開啟編輯';
      retry.addEventListener('click', function () { location.reload(); });
      notice.after(retry);
      return;
    }
    DN.prepareOfflineSave(slug).catch(function () {});
    if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', function (event) {
      if (event.data && event.data.type === 'BG_SYNC_CONFLICT' && event.data.slug === slug) {
        status('離線草稿與新版本衝突，已保留草稿，請先比較內容。', 'error');
      }
      if (event.data && event.data.type === 'BG_SYNC_UNCONFIRMED' && event.data.slug === slug) {
        saveReceiptPending = true;
        status('背景保存回應無法確認版本；離線快照仍保留，請先比較最新來源並匯出目前內容，勿重複儲存。', 'error');
      }
    });
    setInterval(function () {
      DN.prepareOfflineSave(slug).catch(function () {});
    }, 4 * 60 * 60 * 1000);

    // Inject admin styles (scoped, doesn't affect normal article render)
    if (!document.getElementById('hs-admin-css')) {
      var st = document.createElement('style');
      st.id = 'hs-admin-css';
      st.textContent =
        // A transparent article document otherwise inherits the light CMS
        // iframe canvas, even after its text switches to the dark palette.
        'body.hs-admin{background:var(--bg,#faf7f2);color:var(--ink,#2a2620)}' +
        ':root[data-theme="dark"] body.hs-admin{--muted:#b8b0a0}' +
        '#hs-admin-bar{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9998;background:var(--surface,#fff);border:1px solid var(--border,#dcd5c8);border-radius:14px;box-shadow:0 18px 40px -12px rgba(15,23,42,.32);padding:10px 12px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;width:min(720px,calc(100vw - 32px));max-height:calc(100dvh - 48px);overflow:auto}' +
        '@media(max-height:600px){#hs-admin-bar{max-height:40dvh;box-sizing:border-box}}' +
        '#hs-admin-bar button, #hs-admin-bar select{min-width:44px;min-height:44px;box-sizing:border-box;padding:6px 10px;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer;border:1px solid var(--border,#dcd5c8);background:var(--surface,#fff);color:var(--ink-2,#5e574e);transition:all .12s}' +
        '#hs-admin-bar button:hover{border-color:var(--ink-2,#5e574e);color:var(--ink,#2a2620)}' +
        '#hs-admin-bar button:focus-visible,#hs-admin-bar select:focus-visible,#hs-adm-advanced>summary:focus-visible{outline:2px solid var(--ink,#2a2620);outline-offset:2px}' +
        '#hs-admin-bar button.primary{background:#243b56;color:#fff;border-color:#243b56}' +
        '#hs-admin-bar button.primary:hover{color:#fff;opacity:.9}' +
        '#hs-admin-bar button.danger{background:var(--surface,#fff);color:#dc2626;border-color:#fca5a5}' +
        ':root[data-theme="dark"] #hs-admin-bar button.danger{color:#fca5a5}' +
        '#hs-admin-bar button.danger:hover{background:#fee2e2;color:#991b1b}' +
        ':root[data-theme="dark"] #hs-admin-bar button.danger:hover{color:#991b1b}' +
        '#hs-admin-bar .sep{width:1px;height:22px;background:var(--border,#dcd5c8);margin:0 4px}' +
        '#hs-admin-bar .group-label{font-size:10.5px;color:var(--muted,#8b8378);font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-right:4px}' +
        '#hs-admin-bar .hs-adm-writing,#hs-admin-bar .hs-adm-more{display:flex;align-items:center;flex-wrap:wrap;gap:6px;width:100%}' +
        '#hs-adm-advanced{flex-basis:100%;border-top:1px solid var(--border,#dcd5c8)}' +
        '#hs-adm-advanced>summary{min-height:44px;box-sizing:border-box;padding:12px 4px;font-size:12.5px;line-height:20px;font-weight:600;cursor:pointer;color:var(--ink-2,#5e574e)}' +
        '#hs-admin-bar .hs-adm-more{padding-top:6px}' +
        '#hs-admin-status{flex-basis:100%;background:#243b56;color:#fff;padding:9px 12px;border-radius:8px;font-size:13px;max-height:18vh;overflow:auto}' +
        // Tag the editable area visually
        '[contenteditable="true"]{outline:2px dashed rgba(58,90,124,.35);outline-offset:4px;border-radius:6px;transition:outline-color .15s}' +
        '[contenteditable="true"]:focus{outline-color:var(--blue-deep,#243b56);outline-style:solid}' +
        '[contenteditable="true"]:hover{outline-color:rgba(58,90,124,.6)}' +
        // Hide non-editable chrome in admin to reduce distraction
        // Editing text must stay opaque; scroll-driven reveals can remain
        // partially faded when a long card exceeds the iframe viewport.
        'body.hs-admin .reveal,body.hs-admin .myth-card,body.hs-admin .article-list-item{animation:none!important;opacity:1!important;transform:none!important}' +
        'body.hs-admin #hs-share, body.hs-admin #hs-author-bio, body.hs-admin #hs-bmc, body.hs-admin #hs-related, body.hs-admin #hs-prevnext, body.hs-admin #hs-feedback, body.hs-admin #hs-print-btn, body.hs-admin #hs-bookmark, body.hs-admin #hs-totop{display:none!important}' +
        'body.hs-admin .mag-footer{opacity:1}';
      document.head.appendChild(st);
    }
    document.body.classList.add('hs-admin');
    article.before(metadataWorkspace.element);

    // Make article structures editable (h1, h2, h3, paragraphs, list items,
    // figcaptions, table cells). We deliberately skip code / SVG / link href
    // editing for safety.
    var EDITABLE_SEL = '#proseZh h1, #proseZh h2, #proseZh h3, #proseZh p, #proseZh li, #proseZh td, #proseZh th, #proseZh figcaption, #proseZh blockquote, #proseZh pre, #proseEn h1, #proseEn h2, #proseEn h3, #proseEn p, #proseEn li, #proseEn td, #proseEn th, #proseEn figcaption, #proseEn blockquote, #proseEn pre, .myth-card .myth, .myth-card .truth, article.max-w-3xl > h1, article.max-w-3xl figcaption';
    var registeredEditables = new WeakSet();
    function registerEditables() {
      document.querySelectorAll(EDITABLE_SEL).forEach(function (el) {
        if (el.closest('.hs-diagram-mode')) return;
        if (el === document.querySelector('h1') && metadataModule && !metadataWorkspace.element.querySelector('#hs-editor-titleZh').disabled) return;
        el.contentEditable = 'true';
        el.spellcheck = false;
        if (registeredEditables.has(el)) return;
        registeredEditables.add(el);
      });
    }
    registerEditables();
    var applyArticleLanguage = DN.applyTextOnly;
    function applyRestoredLanguage(lang) {
      lang = (lang || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh';
      applyArticleLanguage(lang);
      var zh = article.querySelector('#proseZh'), en = article.querySelector('#proseEn');
      if (zh) zh.style.display = en && lang === 'en' ? 'none' : '';
      if (en) en.style.display = lang === 'en' ? '' : 'none';
    }
    DN.applyTextOnly = function (lang) {
      // Persist the rendered language before translation can replace it. Use
      // the same clean representation as save so editing attributes stay out
      // of bilingual HTML strings. No opposite-language value is overwritten.
      var clean = document.documentElement.cloneNode(true);
      var cleanArticle = clean.querySelector('article.max-w-3xl');
      var rendered = Array.from(article.querySelectorAll('[data-zh],[data-en]'));
      // Keep the correspondence from BEFORE runtime stripping; removed
      // widgets must not shift indices onto unrelated authored elements.
      var translated = Array.from(cleanArticle.querySelectorAll('[data-zh],[data-en]'));
      _sanitizeForSerialize(clean);
      var key = 'data-' + ((document.documentElement.lang || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh');
      rendered.forEach(function (el, index) {
        if (el.closest('.hs-diagram-mode')) return;
        var copy = translated[index];
        if (el.hasAttribute(key) && copy && cleanArticle.contains(copy) && copy.hasAttribute(key)) {
          el.setAttribute(key, copy.getAttribute(key));
          ['data-hs-text-' + key.slice(5), 'data-hs-editor-text-' + key.slice(5)].forEach(function (marker) {
            if (copy.hasAttribute(marker)) el.setAttribute(marker, copy.getAttribute(marker));
            else el.removeAttribute(marker);
          });
        }
      });
      DN._bilingualCache = null;
      applyArticleLanguage(lang);
      registerEditables();
    };

    // Insert after the containing top-level prose block. Keeping the original
    // block intact avoids splitting bilingual attributes, list items or cells.
    // DOM insertion inside a paragraph would create invalid nested blocks.
    function insertArticleBlock(html) {
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) {
        status('請先把游標放在文章正文內，再插入區塊。', 'error');
        return false;
      }
      var range = sel.getRangeAt(0);
      var anchor = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
      var prose = anchor && anchor.closest('#proseZh, #proseEn');
      if (!prose || !article.contains(prose) || anchor === prose) {
        status('請先把游標放在文章正文內，再插入區塊。', 'error');
        return false;
      }
      while (anchor.parentElement !== prose) anchor = anchor.parentElement;
      if (editHistory) editHistory.selection(historyState().selection);
      var template = document.createElement('template');
      template.innerHTML = html;
      var nodes = Array.from(template.content.children);
      if ((document.documentElement.lang || '').toLowerCase().startsWith('en')) {
        nodes.forEach(function (root) {
          var labels = Array.from(root.querySelectorAll('[data-en]'));
          if (root.hasAttribute('data-en')) labels.unshift(root);
          labels.forEach(function (el) { el.innerHTML = el.getAttribute('data-en'); });
        });
      }
      anchor.after(template.content);
      registerEditables();
      markDirty();
      var last = nodes[nodes.length - 1];
      var focus = last && (last.matches(EDITABLE_SEL) ? last : last.querySelector('[contenteditable="true"]'));
      if (focus) {
        focus.focus();
        range = document.createRange();
        range.selectNodeContents(focus);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      return true;
    }

    // Build the floating toolbar
    var bar = document.createElement('div');
    bar.id = 'hs-admin-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', '文章編輯工具');
    bar.innerHTML =
      '<div class="hs-adm-writing" role="group" aria-label="常用寫作工具">' +
      '<button type="button" title="連結 (Cmd/Ctrl+K)" data-cmd="link">🔗 連結</button>' +
      '<button type="button" title="圖片 — 拖曳/貼上/點選" id="hs-adm-img">📷 圖片</button>' +
      '<button type="button" id="hs-adm-undo" title="復原（Ctrl/Cmd+Z）" disabled>↶ 復原</button>' +
      '<button type="button" id="hs-adm-redo" title="重做（Ctrl+Y 或 Ctrl/Cmd+Shift+Z）" disabled>↷ 重做</button>' +
      '<button type="button" title="本機內容預覽，尚未正式上線" id="hs-adm-preview">👁 本機預覽</button>' +
      '<button type="button" class="primary" id="hs-adm-save">💾 儲存至 GitHub</button>' +
      '</div>' +
      '<details id="hs-adm-advanced"><summary>格式、版本與離開編輯</summary>' +
      '<div class="hs-adm-more" role="group" aria-label="格式與版本工具">' +
      '<button type="button" title="粗體 (Cmd/Ctrl+B)" data-cmd="bold"><b>B</b></button>' +
      '<button type="button" title="斜體 (Cmd/Ctrl+I)" data-cmd="italic"><i>I</i></button>' +
      '<span class="group-label">字型</span>' +
      '<select id="hs-adm-font" title="字型"><option value="">(預設)</option><option value="Noto Serif TC, Georgia, serif">Noto Serif TC</option><option value="Inter, sans-serif">Inter</option><option value="JetBrains Mono, monospace">JetBrains Mono</option><option value="Noto Sans TC, sans-serif">Noto Sans TC</option><option value="Fraunces, serif">Fraunces</option></select>' +
      '<select id="hs-adm-size" title="字級"><option value="">(預設)</option><option value="13px">13</option><option value="14px">14</option><option value="15.5px">15.5</option><option value="17px">17</option><option value="20px">20</option><option value="24px">24</option><option value="32px">32</option></select>' +
      '<button type="button" title="底線 (Cmd/Ctrl+U)" data-cmd="underline"><u>U</u></button>' +
      '<button type="button" title="刪除線" data-cmd="strikeThrough">S̶</button>' +
      '<button type="button" title="項目符號" data-cmd="insertUnorderedList">• 項目</button>' +
      '<button type="button" title="數字編號" data-cmd="insertOrderedList">1. 編號</button>' +
      '<button type="button" id="hs-adm-publication">核對上線狀態</button>' +
      '<button type="button" id="hs-adm-check">保存前健檢</button>' +
      '<button type="button" id="hs-adm-compare">比較版本</button>' +
      '<button type="button" title="清除格式" data-cmd="removeFormat">⨯ 清除</button>' +
      '<button type="button" class="danger" id="hs-adm-cancel">放棄修改</button>' +
      '<button type="button" id="hs-adm-exit" title="離開 admin 模式">←離開</button>' +
      '</div></details>' +
      '<input type="file" id="hs-adm-img-input" accept="image/*" hidden />';
    document.body.appendChild(bar);
    var articleInfoButton = document.createElement('button');
    articleInfoButton.type = 'button'; articleInfoButton.id = 'hs-adm-article-info';
    articleInfoButton.textContent = '文章資訊';
    bar.querySelector('.hs-adm-writing').appendChild(articleInfoButton);
    articleInfoButton.addEventListener('click', function () { if (!composing) metadataWorkspace.open(); });
    // Plain image descriptions live in existing editor chrome, never in authored HTML.
    var imageDescriptionButton = document.createElement('button');
    imageDescriptionButton.type = 'button';
    imageDescriptionButton.id = 'hs-adm-image-description';
    imageDescriptionButton.textContent = '圖片替代文字';
    bar.querySelector('.hs-adm-writing').appendChild(imageDescriptionButton);
    var imageDialog = document.createElement('dialog');
    imageDialog.id = 'hs-adm-image-description-dialog';
    imageDialog.setAttribute('aria-label', '圖片替代文字');
    imageDialog.style.cssText = 'max-width:min(32rem,calc(100vw - 32px));box-sizing:border-box;max-height:80dvh;overflow:auto;border:1px solid var(--border);border-radius:12px;padding:20px;background:var(--surface,#fff);color:var(--ink,#243b56)';
    var imageHelp = document.createElement('p');
    imageHelp.id = 'hs-adm-image-description-help';
    imageHelp.textContent = '替代文字描述這張圖在文中的用途，供無法看見圖片的讀者使用；圖說仍可直接在正文編輯。純裝飾且不傳達資訊的圖片可以留空。套用後才會納入草稿或 Git 保存；取消會放棄本視窗輸入。';
    imageDialog.appendChild(imageHelp);
    var imagePickerLabel = document.createElement('label');
    imagePickerLabel.textContent = '選擇圖片';
    var imagePicker = document.createElement('select');
    imagePicker.setAttribute('aria-label', '選擇圖片');
    imagePicker.style.cssText = 'display:block;width:100%;min-height:44px;margin:8px 0';
    imagePickerLabel.appendChild(imagePicker); imageDialog.appendChild(imagePickerLabel);
    var imageAltLabel = document.createElement('label');
    imageAltLabel.textContent = '替代文字';
    var imageAltInput = document.createElement('textarea');
    imageAltInput.setAttribute('aria-label', '替代文字');
    imageAltInput.rows = 3; imageAltInput.maxLength = 2000;
    imageAltInput.style.cssText = 'display:block;width:100%;box-sizing:border-box;margin:8px 0;padding:10px;background:var(--surface,#fff);color:inherit;border:1px solid var(--border);font:inherit';
    imageAltLabel.appendChild(imageAltInput); imageDialog.appendChild(imageAltLabel);
    var imageApply = document.createElement('button');
    imageApply.type = 'button'; imageApply.textContent = '套用替代文字';
    var imageCancel = document.createElement('button');
    imageCancel.type = 'button'; imageCancel.textContent = '取消';
    imageDialog.append(imageApply, imageCancel); bar.appendChild(imageDialog);
    var imageNotice = document.createElement('p');
    imageNotice.id = 'hs-adm-image-description-notice';
    imageNotice.setAttribute('role', 'status'); imageNotice.setAttribute('aria-live', 'polite');
    imageDialog.appendChild(imageNotice);
    imageAltInput.setAttribute('aria-describedby', imageHelp.id + ' ' + imageNotice.id);
    function showImageIssue(message) {
      imageNotice.textContent = message; status(message, 'error'); imageAltInput.focus();
    }
    var imageTargets = [], imageTarget = null, imageLanguage = null, imageIndex = 0, imageLoadedAlt = '';
    function chooseImage() {
      var nextIndex = Number(imagePicker.value), nextTarget = imageTargets[nextIndex] || null;
      if (imageTarget && nextTarget !== imageTarget && imageAltInput.value !== imageLoadedAlt) {
        imagePicker.value = String(imageIndex);
        showImageIssue('請先套用或取消目前圖片的替代文字，再選擇另一張圖片。'); return;
      }
      imageTarget = nextTarget; imageIndex = nextIndex;
      imageLoadedAlt = imageTarget ? imageTarget.getAttribute('alt') || '' : '';
      imageAltInput.value = imageLoadedAlt; imageNotice.textContent = '';
    }
    imagePicker.addEventListener('change', chooseImage);
    imageCancel.addEventListener('click', function () { imageDialog.close(); });
    imageDialog.addEventListener('close', function () { imageTargets = []; imageTarget = null; });
    imageDescriptionButton.addEventListener('click', function () {
      if (composing) return;
      imageTargets = Array.from(article.querySelectorAll('img')).filter(function (img) {
        return img.getClientRects().length && !img.closest('.hs-diagram-mode');
      });
      if (!imageTargets.length) { status('目前正文沒有可修改替代文字的圖片；SVG 圖表與圖說維持原本編輯方式。'); return; }
      imageLanguage = (document.documentElement.lang || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh';
      imagePicker.replaceChildren();
      imageTargets.forEach(function (img, index) {
        var option = document.createElement('option'); option.value = String(index);
        var caption = img.closest('figure') && img.closest('figure').querySelector('figcaption');
        option.textContent = '圖片 ' + (index + 1) + '：' + (img.getAttribute('alt') || caption && caption.textContent || '尚無描述').slice(0, 100);
        imagePicker.appendChild(option);
      });
      chooseImage(); imageDialog.showModal(); imageAltInput.focus();
    });
    imageApply.addEventListener('click', function () {
      if (composing) return;
      var language = (document.documentElement.lang || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh';
      if (!imageTarget || !article.contains(imageTarget) || !imageTarget.getClientRects().length || language !== imageLanguage) {
        showImageIssue('圖片或閱讀語言已改變，文字仍在此視窗；請複製需要的文字，取消後重新選擇圖片。'); return;
      }
      if (imageTarget.getAttribute('alt') !== imageAltInput.value) {
        if (editHistory) editHistory.breakGroup();
        imageTarget.setAttribute('alt', imageAltInput.value);
        markDirty();
        if (editHistory) editHistory.breakGroup();
      }
      imageDialog.close();
    });

    // A mouse press on summary otherwise replaces the author's selection with
    // the disclosure label. Preserve it for the next format command, while
    // leaving native click toggling and keyboard focus/activation intact.
    bar.querySelector('#hs-adm-advanced > summary').addEventListener('mousedown', function (event) {
      var selection = window.getSelection();
      if (event.button === 0 && selection && selection.rangeCount && article.contains(selection.getRangeAt(0).commonAncestorContainer)) {
        event.preventDefault();
      }
    });
    function reserveEditorSpace() {
      // Runtime body spacing is outside the authenticated article snapshot.
      // The public mobile-nav rule uses !important; the editor reservation
      // must win that cascade too, not just appear in the inline declaration.
      document.body.style.setProperty('padding-bottom', Math.ceil(bar.getBoundingClientRect().height + 48) + 'px', 'important');
    }
    if (window.ResizeObserver) new ResizeObserver(reserveEditorSpace).observe(bar);
    else window.addEventListener('resize', reserveEditorSpace);
    reserveEditorSpace();
    var publicationPanel = document.createElement('section');
    publicationPanel.setAttribute('aria-label', '已保存文章的上線狀態');
    publicationPanel.setAttribute('aria-live', 'polite');
    publicationPanel.hidden = true;
    publicationPanel.style.cssText = 'flex-basis:100%;max-height:30vh;overflow:auto;font-size:13px;line-height:1.6';
    bar.appendChild(publicationPanel);
    var reviewPanel = document.createElement('section');
    reviewPanel.setAttribute('aria-label', '保存前健檢與版本比較');
    reviewPanel.setAttribute('aria-live', 'polite');
    reviewPanel.hidden = true;
    reviewPanel.style.cssText = 'flex-basis:100%;max-height:35vh;overflow:auto;font-size:13px;line-height:1.6';
    bar.appendChild(reviewPanel);
    var reviewSnapshot = null, reviewChangeNotice, reviewDownloads = [], editorDownloadUrls = new Set();
    function retireReviewDownload(url) {
      editorDownloadUrls.delete(url);
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    }
    function clearReviewPanel() {
      // Let an in-flight download finish before retiring its object URL.
      reviewDownloads.splice(0).forEach(retireReviewDownload);
      reviewPanel.replaceChildren();
    }
    function reviewLine(message) {
      var line = document.createElement('p'); line.textContent = message;
      reviewPanel.appendChild(line);
    }
    function reviewButton(label, action) {
      var button = document.createElement('button'); button.type = 'button';
      button.textContent = label; button.addEventListener('click', action);
      reviewPanel.appendChild(button); return button;
    }
    function downloadSource(label, html, suffix) {
      var link = document.createElement('a'), url;
      link.textContent = label; link.download = slug + '-' + suffix + '.html.txt';
      link.target = '_blank'; link.rel = 'noopener';
      function refreshDownload() {
        var next = URL.createObjectURL(new Blob([typeof html === 'function' ? html() : html], { type: 'text/plain;charset=utf-8' }));
        if (url) {
          retireReviewDownload(url);
          var previous = reviewDownloads.indexOf(url);
          if (previous !== -1) reviewDownloads.splice(previous, 1);
        }
        url = next; link.href = url;
        reviewDownloads.push(url);
        editorDownloadUrls.add(url);
      }
      refreshDownload();
      link.addEventListener('click', function (event) {
        try { refreshDownload(); }
        catch (e) { event.preventDefault(); status('無法匯出目前內容：' + e.message, 'error'); }
      });
      reviewPanel.appendChild(link);
    }
    function showChecks(html) {
      var result = editorReview.checkDocument(parseEditorDocument(html));
      clearReviewPanel(); reviewPanel.hidden = false;
      reviewSnapshot = html; reviewChangeNotice = null;
      reviewLine('保存前健檢：檢查目前編輯內容，不會保存或發佈。');
      result.blocking.concat(result.warnings).forEach(reviewLine);
      if (!result.blocking.length && !result.warnings.length) reviewLine('本次結構健檢未發現問題。');
      reviewLine('搜尋標題：' + (result.title || '(空白)'));
      reviewLine('搜尋摘要：' + (result.description || '(空白)'));
      reviewLine('請另確認醫療內容、引文、雙語與本機預覽。健檢不代表醫療核可、搜尋排名或正式上線。');
      reviewButton('收起健檢', function () { reviewPanel.hidden = true; });
      return result;
    }
    document.getElementById('hs-adm-check').addEventListener('click', function () {
      try { showChecks(snapshotHtml()); }
      catch (e) { status('無法完成保存前健檢：' + e.message, 'error'); }
    });
    var comparisonRequest = 0, comparisonController, saveConflict = false;
    async function showComparison() {
      if (savePending) { status('請先等保存結果確認，再比較版本。'); return; }
      var request = ++comparisonRequest;
      if (comparisonController) comparisonController.abort();
      comparisonController = new AbortController();
      var controller = comparisonController, timer = setTimeout(function () { controller.abort(); }, 10000);
      clearReviewPanel(); reviewPanel.hidden = false;
      reviewLine('正在讀取最新保存版本；你的編輯內容會留在目前分頁。');
      try {
        var response = await fetch('/api/admin/save?slug=' + encodeURIComponent(slug), {
          credentials: 'include', cache: 'no-store', signal: controller.signal
        });
        if (!response.ok) throw new Error('請確認登入或稍後重試。');
        var latest = await response.json();
        if (request !== comparisonRequest) return;
        if (!/^[a-f0-9]{40}$/.test(latest.sha || '') || typeof latest.html !== 'string') throw new Error('保存版本回應無效。');
        var current = snapshotHtml(), latestDoc = parseEditorDocument(latest.html);
        var versions = [
          { label: '開啟時版本', doc: baseDocument },
          { label: '目前編輯內容', doc: parseEditorDocument(current) },
          { label: '最新保存版本', doc: latestDoc }
        ];
        var descriptions = versions.map(function (version) { return editorReview.describeDocument(version.doc); });
        clearReviewPanel();
        reviewSnapshot = current; reviewChangeNotice = null;
        reviewLine(latest.sha === baseSha ? '最新保存版本與這個編輯器使用的保存版本相同。' :
          '已有其他保存版本。請比較後重新開啟編輯，不會自動合併或覆蓋。');
        reviewLine('這是此次讀取的對照；文字摘要不涵蓋所有格式與圖表差異，可展開正文原始碼或下載。');
        var columns = document.createElement('div');
        columns.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:12px';
        versions.forEach(function (version, index) {
          var column = document.createElement('section'), title = document.createElement('h3'), summary = document.createElement('pre');
          title.textContent = version.label; summary.textContent = descriptions[index].summary;
          summary.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:24vh;overflow:auto';
          var details = document.createElement('details'), label = document.createElement('summary'), code = document.createElement('pre');
          label.textContent = '完整正文原始碼（含格式、圖表與雙語屬性）';
          code.textContent = descriptions[index].source; code.style.cssText = summary.style.cssText;
          details.append(label, code); column.append(title, summary, details); columns.appendChild(column);
        });
        reviewPanel.appendChild(columns);
        if (conflictDraft) downloadSource('下載舊版本草稿', conflictDraft.html, 'previous-draft');
        downloadSource('下載目前編輯內容', snapshotHtml, 'current');
        downloadSource('下載最新保存版本', latest.html, 'saved');
        reviewButton('重新開啟最新版本', async function () {
          if (!confirm('先保存目前本機草稿，再重新開啟最新版本？舊版本草稿會另存備份，不會自動覆蓋新文章。')) return;
          if (await DN.adminBeforeClose()) location.reload();
        });
        reviewButton('收起比較，保留編輯內容', function () { reviewPanel.hidden = true; });
      } catch (e) {
        if (request !== comparisonRequest) return;
        clearReviewPanel(); reviewSnapshot = snapshotHtml(); reviewChangeNotice = null;
        reviewLine('無法比較版本：' + (e.name === 'AbortError' ? '讀取逾時，請稍後重試。' : e.message));
        downloadSource('下載目前編輯內容', snapshotHtml, 'current');
      } finally { clearTimeout(timer); }
    }
    document.getElementById('hs-adm-compare').addEventListener('click', showComparison);
    var publicationRequest = 0, publicationController;
    function invalidatePublication() {
      publicationRequest++;
      if (publicationController) publicationController.abort();
      publicationPanel.hidden = true;
    }
    function publicationLine(message) {
      var line = document.createElement('p');
      line.textContent = message;
      publicationPanel.appendChild(line);
    }
    function publicationLink(label, href, preview) {
      try {
        var url = new URL(href);
        if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash ||
            (preview ? !url.hostname.endsWith('.vercel.app') :
              url.origin !== 'https://hsiao.chendermatologist.com' && url.origin !== 'https://github.com')) return;
        var link = document.createElement('a');
        link.textContent = label;
        link.href = url.href;
        link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.style.cssText = 'display:inline-block;margin-right:16px;text-decoration:underline';
        publicationPanel.appendChild(link);
      } catch (e) {}
    }
    document.getElementById('hs-adm-publication').addEventListener('click', async function () {
      if (savePending || saveReceiptPending) {
        status('請先等保存結果確認，再核對上線狀態。');
        return;
      }
      invalidatePublication();
      var request = publicationRequest, expectedBlob = baseSha, expectedCommit = savedCommit;
      publicationController = new AbortController();
      var controller = publicationController;
      var timer = setTimeout(function () { controller.abort(); }, 10000);
      publicationPanel.replaceChildren(); publicationPanel.hidden = false;
      publicationLine('正在核對已保存版本；不包含本機尚未保存的修改。');
      try {
        var response = await fetch('/api/admin/publication-status?slug=' + encodeURIComponent(slug) +
          '&blob=' + expectedBlob + '&commit=' + expectedCommit, {
          credentials: 'include', cache: 'no-store', signal: controller.signal
        });
        if (!response.ok) throw new Error('無法核對，請確認登入或稍後重試。');
        var data = await response.json();
        if (request !== publicationRequest || baseSha !== expectedBlob || savedCommit !== expectedCommit) return;
        if (!data || data.saved?.blob !== expectedBlob || data.saved?.commit !== expectedCommit || data.releaseVerified !== false) {
          throw new Error('版本核對回應無效，請稍後重試。');
        }
        publicationPanel.replaceChildren();
        publicationLine('僅核對 Git 已保存版本；不包含本機新修改。');
        var production = data.production || {};
        if (!/^[a-f0-9]{40}$/.test(production.sha || '')) production = {};
        if (production.state === 'matching_content') {
          publicationLine('正式頁面目前回傳的內容與已保存版本相同。');
        } else if (production.state === 'different_content') {
          publicationLine('正式頁面內容與已保存版本不同；可能尚未部署，或生成／後續編輯已改變內容，請開啟正式頁面比較。');
        } else {
          publicationLine('正式上線尚未確認：目前無法取得可靠的正式版本或內容。');
        }
        if (/^[a-f0-9]{40}$/.test(production.sha || '')) {
          publicationLine('正式網站回報版本：' + production.sha.slice(0, 7) +
            (production.includesSavedCommit === 'yes' ? '，包含此次保存 commit。' :
              production.includesSavedCommit === 'no' ? '，尚未包含此次保存 commit。' : '，保存 commit 的包含關係尚未確認。'));
        }
        publicationLine('上述為本次查詢結果；完整 CI、部署與發佈驗收仍須另外確認。');
        if (data.preview?.state === 'ready' && data.preview.sha === expectedCommit) {
          publicationLine('此保存版本有同庫候選 Preview；這不是正式上線，開啟時可能需要 Vercel 登入。');
          publicationLink('開啟此版本 Preview', data.preview.url, true);
        } else publicationLine('此保存版本的候選 Preview 尚未確認。');
        publicationLink('開啟正式文章', 'https://hsiao.chendermatologist.com/blog/' + slug, false);
        if (expectedCommit) publicationLink('查看保存 commit 與檢查', data.commitUrl, false);
      } catch (e) {
        if (request !== publicationRequest) return;
        publicationPanel.replaceChildren();
        publicationLine('正式上線尚未確認：' + (e.name === 'AbortError' ? '查詢逾時，請稍後重試。' : e.message));
      } finally { clearTimeout(timer); }
    });
    if (conflictDraft) {
      var draftDownload = document.createElement('a');
      draftDownload.textContent = '下載舊版本草稿';
      draftDownload.download = slug + '-conflict.html';
      draftDownload.href = URL.createObjectURL(new Blob([conflictDraft.html], { type: 'text/html' }));
      // This backup belongs to the toolbar for the entire editor session;
      // clearing a comparison must not retire its download URL.
      editorDownloadUrls.add(draftDownload.href);
      bar.appendChild(draftDownload);
      status('舊版本草稿已另存備份，可下載比較；目前編輯的是最新文章。', 'error');
    }

    // Toolbar handlers
    bar.querySelectorAll('button[data-cmd]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cmd = btn.dataset.cmd;
        if (cmd === 'link') {
          var url = prompt('連結網址 URL:', 'https://');
          if (url) document.execCommand('createLink', false, url);
        } else {
          document.execCommand(cmd, false, null);
        }
      });
    });
    document.getElementById('hs-adm-font').addEventListener('change', function (e) {
      if (e.target.value) document.execCommand('fontName', false, e.target.value);
    });
    document.getElementById('hs-adm-size').addEventListener('change', function (e) {
      // execCommand fontSize takes 1-7; we use a span-wrap shim instead for arbitrary px
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !e.target.value) return;
      var range = sel.getRangeAt(0);
      if (range.collapsed) return;
      var span = document.createElement('span');
      span.style.fontSize = e.target.value;
      try { range.surroundContents(span); markDirty(); } catch (ex) { /* selection across multiple nodes — fallback no-op */ }
    });

    // IME owns its confirmation/navigation keys while composing. The event
    // flag, active session and legacy 229 marker cover differing key ordering.
    var composing = false;
    document.addEventListener('compositionstart', function () {
      composing = true;
      hideSlash();
    });
    document.addEventListener('compositionend', function () { composing = false; });
    function isCompositionKey(e) { return composing || e.isComposing || e.keyCode === 229; }

    // Keyboard shortcuts
    document.addEventListener('keydown', function (e) {
      if (isCompositionKey(e)) return;
      if (editHistory && /^(Arrow|Home|End|Enter|Tab|Escape)/.test(e.key)) editHistory.breakGroup();
      if (!(e.metaKey || e.ctrlKey)) return;
      var k = e.key.toLowerCase();
      if ((k === 'z' || k === 'y') && !e.altKey && (article.contains(document.activeElement) || metadataWorkspace.element.contains(document.activeElement))) {
        e.preventDefault(); moveHistory(k === 'y' || e.shiftKey); return;
      }
      if (k === 's') { e.preventDefault(); doSave(); }
    });
    document.addEventListener('beforeinput', function (e) {
      if (!editHistory || !(article.contains(e.target) || metadataWorkspace.element.contains(e.target))) return;
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
        if (e.cancelable) { e.preventDefault(); moveHistory(e.inputType === 'historyRedo'); }
      } else {
        var selection = historyState(true);
        if (selection && (JSON.stringify(selection.anchor) !== JSON.stringify(selection.focus) || selection.anchorOffset !== selection.focusOffset)) editHistory.breakGroup();
        editHistory.selection(selection, historyField());
      }
    });
    article.addEventListener('focusin', function () { if (editHistory) editHistory.breakGroup(); });
    article.addEventListener('pointerdown', function () { if (editHistory) editHistory.breakGroup(); });
    metadataWorkspace.element.addEventListener('focusin', function () { if (editHistory) editHistory.breakGroup(); });
    metadataWorkspace.element.addEventListener('pointerdown', function () { if (editHistory) editHistory.breakGroup(); });
    document.getElementById('hs-adm-undo').addEventListener('click', function () { moveHistory(false); });
    document.getElementById('hs-adm-redo').addEventListener('click', function () { moveHistory(true); });

    // Save / cancel
    document.getElementById('hs-adm-save').addEventListener('click', doSave);
    document.getElementById('hs-adm-cancel').addEventListener('click', async function () {
      if (savePending) { status('正在儲存至 GitHub，請等候結果後再離開。'); return; }
      if (leavePending) { status('正在處理本機草稿，請稍候再離開。'); return; }
      if (!confirm('確定要丟棄所有未儲存的編輯及本機草稿嗎？')) return;
      leavePending = true;
      var discardHtml = snapshotHtml();
      clearTimeout(draftTimer);
      try {
        await removeDraft();
        if (snapshotHtml() !== discardHtml) { markDirty(); status('清除草稿期間又有新修改，已保留編輯器。'); return; }
        if (await DN.loadDraft(slug)) throw new Error('本機草稿尚未清除');
        if (snapshotHtml() !== discardHtml) { markDirty(); status('確認草稿期間又有新修改，已保留編輯器。'); return; }
        DN._adminDirty = false;
        allowClose = true;
        location.reload();
      } catch (e) { status('無法清除本機草稿，請保留編輯器：' + e.message, 'error'); }
      finally { leavePending = false; }
    });
    document.getElementById('hs-adm-exit').addEventListener('click', async function () {
      if (await DN.adminBeforeClose()) location.href = location.pathname;
    });

    // Image upload — opens file picker, compresses to WebP @ 1600w / q82,
    // POSTs base64 to /api/admin/upload, inserts <img> at cursor on success.
    var imgBtn = document.getElementById('hs-adm-img');
    var imgInput = document.getElementById('hs-adm-img-input');
    imgBtn.addEventListener('click', function () { imgInput.click(); });
    imgInput.addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      uploadImageInline(file);
      imgInput.value = '';
    });
    // Paste-to-upload: catch image data on Cmd/Ctrl+V
    document.addEventListener('paste', function (e) {
      if (!DN.isAdminMode()) return;
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image/') === 0) {
          e.preventDefault();
          uploadImageInline(items[i].getAsFile());
          break;
        }
      }
    });

    // v30: Generate full responsive srcset (220 / 440 / 660 / 1320 widths) ×
    // (webp + avif) and POST as one bundle. The CLIENT does encoding because
    // Edge runtime can't decode images. Inserted snippet is <picture> with
    // proper sources.
    async function uploadImageInline(file) {
      status('⏳ 壓縮中（多尺寸）⋯');
      try {
        if (file.type === 'image/svg+xml') {
          // SVG: pass through — single variant
          return await uploadSvgFallback(file);
        }
        var bitmap = await loadImageBitmap(file);
        var widths = [220, 440, 660, 1320].filter(function (w) { return w <= bitmap.width * 1.05; });
        if (widths.length === 0) widths = [bitmap.width];

        var stem = (file.name || 'img').replace(/\.[^.]+$/, '').replace(/[^a-z0-9._-]/gi, '-').toLowerCase().slice(0, 40) || 'img';
        stem += '-' + Date.now().toString(36);

        var canAvif = await canEncodeAvif();
        var variants = [];
        for (var i = 0; i < widths.length; i++) {
          var w = widths[i];
          var webpData = await encodeAt(bitmap, w, 'image/webp', 0.82);
          variants.push({ suffix: '-' + w, format: 'webp', data: webpData });
          if (canAvif) {
            var avifData = await encodeAt(bitmap, w, 'image/avif', 0.55);
            if (avifData) variants.push({ suffix: '-' + w, format: 'avif', data: avifData });
          }
        }

        status('⏳ 上傳 ' + variants.length + ' 個變體⋯');
        var resp = await fetch('/api/admin/upload-srcset', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stem: stem, folder: 'assets/article-img', variants: variants })
        });
        if (!resp.ok) {
          var err = await resp.json().catch(function () { return {}; });
          status('✗ 上傳失敗: ' + (err.error || resp.status), 'error');
          return;
        }
        var data = await resp.json();
        var snippet = '<figure>' + (data.pictureSnippet || data.imgSnippet) + '<figcaption>(編輯說明文字)</figcaption></figure>';
        if (!insertArticleBlock(snippet)) return;
        status('✓ 已插入 (含 ' + variants.length + ' 個變體)', 'success');
      } catch (e) {
        status('✗ 圖片處理失敗: ' + (e.message || e), 'error');
      }
    }

    function loadImageBitmap(file) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        var url = URL.createObjectURL(file);
        img.onload = function () {
          URL.revokeObjectURL(url);
          resolve({ image: img, width: img.naturalWidth, height: img.naturalHeight });
        };
        img.onerror = function () { reject(new Error('image load failed')); };
        img.src = url;
      });
    }

    // v33: WebCodecs path for AVIF encoding — 3-5× faster than canvas.toBlob.
    // Falls back to canvas.toBlob when ImageEncoder/AVIF not supported.
    function encodeAt(bitmap, targetW, mime, quality) {
      return new Promise(function (resolve, reject) {
        var w = Math.min(targetW, bitmap.width);
        var h = Math.round(bitmap.height * (w / bitmap.width));

        function canvasFallback() {
          try {
            var canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(bitmap.image, 0, 0, w, h);
            canvas.toBlob(function (blob) {
              if (!blob) { resolve(null); return; }
              try {
                var fr = new FileReader();
                fr.onload = function () { resolve(fr.result.replace(/^data:[^,]+,/, '')); };
                fr.onerror = reject;
                fr.readAsDataURL(blob);
              } catch (e) { reject(e); }
            }, mime, quality);
          } catch (e) { reject(e); }
        }

        // Use the encoder only when exposed; unsupported types or failures
        // must settle through the same native canvas fallback.
        if (window.ImageEncoder && (mime === 'image/avif' || mime === 'image/webp')) {
          (async function () {
            try {
              // Use OffscreenCanvas + transferToImageBitmap for the source frame
              var off = new OffscreenCanvas(w, h);
              off.getContext('2d').drawImage(bitmap.image, 0, 0, w, h);
              var src = off.transferToImageBitmap();
              var encoder = new ImageEncoder({
                type: mime,
                quality: quality,
              });
              var encoded = await encoder.encode({ image: src });
              var arr = new Uint8Array(encoded.data);
              // Convert to base64 without data: prefix
              var bin = ''; for (var i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
              resolve(btoa(bin));
              return;
            } catch (e) {
              canvasFallback();
            }
          })();
          return;
        }

        canvasFallback();
      });
    }

    var _avifProbeResult = null;
    function canEncodeAvif() {
      if (_avifProbeResult !== null) return Promise.resolve(_avifProbeResult);
      return new Promise(function (resolve) {
        var canvas = document.createElement('canvas');
        canvas.width = 8; canvas.height = 8;
        try {
          canvas.toBlob(function (b) {
            _avifProbeResult = !!(b && b.size > 0 && b.type === 'image/avif');
            resolve(_avifProbeResult);
          }, 'image/avif', 0.5);
        } catch (e) { _avifProbeResult = false; resolve(false); }
      });
    }

    async function uploadSvgFallback(file) {
      var fr = new FileReader();
      var dataUrl = await new Promise(function (res, rej) {
        fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(file);
      });
      var base64 = dataUrl.replace(/^data:[^,]+,/, '');
      var stem = (file.name || 'img').replace(/\.[^.]+$/, '').replace(/[^a-z0-9._-]/gi, '-').toLowerCase().slice(0, 40);
      var filename = stem + '-' + Date.now().toString(36) + '.svg';
      var resp = await fetch('/api/admin/upload', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: filename, contentType: 'image/svg+xml', data: base64, folder: 'assets/article-img' })
      });
      if (!resp.ok) { status('✗ SVG 上傳失敗', 'error'); return; }
      var data = await resp.json();
      if (!insertArticleBlock('<figure><img src="' + data.url + '" alt="" /><figcaption>(編輯說明文字)</figcaption></figure>')) return;
      status('✓ SVG 已插入', 'success');
    }

    // ─────────────────────────────────────────────────────────────────
    // v31: Notion-style slash commands — when caret is at start of an
    // empty line and user types `/`, show a popup of block types.
    // ─────────────────────────────────────────────────────────────────
    var slashMenu = document.createElement('div');
    slashMenu.id = 'hs-slash-menu';
    slashMenu.style.cssText = 'position:absolute;background:var(--surface,#fff);color:var(--ink,#2a2620);border:1px solid var(--border,#dcd5c8);border-radius:10px;box-shadow:0 14px 38px -14px rgba(15,23,42,.32);padding:6px 0;min-width:220px;z-index:9999;display:none;font-size:13px;font-family:Inter,"Noto Sans TC",sans-serif';
    document.body.appendChild(slashMenu);

    var SLASH_COMMANDS = [
      { key: 'h2',     label: 'H2 二級標題',    icon: 'H₂', cmd: function () { document.execCommand('formatBlock', false, '<h2>'); } },
      { key: 'h3',     label: 'H3 三級標題',    icon: 'H₃', cmd: function () { document.execCommand('formatBlock', false, '<h3>'); } },
      { key: 'p',      label: '段落',           icon: '¶',  cmd: function () { document.execCommand('formatBlock', false, '<p>'); } },
      { key: 'ul',     label: '項目列表',       icon: '•',  cmd: function () { document.execCommand('insertUnorderedList', false, null); } },
      { key: 'ol',     label: '數字編號',       icon: '1.', cmd: function () { document.execCommand('insertOrderedList', false, null); } },
      { key: 'quote',  label: '引言',           icon: '❝',  cmd: function () { document.execCommand('formatBlock', false, '<blockquote>'); } },
      { key: 'myth',   label: '迷思 / 事實 卡', icon: '⚖',  cmd: function () { insertArticleBlock('<div class="myth-card"><div class="myth" data-zh="迷思: 在這裡寫迷思" data-en="Myth: Write the misconception here">迷思: 在這裡寫迷思</div><div class="truth" data-zh="真相: 在這裡寫真相" data-en="Fact: Write the explanation here">真相: 在這裡寫真相</div></div><p></p>'); } },
      // M-01: was <hs-redflag>, a custom element whose only implementation lived
      // in assets/components.js — a file no page ever loaded, so the tag rendered
      // unstyled. Emits the class-based markup real articles use, which app.css
      // styles via .hs-redflag-box / -title / -list.
      // The data-zh/data-en pairs are NOT decoration: _sanitizeForSerialize only
      // syncs elements that already carry them, and _gen_en_pages.py only swaps
      // paired elements — without them the author's Chinese is committed verbatim
      // into the /en/ mirror.
      { key: 'redflag',label: '紅旗警告框',     icon: '🚩', cmd: function () { insertArticleBlock('<section class="hs-redflag-box"><h3 class="hs-redflag-title">🚨 <span data-zh="警訊辨識" data-en="Red flags">警訊辨識</span></h3><ul class="hs-redflag-list"><li data-zh="第一項警訊" data-en="First red flag">第一項警訊</li><li data-zh="第二項警訊" data-en="Second red flag">第二項警訊</li></ul></section><p></p>'); } },
      // M-01: same story — <hs-tldr> had no implementation. Articles carry a
      // `.tldr` paragraph; note there is NO `.tldr` rule in app.css — its look
      // comes from the utility classes and the inline colour copied here, so
      // they are load-bearing, not incidental. data-zh/data-en as above.
      { key: 'tldr',   label: 'TL;DR 引言',     icon: '✨', cmd: function () { insertArticleBlock('<p class="mt-6 text-[15.5px] leading-[1.95] tldr" style="color:var(--ink-2)" data-zh="3 句話精華:第一句 · 第二句 · 第三句。" data-en="Three-sentence summary: first · second · third.">3 句話精華:第一句 · 第二句 · 第三句。</p><p></p>'); } },
      { key: 'table',  label: '3×3 表格',       icon: '⊞',  cmd: function () { insertArticleBlock('<table class="dn"><thead><tr><th data-zh="欄 1" data-en="Column 1">欄 1</th><th data-zh="欄 2" data-en="Column 2">欄 2</th><th data-zh="欄 3" data-en="Column 3">欄 3</th></tr></thead><tbody><tr><td data-zh="" data-en=""></td><td data-zh="" data-en=""></td><td data-zh="" data-en=""></td></tr><tr><td data-zh="" data-en=""></td><td data-zh="" data-en=""></td><td data-zh="" data-en=""></td></tr></tbody></table><p></p>'); } },
      { key: 'mermaid',label: 'Mermaid 流程圖', icon: '↳',  cmd: function () { insertArticleBlock('<pre class="mermaid">flowchart TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Action]\n  B -->|No| D[End]</pre><p></p>'); } },
      { key: 'math',   label: 'KaTeX 公式 (block)', icon: '∑', cmd: function () { insertArticleBlock('<p>$$ P_{IOL} = A - 2.5 \\cdot AL - 0.9 \\cdot K $$</p>'); } },
      { key: 'hr',     label: '分隔線',         icon: '—',  cmd: function () { document.execCommand('insertHorizontalRule', false, null); } },
      { key: 'img',    label: '插入圖片',       icon: '📷', cmd: function () { document.getElementById('hs-adm-img-input').click(); } },
    ];

    var slashFilter = '';
    function showSlash() {
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      var rect = sel.getRangeAt(0).getBoundingClientRect();
      slashMenu.style.top = (window.scrollY + rect.bottom + 6) + 'px';
      slashMenu.style.left = (window.scrollX + rect.left) + 'px';
      slashMenu.style.display = 'block';
      renderSlash();
    }
    function hideSlash() { slashMenu.style.display = 'none'; slashFilter = ''; }
    function renderSlash() {
      var f = slashFilter.toLowerCase();
      var items = SLASH_COMMANDS.filter(function (c) {
        return !f || c.key.indexOf(f) >= 0 || c.label.indexOf(f) >= 0;
      });
      slashMenu.innerHTML = items.map(function (c, i) {
        return '<div class="hs-slash-item" data-key="' + c.key + '" style="padding:7px 14px;cursor:pointer;display:flex;gap:10px;align-items:center" tabindex="-1">' +
               '<span style="width:22px;text-align:center;font-weight:600;color:inherit">' + c.icon + '</span>' +
               '<span>' + c.label + '</span></div>';
      }).join('') || '<div style="padding:8px 14px;color:var(--muted,#6e6759);font-size:12px">沒有匹配命令</div>';
      // First item highlighted
      var first = slashMenu.querySelector('.hs-slash-item');
      if (first) first.style.background = 'var(--blue-soft,#f3f7fb)';
    }

    slashMenu.addEventListener('mousedown', function (e) { e.preventDefault(); });
    slashMenu.addEventListener('click', function (e) {
      var item = e.target.closest('.hs-slash-item');
      if (!item) return;
      var cmd = SLASH_COMMANDS.find(function (c) { return c.key === item.dataset.key; });
      if (cmd) {
        // Slash and filter keydowns are prevented, so there are no typed
        // characters to delete. Deleting here can erase existing author text.
        cmd.cmd();
      }
      hideSlash();
    });

    document.addEventListener('keydown', function (e) {
      if (isCompositionKey(e)) return;
      if (!DN.isAdminMode()) return;
      var inEditable = e.target && e.target.closest && e.target.closest('[contenteditable="true"]');
      if (!inEditable) return;

      if (slashMenu.style.display === 'block') {
        if (e.key === 'Escape') { hideSlash(); e.preventDefault(); return; }
        if (e.key === 'Enter')  {
          var first = slashMenu.querySelector('.hs-slash-item');
          if (first) { first.click(); e.preventDefault(); }
          return;
        }
        if (e.key === 'Backspace' && slashFilter.length === 0) { hideSlash(); return; }
        if (e.key === 'Backspace') { slashFilter = slashFilter.slice(0, -1); renderSlash(); return; }
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) { slashFilter += e.key.toLowerCase(); renderSlash(); e.preventDefault(); return; }
      } else if (e.key === '/') {
        // Only fire on blank line / start of paragraph
        var sel = window.getSelection();
        if (sel && sel.isCollapsed) {
          var range = sel.getRangeAt(0);
          var atStart = range.startOffset === 0 ||
                        (range.startContainer.nodeType === 3 && /^\s*$/.test(range.startContainer.textContent.slice(0, range.startOffset)));
          if (atStart) {
            e.preventDefault();
            slashFilter = '';
            showSlash();
          }
        }
      }
    });
    document.addEventListener('click', function (e) {
      if (!slashMenu.contains(e.target)) hideSlash();
    });

    // v37.14 — central sanitizer used by preview, save, and draft. The
    // runtime injects many helper elements (#hs-progress, #hs-mobile-nav,
    // #hs-totop, #hs-cmdk-*, #hs-font-sizer, #hs-slash-menu, .hs-img-lightbox)
    // that should NEVER be serialized into the source HTML. It also syncs
    // user edits back to data-zh / data-en attributes so the bilingual
    // toggle (DN.applyTextOnly) doesn't revert them on next page load.
    function _stripRuntimeHelpers(clone) {
      // 1. Strip admin chrome + runtime-injected helpers.
      // ⚠ COUPLING (M-06): the runtime-helper portion of this array MUST stay
      //   identical to RUNTIME_HELPER_IDS in api/admin/_save.js — the only
      //   client-extra entries are the 3 admin-chrome ids on the next line.
      //   Drift is caught by _check_runtime_helper_sync.py (in _check_all.py).
      // ⚠ Do not write a literal `[` or `]` anywhere inside this array, comments
      //   included: the checker locates the array with a bracket-free regex and
      //   will refuse to run (fail-closed, so it shows up immediately).
      ['hs-admin-bar', 'hs-admin-status', 'hs-admin-css',
       // Runtime-injected helper widgets — these are re-injected by blog-shared.js
       'hs-progress', 'hs-mobile-nav', 'hs-mobile-nav-style', 'hs-totop',
       'hs-cmdk-overlay', 'hs-cmdk-style', 'hs-cmdk-modal', 'hs-cmdk-pf-fallback',
       'hs-font-sizer', 'hs-font-size-style',
       'hs-slash-menu',
       'hs-resume-toast', 'hs-resume-style', 'hs-en-banner', 'hs-bookmark', 'hs-print-btn',
       'hs-theme-toggle', 'hs-theme-style', 'hs-breadcrumb-runtime', 'hs-reading-meta',
       'hsMobileMenuBtn', 'hsMobileDrawer',
       'hs-article-hero', 'hs-img-css',
       'hs-inline-toc', 'hs-toc-float', 'hs-inline-cta',
       'hs-prevnext', 'hs-pn-css', 'hs-vt-css',
       'hs-new-pulse-css', 'hs-calc-css', 'hs-dialog-css', 'hs-dict-css', 'hs-tf-css',
       'hs-reveal-css', 'hs-admin-runtime', 'hs-vercel-insights',
       // M-06: one-shot style injectors previously missed (no authored mount).
       'hs-related-css', 'hs-blog-filter-css', 'hs-spotlight-css',
       // M-07: DN._buildCalc widgets. Both mount paths are live — /tools uses
       // authored data-calc placeholders, while injectArticleCalculators()
       // passes no mountSel on 3 article slugs and falls back to a generated
       // <section id="hs-<calc>-wrap">. Strip BOTH ids: the wrapper (so the
       // fallback section doesn't accumulate) and the inner widget (so the
       // authored placeholder is emptied and rebuilt on reload). Verified: no
       // article carries an authored element with any of these ids, so unlike
       // hs-related / hs-feedback / hs-support there is no mount to destroy.
       'hs-osdi', 'hs-deq5', 'hs-snellen', 'hs-se', 'hs-floater-rf',
       'hs-osdi-wrap', 'hs-deq5-wrap', 'hs-snellen-wrap', 'hs-se-wrap', 'hs-floater-rf-wrap',
      ].forEach(function (id) {
        clone.querySelectorAll('#' + id).forEach(function (el) { el.remove(); });
      });
      // 2. Strip image lightbox container (.hs-img-lightbox is injected on demand)
      clone.querySelectorAll('.hs-img-lightbox').forEach(function (el) { el.remove(); });
      return clone;
    }

    function _sanitizeForSerialize(clone) {
      _stripRuntimeHelpers(clone);
      // 3. Strip apply sentinels (markers from _apply_*.py — re-added by build)
      clone.querySelectorAll('[data-critical-css], [data-a11y-vt-applied], [data-i-series-applied]').forEach(function (el) {
        // Keep critical CSS itself; it'll be regenerated. Remove only the marker comment style.
      });
      // 4. Remove contentEditable / spellcheck attributes from editable nodes
      clone.querySelectorAll('[contenteditable]').forEach(function (el) {
        el.removeAttribute('contenteditable');
        el.removeAttribute('spellcheck');
      });
      // 5. Remove body.hs-admin class
      var body = clone.querySelector('body');
      if (body) body.classList.remove('hs-admin');
      clone.removeAttribute('data-theme');
      // Table instruction language follows the live UI, not the saved source.
      var sourceTableGroups = Array.from(baseDocument.querySelectorAll('.hs-table-scroll'));
      clone.querySelectorAll('.hs-diagram-mode').forEach(function (el) {
        var source = baseDocument.getElementById(el.id);
        if (!source) return;
        var language = source.getAttribute('lang');
        if (language === null) el.removeAttribute('lang');
        else el.setAttribute('lang', language);
        if (source.hasAttribute('open')) el.setAttribute('open', source.getAttribute('open'));
        else el.removeAttribute('open');
      });
      clone.querySelectorAll('.hs-table-scroll,.hs-table-hint').forEach(function (el) {
        var source = el.classList.contains('hs-table-hint') ? baseDocument.getElementById(el.id) :
          sourceTableGroups.find(function (node) { return node.getAttribute('aria-labelledby') === el.getAttribute('aria-labelledby'); });
        if (!source) return;
        var language = source.getAttribute('lang');
        if (language === null) el.removeAttribute('lang');
        else el.setAttribute('lang', language);
      });
      // Language switching changes these styles only for the live editor.
      // Keep the authenticated source defaults in drafts, history and saves.
      ['proseZh', 'proseEn'].forEach(function (proseId) {
        var node = clone.querySelector('#' + proseId), source = baseDocument.getElementById(proseId);
        if (!node || !source) return;
        var style = source.getAttribute('style');
        if (style === null) node.removeAttribute('style');
        else node.setAttribute('style', style);
      });
      // 6. CRITICAL: sync edited text back to data-zh / data-en. The runtime
      //    DN.applyTextOnly() reads these attributes on page load and
      //    overwrites innerHTML/textContent — without this sync, every edit
      //    would revert after the language toggle script ran.
      // M-06: scope the write-back to the EDITABLE article body only. data-zh /
      //    data-en also appear on nav / footer / breadcrumb / hero, which the
      //    admin never edits (they are not contentEditable). Mirroring their
      //    innerHTML on every save would bake runtime-rendered markup into the
      //    source across the whole page. Restrict to <article> (#proseZh /
      //    #proseEn + the editable title / figcaption inside article.max-w-3xl).
      var currentLang = (document.documentElement.lang || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh';
      var attrName = 'data-' + currentLang;
      var syncSeen = [];
      var roots = Array.from(clone.querySelectorAll('article.max-w-3xl, #proseZh, #proseEn'));
      if (clone.matches('article.max-w-3xl, #proseZh, #proseEn')) roots.unshift(clone);
      roots.forEach(function (root) {
        Array.from(root.querySelectorAll('[data-zh],[data-en]')).reverse().forEach(function (el) {
          if (el.closest('.hs-diagram-mode')) return;
          if (syncSeen.indexOf(el) !== -1) return;   // dedup nested roots
          syncSeen.push(el);
          if (el.hasAttribute(attrName)) {
            // Plain text must stay literal: innerHTML entity-encodes >, < and
            // &, but DN.applyTextOnly renders non-markup values as textContent.
            // Keep actual element markup for rich text, and mark literal tag
            // syntax per language so it cannot become markup on reopening.
            var textMarker = 'data-hs-text-' + currentLang;
            var autoMarker = 'data-hs-editor-text-' + currentLang;
            var explicitText = el.hasAttribute('data-hs-text') || (el.hasAttribute(textMarker) && !el.hasAttribute(autoMarker));
            if (el.hasAttribute(autoMarker)) {
              el.removeAttribute(textMarker);
              el.removeAttribute(autoMarker);
            }
            var textOnly = explicitText || el.childElementCount === 0;
            var value = textOnly ? el.textContent : el.innerHTML;
            if (textOnly && !explicitText && /<\/?[a-z]/i.test(value)) {
              el.setAttribute(textMarker, '');
              el.setAttribute(autoMarker, '');
            }
            el.setAttribute(attrName, value);
          }
        });
      });
      // Reader controls are translated UI, not authored article text. Restore
      // their authenticated children after bilingual write-back, without
      // replacing the mode element or touching the adjacent author SVG.
      clone.querySelectorAll('.hs-diagram-mode').forEach(function (el) {
        var source = baseDocument.getElementById(el.id);
        if (!source || !source.classList.contains('hs-diagram-mode')) return;
        var controls = prepareEditableArticle(source.cloneNode(true));
        el.replaceChildren.apply(el, Array.from(controls.childNodes));
      });
      return clone;
    }

    function snapshotHtml() {
      // Preserve the authenticated document outside the editable article.
      var edited = _sanitizeForSerialize(document.documentElement.cloneNode(true));
      prepareEditableArticle(edited.querySelector('article.max-w-3xl'));
      var snapshot = baseDocument.documentElement.cloneNode(true);
      snapshot.querySelector('article.max-w-3xl').replaceWith(edited.querySelector('article.max-w-3xl'));
      metadataWorkspace.apply(snapshot);
      // The authenticated hero can now contain generated reader information.
      // Strip helpers from the complete snapshot, without rewriting untouched
      // hero/footer bilingual text from the editor's currently selected language.
      _stripRuntimeHelpers(snapshot);
      return '<!doctype html>\n' + snapshot.outerHTML;
    }

    function refreshMetadataHeading() {
      if (!metadataWorkspace) return;
      var current = document.querySelector('h1');
      if (!current) return;
      if (article.contains(current) && metadataWorkspace.element.querySelector('#hs-editor-titleZh').disabled) return;
      var lang = (document.documentElement.lang || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh';
      var heading = metadataWorkspace.heading(lang);
      if (!heading) return;
      var copy = document.importNode(prepareEditableArticle(heading), true);
      current.replaceWith(copy); DN._bilingualCache = null; registerEditables();
    }

    // Local, unsaved content preview. No Git write or deployment is implied.
    document.getElementById('hs-adm-preview').addEventListener('click', function () {
      var preview, url;
      try {
        var doc = parseEditorDocument(snapshotHtml());
        var base = doc.createElement('base');
        base.href = window.location.origin + window.location.pathname;
        doc.querySelectorAll('base').forEach(function (node) { node.remove(); });
        doc.head.prepend(base);
        doc.documentElement.setAttribute('data-hs-editor-preview-path', window.location.pathname);
        doc.documentElement.lang = document.documentElement.lang;
        var runtime = doc.createElement('script');
        runtime.src = '/blog/editor-preview.js?v=20260713';
        // Register fragment handling before authored page initializers.
        base.after(runtime);
        var notice = doc.createElement('aside');
        notice.setAttribute('role', 'note');
        notice.setAttribute('data-zh', '本機內容預覽：包含尚未儲存的修改，未代表正式上線。');
        notice.setAttribute('data-en', 'Local content preview: includes unsaved changes; not a production release.');
        notice.textContent = notice.getAttribute('data-zh');
        notice.style.cssText = 'padding:12px 16px;background:#fff4db;color:#243b56;text-align:center';
        doc.body.prepend(notice);
        url = URL.createObjectURL(new Blob(['<!doctype html>\n' + doc.documentElement.outerHTML], { type: 'text/html' }));
        // noopener makes window.open return null even on success. Open inert
        // blank first and disown it synchronously before loading any content.
        preview = window.open('about:blank', '_blank');
        if (!preview) throw new Error('瀏覽器封鎖新視窗，請允許此網站開啟預覽後重試。');
        preview.opener = null;
        preview.location.replace(url);
        var cleanup = setInterval(function () {
          if (preview.closed) { clearInterval(cleanup); URL.revokeObjectURL(url); }
        }, 1000);
        status('已開啟本機內容預覽；修改尚未保存或正式上線。');
      } catch (e) {
        if (preview) preview.close();
        if (url) URL.revokeObjectURL(url);
        status('無法開啟本機預覽：' + e.message, 'error');
      }
    });

    // Show admin status when scrolling past article
    function status(msg, cls) {
      var s = document.getElementById('hs-admin-status');
      if (!s) {
        s = document.createElement('div');
        s.id = 'hs-admin-status';
        s.setAttribute('aria-live', 'polite');
        bar.prepend(s);
      }
      s.setAttribute('role', cls === 'error' ? 'alert' : 'status');
      s.textContent = msg;
      if (cls === 'error') s.style.background = '#dc2626';
      else if (cls === 'success') s.style.background = '#166534';
      else s.style.background = '#243b56';
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'hs-admin-state', slug: slug, message: msg }, window.location.origin);
      }
    }

    // Serialize draft writes/deletes so an older autosave cannot finish after a
    // newer snapshot or recreate a draft after a successful GitHub save.
    var draftQueue = Promise.resolve();
    var draftTimer, savePending = false, allowClose = false, leavePending = false, draftCleanupPending = false, saveReceiptPending = false;
    var draftCleanupRecovery = false;
    function storeDraft(html, sha) {
      var write = draftQueue.then(function () { return DN.saveDraft(slug, html, sha); });
      draftQueue = write.catch(function () {});
      return write;
    }
    function removeDraft() {
      draftCleanupPending = true;
      draftCleanupRecovery = false;
      var remove = draftQueue.then(async function () {
        var result = await DN.deleteDraft(slug);
        if (!result || !result.deleted) throw new Error('無法確認本機草稿已清除');
        draftCleanupPending = false;
        return result;
      });
      draftQueue = remove.catch(function () {});
      return remove;
    }
    function markDirty(event) {
      if (editHistory && !restoringHistory) {
        var type = event && event.inputType || '';
        var key = /^(insertText|insertCompositionText|insertFromComposition)$/.test(type) ? 'text' : /^delete/.test(type) ? 'delete' : '';
        if (key) key += ':' + (metadataWorkspace.element.contains(event.target) ? event.target.id : JSON.stringify(historyPath(article, event.target)));
        editHistory.record(historyState(), key);
        updateHistoryButtons();
      }
      DN._adminDirty = true;
      allowClose = false;
      if (!reviewPanel.hidden && reviewSnapshot !== null && !reviewChangeNotice) {
        reviewChangeNotice = document.createElement('p');
        reviewChangeNotice.textContent = '健檢／對照後又有修改，請重新健檢或比較版本；下方是前次讀取內容。';
        reviewPanel.prepend(reviewChangeNotice);
      }
      if (!savePending) status(saveReceiptPending ? '保存版本尚未確認；請先重新讀取確認。本機草稿將自動保存。' : '尚有未儲存至 GitHub 的修改；本機草稿將自動保存。');
      clearTimeout(draftTimer);
      draftTimer = setTimeout(function () {
        if (!DN._adminDirty) return;
        persistLatestDraft().then(function (saved) {
          if (saved && !savePending) status(saveReceiptPending ? '本機草稿已保存；GitHub 保存版本尚未確認，請先重新讀取確認。' : '本機草稿已保存；尚未儲存至 GitHub。');
        });
      }, 5000);
    }
    function historyPath(root, node) {
      var path = [];
      while (node && node !== root) {
        if (!node.parentNode) return null;
        path.unshift(Array.prototype.indexOf.call(node.parentNode.childNodes, node)); node = node.parentNode;
      }
      return node === root ? path : null;
    }
    function historyNode(root, path) {
      if (!path) return null;
      for (var i = 0; root && i < path.length; i++) root = root.childNodes[path[i]];
      return root;
    }
    function historySelection(root) {
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount || !article.contains(sel.anchorNode) || !article.contains(sel.focusNode)) return null;
      return { anchor: historyPath(root, sel.anchorNode), anchorOffset: sel.anchorOffset,
        focus: historyPath(root, sel.focusNode), focusOffset: sel.focusOffset };
    }
    function historyState(selectionOnly) {
      var selection = historySelection(article);
      if (selectionOnly && !selection) return null;
      var copy = article.cloneNode(true);
      var anchor = selection && historyNode(copy, selection.anchor), focus = selection && historyNode(copy, selection.focus);
      _sanitizeForSerialize(copy); prepareEditableArticle(copy);
      if (selection && copy.contains(anchor) && copy.contains(focus)) {
        selection.anchor = historyPath(copy, anchor); selection.focus = historyPath(copy, focus);
      } else selection = null;
      // Pre-input only needs clean selection paths, not another complete HTML
      // string. Input bubbles through one document listener below.
      if (selectionOnly) return selection;
      // Keep typing history bounded to author text, not repeated page CSS,
      // JSON-LD and bootstraps. Full source is assembled for durable snapshots.
      return { html: copy.outerHTML, metadata: metadataWorkspace.historyValues(), selection: selection,
        field: historyField() };
    }
    function historyField() {
      var active = document.activeElement;
      return metadataWorkspace.element.contains(active) ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
    }
    function updateHistoryButtons() {
      document.getElementById('hs-adm-undo').disabled = !editHistory.canUndo;
      document.getElementById('hs-adm-redo').disabled = !editHistory.canRedo;
    }
    function moveHistory(redo) {
      if (!editHistory || composing) return;
      var state = redo ? editHistory.redo() : editHistory.undo();
      if (!state) return;
      restoringHistory = true;
      try {
        var doc = parseEditorDocument(state.html);
        metadataWorkspace.restoreHistory(state.metadata);
        var restored = prepareEditableArticle(doc.querySelector('article.max-w-3xl'));
        article.replaceChildren.apply(article, Array.from(restored.childNodes).map(function (node) { return document.importNode(node, true); }));
        DN._bilingualCache = null;
        var lang = (document.documentElement.lang || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh';
        applyRestoredLanguage(lang);
        var zh = article.querySelector('#proseZh'), en = article.querySelector('#proseEn');
        registerEditables();
        refreshMetadataHeading();
        var selection = state.selection;
        var anchor = selection && historyNode(article, selection.anchor), focus = selection && historyNode(article, selection.focus);
        var focused = false;
        if (state.field) {
          var field = document.getElementById(state.field.id);
          if (field && metadataWorkspace.element.contains(field)) {
            metadataWorkspace.element.open = true;
            field.focus(); field.setSelectionRange(state.field.start, state.field.end); focused = true;
          }
        }
        if (!focused && anchor && focus) {
          var element = anchor.nodeType === 1 ? anchor : anchor.parentElement;
          var editable = element.closest('[contenteditable="true"]');
          if (editable && editable.getClientRects().length) {
            editable.focus();
            try { window.getSelection().setBaseAndExtent(anchor, selection.anchorOffset, focus, selection.focusOffset); focused = true; } catch (e) {}
          }
        }
        if (!focused) {
          var fallback = (en && lang === 'en' ? en : zh || article).querySelector('[contenteditable="true"]');
          if (fallback) {
            fallback.focus(); var range = document.createRange(); range.selectNodeContents(fallback); range.collapse(false);
            window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
          }
        }
        markDirty(); updateHistoryButtons();
      } finally { restoringHistory = false; }
    }
    async function persistLatestDraft() {
      try {
        var html;
        do {
          html = snapshotHtml();
          var saved = await storeDraft(html, baseSha);
          if (!saved || !saved.source) throw new Error('瀏覽器儲存空間無法寫入');
        } while (snapshotHtml() !== html);
        return true;
      } catch (e) {
        status('本機草稿保存失敗，請保持編輯器開啟並儲存至 GitHub：' + e.message, 'error');
        return false;
      }
    }
    DN.adminBeforeClose = async function () {
      if (imageDialog.open) {
        showImageIssue('尚未離開：請先套用或取消圖片替代文字。'); return false;
      }
      if (savePending) {
        status('正在儲存至 GitHub，請等候結果後再離開。');
        return false;
      }
      if (leavePending) { status('正在處理本機草稿，請稍候再離開。'); return false; }
      leavePending = true;
      try {
        clearTimeout(draftTimer);
        if (draftCleanupPending && !draftCleanupRecovery) {
          try { await removeDraft(); }
          catch (e) { status('本機草稿清除尚未確認，請保持編輯器開啟：' + e.message, 'error'); return false; }
        }
        // A Git receipt plus a retained recovery copy permits normal closing;
        // it does not assert that inaccessible older drafts have been deleted.
        // Write again on close so input after the receipt is preserved too.
        if ((DN._adminDirty || draftCleanupRecovery) && !(await persistLatestDraft())) return false;
        allowClose = true;
        return true;
      } finally { leavePending = false; }
    };
    window.addEventListener('beforeunload', function (event) {
      if (!allowClose && (imageDialog.open || DN._adminDirty || savePending || draftCleanupPending || leavePending)) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    if ('navigation' in window) window.navigation.addEventListener('navigate', function (event) {
      if (event.downloadRequest !== null || allowClose) return;
      if (imageDialog.open) {
        event.preventDefault(); showImageIssue('尚未離開：請先套用或取消圖片替代文字。'); return;
      }
      if (!DN._adminDirty) return;
      // Firefox can emit a second navigate event with downloadRequest=null
      // for the same download. Only exempt an explicit link to our live export.
      var sourceLink = event.sourceElement;
      if (sourceLink && sourceLink.tagName === 'A' && sourceLink.hasAttribute('download') &&
          sourceLink.href === event.destination.url && editorDownloadUrls.has(event.destination.url)) return;
      if (!confirm('有未儲存的編輯。確定要離開？')) event.preventDefault();
    });
    if (!conflictDraft) status('目前沒有未儲存的修改。GitHub 保存與正式上線為不同狀態。');

    function approveSaveChecks(html) {
      var check = editorReview.checkDocument(parseEditorDocument(html));
      if (check.blocking.length) {
        showChecks(html); status('尚未送出保存：' + check.blocking.join(' '), 'error'); return false;
      }
      // Existing article warnings remain visible in manual checks. Only new
      // warnings interrupt saving, so legacy translation stubs don't nag on
      // every ordinary edit. This is author review, never medical approval.
      var existing = new Set(editorReview.checkDocument(baseDocument).issues.map(function (issue) { return issue.key; }));
      var added = check.issues.filter(function (issue) { return !existing.has(issue.key); });
      if (added.length) {
        showChecks(html);
        var messages = Array.from(new Set(added.map(function (issue) { return issue.message; })));
        if (!confirm('保存前健檢發現新問題：\n' + messages.join('\n') + '\n\n仍要保存這次內容嗎？正式上線仍須另外確認。')) {
          status('尚未送出保存；修改仍在目前分頁，本機草稿會持續保存。'); return false;
        }
      }
      return true;
    }

    async function doSave() {
      if (imageDialog && imageDialog.open) {
        showImageIssue('尚未送出保存：請先套用或取消圖片替代文字。'); return;
      }
      // v34: navigator.locks guards against 2 admin tabs committing the
      // same slug at once (would otherwise produce duplicate commits or
      // GitHub Contents API SHA conflict).
      if (savePending) return;
      if (leavePending) { status('正在處理本機草稿，請稍候再儲存至 GitHub。'); return; }
      if (saveReceiptPending) { status('無法確認保存版本；編輯內容仍在目前分頁，請保留編輯器並先重新讀取確認，勿重複儲存。', 'error'); return; }
      if (saveConflict) { status('保存版本已改變，請先比較版本並重新開啟編輯；目前內容與草稿仍保留。', 'error'); return; }
      if (!metadataWorkspace.valid()) { status('尚未送出保存：請填寫文章標題與搜尋標題。', 'error'); return; }
      try {
        var approvedHtml = snapshotHtml();
        if (!approveSaveChecks(approvedHtml)) return;
      } catch (e) { status('尚未送出保存：無法完成正文健檢，請保持編輯器開啟。', 'error'); return; }
      savePending = true;
      invalidatePublication();
      comparisonRequest++;
      if (comparisonController) comparisonController.abort();
      clearReviewPanel();
      reviewPanel.hidden = true;
      try { return await DN.withLock('admin-save:' + slug, function () { return _doSaveInner(approvedHtml); }); }
      finally { savePending = false; }
    }
    async function _doSaveInner(approvedHtml) {
      // Capture full <html> (modified DOM) and send to /api/admin/save
      var btn = document.getElementById('hs-adm-save');
      btn.disabled = true; btn.textContent = '儲存中⋯';
      status('正在 commit 到 GitHub⋯');
      var gitSaved = false, saveAccepted = false;
      try {
        var html = snapshotHtml();
        if (html !== approvedHtml && !approveSaveChecks(html)) return;
        clearTimeout(draftTimer);

        // v33: OPFS draft snapshot before network attempt — survives crash mid-save
        var backup = await storeDraft(html, baseSha);
        if (!backup || !backup.source) status('本機草稿未能保存；仍嘗試儲存至 GitHub，請保持編輯器開啟。', 'error');

        try {
          var resp = await fetch('/api/admin/save', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug: slug, html: html, baseSha: baseSha })
          });
          if (resp.ok) {
            saveAccepted = true;
            saveReceiptPending = true;
            var data = await resp.json();
            if (!data || data.ok !== true || !/^[a-f0-9]{40}$/.test(data.sha || '') ||
                typeof data.commit !== 'string' ||
                !(data.commit === '' && data.noop === true || /^[a-f0-9]{40}$/.test(data.commit))) {
              throw new Error('保存回應缺少有效的文章版本或 commit');
            }
            gitSaved = true;
            saveReceiptPending = false;
            savedCommit = data.commit || (baseSha === data.sha ? savedCommit : '');
            baseSha = data.sha;
            metadataWorkspace.accepted(parseEditorDocument(html), data.catalogSha);
            // Typing while the request is in flight must remain an unsaved draft.
            clearTimeout(draftTimer);
            DN._adminDirty = snapshotHtml() !== html;
            var recoverySaved = true;
            if (DN._adminDirty) {
              recoverySaved = await persistLatestDraft();
              if (recoverySaved) status('GitHub 已保存上一版；仍有較新的修改尚未儲存。', 'success');
            } else {
              await removeDraft();
              DN._adminDirty = snapshotHtml() !== html;
              if (DN._adminDirty) {
                recoverySaved = await persistLatestDraft();
                if (recoverySaved) status('GitHub 已保存上一版；仍有較新的修改尚未儲存。', 'success');
              } else {
                status('✓ 已保存至 GitHub (commit: ' + (data.commit || '-').slice(0, 7) + ')；正式上線尚未確認。', 'success');
              }
            }
            try {
              if (recoverySaved && window.parent && window.parent !== window) {
                window.parent.postMessage(
                  { type: 'hs-admin-saved', slug: slug, commit: data.commit, dirty: DN._adminDirty },
                  window.location.origin
                );
              }
            } catch (e2) {}
          } else {
            var err = await resp.json().catch(function () { return {}; });
            status('✗ 儲存失敗: ' + (err.error || resp.status), 'error');
            if (resp.status === 409) {
              saveConflict = true;
              status('文章已有新保存版本；草稿與目前內容仍保留，請使用「比較版本」再重新開啟編輯。', 'error');
            }
          }
        } catch (e) {
          if (saveAccepted) throw e;
          // v33: Network failure → queue for Background Sync v2 replay
          if (await DN.queueOfflineSave(slug, html, baseSha)) {
            if (!saveReceiptPending) status('⚠ 離線中 — 已排入背景同步,連線後自動重送', 'error');
          } else {
            status('✗ 網路錯誤；未確認排入背景同步，請保持編輯器開啟並確認本機草稿：' + (e.message || e), 'error');
          }
        }
      } catch (e) {
        if (saveAccepted && !gitSaved) {
          var recovered = await persistLatestDraft();
          status('伺服器已回應，但無法確認保存版本；' +
            (recovered ? '已保存最新本機草稿，請先重新讀取確認，勿重複儲存：' : '本機草稿未能保存，編輯內容僅在目前分頁，請保持編輯器開啟並先確認來源版本：') +
            (e.message || e), 'error');
          return;
        }
        if (gitSaved && draftCleanupPending) {
          draftCleanupRecovery = await persistLatestDraft();
          status('GitHub 已保存；本機草稿清除尚未確認；' +
            (draftCleanupRecovery ? '已保存最新復原草稿，可返回後台。' : '復原草稿未能保存，請保持編輯器開啟。') +
            (e.message || e), 'error');
          return;
        }
        status((gitSaved ? 'GitHub 已保存；本機草稿處理失敗，請保持編輯器開啟：'
          : '✗ 儲存失敗，請保持編輯器開啟：') + (e.message || e), 'error');
      } finally {
        btn.disabled = false; btn.textContent = '💾 儲存至 GitHub';
      }
    }

    // Content input schedules a local draft; toolbar input is not author text.
    document.addEventListener('input', function (event) {
      if (!DN.isAdminMode() || !article.contains(event.target)) return;
      markDirty(event);
    });
    editHistory = historyModule.createHistory(historyState());
    updateHistoryButtons();

    // v33: On enter admin mode, check for unsaved draft + offer to restore
    Promise.resolve(initialDraft).then(function (draft) {
      if (!draft || !draft.html) return;
      if (draft.baseSha !== baseSha) {
        status('有其他版本的草稿，已保留；請先比較內容，避免覆蓋新版本。', 'error');
        return;
      }
      // Compare draft timestamp to "load time" — if draft newer than 30s old, prompt
      if ((Date.now() - (draft.ts || 0)) > 30 * 86400 * 1000) return;  // older than 30 days, ignore
      if (confirm('偵測到未儲存的草稿（' + new Date(draft.ts).toLocaleString() + '）— 要恢復嗎？')) {
        // Replace just the article body — don't blow away the page chrome
        var doc = parseEditorDocument(draft.html);
        var newProse = doc.querySelector('article.max-w-3xl');
        var curProse = article;
        if (newProse && curProse) {
          metadataWorkspace.restore(doc);
          prepareEditableArticle(newProse);
          curProse.replaceChildren.apply(curProse, Array.from(newProse.childNodes).map(function (node) {
            return document.importNode(node, true);
          }));
          registerEditables();
          DN._bilingualCache = null;
          applyRestoredLanguage(DN.detectLang());
          refreshMetadataHeading();
          markDirty();
        }
      } else {
        removeDraft().catch(function (e) { status('無法清除本機草稿，請保留編輯器：' + e.message, 'error'); });
      }
    }).catch(function (e) { status('無法復原草稿；原草稿與目前編輯內容仍保留：' + e.message, 'error'); });
})(window.DN, window, document);
