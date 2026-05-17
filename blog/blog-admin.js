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
(function (DN, window, document) {
  if (!DN || !DN.isAdminMode || !DN.isAdminMode()) return;
  var article = document.querySelector('article.max-w-3xl');
    if (!article) return;
    var slug = DN.currentSlug && DN.currentSlug();
    if (!slug) return;
    if (document.getElementById('hs-admin-bar')) return;

    // Inject admin styles (scoped, doesn't affect normal article render)
    if (!document.getElementById('hs-admin-css')) {
      var st = document.createElement('style');
      st.id = 'hs-admin-css';
      st.textContent =
        '#hs-admin-bar{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9998;background:#fff;border:1px solid var(--border,#dcd5c8);border-radius:14px;box-shadow:0 18px 40px -12px rgba(15,23,42,.32);padding:10px 12px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;max-width:calc(100vw - 32px)}' +
        '#hs-admin-bar button, #hs-admin-bar select{padding:6px 10px;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer;border:1px solid var(--border,#dcd5c8);background:#fff;color:var(--ink-2,#5e574e);transition:all .12s}' +
        '#hs-admin-bar button:hover{border-color:var(--blue-deep,#243b56);color:var(--blue-deep,#243b56)}' +
        '#hs-admin-bar button.primary{background:var(--blue-deep,#243b56);color:#fff;border-color:var(--blue-deep,#243b56)}' +
        '#hs-admin-bar button.primary:hover{color:#fff;opacity:.9}' +
        '#hs-admin-bar button.danger{background:#fff;color:#dc2626;border-color:#fca5a5}' +
        '#hs-admin-bar button.danger:hover{background:#fee2e2;color:#991b1b}' +
        '#hs-admin-bar .sep{width:1px;height:22px;background:var(--border,#dcd5c8);margin:0 4px}' +
        '#hs-admin-bar .group-label{font-size:10.5px;color:var(--muted,#8b8378);font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-right:4px}' +
        '#hs-admin-status{position:fixed;left:50%;bottom:80px;transform:translateX(-50%);background:#243b56;color:#fff;padding:9px 18px;border-radius:9999px;font-size:13px;z-index:9999;box-shadow:0 12px 28px -8px rgba(58,90,124,.55)}' +
        // Tag the editable area visually
        '[contenteditable="true"]{outline:2px dashed rgba(58,90,124,.35);outline-offset:4px;border-radius:6px;transition:outline-color .15s}' +
        '[contenteditable="true"]:focus{outline-color:var(--blue-deep,#243b56);outline-style:solid}' +
        '[contenteditable="true"]:hover{outline-color:rgba(58,90,124,.6)}' +
        // Hide non-editable chrome in admin to reduce distraction
        'body.hs-admin #hs-share, body.hs-admin #hs-author-bio, body.hs-admin #hs-bmc, body.hs-admin #hs-related, body.hs-admin #hs-prevnext, body.hs-admin #hs-feedback, body.hs-admin #hs-print-btn, body.hs-admin #hs-bookmark, body.hs-admin #hs-totop{display:none!important}' +
        'body.hs-admin .mag-footer{opacity:.4}';
      document.head.appendChild(st);
    }
    document.body.classList.add('hs-admin');

    // Make article structures editable (h1, h2, h3, paragraphs, list items,
    // figcaptions, table cells). We deliberately skip code / SVG / link href
    // editing for safety.
    var EDITABLE_SEL = '#proseZh h1, #proseZh h2, #proseZh h3, #proseZh p, #proseZh li, #proseZh td, #proseZh th, #proseZh figcaption, #proseZh blockquote, .myth-card .myth, .myth-card .truth, article.max-w-3xl > h1, article.max-w-3xl figcaption';
    document.querySelectorAll(EDITABLE_SEL).forEach(function (el) {
      el.contentEditable = 'true';
      el.spellcheck = false;
      // v33: mark dirty on input so Navigation API guard can prompt
      el.addEventListener('input', function () { DN._adminDirty = true; }, { once: true });
    });

    // Build the floating toolbar
    var bar = document.createElement('div');
    bar.id = 'hs-admin-bar';
    bar.innerHTML =
      '<span class="group-label">字型</span>' +
      '<select id="hs-adm-font" title="Font family"><option value="">(預設)</option><option value="Noto Serif TC, Georgia, serif">Noto Serif TC</option><option value="Inter, sans-serif">Inter</option><option value="JetBrains Mono, monospace">JetBrains Mono</option><option value="Noto Sans TC, sans-serif">Noto Sans TC</option><option value="Fraunces, serif">Fraunces</option></select>' +
      '<select id="hs-adm-size" title="Font size"><option value="">(預設)</option><option value="13px">13</option><option value="14px">14</option><option value="15.5px">15.5</option><option value="17px">17</option><option value="20px">20</option><option value="24px">24</option><option value="32px">32</option></select>' +
      '<span class="sep"></span>' +
      '<button type="button" title="粗體 (Cmd/Ctrl+B)" data-cmd="bold"><b>B</b></button>' +
      '<button type="button" title="斜體 (Cmd/Ctrl+I)" data-cmd="italic"><i>I</i></button>' +
      '<button type="button" title="底線 (Cmd/Ctrl+U)" data-cmd="underline"><u>U</u></button>' +
      '<button type="button" title="刪除線" data-cmd="strikeThrough">S̶</button>' +
      '<span class="sep"></span>' +
      '<button type="button" title="項目符號" data-cmd="insertUnorderedList">• 項目</button>' +
      '<button type="button" title="數字編號" data-cmd="insertOrderedList">1. 編號</button>' +
      '<button type="button" title="連結 (Cmd/Ctrl+K)" data-cmd="link">🔗 連結</button>' +
      '<button type="button" title="圖片 — 拖曳/貼上/點選" id="hs-adm-img">📷 圖片</button>' +
      '<button type="button" title="預覽 (新視窗)" id="hs-adm-preview">👁 預覽</button>' +
      '<button type="button" title="清除格式" data-cmd="removeFormat">⨯ 清除</button>' +
      '<span class="sep"></span>' +
      '<button type="button" class="primary" id="hs-adm-save">💾 儲存</button>' +
      '<button type="button" class="danger" id="hs-adm-cancel">取消</button>' +
      '<button type="button" id="hs-adm-exit" title="離開 admin 模式">←離開</button>' +
      '<input type="file" id="hs-adm-img-input" accept="image/*" hidden />';
    document.body.appendChild(bar);

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
      try { range.surroundContents(span); } catch (ex) { /* selection across multiple nodes — fallback no-op */ }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', function (e) {
      if (!(e.metaKey || e.ctrlKey)) return;
      var k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); doSave(); }
    });

    // Save / cancel
    document.getElementById('hs-adm-save').addEventListener('click', doSave);
    document.getElementById('hs-adm-cancel').addEventListener('click', function () {
      if (confirm('確定要丟棄所有未儲存的編輯嗎？')) location.reload();
    });
    document.getElementById('hs-adm-exit').addEventListener('click', function () {
      location.href = location.pathname;
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
        document.execCommand('insertHTML', false, snippet);
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

        // WebCodecs ImageEncoder fast path (Chrome 132+ for AVIF, 122+ for WebP)
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
              // Fall through to canvas.toBlob
            }
          })();
          return;
        }

        // Fallback: canvas.toBlob
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(bitmap.image, 0, 0, w, h);
        canvas.toBlob(function (blob) {
          if (!blob) { resolve(null); return; }
          var fr = new FileReader();
          fr.onload = function () { resolve(fr.result.replace(/^data:[^,]+,/, '')); };
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        }, mime, quality);
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
      document.execCommand('insertHTML', false, '<figure><img src="' + data.url + '" alt="" /><figcaption>(編輯說明文字)</figcaption></figure>');
      status('✓ SVG 已插入', 'success');
    }

    // ─────────────────────────────────────────────────────────────────
    // v31: Notion-style slash commands — when caret is at start of an
    // empty line and user types `/`, show a popup of block types.
    // ─────────────────────────────────────────────────────────────────
    var slashMenu = document.createElement('div');
    slashMenu.id = 'hs-slash-menu';
    slashMenu.style.cssText = 'position:absolute;background:#fff;border:1px solid #dcd5c8;border-radius:10px;box-shadow:0 14px 38px -14px rgba(15,23,42,.32);padding:6px 0;min-width:220px;z-index:9999;display:none;font-size:13px;font-family:Inter,"Noto Sans TC",sans-serif';
    document.body.appendChild(slashMenu);

    var SLASH_COMMANDS = [
      { key: 'h2',     label: 'H2 二級標題',    icon: 'H₂', cmd: function () { document.execCommand('formatBlock', false, '<h2>'); } },
      { key: 'h3',     label: 'H3 三級標題',    icon: 'H₃', cmd: function () { document.execCommand('formatBlock', false, '<h3>'); } },
      { key: 'p',      label: '段落',           icon: '¶',  cmd: function () { document.execCommand('formatBlock', false, '<p>'); } },
      { key: 'ul',     label: '項目列表',       icon: '•',  cmd: function () { document.execCommand('insertUnorderedList', false, null); } },
      { key: 'ol',     label: '數字編號',       icon: '1.', cmd: function () { document.execCommand('insertOrderedList', false, null); } },
      { key: 'quote',  label: '引言',           icon: '❝',  cmd: function () { document.execCommand('formatBlock', false, '<blockquote>'); } },
      { key: 'myth',   label: '迷思 / 事實 卡', icon: '⚖',  cmd: function () { document.execCommand('insertHTML', false, '<div class="myth-card"><div class="myth">迷思: 在這裡寫迷思</div><div class="truth">真相: 在這裡寫真相</div></div><p></p>'); } },
      { key: 'redflag',label: '紅旗警告框',     icon: '🚩', cmd: function () { document.execCommand('insertHTML', false, '<hs-redflag title="警訊辨識"><ul><li>第一項警訊</li><li>第二項警訊</li></ul></hs-redflag><p></p>'); } },
      { key: 'tldr',   label: 'TL;DR 引言',     icon: '✨', cmd: function () { document.execCommand('insertHTML', false, '<hs-tldr><p>3 句話精華:第一句 · 第二句 · 第三句。</p></hs-tldr><p></p>'); } },
      { key: 'table',  label: '3×3 表格',       icon: '⊞',  cmd: function () { document.execCommand('insertHTML', false, '<table class="dn"><thead><tr><th>欄 1</th><th>欄 2</th><th>欄 3</th></tr></thead><tbody><tr><td></td><td></td><td></td></tr><tr><td></td><td></td><td></td></tr></tbody></table><p></p>'); } },
      { key: 'mermaid',label: 'Mermaid 流程圖', icon: '↳',  cmd: function () { document.execCommand('insertHTML', false, '<pre class="mermaid">flowchart TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Action]\n  B -->|No| D[End]</pre><p></p>'); } },
      { key: 'math',   label: 'KaTeX 公式 (block)', icon: '∑', cmd: function () { document.execCommand('insertHTML', false, '<p>$$ P_{IOL} = A - 2.5 \\cdot AL - 0.9 \\cdot K $$</p>'); } },
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
               '<span style="width:22px;text-align:center;font-weight:600;color:#3a5a7c">' + c.icon + '</span>' +
               '<span>' + c.label + '</span></div>';
      }).join('') || '<div style="padding:8px 14px;color:#8b8378;font-size:12px">沒有匹配命令</div>';
      // First item highlighted
      var first = slashMenu.querySelector('.hs-slash-item');
      if (first) first.style.background = '#f3f7fb';
    }

    slashMenu.addEventListener('click', function (e) {
      var item = e.target.closest('.hs-slash-item');
      if (!item) return;
      var cmd = SLASH_COMMANDS.find(function (c) { return c.key === item.dataset.key; });
      if (cmd) {
        // Remove the typed `/<filter>` chars before applying
        var sel = window.getSelection();
        if (sel && sel.rangeCount && slashFilter !== undefined) {
          for (var i = 0; i <= slashFilter.length; i++) document.execCommand('delete', false, null);
        }
        cmd.cmd();
      }
      hideSlash();
    });

    document.addEventListener('keydown', function (e) {
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
    function _sanitizeForSerialize(clone) {
      // 1. Strip admin chrome
      ['hs-admin-bar', 'hs-admin-status', 'hs-admin-css',
       // Runtime-injected helper widgets — these are re-injected by blog-shared.js
       'hs-progress', 'hs-mobile-nav', 'hs-totop',
       'hs-cmdk-overlay', 'hs-cmdk-style',
       'hs-font-sizer',
       'hs-slash-menu',
       'hs-resume-toast', 'hs-en-banner', 'hs-bookmark', 'hs-print-btn',
       'hs-related-css', 'hs-feedback',
      ].forEach(function (id) {
        var el = clone.querySelector('#' + id); if (el) el.remove();
      });
      // 2. Strip image lightbox container (.hs-img-lightbox is injected on demand)
      clone.querySelectorAll('.hs-img-lightbox').forEach(function (el) { el.remove(); });
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
      // 6. CRITICAL: sync edited text back to data-zh / data-en. The runtime
      //    DN.applyTextOnly() reads these attributes on page load and
      //    overwrites innerHTML/textContent — without this sync, every edit
      //    would revert after the language toggle script ran.
      var currentLang = (document.documentElement.lang || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh';
      clone.querySelectorAll('[data-zh],[data-en]').forEach(function (el) {
        var attrName = 'data-' + currentLang;
        if (el.hasAttribute(attrName)) {
          // Mirror current rendered content into the attribute. innerHTML
          // preserves <strong>, <a> etc. that the editor may have inserted.
          el.setAttribute(attrName, el.innerHTML);
        }
      });
      return clone;
    }

    // Live preview — opens a fresh tab with the saved-state HTML rendered (without ?admin=1)
    document.getElementById('hs-adm-preview').addEventListener('click', function () {
      var clone = _sanitizeForSerialize(document.documentElement.cloneNode(true));
      var html = '<!doctype html>\n' + clone.outerHTML;
      var blob = new Blob([html], { type: 'text/html' });
      var url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    });

    // Show admin status when scrolling past article
    function status(msg, cls) {
      var s = document.getElementById('hs-admin-status');
      if (!s) {
        s = document.createElement('div');
        s.id = 'hs-admin-status';
        document.body.appendChild(s);
      }
      s.textContent = msg;
      if (cls === 'error') s.style.background = '#dc2626';
      else if (cls === 'success') s.style.background = '#16a34a';
      else s.style.background = '#243b56';
    }

    async function doSave() {
      // v34: navigator.locks guards against 2 admin tabs committing the
      // same slug at once (would otherwise produce duplicate commits or
      // GitHub Contents API SHA conflict).
      return DN.withLock('admin-save:' + slug, _doSaveInner);
    }
    async function _doSaveInner() {
      // Capture full <html> (modified DOM) and send to /api/admin/save
      var btn = document.getElementById('hs-adm-save');
      btn.disabled = true; btn.textContent = '儲存中⋯';
      status('正在 commit 到 GitHub⋯');
      try {
        var clone = _sanitizeForSerialize(document.documentElement.cloneNode(true));
        var html = '<!doctype html>\n' + clone.outerHTML;

        // v33: OPFS draft snapshot before network attempt — survives crash mid-save
        DN.saveDraft(slug, html).catch(function () {});

        try {
          var resp = await fetch('/api/admin/save', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug: slug, html: html })
          });
          if (resp.ok) {
            var data = await resp.json();
            status('✓ 已儲存 (commit: ' + (data.commit || '-').slice(0, 7) + ')', 'success');
            setTimeout(function () { var s = document.getElementById('hs-admin-status'); if (s) s.remove(); }, 3500);
            DN._adminDirty = false;
            DN.deleteDraft(slug);  // commit succeeded → drop local draft
            try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'hs-admin-saved', slug: slug, commit: data.commit }, '*'); } catch (e2) {}
          } else {
            var err = await resp.json().catch(function () { return {}; });
            status('✗ 儲存失敗: ' + (err.error || resp.status), 'error');
          }
        } catch (e) {
          // v33: Network failure → queue for Background Sync v2 replay
          if (DN.queueOfflineSave(slug, html)) {
            status('⚠ 離線中 — 已排入背景同步,連線後自動重送', 'error');
          } else {
            status('✗ 網路錯誤: ' + (e.message || e), 'error');
          }
        }
      } finally {
        btn.disabled = false; btn.textContent = '💾 儲存';
      }
    }

    // v33: Periodic OPFS draft autosave every 5s while editing
    var draftTimer;
    document.addEventListener('input', function () {
      if (!DN.isAdminMode()) return;
      clearTimeout(draftTimer);
      draftTimer = setTimeout(function () {
        var clone = _sanitizeForSerialize(document.documentElement.cloneNode(true));
        DN.saveDraft(slug, '<!doctype html>\n' + clone.outerHTML).catch(function () {});
      }, 5000);
    });

    // v33: On enter admin mode, check for unsaved draft + offer to restore
    DN.loadDraft(slug).then(function (draft) {
      if (!draft || !draft.html) return;
      // Compare draft timestamp to "load time" — if draft newer than 30s old, prompt
      if ((Date.now() - (draft.ts || 0)) > 30 * 86400 * 1000) return;  // older than 30 days, ignore
      if (confirm('偵測到未儲存的草稿（' + new Date(draft.ts).toLocaleString() + '）— 要恢復嗎？')) {
        // Replace just the article body — don't blow away the page chrome
        var parser = new DOMParser();
        var doc = parser.parseFromString(draft.html, 'text/html');
        var newProse = doc.querySelector('#proseZh, article.max-w-3xl');
        var curProse = document.querySelector('#proseZh, article.max-w-3xl');
        if (newProse && curProse) {
          curProse.innerHTML = newProse.innerHTML;
          DN._adminDirty = true;
        }
      } else {
        DN.deleteDraft(slug);
      }
    });
})(window.DN, window, document);
