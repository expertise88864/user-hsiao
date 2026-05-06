/* ============================================================
 * HsiaoEye - shared runtime (zh / en)
 *
 * Includes:
 *   - language detection + 2-button / dropdown toggle (toggles #proseZh/#proseEn)
 *   - reading progress bar at top
 *   - scroll-to-top button
 *   - mobile hamburger drawer
 *   - reveal-on-scroll, view transitions
 *   - service worker registration + update toast
 *   - prefetch on idle
 *   - article: inline TOC (collapsible, top of article)
 *   - article: floating TOC sidebar (desktop ≥1280px)
 *   - article: scroll-position memory + "continue reading" toast
 *   - article: reading time + last-reviewed badges
 *   - article: floating font sizer (S/M/L)
 *   - article: share toolbar
 *   - article: author bio block
 *   - article: related articles (with ItemList JSON-LD)
 *   - read-tracker: localStorage record of which articles user has read
 *   - footer year, BMC button (skipped if URL empty)
 *
 * Usage on every page:
 *   <script src="/blog/blog-shared.js" defer></script>
 *   <script>document.addEventListener('DOMContentLoaded',()=>DN.initBlog({}));</script>
 * ============================================================ */
(function () {
  const DN = (window.DN = window.DN || {});

  // ---------- brand constants ----------
  DN.SITE_NAME       = 'HsiaoEye';
  DN.SITE_TITLE      = '蕭閔謙醫師 眼科筆記';
  DN.SITE_URL        = 'https://hsiao.chendermatologist.com';
  DN.AUTHOR_NAME_ZH  = '蕭閔謙 醫師';
  DN.AUTHOR_NAME_EN  = 'Min-Chien Hsiao, MD';
  DN.AUTHOR_AFFIL_ZH = '眼科';
  DN.AUTHOR_AFFIL_EN = 'Ophthalmology';
  DN.AUTHOR_ROLE_ZH  = '住院醫師 R2';
  DN.AUTHOR_ROLE_EN  = 'Ophthalmology Resident';
  DN.AUTHOR_EMAIL    = 'f94001115@gmail.com';
  DN.BMC_URL         = '';
  DN.AUTHOR_BIO_URL  = '/about';
  DN.READ_KEY        = 'hs:read:slugs';

  // ---------- article catalog ----------
  DN.ARTICLES = [
    { slug:'dry-eye-myths',              title:'乾眼症 8 大迷思',         title_en:'8 Dry-Eye Myths',                        cat:'myth', tag:'乾眼症',     tag_en:'Dry Eye',         date:'2026-05-04' },
    { slug:'pediatric-myopia-control',   title:'兒童近視控制 8 大迷思',  title_en:'8 Pediatric Myopia Control Myths',         cat:'myth', tag:'兒童近視',   tag_en:'Myopia control',  date:'2026-05-04' },
    { slug:'floaters-retinal-detachment', title:'飛蚊症 6 大警訊',         title_en:'6 Floater Red Flags',                     cat:'myth', tag:'飛蚊症',     tag_en:'Floaters',        date:'2026-05-04' }
  ];
  DN.totalArticles = DN.ARTICLES.length;

  DN.currentSlug = function () {
    const m = location.pathname.match(/\/blog\/([a-z0-9-]+)\/?$/i);
    return m ? m[1] : null;
  };

  // ---------- language helpers ----------
  DN.LANGS = [
    { code: 'zh', label: '中文',    htmlLang: 'zh-TW' },
    { code: 'en', label: 'English', htmlLang: 'en'    }
  ];
  DN.LANG_KEY = { 'zh': 'zh', 'en': 'en' };

  DN.cookieGet = function (name) {
    const found = document.cookie.split('; ').find(c => c.startsWith(name + '='));
    return found ? decodeURIComponent(found.split('=').slice(1).join('=')) : null;
  };
  DN.cookieSet = function (name, val, days) {
    const exp = new Date(Date.now() + (days || 365) * 86400e3).toUTCString();
    document.cookie = name + '=' + encodeURIComponent(val) + '; expires=' + exp + '; path=/; SameSite=Lax';
  };

  DN.detectLang = function () {
    const fromCookie = DN.cookieGet('hs_lang');
    if (fromCookie && DN.LANG_KEY[fromCookie]) return fromCookie;
    const stored = (function(){ try { return localStorage.getItem('hs_lang'); } catch(e){ return null; } })();
    if (stored && DN.LANG_KEY[stored]) return stored;
    const nav = (navigator.language || 'zh').toLowerCase();
    if (nav.startsWith('zh')) return 'zh';
    if (nav.startsWith('en')) return 'en';
    return 'zh';
  };

  DN.setLang = function (code) {
    if (!DN.LANG_KEY[code]) return;
    try { localStorage.setItem('hs_lang', code); } catch (e) {}
    DN.cookieSet('hs_lang', code);
  };

  DN.translate = function (el, lang) {
    const order = lang === 'en' ? ['en', 'zh'] : ['zh', 'en'];
    for (const k of order) if (el.dataset[k] != null) return el.dataset[k];
    return null;
  };

  DN.applyTextOnly = function (lang) {
    const meta = DN.LANGS.find(function (l) { return l.code === lang; }) || DN.LANGS[0];
    document.documentElement.lang = meta.htmlLang;
    document.querySelectorAll('[data-zh],[data-en]').forEach(function (el) {
      const txt = DN.translate(el, lang);
      if (txt == null) return;
      if (/[<&]/.test(txt) && /<\/?[a-z]/i.test(txt)) el.innerHTML = txt;
      else el.textContent = txt;
    });
  };

  DN.bindLangToggle = function (onChange) {
    const toggle = document.getElementById('langToggle');
    if (!toggle) return;
    if (toggle.tagName === 'SELECT') {
      toggle.value = DN.detectLang();
      toggle.addEventListener('change', function () {
        const lang = toggle.value;
        if (!DN.LANG_KEY[lang]) return;
        DN.setLang(lang);
        if (typeof onChange === 'function') onChange(lang);
      });
      return;
    }
    const buttons = toggle.querySelectorAll('button[data-lang]');
    function syncActive(curLang) {
      buttons.forEach(function (b) { b.classList.toggle('active', b.dataset.lang === curLang); });
    }
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const lang = btn.dataset.lang;
        if (!DN.LANG_KEY[lang]) return;
        DN.setLang(lang);
        syncActive(lang);
        if (typeof onChange === 'function') onChange(lang);
      });
    });
    syncActive(DN.detectLang());
  };

  // ---------- reading progress bar ----------
  DN.addReadingProgress = function () {
    if (document.getElementById('hs-progress')) return;
    const bar = document.createElement('div');
    bar.id = 'hs-progress';
    bar.style.cssText = 'position:fixed;top:0;left:0;height:3px;background:linear-gradient(90deg,#8fb3d4,#243b56);z-index:60;width:0;transition:width .12s linear;pointer-events:none';
    document.body.appendChild(bar);
    function update() {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      bar.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + '%';
    }
    document.addEventListener('scroll', update, { passive: true });
    update();
  };

  // ---------- scroll to top ----------
  DN.addScrollToTop = function () {
    if (document.getElementById('hs-totop')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'hs-totop';
    btn.setAttribute('aria-label', 'Scroll to top');
    btn.innerHTML = '↑';
    btn.style.cssText = 'position:fixed;right:18px;bottom:24px;width:42px;height:42px;border-radius:50%;background:linear-gradient(180deg,#8fb3d4,#3a5a7c);color:#fff;border:1px solid rgba(36,59,86,.5);box-shadow:0 8px 20px -8px rgba(36,59,86,.55);cursor:pointer;display:none;align-items:center;justify-content:center;z-index:50;font-size:18px;line-height:1';
    btn.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    document.body.appendChild(btn);
    document.addEventListener('scroll', function () {
      btn.style.display = window.scrollY > 800 ? 'flex' : 'none';
    }, { passive: true });
  };

  // ---------- prefetch on idle ----------
  DN.prefetchOnIdle = function () {
    if (!('IntersectionObserver' in window)) return;
    const idle = window.requestIdleCallback || function (cb) { return setTimeout(cb, 1500); };
    idle(function () {
      const seen = new Set();
      const io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          const a = e.target;
          const href = a.getAttribute('href');
          if (!href || seen.has(href)) return;
          seen.add(href);
          if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
          if (/^https?:\/\//.test(href) && !href.startsWith(location.origin)) return;
          const link = document.createElement('link');
          link.rel = 'prefetch';
          link.href = href;
          link.as = 'document';
          document.head.appendChild(link);
          io.unobserve(a);
        });
      }, { rootMargin: '200px' });
      document.querySelectorAll('a[href^="/"], a[href^="' + location.origin + '"]').forEach(function (a) {
        io.observe(a);
      });
    });
  };

  // ---------- reveal on scroll ----------
  DN.bindRevealOnScroll = function () {
    if (!('IntersectionObserver' in window)) return;
    const targets = document.querySelectorAll('.reveal, .article-list-item, .myth-card');
    if (!targets.length) return;
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    targets.forEach(function (el, i) {
      el.style.opacity = el.style.opacity || '0';
      el.style.transform = el.style.transform || 'translateY(10px)';
      el.style.transition = 'opacity .35s cubic-bezier(.2,.7,.2,1) ' + Math.min(i * 25, 200) + 'ms, transform .35s cubic-bezier(.2,.7,.2,1) ' + Math.min(i * 25, 200) + 'ms';
      io.observe(el);
    });
    const styleEl = document.createElement('style');
    styleEl.textContent = '.reveal.visible, .article-list-item.visible, .myth-card.visible { opacity:1 !important; transform:translateY(0) !important; }';
    document.head.appendChild(styleEl);
  };

  // ---------- view transitions ----------
  DN.bindViewTransitions = function () {
    if (!document.startViewTransition) return;
    document.addEventListener('click', function (e) {
      const a = e.target.closest('a');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href) return;
      if (a.target === '_blank' || a.hasAttribute('download')) return;
      if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;
      const url = new URL(href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      e.preventDefault();
      document.startViewTransition(function () {
        location.href = url.href;
      });
    });
  };

  // ---------- SW update toast ----------
  DN.bindSWUpdateToast = function (registration) {
    if (!registration) return;
    function showToast() {
      if (document.getElementById('hs-sw-toast')) return;
      const toast = document.createElement('div');
      toast.id = 'hs-sw-toast';
      toast.style.cssText = 'position:fixed;left:50%;bottom:max(24px,env(safe-area-inset-bottom));transform:translateX(-50%);background:#243b56;color:#fff;padding:10px 16px 10px 18px;border-radius:9999px;display:flex;align-items:center;gap:12px;font-size:13px;font-weight:600;z-index:60;box-shadow:0 12px 28px -8px rgba(36,59,86,.55);max-width:calc(100vw - 24px);';
      toast.innerHTML = '<span>網站已更新 — </span><button style="background:#fff;color:#3a5a7c;border:none;padding:5px 12px;border-radius:9999px;font-weight:700;font-size:12px;cursor:pointer">重新載入</button>';
      toast.querySelector('button').addEventListener('click', function () {
        if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        location.reload();
      });
      document.body.appendChild(toast);
    }
    if (registration.waiting) showToast();
    registration.addEventListener('updatefound', function () {
      const sw = registration.installing;
      if (!sw) return;
      sw.addEventListener('statechange', function () {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) showToast();
      });
    });
  };

  // ---------- mobile drawer ----------
  DN.injectMobileMenu = function () {
    if (document.getElementById('hsMobileMenuBtn')) return;
    const header = document.querySelector('header.sticky') || document.querySelector('header');
    if (!header) return;
    const headerInner = header.querySelector('.h-16') || header.querySelector('div.flex.items-center.justify-between') || header.firstElementChild;
    if (!headerInner) return;
    const right = headerInner.lastElementChild;

    const btn = document.createElement('button');
    btn.id = 'hsMobileMenuBtn';
    btn.type = 'button';
    btn.className = 'sm:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--border)] bg-white mr-2';
    btn.setAttribute('aria-label', 'Menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>';
    right.parentNode.insertBefore(btn, right);

    const drawer = document.createElement('div');
    drawer.id = 'hsMobileDrawer';
    drawer.className = 'hidden sm:hidden border-t border-[var(--border)]';
    drawer.style.cssText = 'background:rgba(247,245,240,.98);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);max-height:calc(100vh - 64px);overflow-y:auto;-webkit-overflow-scrolling:touch';
    drawer.innerHTML =
      '<nav class="max-w-6xl mx-auto px-5 py-4 flex flex-col gap-1">' +
        '<a href="/" class="block px-3 py-2.5 rounded-lg text-[14px] font-semibold" style="color:var(--blue-deep)" data-zh="首頁" data-en="Home"></a>' +
        '<a href="/blog/" class="block px-3 py-2.5 rounded-lg text-[14px] font-semibold" style="color:var(--blue-deep)" data-zh="衛教文章" data-en="Articles"></a>' +
        '<a href="/about" class="block px-3 py-2.5 rounded-lg text-[14px] font-semibold" style="color:var(--blue-deep)" data-zh="關於我" data-en="About"></a>' +
      '</nav>';
    header.appendChild(drawer);

    function open()  { drawer.classList.remove('hidden'); btn.setAttribute('aria-expanded', 'true');  document.body.style.overflow = 'hidden'; }
    function close() { drawer.classList.add('hidden');    btn.setAttribute('aria-expanded', 'false'); document.body.style.overflow = ''; }
    btn.addEventListener('click', function () { drawer.classList.contains('hidden') ? open() : close(); });
    drawer.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', close); });
    window.addEventListener('resize', function () { if (window.innerWidth >= 640) close(); });
  };

  // ---------- footer year ----------
  DN.injectFooterYear = function () {
    const el = document.getElementById('yr');
    if (el) el.textContent = String(new Date().getFullYear());
  };

  // ---------- read tracker (localStorage) ----------
  DN.getReadSlugs = function () {
    try {
      const raw = localStorage.getItem(DN.READ_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  };
  DN.markRead = function (slug) {
    if (!slug) return;
    const slugs = DN.getReadSlugs();
    if (slugs.indexOf(slug) !== -1) return;
    slugs.push(slug);
    try {
      localStorage.setItem(DN.READ_KEY, JSON.stringify(slugs));
      window.dispatchEvent(new CustomEvent('hs-read-updated'));
    } catch (e) {}
  };
  DN.getReadCount = function () { return DN.getReadSlugs().length; };
  DN.resetRead = function () {
    try { localStorage.removeItem(DN.READ_KEY); window.dispatchEvent(new CustomEvent('hs-read-updated')); } catch (e) {}
  };

  // ---------- read-progress widget (mounts into #hs-read-progress) ----------
  DN.injectReadProgress = function () {
    const host = document.getElementById('hs-read-progress');
    if (!host) return;
    function render() {
      const read = DN.getReadCount();
      const total = DN.totalArticles || 1;
      const pct = Math.round((read / total) * 100);
      host.innerHTML =
        '<div style="background:#fff;border:1px solid var(--border);border-radius:14px;padding:18px 22px;box-shadow:0 1px 2px rgba(15,23,42,.04)">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">' +
            '<div>' +
              '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.22em;color:var(--blue-deep);font-weight:700;margin-bottom:2px" data-zh="閱讀進度" data-en="Reading progress">閱讀進度</div>' +
              '<div style="font-family:\'Noto Serif TC\',Georgia,serif;font-size:18px;font-weight:700;color:var(--ink)">' +
                '<span data-zh="已讀" data-en="Read">已讀</span> <span style="color:var(--blue-deep)">' + read + '</span> / ' + total + ' <span data-zh="篇" data-en="">篇</span> ' +
                '<span style="font-size:13px;font-weight:500;color:var(--ink-2)">(' + pct + '%)</span>' +
              '</div>' +
            '</div>' +
            (read > 0
              ? '<button id="hs-read-reset" type="button" style="background:#fff;border:1px solid var(--border);color:var(--ink-2);padding:5px 10px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer" data-zh="重設" data-en="Reset">重設</button>'
              : '<span style="font-size:12px;color:var(--muted);font-style:italic" data-zh="閱讀後自動記錄" data-en="Auto-tracked">閱讀後自動記錄</span>') +
          '</div>' +
          '<div style="height:8px;background:var(--blue-soft);border-radius:9999px;overflow:hidden">' +
            '<div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,#8fb3d4,#243b56);transition:width .35s ease;"></div>' +
          '</div>' +
        '</div>';
      const resetBtn = document.getElementById('hs-read-reset');
      if (resetBtn) resetBtn.addEventListener('click', function () {
        if (confirm('要重設閱讀進度嗎? 本動作只會清除本裝置的紀錄,不會影響網站。')) DN.resetRead();
      });
    }
    render();
    window.addEventListener('hs-read-updated', render);
    window.addEventListener('storage', function (e) { if (e.key === DN.READ_KEY) render(); });
  };

  // ---------- article reading-meta (reading time + last-reviewed badges) ----------
  DN.addReadingMeta = function () {
    const proseEl = document.getElementById('proseZh') || document.querySelector('article .prose');
    if (!proseEl) return;
    if (document.getElementById('hs-reading-meta')) return;

    const text = (proseEl.textContent || '').replace(/\s+/g, '');
    const cjkChars = (text.match(/[一-鿿]/g) || []).length;
    const otherWords = (text.match(/[A-Za-z0-9]+/g) || []).length;
    const minutes = Math.max(2, Math.round(cjkChars / 350 + otherWords / 200));

    const slug = DN.currentSlug();
    const meta = (DN.ARTICLES || []).find(function (a) { return a.slug === slug; });
    const reviewedDate = meta ? meta.date : '';

    const h1 = document.querySelector('article h1, section h1');
    const lead = h1 ? h1.parentElement.querySelector('p') : null;
    const target = lead || h1;
    if (!target) return;

    const bar = document.createElement('div');
    bar.id = 'hs-reading-meta';
    bar.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:14px 0 8px;font-size:12.5px;color:var(--ink-2);';
    bar.innerHTML =
      '<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:9999px;background:var(--blue-soft);border:1px solid #b8cfe3;color:var(--blue-deep);font-weight:600">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
        '<span data-zh="閱讀約 ' + minutes + ' 分鐘" data-en="' + minutes + ' min read">閱讀約 ' + minutes + ' 分鐘</span>' +
      '</span>' +
      (reviewedDate ?
      '<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:9999px;background:#dcfce7;border:1px solid #86efac;color:#14532d;font-weight:600">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
        '<span data-zh="最後審閱 ' + reviewedDate + '" data-en="Last reviewed · ' + reviewedDate + '">最後審閱 ' + reviewedDate + '</span>' +
      '</span>' : '') +
      '<a href="' + DN.AUTHOR_BIO_URL + '" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:9999px;background:#fff;border:1px solid var(--border);color:var(--blue-deep);text-decoration:none;font-weight:600" data-zh="蕭閔謙 醫師 →" data-en="Dr. Hsiao →">蕭閔謙 醫師 →</a>';
    target.parentNode.insertBefore(bar, target.nextSibling);

    if (slug) DN.markRead(slug);
  };

  // ---------- inline TOC (collapsible card at top of article) ----------
  DN.addInlineTOC = function () {
    const proseEl = document.getElementById('proseZh') || document.querySelector('article .prose');
    if (!proseEl) return;
    if (document.getElementById('hs-inline-toc')) return;
    const h2s = proseEl.querySelectorAll('h2[id]');
    if (h2s.length < 3) return;

    const details = document.createElement('details');
    details.id = 'hs-inline-toc';
    details.open = true;
    details.style.cssText = 'margin:18px 0 24px;background:linear-gradient(135deg,#f3f7fb 0%,#e6eef6 100%);border:1px solid #b8cfe3;border-radius:14px;padding:0;overflow:hidden';

    const summary = document.createElement('summary');
    summary.style.cssText = 'cursor:pointer;list-style:none;padding:14px 18px;font-size:13px;font-weight:700;color:var(--blue-deep);display:flex;align-items:center;justify-content:space-between;gap:8px;user-select:none';
    summary.innerHTML =
      '<span style="display:inline-flex;align-items:center;gap:8px">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>' +
          '<line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>' +
        '</svg>' +
        '<span data-zh="本篇大綱" data-en="In this article">本篇大綱</span>' +
        '<span style="font-size:11px;font-weight:600;color:var(--ink-2);opacity:.7">· ' + h2s.length + ' 段</span>' +
      '</span>' +
      '<span style="font-size:11px;color:var(--ink-2);opacity:.7" data-zh="點擊收合" data-en="Click to collapse">點擊收合</span>';
    details.appendChild(summary);

    // Match each h2[id] in proseZh with its English counterpart in proseEn (id + "-en")
    const proseEnInline = document.getElementById('proseEn');
    function attrEscInline(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

    const ol = document.createElement('ol');
    ol.style.cssText = 'list-style:none;counter-reset:toc;padding:4px 18px 14px;margin:0;display:flex;flex-direction:column;gap:2px';
    h2s.forEach(function (h, i) {
      const idZh = h.id;
      const textZh = (h.textContent || ('Section ' + (i + 1))).trim();
      const enH = proseEnInline ? proseEnInline.querySelector('#' + idZh + '-en') : null;
      const textEn = (enH && (enH.textContent || '').trim()) || textZh;
      const li = document.createElement('li');
      li.style.cssText = 'counter-increment:toc;position:relative;padding:5px 4px 5px 32px';
      li.innerHTML =
        '<span style="position:absolute;left:0;top:5px;width:24px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:700;color:var(--blue-deep);background:#fff;border:1px solid #b8cfe3;border-radius:6px">' + (i + 1) + '</span>' +
        '<a href="#' + idZh + '" data-toc-inline="' + idZh + '" data-zh="' + attrEscInline(textZh) + '" data-en="' + attrEscInline(textEn) + '" style="display:block;color:var(--ink-2);text-decoration:none;font-size:13.5px;line-height:1.6;font-weight:500">' + textZh + '</a>';
      ol.appendChild(li);
    });
    details.appendChild(ol);

    const articleEl = document.querySelector('article');
    if (articleEl && articleEl.firstElementChild) {
      const h1 = articleEl.querySelector('h1');
      if (h1 && h1.parentNode) h1.parentNode.insertBefore(details, h1.nextSibling);
      else articleEl.insertBefore(details, articleEl.firstElementChild);
    } else {
      proseEl.parentNode.insertBefore(details, proseEl);
    }

    ol.addEventListener('click', function (e) {
      const a = e.target.closest('a[data-toc-inline]');
      if (!a) return;
      e.preventDefault();
      const id = a.dataset.tocInline;
      const target = document.getElementById(id);
      if (target) {
        const top = target.getBoundingClientRect().top + window.pageYOffset - 80;
        window.scrollTo({ top: top, behavior: 'smooth' });
        history.pushState(null, '', '#' + id);
      }
    });
  };

  // ---------- floating sidebar TOC (desktop ≥1280px) ----------
  DN.addFloatingTOC = function () {
    if (window.innerWidth < 1280) return;
    const proseEl = document.getElementById('proseZh') || document.querySelector('article .prose');
    if (!proseEl) return;
    const h2s = proseEl.querySelectorAll('h2[id]');
    if (h2s.length < 3) return;
    if (document.getElementById('hs-toc-float')) return;

    const aside = document.createElement('aside');
    aside.id = 'hs-toc-float';
    aside.style.cssText = 'position:fixed;left:max(16px,calc(50% - 720px));top:120px;width:200px;max-height:calc(100vh - 160px);overflow-y:auto;padding:14px 16px;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid var(--border);border-radius:14px;box-shadow:0 12px 28px -14px rgba(58,90,124,.22);font-size:12.5px;line-height:1.7;z-index:30;';
    const proseEnFloat = document.getElementById('proseEn');
    function attrEscFloat(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
    let html = '<div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.18em;color:var(--blue-deep);font-weight:700;margin-bottom:8px" data-zh="本篇大綱" data-en="Contents">本篇大綱</div><ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:5px" id="hs-toc-list">';
    h2s.forEach(function (h, i) {
      const idZh = h.id;
      const textZh = (h.textContent || ('Section ' + (i + 1))).trim().slice(0, 28);
      const enH = proseEnFloat ? proseEnFloat.querySelector('#' + idZh + '-en') : null;
      const textEn = (enH && (enH.textContent || '').trim().slice(0, 28)) || textZh;
      html += '<li><a href="#' + idZh + '" data-toc="' + idZh + '" data-zh="' + attrEscFloat(textZh) + '" data-en="' + attrEscFloat(textEn) + '" style="display:block;padding:5px 8px;border-radius:6px;color:var(--ink-2);text-decoration:none;border-left:2px solid transparent;transition:all .15s">' + textZh + '</a></li>';
    });
    html += '</ul>';
    aside.innerHTML = html;
    document.body.appendChild(aside);

    const links = aside.querySelectorAll('a[data-toc]');
    function setActive(id) {
      links.forEach(function (l) {
        const active = l.dataset.toc === id;
        l.style.color = active ? 'var(--blue-deep)' : 'var(--ink-2)';
        l.style.background = active ? 'var(--blue-soft)' : 'transparent';
        l.style.borderLeftColor = active ? 'var(--blue)' : 'transparent';
        l.style.fontWeight = active ? '700' : '500';
      });
    }
    const io = new IntersectionObserver(function (entries) {
      const visible = entries.filter(function (e) { return e.isIntersecting; });
      if (visible.length) setActive(visible[0].target.id);
    }, { rootMargin: '-30% 0px -50% 0px' });
    h2s.forEach(function (h) { io.observe(h); });

    window.addEventListener('resize', function () {
      aside.style.display = (window.innerWidth >= 1280) ? '' : 'none';
    });

    aside.addEventListener('click', function (e) {
      const a = e.target.closest('a[data-toc]');
      if (!a) return;
      e.preventDefault();
      const id = a.dataset.toc;
      const target = document.getElementById(id);
      if (target) {
        const top = target.getBoundingClientRect().top + window.pageYOffset - 80;
        window.scrollTo({ top: top, behavior: 'smooth' });
        history.pushState(null, '', '#' + id);
      }
    });
  };

  // ---------- scroll memory + "continue reading" toast ----------
  DN.bindScrollMemory = function () {
    const slug = DN.currentSlug();
    if (!slug) return;
    const proseEl = document.getElementById('proseZh') || document.querySelector('article .prose');
    if (!proseEl) return;
    const KEY = 'hs:scroll:' + slug;
    const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

    function saveNow() {
      try {
        const docH = document.documentElement.scrollHeight - window.innerHeight;
        if (docH < 100) return;
        const y = window.pageYOffset;
        const pct = Math.min(100, Math.max(0, Math.round((y / docH) * 100)));
        if (pct < 3 || pct > 97) { localStorage.removeItem(KEY); return; }
        const h2s = proseEl.querySelectorAll('h2[id]');
        let nearest = null;
        let nearestIdx = 0;
        for (let i = 0; i < h2s.length; i++) {
          const top = h2s[i].getBoundingClientRect().top + window.pageYOffset;
          if (top <= y + 120) { nearest = h2s[i]; nearestIdx = i; }
          else break;
        }
        const data = {
          y: y, pct: pct, ts: Date.now(),
          h2: nearest ? (nearest.textContent || '').slice(0, 40) : '',
          h2i: nearestIdx
        };
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch (e) {}
    }

    let saveTimer = null;
    window.addEventListener('scroll', function () {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(saveNow, 500);
    }, { passive: true });
    window.addEventListener('beforeunload', saveNow);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') saveNow();
    });

    function maybePrompt() {
      if (window.location.hash) return;
      let raw;
      try { raw = localStorage.getItem(KEY); } catch (e) { return; }
      if (!raw) return;
      let data;
      try { data = JSON.parse(raw); } catch (e) { localStorage.removeItem(KEY); return; }
      if (!data || !data.y || !data.pct) return;
      if (Date.now() - (data.ts || 0) > MAX_AGE_MS) { localStorage.removeItem(KEY); return; }
      if (data.pct < 5 || data.pct > 95) return;

      const toast = document.createElement('div');
      toast.id = 'hs-resume-toast';
      toast.style.cssText =
        'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;' +
        'background:#fff;border:1px solid #b8cfe3;border-radius:14px;' +
        'box-shadow:0 18px 40px -16px rgba(58,90,124,.35),0 4px 10px rgba(15,23,42,.08);' +
        'padding:14px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;' +
        'max-width:calc(100vw - 32px);font-size:13.5px;color:var(--ink);' +
        'animation:hs-toast-in .35s cubic-bezier(.2,.7,.3,1)';
      const label = data.h2 ? '「' + data.h2 + '」' : '';
      toast.innerHTML =
        '<div style="display:flex;align-items:center;gap:10px;flex:1;min-width:200px">' +
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3a5a7c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.8 1 6.5 2.6L21 8"/><path d="M21 3v5h-5"/>' +
          '</svg>' +
          '<div style="line-height:1.5">' +
            '<div style="font-weight:700;color:var(--blue-deep)">上次讀到 ' + data.pct + '%</div>' +
            (label ? '<div style="font-size:12px;color:var(--ink-2);margin-top:2px">' + label + '</div>' : '') +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-shrink:0">' +
          '<button data-resume-yes style="padding:7px 14px;border-radius:9999px;background:var(--blue-deep);color:#fff;border:0;font-weight:700;font-size:12.5px;cursor:pointer">繼續閱讀</button>' +
          '<button data-resume-no style="padding:7px 12px;border-radius:9999px;background:#fff;color:var(--ink-2);border:1px solid var(--border);font-weight:600;font-size:12.5px;cursor:pointer">從頭開始</button>' +
        '</div>';
      if (!document.getElementById('hs-resume-style')) {
        const st = document.createElement('style');
        st.id = 'hs-resume-style';
        st.textContent = '@keyframes hs-toast-in{from{opacity:0;transform:translate(-50%,16px)}to{opacity:1;transform:translate(-50%,0)}}';
        document.head.appendChild(st);
      }
      document.body.appendChild(toast);

      function dismiss() { if (toast.parentNode) toast.parentNode.removeChild(toast); }
      toast.querySelector('[data-resume-yes]').addEventListener('click', function () {
        window.scrollTo({ top: data.y, behavior: 'smooth' });
        dismiss();
      });
      toast.querySelector('[data-resume-no]').addEventListener('click', function () {
        try { localStorage.removeItem(KEY); } catch (e) {}
        dismiss();
      });
      setTimeout(function () { if (toast.parentNode) toast.style.opacity = '0', setTimeout(dismiss, 350); }, 12000);
    }
    setTimeout(maybePrompt, 600);
  };

  // ---------- font sizer (S/M/L floating button) ----------
  DN.addFontSizer = function () {
    if (document.getElementById('hs-font-sizer')) return;
    if (!document.querySelector('.prose, #proseZh, #proseEn')) return;

    const savedSize = (function(){ try { return localStorage.getItem('hs-font-size') || 'M'; } catch(e){ return 'M'; } })();
    const sizeMap = { 'S': '15px', 'M': '16.5px', 'L': '18.5px' };
    function applyFontSize(s) {
      let styleEl = document.getElementById('hs-font-size-style');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'hs-font-size-style';
        document.head.appendChild(styleEl);
      }
      styleEl.textContent =
        '.prose, #proseZh, #proseEn { font-size: ' + sizeMap[s] + ' !important; }' +
        '.prose p, #proseZh p, #proseEn p { font-size: ' + sizeMap[s] + ' !important; }';
      try { localStorage.setItem('hs-font-size', s); } catch (e) {}
    }
    applyFontSize(savedSize);

    const wrap = document.createElement('div');
    wrap.id = 'hs-font-sizer';
    wrap.setAttribute('aria-label', '字型大小調整');
    wrap.style.cssText =
      'position:fixed;right:18px;bottom:74px;z-index:49;display:flex;flex-direction:column;' +
      'background:#fff;border:1px solid var(--border);border-radius:22px;' +
      'box-shadow:0 6px 18px -8px rgba(58,90,124,.45);overflow:hidden;opacity:0;' +
      'pointer-events:none;transition:opacity .25s;';

    ['S', 'M', 'L'].forEach(function (s) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.size = s;
      b.style.cssText =
        'width:38px;height:32px;border:0;cursor:pointer;font-weight:700;' +
        'background:' + (s === savedSize ? 'linear-gradient(180deg,#8fb3d4,#3a5a7c)' : 'transparent') + ';' +
        'color:' + (s === savedSize ? '#fff' : '#3a5a7c') + ';';
      b.style.fontSize = s === 'S' ? '11px' : (s === 'M' ? '13px' : '15px');
      b.textContent = s === 'S' ? '小' : (s === 'M' ? '中' : '大');
      b.setAttribute('aria-label', '字型大小 ' + s);
      b.title = '字型大小 ' + (s === 'S' ? '小' : (s === 'M' ? '中' : '大'));
      b.addEventListener('click', function () {
        applyFontSize(s);
        wrap.querySelectorAll('button').forEach(function (x) {
          x.style.background = 'transparent';
          x.style.color = '#3a5a7c';
        });
        b.style.background = 'linear-gradient(180deg,#8fb3d4,#3a5a7c)';
        b.style.color = '#fff';
      });
      wrap.appendChild(b);
    });
    document.body.appendChild(wrap);

    let ticking = false;
    function update() {
      const scrolled = window.scrollY > 400;
      wrap.style.opacity = scrolled ? '1' : '0';
      wrap.style.pointerEvents = scrolled ? 'auto' : 'none';
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    update();
  };

  // ---------- author bio + disclaimer (mounted at #hs-author-bio) ----------
  DN.injectAuthorBio = function (mountId) {
    const mount = document.getElementById(mountId || 'hs-author-bio');
    if (!mount) return;
    mount.innerHTML =
      '<div style="background:#fff;border:1px solid var(--border);border-radius:16px;padding:20px 22px;margin:32px 0 24px;box-shadow:0 8px 18px -10px rgba(58,90,124,.18)">' +
        '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">' +
          '<img src="/SUNN1302.jpg" alt="蕭閔謙 醫師" width="54" height="54" loading="lazy" style="width:54px;height:54px;border-radius:50%;object-fit:cover;object-position:center top;flex-shrink:0;border:2px solid #fff;box-shadow:0 4px 10px -2px rgba(58,90,124,.3);background:var(--blue-soft)" />' +
          '<div style="flex:1;min-width:200px">' +
            '<div style="font-family:\'Noto Serif TC\',Georgia,serif;font-size:16px;font-weight:700;color:var(--ink)">' +
              '<span data-zh="' + DN.AUTHOR_NAME_ZH + '" data-en="' + DN.AUTHOR_NAME_EN + '">' + DN.AUTHOR_NAME_ZH + '</span>' + 
            '</div>' +
            '<div style="font-size:13px;color:#334155;line-height:1.85;margin-top:6px" ' +
              'data-zh="<strong>現職</strong>:眼科住院醫師<br/><strong>學歷</strong>:高雄醫學大學 學士後醫學系" ' +
              'data-en="<strong>Position</strong>: Ophthalmology Resident<br/><strong>Education</strong>: KMU School of Post-Baccalaureate Medicine">' +
              '<strong>現職</strong>:眼科住院醫師<br/>' +
              '<strong>學歷</strong>:高雄醫學大學 學士後醫學系' +
            '</div>' +
          '</div>' +
          '<a href="' + DN.AUTHOR_BIO_URL + '" style="padding:8px 14px;border-radius:9999px;background:var(--blue-deep);color:#fff;font-size:13px;font-weight:600;text-decoration:none;flex-shrink:0" data-zh="完整自介 →" data-en="Full bio →">完整自介 →</a>' +
        '</div>' +
        '<div style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--line);font-size:12px;line-height:1.75;color:#64748b" ' +
          'data-zh="本文為眼科住院醫師的<strong>衛教與學習筆記</strong>,內容依據國際醫學文獻與臨床指引整理,僅作為<strong>一般教育用途</strong>。任何用藥、停藥、調整劑量或就醫決定,請以您的主治醫師判斷為準。本網站不涉及任何藥品、醫療器材、療程或診所之推薦或業配。依《醫療法》§85-86 及《醫師法》§17,個別治療效果因人而異,本文不保證任何結果。" ' +
          'data-en="This article is a residency-level patient-education note, compiled from international literature for general education only — not individual medical advice. This site does not endorse any drug, device, procedure, or clinic. Per Taiwan Medical Care Act §§85–86, individual outcomes vary.">' +
          '本文為眼科住院醫師的<strong>衛教與學習筆記</strong>,內容依據國際醫學文獻與臨床指引整理,僅作為<strong>一般教育用途</strong>。任何用藥、停藥、調整劑量或就醫決定,請以您的主治醫師判斷為準。本網站不涉及任何藥品、醫療器材、療程或診所之推薦或業配。依《醫療法》§85-86 及《醫師法》§17,個別治療效果因人而異,本文不保證任何結果。' +
        '</div>' +
      '</div>';
  };

  // ---------- share toolbar ----------
  DN.injectShareToolbar = function (mountId) {
    const mount = document.getElementById(mountId || 'hs-share');
    if (!mount) return;
    const url = location.href;
    const title = document.title;
    const enc = encodeURIComponent;
    const links = [
      { name:'Line',     href:'https://social-plugins.line.me/lineit/share?url=' + enc(url),                    icon:'L' },
      { name:'Facebook', href:'https://www.facebook.com/sharer/sharer.php?u=' + enc(url),                       icon:'f' },
      { name:'X',        href:'https://twitter.com/intent/tweet?url=' + enc(url) + '&text=' + enc(title),       icon:'𝕏' },
      { name:'Threads',  href:'https://www.threads.net/intent/post?text=' + enc(title + ' ' + url),             icon:'@' }
    ];
    let html = '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:18px 0">' +
      '<span style="font-size:12px;color:var(--muted);font-weight:600;letter-spacing:.08em" data-zh="分享" data-en="Share">分享</span>';
    links.forEach(function (l) {
      html += '<a href="' + l.href + '" target="_blank" rel="noopener" aria-label="Share to ' + l.name + '" ' +
        'style="display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;background:#fff;border:1px solid var(--border);color:var(--blue-deep);text-decoration:none;font-weight:700;font-size:14px;transition:all .15s">' + l.icon + '</a>';
    });
    html += '<button type="button" id="hs-copylink" style="display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:9999px;background:var(--blue-soft);color:var(--blue-deep);border:1px solid #b8cfe3;font-size:12px;font-weight:600;cursor:pointer">' +
      '<span data-zh="複製連結" data-en="Copy link">複製連結</span></button>';
    html += '</div>';
    mount.innerHTML = html;
    const cb = document.getElementById('hs-copylink');
    if (cb) cb.addEventListener('click', function () {
      navigator.clipboard.writeText(location.href).then(function () {
        const old = cb.querySelector('span').textContent;
        cb.querySelector('span').textContent = '✓ ' + (DN.detectLang() === 'en' ? 'Copied' : '已複製');
        setTimeout(function () { cb.querySelector('span').textContent = old; }, 1600);
      });
    });
  };

  // ---------- BMC button (skipped if URL empty) ----------
  DN.injectBMC = function (mountId) {
    if (!DN.BMC_URL) return;
    const mount = document.getElementById(mountId || 'hs-bmc');
    if (!mount) return;
    mount.innerHTML =
      '<a href="' + DN.BMC_URL + '" target="_blank" rel="noopener" ' +
        'style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:9999px;background:#FFDD00;color:#000;text-decoration:none;font-weight:700;font-size:13.5px;box-shadow:0 6px 14px -6px rgba(0,0,0,.25)">' +
        '☕ <span data-zh="請我喝杯咖啡" data-en="Buy me a coffee">請我喝杯咖啡</span>' +
      '</a>';
  };

  // ---------- related articles + ItemList JSON-LD ----------
  DN.addRelatedArticles = function () {
    const article = document.querySelector('article');
    if (!article || document.getElementById('hs-related')) return;
    const slug = DN.currentSlug();
    if (!slug) return;
    const all = DN.ARTICLES || [];
    const cur = all.find(function (a) { return a.slug === slug; });
    if (!cur) return;
    const others = all.filter(function (a) { return a.slug !== slug; });
    if (!others.length) return;

    const scored = others
      .map(function (a) { return { a: a, s: (a.cat === cur.cat ? 2 : 1) + Math.random() * 0.5 }; })
      .sort(function (x, y) { return y.s - x.s; })
      .slice(0, 3)
      .map(function (x) { return x.a; });

    const wrap = document.createElement('section');
    wrap.id = 'hs-related';
    wrap.className = 'max-w-3xl mx-auto px-5 sm:px-8 my-10';
    let html = '<div style="border-top:1px solid var(--line);padding-top:24px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.22em;color:var(--blue-deep);font-weight:700;margin-bottom:12px" data-zh="你可能也會想看" data-en="Related reads">你可能也會想看</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">';
    scored.forEach(function (a) {
      html += '<a href="/blog/' + a.slug + '" style="display:flex;flex-direction:column;gap:6px;padding:14px;background:#fff;border:1px solid var(--border);border-radius:12px;text-decoration:none;color:var(--ink);transition:all .15s;box-shadow:0 1px 2px rgba(15,23,42,.04)">' +
        '<span style="font-size:11px;font-weight:700;letter-spacing:.18em;color:var(--blue-deep);text-transform:uppercase">' + (a.tag_en || a.tag) + '</span>' +
        '<span style="font-size:14px;font-weight:700;line-height:1.4;font-family:Noto Serif TC,Georgia,serif">' + a.title + '</span>' +
        '<span style="font-size:11.5px;color:var(--muted)">' + a.tag + ' · ' + a.date + '</span>' +
      '</a>';
    });
    html += '</div></div>';
    wrap.innerHTML = html;
    article.parentNode.insertBefore(wrap, article.nextSibling);

    const ld = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      'name': 'Related ophthalmology articles',
      'itemListElement': scored.map(function (a, i) {
        return { '@type': 'ListItem', 'position': i + 1, 'url': DN.SITE_URL + '/blog/' + a.slug, 'name': a.title };
      })
    };
    const ldEl = document.createElement('script');
    ldEl.type = 'application/ld+json';
    ldEl.textContent = JSON.stringify(ld);
    document.head.appendChild(ldEl);
  };

  // ---------- hero card rotation (封面故事 + 本期推薦) ----------
  // The homepage has two hero anchors (#hs-cover-story + #hs-editor-pick)
  // marked-up with one default article each. On every load we pick 2 random
  // distinct entries from DN.HERO_CARDS (Fisher-Yates) and rewrite both
  // anchors so visitors see different cover stories on repeat visits.
  // Only published articles appear here (no 'COMING' stubs).
  DN.HERO_CARDS = [
    {
      slug: 'floaters-retinal-detachment',
      title_zh: '飛蚊症 6 大警訊 — 何時要立刻衝眼科？',
      title_en: '6 Floater Red Flags — when do floaters mean retinal emergency?',
      meta_zh: '2026.05 · 9 分鐘 · 警訊辨識',
      meta_en: '2026.05 · 9 min · Red flags',
      svg:
        '<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
          '<rect width="400" height="300" fill="#dcd9d1" />' +
          '<g filter="url(#mag-rough)">' +
            '<path d="M 60 150 Q 200 50 340 150 Q 200 250 60 150 Z" fill="#fff" stroke="#2a2620" stroke-width="2.5" stroke-linejoin="round" />' +
            '<circle cx="200" cy="150" r="58" fill="#a4c4dd" stroke="#3a5a7c" stroke-width="2" />' +
            '<circle cx="200" cy="150" r="24" fill="#2a2620" />' +
            '<circle cx="186" cy="138" r="8" fill="#faf7f2" />' +
            '<circle cx="120" cy="100" r="4" fill="#2a2620" opacity="0.65" />' +
            '<ellipse cx="138" cy="112" rx="6" ry="2" fill="#2a2620" opacity="0.55" transform="rotate(-25 138 112)" />' +
            '<circle cx="280" cy="118" r="3.5" fill="#2a2620" opacity="0.55" />' +
            '<ellipse cx="295" cy="195" rx="5" ry="2" fill="#2a2620" opacity="0.45" transform="rotate(20 295 195)" />' +
            '<circle cx="105" cy="195" r="3" fill="#2a2620" opacity="0.5" />' +
            '<line x1="100" y1="100" x2="92" y2="80" stroke="#2a2620" stroke-width="2.4" stroke-linecap="round" />' +
            '<line x1="150" y1="76" x2="148" y2="56" stroke="#2a2620" stroke-width="2.4" stroke-linecap="round" />' +
            '<line x1="200" y1="68" x2="200" y2="46" stroke="#2a2620" stroke-width="2.4" stroke-linecap="round" />' +
            '<line x1="250" y1="76" x2="252" y2="56" stroke="#2a2620" stroke-width="2.4" stroke-linecap="round" />' +
            '<line x1="300" y1="100" x2="308" y2="80" stroke="#2a2620" stroke-width="2.4" stroke-linecap="round" />' +
            '<path d="M 90 50 Q 200 30 310 50" fill="none" stroke="#c9a961" stroke-width="4" stroke-linecap="round" opacity="0.85" />' +
          '</g>' +
          '<rect width="400" height="300" fill="url(#mag-dots)" opacity="0.35" />' +
        '</svg>'
    },
    {
      slug: 'pediatric-myopia-control',
      title_zh: '兒童近視控制 — 阿托品、OK 鏡、紅光、戶外哪個有效？',
      title_en: 'Pediatric myopia control — atropine, ortho-K, red light, outdoor: what works?',
      meta_zh: '2026.05 · 12 分鐘 · 迷思澄清',
      meta_en: '2026.05 · 12 min · Myth-busting',
      svg:
        '<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
          '<rect width="400" height="300" fill="#ebe4d8" />' +
          '<g filter="url(#mag-rough)">' +
            '<circle cx="135" cy="150" r="62" fill="#fff" stroke="#2a2620" stroke-width="3" />' +
            '<circle cx="265" cy="150" r="62" fill="#fff" stroke="#2a2620" stroke-width="3" />' +
            '<line x1="195" y1="150" x2="205" y2="150" stroke="#2a2620" stroke-width="3" stroke-linecap="round" />' +
            '<line x1="73" y1="138" x2="40" y2="118" stroke="#2a2620" stroke-width="3" stroke-linecap="round" />' +
            '<line x1="327" y1="138" x2="360" y2="118" stroke="#2a2620" stroke-width="3" stroke-linecap="round" />' +
            '<circle cx="135" cy="150" r="58" fill="#a4c4dd" opacity="0.4" />' +
            '<circle cx="265" cy="150" r="58" fill="#a4c4dd" opacity="0.4" />' +
            '<path d="M 105 125 Q 130 115 155 130" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity="0.7" />' +
            '<path d="M 235 125 Q 260 115 285 130" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity="0.7" />' +
          '</g>' +
        '</svg>'
    },
    {
      slug: 'dry-eye-myths',
      title_zh: '乾眼症 8 大迷思 — 點人工淚液真的越點越乾嗎？',
      title_en: '8 dry-eye myths — do artificial tears really make eyes drier?',
      meta_zh: '2026.05 · 10 分鐘 · 迷思澄清',
      meta_en: '2026.05 · 10 min · Myth-busting',
      svg:
        '<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
          '<rect width="400" height="300" fill="#dde7e2" />' +
          '<g filter="url(#mag-rough)">' +
            '<path d="M 60 160 Q 200 70 340 160 Q 200 240 60 160 Z" fill="#fff" stroke="#2a2620" stroke-width="2.5" stroke-linejoin="round" />' +
            '<circle cx="200" cy="160" r="52" fill="#a4c4dd" stroke="#3a5a7c" stroke-width="2" />' +
            '<circle cx="200" cy="160" r="22" fill="#2a2620" />' +
            '<circle cx="188" cy="150" r="7" fill="#faf7f2" />' +
            '<line x1="105" y1="115" x2="98" y2="95" stroke="#2a2620" stroke-width="2.4" stroke-linecap="round" />' +
            '<line x1="155" y1="92" x2="153" y2="72" stroke="#2a2620" stroke-width="2.4" stroke-linecap="round" />' +
            '<line x1="200" y1="84" x2="200" y2="62" stroke="#2a2620" stroke-width="2.4" stroke-linecap="round" />' +
            '<line x1="245" y1="92" x2="247" y2="72" stroke="#2a2620" stroke-width="2.4" stroke-linecap="round" />' +
            '<line x1="295" y1="115" x2="302" y2="95" stroke="#2a2620" stroke-width="2.4" stroke-linecap="round" />' +
            '<path d="M 312 198 Q 322 215 312 232 Q 302 215 312 198 Z" fill="#7fc8d8" stroke="#3a5a7c" stroke-width="1.8" stroke-linejoin="round" />' +
            '<path d="M 308 205 Q 313 210 313 215" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity="0.85" />' +
            '<path d="M 90 60 Q 200 42 310 60" fill="none" stroke="#c9a961" stroke-width="4" stroke-linecap="round" opacity="0.85" />' +
          '</g>' +
        '</svg>'
    }
  ];

  function attrEsc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  // Pick 2 distinct entries from HERO_CARDS using Fisher-Yates,
  // then rewrite #hs-cover-story (full mag-card) and #hs-editor-pick
  // (mag-card-side). Falls back silently if either anchor is missing.
  DN.shuffleHeroCards = function () {
    var coverEl = document.getElementById('hs-cover-story');
    var pickEl  = document.getElementById('hs-editor-pick');
    if (!coverEl || !pickEl) return;          // not on home page
    var cards = (DN.HERO_CARDS || []).slice();
    if (cards.length < 2) return;             // nothing to shuffle

    // Fisher-Yates in-place shuffle, then take first 2
    for (var i = cards.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = cards[i]; cards[i] = cards[j]; cards[j] = tmp;
    }
    var cover = cards[0];
    var pick  = cards[1];

    // Cover Story (full mag-card with meta line + h3 title)
    coverEl.setAttribute('href', '/blog/' + cover.slug);
    coverEl.innerHTML =
      '<div class="mag-card-cover">' + cover.svg + '</div>' +
      '<div class="mag-card-body">' +
        '<span class="mag-card-tag" data-zh="封面故事 · COVER STORY" data-en="Cover Story">封面故事 · COVER STORY</span>' +
        '<h3 data-zh="' + attrEsc(cover.title_zh) + '" data-en="' + attrEsc(cover.title_en) + '">' + cover.title_zh + '</h3>' +
        '<div class="mag-card-meta" data-zh="' + attrEsc(cover.meta_zh) + '" data-en="' + attrEsc(cover.meta_en) + '">' + cover.meta_zh + '</div>' +
      '</div>';

    // Editor's Pick (side variant — h4 title, no meta line)
    pickEl.setAttribute('href', '/blog/' + pick.slug);
    pickEl.innerHTML =
      '<div class="mag-card-cover">' + pick.svg + '</div>' +
      '<div>' +
        '<span class="mag-card-tag" data-zh="本期推薦" data-en="Editor’s Pick">本期推薦</span>' +
        '<h4 data-zh="' + attrEsc(pick.title_zh) + '" data-en="' + attrEsc(pick.title_en) + '">' + pick.title_zh + '</h4>' +
      '</div>';
  };

  // ---------- spotlight (最近更新 + 熱門推薦) ----------
  // Populates two homepage <ol> lists from DN.ARTICLES.
  //   #hs-recent-list  — most recent by date desc
  //   #hs-popular-list — curated by DN.POPULAR_SLUGS, falls back to recent
  // Renders DermNotes-style 2-row cards: metadata strip on top
  // (badge + tag_en + date), then SVG icon + Noto Serif TC title.
  DN.POPULAR_SLUGS = ['floaters-retinal-detachment', 'pediatric-myopia-control', 'dry-eye-myths'];   // edit this list to curate

  // 32x32 line-art SVG icons keyed by Chinese tag — ophthalmology palette
  // (Tiffany blue + ochre + ink). Falls back to the FAQ icon when missing.
  DN.HS_TAG_SVG = {
    '飛蚊症':
      '<circle cx="16" cy="16" r="11" fill="#fff" stroke="#3a5a7c" stroke-width="1.6"/>' +
      '<circle cx="16" cy="16" r="5" fill="#a4c4dd" stroke="#3a5a7c" stroke-width="1"/>' +
      '<circle cx="16" cy="16" r="2" fill="#0f172a"/>' +
      '<circle cx="9" cy="10" r="1.4" fill="#0f172a" opacity=".6"/>' +
      '<ellipse cx="23" cy="11" rx="2" ry="1" fill="#0f172a" opacity=".55" transform="rotate(-15 23 11)"/>' +
      '<circle cx="22" cy="22" r="1" fill="#0f172a" opacity=".5"/>',
    '兒童近視':
      '<circle cx="11" cy="17" r="6" fill="#fff" stroke="#3a5a7c" stroke-width="1.5"/>' +
      '<circle cx="21" cy="17" r="6" fill="#fff" stroke="#3a5a7c" stroke-width="1.5"/>' +
      '<circle cx="11" cy="17" r="5.4" fill="#a4c4dd" opacity=".55"/>' +
      '<circle cx="21" cy="17" r="5.4" fill="#a4c4dd" opacity=".55"/>' +
      '<line x1="17" y1="17" x2="15" y2="17" stroke="#3a5a7c" stroke-width="1.4" stroke-linecap="round"/>' +
      '<line x1="5" y1="14" x2="2" y2="12" stroke="#3a5a7c" stroke-width="1.4" stroke-linecap="round"/>' +
      '<line x1="27" y1="14" x2="30" y2="12" stroke="#3a5a7c" stroke-width="1.4" stroke-linecap="round"/>',
    '乾眼症':
      '<path d="M5 17 Q16 9 27 17 Q16 24 5 17 Z" fill="#fff" stroke="#3a5a7c" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<circle cx="16" cy="17" r="5" fill="#a4c4dd" stroke="#3a5a7c" stroke-width="1"/>' +
      '<circle cx="16" cy="17" r="2" fill="#0f172a"/>' +
      '<path d="M25 22 Q28 25 25 28 Q22 25 25 22 Z" fill="#7fc8d8" stroke="#3a5a7c" stroke-width="1"/>',
    '視網膜剝離':
      '<circle cx="16" cy="16" r="11" fill="#fff" stroke="#3a5a7c" stroke-width="1.6"/>' +
      '<path d="M7 12 Q12 18 16 14 Q20 10 25 16" fill="none" stroke="#9a3412" stroke-width="1.6" stroke-linecap="round"/>' +
      '<line x1="11" y1="22" x2="21" y2="22" stroke="#dc2626" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="2 2"/>',
    '白內障':
      '<circle cx="16" cy="16" r="11" fill="#ebe4d8" stroke="#3a5a7c" stroke-width="1.5"/>' +
      '<circle cx="16" cy="16" r="6" fill="#fff" opacity=".7"/>' +
      '<circle cx="16" cy="16" r="3" fill="#c9a961" opacity=".5"/>',
    '青光眼':
      '<circle cx="16" cy="16" r="11" fill="#fff" stroke="#3a5a7c" stroke-width="1.5"/>' +
      '<circle cx="16" cy="16" r="6" fill="#a4c4dd" stroke="#3a5a7c" stroke-width="1"/>' +
      '<circle cx="16" cy="16" r="3.5" fill="#0f172a"/>' +
      '<line x1="6" y1="22" x2="26" y2="22" stroke="#dc2626" stroke-width="1.4" stroke-linecap="round"/>',
    '隱形眼鏡':
      '<ellipse cx="16" cy="16" rx="10" ry="9" fill="#fff" stroke="#3a5a7c" stroke-width="1.6"/>' +
      '<ellipse cx="16" cy="16" rx="6" ry="5.5" fill="#a4c4dd" opacity=".55"/>' +
      '<path d="M9 12 Q12 9 16 9" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>',
    '紅眼症':
      '<path d="M5 17 Q16 9 27 17 Q16 24 5 17 Z" fill="#fee2e2" stroke="#dc2626" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<circle cx="16" cy="17" r="5" fill="#a4c4dd" stroke="#3a5a7c" stroke-width="1"/>' +
      '<circle cx="16" cy="17" r="2" fill="#0f172a"/>' +
      '<line x1="6" y1="14" x2="9" y2="15" stroke="#dc2626" stroke-width="1.2" stroke-linecap="round"/>' +
      '<line x1="26" y1="14" x2="23" y2="15" stroke="#dc2626" stroke-width="1.2" stroke-linecap="round"/>',
    '結膜炎':
      '<path d="M5 17 Q16 9 27 17 Q16 24 5 17 Z" fill="#fee2e2" stroke="#dc2626" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<circle cx="16" cy="17" r="5" fill="#a4c4dd" stroke="#3a5a7c" stroke-width="1"/>' +
      '<circle cx="16" cy="17" r="2" fill="#0f172a"/>',
    '常見問題':
      '<circle cx="16" cy="16" r="11" fill="#fff" stroke="#3a5a7c" stroke-width="1.5"/>' +
      '<path d="M13 13 Q13 10 16 10 Q19 10 19 13 Q19 15 16 16 L16 18" fill="none" stroke="#3a5a7c" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="16" cy="22" r="1.2" fill="#3a5a7c"/>'
  };

  DN.svgForTag = function (tag) {
    var lib = DN.HS_TAG_SVG || {};
    // try exact match, then substring match (e.g. "飛蚊症 / 視網膜剝離" -> "飛蚊症")
    if (lib[tag]) return lib[tag];
    var keys = Object.keys(lib);
    for (var i = 0; i < keys.length; i++) {
      if (tag && tag.indexOf(keys[i]) >= 0) return lib[keys[i]];
    }
    return lib['常見問題'];
  };

  DN.injectSpotlight = function () {
    const recentEl  = document.getElementById('hs-recent-list');
    const popularEl = document.getElementById('hs-popular-list');
    if (!recentEl && !popularEl) return;
    const all = (DN.ARTICLES || []).slice();
    if (!all.length) return;

    const byDate = all.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    const recent = byDate.slice(0, 3);
    const popularSet = new Set(DN.POPULAR_SLUGS);
    const popular = all.filter(function (a) { return popularSet.has(a.slug); }).slice(0, 3);
    const popularFinal = popular.length ? popular : recent;

    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

    function rowHTML(a, badge) {
      var titleZh = a.title || a.slug;
      var titleEn = a.title_en || a.title || '';
      var tagZh   = a.tag || '';
      var tagEn   = a.tag_en || a.tag || '';
      var date    = a.date || '';
      var iconSvg = '<svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" style="flex-shrink:0">' + DN.svgForTag(tagZh) + '</svg>';
      return '<li><a href="/blog/' + a.slug + '" ' +
        'style="display:flex;flex-direction:column;gap:6px;padding:14px 16px;background:#fff;' +
        'border:0.5px solid var(--border);border-radius:12px;text-decoration:none;color:inherit;' +
        'transition:all .15s;box-shadow:0 1px 2px rgba(15,23,42,.04)" ' +
        'onmouseover="this.style.borderColor=\'rgba(58,90,124,.5)\';this.style.transform=\'translateY(-2px)\';this.style.boxShadow=\'0 8px 18px -10px rgba(58,90,124,.25)\'" ' +
        'onmouseout="this.style.borderColor=\'\';this.style.transform=\'\';this.style.boxShadow=\'0 1px 2px rgba(15,23,42,.04)\'">' +
        '<div style="display:flex;align-items:center;gap:6px;font-size:10.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--blue-deep);font-family:\'JetBrains Mono\',Inter,sans-serif">' +
          (badge ? '<span style="padding:2px 8px;border-radius:9999px;background:' + badge.bg + ';color:' + badge.fg + ';letter-spacing:.08em;font-size:10px">' + badge.label + '</span>' : '') +
          '<span data-zh="' + esc(tagZh) + '" data-en="' + esc(tagEn) + '" style="letter-spacing:.06em">' + tagZh + '</span>' +
          '<span style="opacity:.45">·</span>' +
          '<time style="font-weight:500;letter-spacing:0;color:var(--muted)">' + date + '</time>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          iconSvg +
          '<span data-zh="' + esc(titleZh) + '" data-en="' + esc(titleEn) + '" style="font-family:\'Noto Serif TC\',Georgia,serif;font-size:14.5px;font-weight:700;line-height:1.45;color:var(--ink);flex:1">' + titleZh + '</span>' +
        '</div>' +
      '</a></li>';
    }

    if (recentEl) {
      recentEl.innerHTML = recent.map(function (a, i) {
        return rowHTML(a, i === 0 ? { label: 'NEW', bg: '#fee2e2', fg: '#991b1b' } : null);
      }).join('');
    }
    if (popularEl) {
      popularEl.innerHTML = popularFinal.map(function (a, i) {
        return rowHTML(a, { label: '#' + (i + 1), bg: 'var(--blue-soft)', fg: 'var(--blue-deep)' });
      }).join('');
    }
  };

  // ---------- dark mode toggle (☀ / ☾) ----------
  DN.bindThemeToggle = function () {
    if (document.getElementById('hs-theme-toggle')) return;
    const root = document.documentElement;
    let stored = null;
    try { stored = localStorage.getItem('hs_theme'); } catch (e) {}
    const initial = stored || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    root.dataset.theme = initial;

    // Inject dark-mode CSS once
    if (!document.getElementById('hs-theme-style')) {
      const st = document.createElement('style');
      st.id = 'hs-theme-style';
      st.textContent =
        ':root[data-theme="dark"]{' +
          '--bg:#1a1815;--surface:#252220;--ink:#f5f0e6;--ink-2:#c9c0b0;--muted:#8a8275;' +
          '--border:#3a352d;--line:#2f2a23;--mint-soft:#2a2620;' +
          '--blue-soft:#1f2e42;--teal-bright:#5e7c98;' +
        '}' +
        ':root[data-theme="dark"] body::before{opacity:.5}' +
        ':root[data-theme="dark"] .myth-card,' +
        ':root[data-theme="dark"] .info-card,' +
        ':root[data-theme="dark"] .article-list-item,' +
        ':root[data-theme="dark"] .topic-card,' +
        ':root[data-theme="dark"] .ad-slot,' +
        ':root[data-theme="dark"] .home-faq details.hf,' +
        ':root[data-theme="dark"] .quick-find a,' +
        ':root[data-theme="dark"] .keypoint,' +
        ':root[data-theme="dark"] .selfcheck,' +
        ':root[data-theme="dark"] .references,' +
        ':root[data-theme="dark"] table.dn,' +
        ':root[data-theme="dark"] .placeholder-card,' +
        ':root[data-theme="dark"] .mag-card,' +
        ':root[data-theme="dark"] .dn-search-input,' +
        ':root[data-theme="dark"] header.sticky,' +
        ':root[data-theme="dark"] .lang-select{background:var(--surface)!important;color:var(--ink)}' +
        ':root[data-theme="dark"] .disclaimer{background:#2a2418;color:#e8d9b0;border-color:#5a4720}' +
        ':root[data-theme="dark"] .alert-card{background:#3a1f1f;border-color:#7a3a3a}' +
        ':root[data-theme="dark"] .alert-card h4,' +
        ':root[data-theme="dark"] .alert-card li{color:#fcaaaa}' +
        ':root[data-theme="dark"] .myth-card .myth{color:#fca5a5}' +
        ':root[data-theme="dark"] .myth-card .truth{color:#86efac}' +
        ':root[data-theme="dark"] header.sticky{background:rgba(37,34,32,.94)}';
      document.head.appendChild(st);
    }

    const langToggle = document.getElementById('langToggle');
    if (!langToggle || !langToggle.parentNode) return;

    const btn = document.createElement('button');
    btn.id = 'hs-theme-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Toggle theme');
    btn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9999px;background:#fff;border:1px solid var(--border);color:var(--ink);cursor:pointer;flex-shrink:0;font-size:15px;line-height:1;transition:all .15s';
    function render() {
      const isDark = root.dataset.theme === 'dark';
      btn.innerHTML = isDark
        ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
        : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
      btn.title = isDark ? 'Switch to light' : 'Switch to dark';
    }
    render();
    btn.addEventListener('click', function () {
      root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('hs_theme', root.dataset.theme); } catch (e) {}
      render();
    });
    // Insert immediately BEFORE the language select
    langToggle.parentNode.insertBefore(btn, langToggle);
  };

  // ---------- mobile bottom-fixed nav (3 buttons: Articles / Search / About) ----------
  DN.injectMobileBottomNav = function () {
    if (document.getElementById('hs-mobile-nav')) return;
    if (!document.getElementById('hs-mobile-nav-style')) {
      const st = document.createElement('style');
      st.id = 'hs-mobile-nav-style';
      st.textContent =
        '#hs-mobile-nav{display:none}' +
        '@media (max-width:720px){' +
          '#hs-mobile-nav{position:fixed;bottom:0;left:0;right:0;z-index:55;display:flex;background:rgba(247,243,236,.96);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-top:0.5px solid var(--border);padding:6px 4px calc(6px + env(safe-area-inset-bottom));box-shadow:0 -8px 20px -10px rgba(58,90,124,.18)}' +
          ':root[data-theme="dark"] #hs-mobile-nav{background:rgba(37,34,32,.96)}' +
          '#hs-mobile-nav a{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:7px 6px;color:var(--ink-2);text-decoration:none;font-family:"Noto Sans TC",Inter,sans-serif;font-size:11px;font-weight:600;border-radius:10px;transition:color .15s,background .15s}' +
          '#hs-mobile-nav a:active,#hs-mobile-nav a:hover{color:var(--teal-deep);background:var(--blue-soft)}' +
          '#hs-mobile-nav svg{width:20px;height:20px;flex-shrink:0}' +
          'body{padding-bottom:calc(64px + env(safe-area-inset-bottom))!important}' +
        '}';
      document.head.appendChild(st);
    }
    const nav = document.createElement('nav');
    nav.id = 'hs-mobile-nav';
    nav.setAttribute('aria-label', 'Mobile navigation');
    nav.innerHTML =
      '<a href="/blog/">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>' +
        '<span data-zh="最新文章" data-en="Articles">最新文章</span>' +
      '</a>' +
      '<a href="/#dn-search-input" id="hs-mn-search">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>' +
        '<span data-zh="找文章" data-en="Search">找文章</span>' +
      '</a>' +
      '<a href="/about">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
        '<span data-zh="關於我" data-en="About">關於我</span>' +
      '</a>';
    document.body.appendChild(nav);
    // Search button: focus search input if on homepage
    const searchBtn = document.getElementById('hs-mn-search');
    if (searchBtn) searchBtn.addEventListener('click', function (e) {
      const input = document.getElementById('dn-search-input');
      if (input && location.pathname === '/') {
        e.preventDefault();
        input.focus();
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  };

  // ---------- FAQ hash deep linking (open by URL hash, push hash on toggle) ----------
  DN.bindFAQDeepLink = function () {
    const items = document.querySelectorAll('details.hf');
    if (!items.length) return;
    items.forEach(function (d, i) {
      if (!d.id) d.id = 'q' + (i + 1);
      if ('#' + d.id === location.hash) {
        d.open = true;
        setTimeout(function () { d.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 200);
      }
      d.addEventListener('toggle', function () {
        if (d.open && history.replaceState) {
          history.replaceState(null, '', '#' + d.id);
        }
      });
    });
    // Handle browser back/forward
    window.addEventListener('hashchange', function () {
      const h = location.hash;
      if (!h) return;
      const target = document.querySelector(h);
      if (target && target.tagName === 'DETAILS' && target.classList.contains('hf')) {
        target.open = true;
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  };

  // ---------- home search (filter article-list-item by title/tag/text) ----------
  DN.bindHomeSearch = function () {
    const input = document.getElementById('dn-search-input');
    if (!input) return;
    const items = document.querySelectorAll('#dn-article-list .article-list-item');
    const empty = document.getElementById('dn-search-empty');
    function applyFilter() {
      const q = input.value.trim().toLowerCase();
      let visible = 0;
      items.forEach(function (it) {
        const text = (it.textContent || '').toLowerCase();
        const show = !q || text.indexOf(q) !== -1;
        it.style.display = show ? '' : 'none';
        if (show) visible++;
      });
      if (empty) empty.style.display = (q && visible === 0) ? 'block' : 'none';
    }
    input.addEventListener('input', applyFilter);
    // Esc clears
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { input.value = ''; applyFilter(); }
    });
  };

  // ---------------------------------------------------------------------
  // Cmd+K / Ctrl+K / "/" — global search modal across DN.ARTICLES
  // Indexes article titles + tags + meta-jumps (about, blog index, etc.).
  // Wires to any header button[aria-label="搜尋"] or [aria-label="Search"].
  // ---------------------------------------------------------------------
  DN.initCmdK = function () {
    if (document.getElementById('hs-cmdk-style')) return;
    var st = document.createElement('style');
    st.id = 'hs-cmdk-style';
    st.textContent =
      '#hs-cmdk-overlay{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9998;display:none;align-items:flex-start;justify-content:center;padding:88px 18px 18px;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}' +
      '#hs-cmdk-overlay.open{display:flex}' +
      '#hs-cmdk-modal{width:100%;max-width:640px;background:var(--surface,#fff);border:1px solid var(--border,#dcd5c8);border-radius:14px;box-shadow:0 30px 80px -20px rgba(0,0,0,.35);overflow:hidden;font-family:Inter,system-ui,sans-serif}' +
      '#hs-cmdk-input{width:100%;padding:18px 20px;border:0;border-bottom:1px solid var(--border,#dcd5c8);font-size:16px;outline:none;background:transparent;color:var(--ink,#0f172a);font-family:inherit}' +
      '#hs-cmdk-results{max-height:60vh;overflow:auto;padding:8px 0}' +
      '#hs-cmdk-results .row{display:flex;flex-direction:column;gap:2px;padding:10px 20px;cursor:pointer;border-left:3px solid transparent;text-decoration:none;color:var(--ink,#0f172a)}' +
      '#hs-cmdk-results .row.active{background:var(--blue-soft,#e3edf6);border-left-color:var(--blue-deep,#243b56)}' +
      '#hs-cmdk-results .row .t{font-family:"Noto Serif TC",Georgia,serif;font-size:14.5px;font-weight:600;line-height:1.4}' +
      '#hs-cmdk-results .row .m{font-size:11.5px;color:var(--muted,#8b8378);font-family:Inter,monospace;letter-spacing:.06em}' +
      '#hs-cmdk-empty{padding:24px;text-align:center;font-size:13px;color:var(--muted,#8b8378)}' +
      '#hs-cmdk-foot{padding:10px 20px;border-top:1px solid var(--border,#dcd5c8);font-size:11px;color:var(--muted,#8b8378);font-family:Inter,monospace;letter-spacing:.04em;display:flex;gap:14px;flex-wrap:wrap;background:var(--mint-soft,#dde7e2)}' +
      '#hs-cmdk-foot kbd{padding:1px 6px;border:1px solid var(--border,#dcd5c8);border-radius:3px;background:#fff;font-family:inherit;font-size:10.5px}';
    document.head.appendChild(st);

    var overlay = document.createElement('div');
    overlay.id = 'hs-cmdk-overlay';
    overlay.innerHTML =
      '<div id="hs-cmdk-modal" role="dialog" aria-label="搜尋">' +
        '<input id="hs-cmdk-input" type="text" placeholder="搜尋文章 / 主題⋯ (按 Esc 關閉)" autocomplete="off" spellcheck="false" />' +
        '<div id="hs-cmdk-results"></div>' +
        '<div id="hs-cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> 移動</span><span><kbd>Enter</kbd> 開啟</span><span><kbd>Esc</kbd> 關閉</span></div>' +
      '</div>';
    document.body.appendChild(overlay);

    var input = overlay.querySelector('#hs-cmdk-input');
    var results = overlay.querySelector('#hs-cmdk-results');
    var activeIdx = 0;
    var currentMatches = [];

    function buildIndex() {
      var idx = [];
      (DN.ARTICLES || []).forEach(function (a) {
        idx.push({
          title: a.title || a.slug,
          meta: (a.tag || '') + ' · ' + (a.date || ''),
          url: '/blog/' + a.slug,
          search: ((a.title || '') + ' ' + (a.tag || '') + ' ' + (a.tag_en || '') + ' ' + a.slug).toLowerCase()
        });
      });
      [
        { title: '主題地圖', meta: 'Topic Map', url: '/blog/topics', search: 'topics 主題 地圖' },
        { title: '關於作者', meta: 'About', url: '/about', search: 'about 作者 蕭閔謙' },
        { title: '衛教文章索引', meta: 'Articles', url: '/blog/', search: 'blog articles 文章 索引' },
        { title: '隱私權政策', meta: 'Privacy', url: '/privacy', search: 'privacy 隱私' }
      ].forEach(function (it) { idx.push(it); });
      return idx;
    }
    var INDEX = null;

    function open() {
      if (!INDEX) INDEX = buildIndex();
      overlay.classList.add('open');
      input.value = '';
      input.focus();
      render('');
    }
    function close() { overlay.classList.remove('open'); }
    function render(q) {
      q = (q || '').toLowerCase().trim();
      var matches;
      if (!q) {
        matches = INDEX.slice(0, 8);
      } else {
        matches = INDEX
          .map(function (it) { return { it: it, s: it.search.indexOf(q) >= 0 ? (it.search.indexOf(q) === 0 ? 100 : 50) : 0 }; })
          .filter(function (x) { return x.s > 0; })
          .sort(function (x, y) { return y.s - x.s; })
          .slice(0, 10)
          .map(function (x) { return x.it; });
      }
      currentMatches = matches;
      activeIdx = 0;
      if (!matches.length) { results.innerHTML = '<div id="hs-cmdk-empty">找不到符合的內容</div>'; return; }
      results.innerHTML = matches.map(function (m, i) {
        return '<a class="row' + (i === 0 ? ' active' : '') + '" href="' + m.url + '" data-idx="' + i + '">' +
          '<span class="t">' + m.title + '</span>' +
          '<span class="m">' + (m.meta || '') + '</span>' +
        '</a>';
      }).join('');
    }
    function setActive(i) {
      activeIdx = Math.max(0, Math.min(currentMatches.length - 1, i));
      var rows = results.querySelectorAll('.row');
      rows.forEach(function (r, j) { r.classList.toggle('active', j === activeIdx); });
      var act = rows[activeIdx];
      if (act) act.scrollIntoView({ block: 'nearest' });
    }
    function go() { var m = currentMatches[activeIdx]; if (m) location.href = m.url; }

    input.addEventListener('input', function () { render(input.value); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIdx + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIdx - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); go(); }
      else if (e.key === 'Escape') { close(); }
    });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (overlay.classList.contains('open')) close(); else open();
      } else if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault();
        open();
      }
    });
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('button[aria-label="搜尋"], button[aria-label="Search"]');
      if (btn) { e.preventDefault(); open(); }
    });
  };

  // ---------------------------------------------------------------------
  // Article hero — gradient banner with breadcrumb + read-time + dates.
  // Inserts <figure id="hs-article-hero"> after H1 inside article.max-w-3xl.
  // SVG art is keyed by article tag (Tiffany blue + ochre + paper cream).
  // ---------------------------------------------------------------------
  DN.injectArticleHero = function () {
    if (document.getElementById('hs-article-hero')) return;
    var slug = DN.currentSlug && DN.currentSlug();
    if (!slug) return;
    var meta = (DN.ARTICLES || []).find(function (a) { return a.slug === slug; });
    if (!meta) return;
    var article = document.querySelector('article.max-w-3xl');
    if (!article) return;
    var h1 = article.querySelector('h1');
    if (!h1) return;

    var HEROES = {
      '飛蚊症': '<svg viewBox="0 0 720 240" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<rect width="720" height="240" fill="#faf7f2"/>' +
        '<g transform="translate(60 30)"><path d="M20 90 Q120 0 220 90 Q120 180 20 90 Z" fill="#fff" stroke="#3a5a7c" stroke-width="2.5"/>' +
        '<circle cx="120" cy="90" r="42" fill="#a4c4dd" stroke="#3a5a7c" stroke-width="2"/>' +
        '<circle cx="120" cy="90" r="18" fill="#0f172a"/>' +
        '<circle cx="60" cy="50" r="3" fill="#0f172a" opacity=".6"/>' +
        '<ellipse cx="170" cy="60" rx="5" ry="2" fill="#0f172a" opacity=".55" transform="rotate(-15 170 60)"/>' +
        '<circle cx="180" cy="130" r="2.5" fill="#0f172a" opacity=".5"/>' +
        '</g><g transform="translate(360 60)"><text x="0" y="40" font-family="Noto Serif TC,Georgia,serif" font-size="32" font-weight="700" fill="#243b56">飛蚊症 / 視網膜剝離</text>' +
        '<text x="0" y="78" font-family="Inter,sans-serif" font-size="14" letter-spacing="3" fill="#7a9285">FLOATERS · RETINAL DETACHMENT</text>' +
        '<line x1="0" y1="100" x2="320" y2="100" stroke="#a4c4dd" stroke-width="2"/>' +
        '<text x="0" y="140" font-family="Noto Sans TC,sans-serif" font-size="13" fill="#5e574e">突發閃光 · 視野缺損 · 48 小時警訊</text>' +
        '</g></svg>',
      '兒童近視': '<svg viewBox="0 0 720 240" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<rect width="720" height="240" fill="#faf7f2"/>' +
        '<g transform="translate(60 50)"><circle cx="80" cy="80" r="50" fill="#fff" stroke="#3a5a7c" stroke-width="3"/>' +
        '<circle cx="180" cy="80" r="50" fill="#fff" stroke="#3a5a7c" stroke-width="3"/>' +
        '<circle cx="80" cy="80" r="46" fill="#a4c4dd" opacity=".5"/>' +
        '<circle cx="180" cy="80" r="46" fill="#a4c4dd" opacity=".5"/>' +
        '<line x1="130" y1="80" x2="130" y2="80" stroke="#3a5a7c" stroke-width="3"/>' +
        '<line x1="125" y1="80" x2="135" y2="80" stroke="#3a5a7c" stroke-width="3" stroke-linecap="round"/>' +
        '<line x1="35" y1="65" x2="10" y2="50" stroke="#3a5a7c" stroke-width="3" stroke-linecap="round"/>' +
        '<line x1="225" y1="65" x2="250" y2="50" stroke="#3a5a7c" stroke-width="3" stroke-linecap="round"/>' +
        '</g><g transform="translate(330 60)"><text x="0" y="40" font-family="Noto Serif TC,Georgia,serif" font-size="32" font-weight="700" fill="#243b56">兒童近視控制</text>' +
        '<text x="0" y="78" font-family="Inter,sans-serif" font-size="14" letter-spacing="3" fill="#7a9285">PEDIATRIC MYOPIA CONTROL</text>' +
        '<line x1="0" y1="100" x2="340" y2="100" stroke="#a4c4dd" stroke-width="2"/>' +
        '<text x="0" y="140" font-family="Noto Sans TC,sans-serif" font-size="13" fill="#5e574e">阿托品 · 角膜塑型 · 戶外 2 小時</text>' +
        '</g></svg>',
      '乾眼症': '<svg viewBox="0 0 720 240" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<rect width="720" height="240" fill="#faf7f2"/>' +
        '<g transform="translate(60 50)"><path d="M20 90 Q120 10 220 90 Q120 160 20 90 Z" fill="#fff" stroke="#3a5a7c" stroke-width="2.5"/>' +
        '<circle cx="120" cy="90" r="38" fill="#a4c4dd" stroke="#3a5a7c" stroke-width="2"/>' +
        '<circle cx="120" cy="90" r="16" fill="#0f172a"/>' +
        '<path d="M210 130 Q220 150 210 170 Q200 150 210 130 Z" fill="#7fc8d8" stroke="#3a5a7c" stroke-width="1.5"/>' +
        '</g><g transform="translate(330 60)"><text x="0" y="40" font-family="Noto Serif TC,Georgia,serif" font-size="32" font-weight="700" fill="#243b56">乾眼症</text>' +
        '<text x="0" y="78" font-family="Inter,sans-serif" font-size="14" letter-spacing="3" fill="#7a9285">DRY EYE DISEASE · MGD</text>' +
        '<line x1="0" y1="100" x2="320" y2="100" stroke="#a4c4dd" stroke-width="2"/>' +
        '<text x="0" y="140" font-family="Noto Sans TC,sans-serif" font-size="13" fill="#5e574e">瞼板腺 · 人工淚液 · Omega-3</text>' +
        '</g></svg>',
      '常見問題': '<svg viewBox="0 0 720 240" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<rect width="720" height="240" fill="#faf7f2"/>' +
        '<g transform="translate(80 30)"><circle cx="90" cy="90" r="80" fill="#fff" stroke="#3a5a7c" stroke-width="2.5"/>' +
        '<text x="90" y="115" text-anchor="middle" font-family="Noto Serif TC,Georgia,serif" font-size="80" font-weight="700" fill="#243b56">?</text>' +
        '</g><g transform="translate(280 50)"><text x="0" y="40" font-family="Noto Serif TC,Georgia,serif" font-size="32" font-weight="700" fill="#243b56">' + (meta.title.length > 14 ? meta.title.slice(0, 14) + '⋯' : meta.title) + '</text>' +
        '<text x="0" y="78" font-family="Inter,sans-serif" font-size="14" letter-spacing="3" fill="#7a9285">' + (meta.tag_en || 'OPHTHALMOLOGY') + '</text>' +
        '<line x1="0" y1="100" x2="340" y2="100" stroke="#a4c4dd" stroke-width="2"/>' +
        '<text x="0" y="140" font-family="Noto Sans TC,sans-serif" font-size="13" fill="#5e574e">蕭閔謙 醫師 · 眼科衛教筆記</text>' +
        '</g></svg>'
    };
    // Try exact tag match, then substring (for compound tags)
    var heroSvg = HEROES[meta.tag];
    if (!heroSvg) {
      var keys = Object.keys(HEROES);
      for (var i = 0; i < keys.length; i++) {
        if (meta.tag && meta.tag.indexOf(keys[i]) >= 0) { heroSvg = HEROES[keys[i]]; break; }
      }
    }
    if (!heroSvg) heroSvg = HEROES['常見問題'];

    var fig = document.createElement('figure');
    fig.id = 'hs-article-hero';
    fig.style.cssText = 'margin:18px 0 8px;padding:0;border-radius:14px;overflow:hidden;box-shadow:0 4px 14px -8px rgba(15,23,42,.15)';
    fig.innerHTML = heroSvg;
    var svg = fig.querySelector('svg');
    if (svg) {
      svg.style.cssText = 'display:block;width:100%;height:auto';
      svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    }
    h1.parentNode.insertBefore(fig, h1.nextSibling);
  };

  // ---------------------------------------------------------------------
  // Article images — lazy-load, decoding=async, click-to-zoom lightbox
  // ---------------------------------------------------------------------
  DN.enhanceArticleImages = function () {
    if (document.getElementById('hs-img-css')) return;
    var st = document.createElement('style');
    st.id = 'hs-img-css';
    st.textContent =
      '.prose img, article.max-w-3xl img:not(.no-zoom){display:block;width:100%;max-width:760px;height:auto;margin:24px auto;border-radius:12px;box-shadow:0 4px 14px -8px rgba(15,23,42,.15);cursor:zoom-in}' +
      '.prose svg, article.max-w-3xl svg{display:block;max-width:100%;height:auto;margin:20px auto}' +
      '.hs-img-lightbox{position:fixed;inset:0;background:rgba(15,23,42,.92);z-index:9999;display:none;align-items:center;justify-content:center;padding:24px;cursor:zoom-out}' +
      '.hs-img-lightbox.open{display:flex}' +
      '.hs-img-lightbox img{max-width:96%;max-height:96vh;border-radius:8px;box-shadow:0 24px 60px rgba(0,0,0,.5)}';
    document.head.appendChild(st);

    var imgs = document.querySelectorAll('.prose img, article.max-w-3xl img:not(.no-zoom)');
    imgs.forEach(function (img) {
      if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');
      if (!img.hasAttribute('decoding')) img.setAttribute('decoding', 'async');
      if (!img.hasAttribute('width') && !img.hasAttribute('height')) {
        img.setAttribute('width', '760');
        img.setAttribute('height', '480');
      }
    });

    var box = document.createElement('div');
    box.className = 'hs-img-lightbox';
    box.innerHTML = '<img alt="" />';
    document.body.appendChild(box);
    var bigImg = box.querySelector('img');
    imgs.forEach(function (img) {
      img.addEventListener('click', function () {
        bigImg.src = img.currentSrc || img.src;
        bigImg.alt = img.alt || '';
        box.classList.add('open');
      });
    });
    box.addEventListener('click', function () { box.classList.remove('open'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') box.classList.remove('open'); });
  };

  // ---------------------------------------------------------------------
  // Inline mid-article CTA — points readers to the topic hub.
  // Inserts a styled card before the middle H2 of #proseZh.
  // ---------------------------------------------------------------------
  DN.addInlineCTA = function () {
    var prose = document.getElementById('proseZh');
    if (!prose) return;
    var h2s = prose.querySelectorAll('h2');
    if (h2s.length < 4) return;
    var targetH2 = h2s[Math.floor(h2s.length / 2)];
    if (!targetH2 || targetH2.dataset.hsCtaInserted) return;
    targetH2.dataset.hsCtaInserted = '1';
    var cta = document.createElement('div');
    cta.id = 'hs-inline-cta';
    cta.style.cssText = 'background:linear-gradient(135deg,#e3edf6 0%,#f0f6f4 100%);border:1px solid #b8cfe3;border-radius:14px;padding:16px 20px;margin:22px 0;display:flex;gap:14px;align-items:center;flex-wrap:wrap';
    cta.innerHTML =
      '<div style="flex:1;min-width:200px">' +
        '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.18em;color:#243b56;font-weight:700;margin-bottom:4px" data-zh="想找其他眼科主題？" data-en="Looking for other topics?">想找其他眼科主題？</div>' +
        '<div style="font-size:14px;color:#0f172a;line-height:1.7;margin:0" data-zh="瀏覽所有衛教文章，或回到首頁的快速查找，依眼科主題快速跳轉。" data-en="Browse all education articles, or jump back to the home page topic chips.">瀏覽所有衛教文章，或回到首頁的快速查找，依眼科主題快速跳轉。</div>' +
      '</div>' +
      '<a href="/blog/" style="flex-shrink:0;padding:10px 18px;border-radius:9999px;background:#243b56;color:#fff;text-decoration:none;font-size:13px;font-weight:700;white-space:nowrap" data-zh="全部文章 →" data-en="All articles →">全部文章 →</a>';
    targetH2.parentNode.insertBefore(cta, targetH2);
  };

  // ---------------------------------------------------------------------
  // Mark recently-published articles with an animated "NEW" badge.
  // Triggered by `date` field in DN.ARTICLES (within last 14 days).
  // ---------------------------------------------------------------------
  DN.markNewArticles = function () {
    var NOW = Date.now();
    var FOURTEEN_DAYS = 14 * 86400 * 1000;
    var cards = document.querySelectorAll('a.article-list-item[href*="/blog/"]');
    if (!cards.length) return;
    if (!document.getElementById('hs-new-pulse-css')) {
      var styleEl = document.createElement('style');
      styleEl.id = 'hs-new-pulse-css';
      styleEl.textContent = '.hs-new-pulse{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:9999px;background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#fff;font-size:9.5px;font-weight:800;letter-spacing:.04em;line-height:1.5;animation:hsPulse 1.6s ease-in-out infinite;vertical-align:middle}@keyframes hsPulse{0%,100%{box-shadow:0 0 0 0 rgba(251,191,36,.55)}50%{box-shadow:0 0 0 6px rgba(251,191,36,0)}}';
      document.head.appendChild(styleEl);
    }
    cards.forEach(function (a) {
      var href = a.getAttribute('href') || '';
      var m = href.match(/\/blog\/([a-z0-9-]+)/i);
      if (!m) return;
      var slug = m[1];
      var meta = (DN.ARTICLES || []).find(function (x) { return x.slug === slug; });
      if (!meta) return;
      var pub = Date.parse(meta.date);
      if (!pub || NOW - pub > FOURTEEN_DAYS) return;
      var h3 = a.querySelector('h3');
      if (!h3 || h3.querySelector('.hs-new-pulse')) return;
      var tag = document.createElement('span');
      tag.className = 'hs-new-pulse';
      tag.textContent = 'NEW';
      h3.appendChild(tag);
    });
  };

  // ---------------------------------------------------------------------
  // GA4 conversion event tracking — email/RSS/lang/scroll-depth/internal links
  // ---------------------------------------------------------------------
  DN.bindGAEvents = function () {
    if (typeof gtag !== 'function') return;
    function fire(name, params) { try { gtag('event', name, params || {}); } catch (e) {} }
    document.querySelectorAll('a[href^="mailto:"]').forEach(function (a) {
      a.addEventListener('click', function () { fire('email_click', { page_path: location.pathname }); });
    });
    document.querySelectorAll('[data-subscribe-link]').forEach(function (a) {
      a.addEventListener('click', function () { fire('newsletter_subscribe_click', { method: 'mailto', page_path: location.pathname }); });
    });
    document.querySelectorAll('a[href$="/feed.xml"], a[href$="/atom.xml"]').forEach(function (a) {
      a.addEventListener('click', function () { fire('rss_subscribe_click', { feed: a.getAttribute('href'), page_path: location.pathname }); });
    });
    var lt = document.getElementById('langToggle');
    if (lt && lt.tagName === 'SELECT') {
      lt.addEventListener('change', function () { fire('lang_switch', { lang: lt.value }); });
    }
    document.querySelectorAll('article a[href^="/blog/"]').forEach(function (a) {
      a.addEventListener('click', function () { fire('internal_link', { destination: a.getAttribute('href'), source: location.pathname }); });
    });
    if (document.querySelector('article .prose, article.max-w-3xl')) {
      var fired = false;
      window.addEventListener('scroll', function () {
        if (fired) return;
        var h = document.documentElement;
        var pct = (h.scrollTop + h.clientHeight) / h.scrollHeight;
        if (pct >= 0.75) { fired = true; fire('article_75pct', { page_path: location.pathname }); }
      }, { passive: true });
    }
  };

  // ---------------------------------------------------------------------
  // Web Vitals — LCP / CLS / INP via PerformanceObserver, sent to GA4
  // ---------------------------------------------------------------------
  DN.bindWebVitals = function () {
    if (typeof gtag !== 'function') return;
    function send(name, value, id) {
      try {
        gtag('event', name, {
          event_category: 'Web Vitals',
          event_label: id,
          value: Math.round(name === 'CLS' ? value * 1000 : value),
          non_interaction: true
        });
      } catch (e) {}
    }
    try {
      var lcp = 0;
      var lcpObs = new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        var last = entries[entries.length - 1];
        lcp = last.renderTime || last.loadTime || last.startTime;
      });
      lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });
      addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden' && lcp) { send('LCP', lcp, 'lcp-' + Date.now()); lcp = 0; }
      }, { once: true });
    } catch (e) {}
    try {
      var cls = 0;
      var clsObs = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (entry) { if (!entry.hadRecentInput) cls += entry.value; });
      });
      clsObs.observe({ type: 'layout-shift', buffered: true });
      addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') send('CLS', cls, 'cls-' + Date.now());
      });
    } catch (e) {}
    try {
      var worstINP = 0;
      var inpObs = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (entry) { if (entry.duration > worstINP) worstINP = entry.duration; });
      });
      inpObs.observe({ type: 'event', buffered: true, durationThreshold: 40 });
      addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden' && worstINP) { send('INP', worstINP, 'inp-' + Date.now()); worstINP = 0; }
      });
    } catch (e) {}
  };

  // ---------- service worker ----------
  DN.registerSW = function () {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').then(function (reg) {
      DN.bindSWUpdateToast(reg);
      setInterval(function () {
        if (document.visibilityState === 'visible') reg.update().catch(function () {});
      }, 30 * 60 * 1000);
    }).catch(function () {});
  };

  // ---------- orchestrator ----------
  DN.initBlog = function (opts) {
    opts = opts || {};
    let curLang = DN.detectLang();

    function apply(lang) {
      curLang = lang;
      DN.applyTextOnly(lang);
      const isZh = (lang === 'zh');
      const ze = document.getElementById(opts.proseZh || 'proseZh');
      const en = document.getElementById(opts.proseEn || 'proseEn');
      if (ze) ze.style.display = isZh ? '' : 'none';
      if (en) en.style.display = isZh ? 'none' : '';
      if (typeof opts.onChange === 'function') opts.onChange(lang);
    }

    DN.injectMobileMenu();
    DN.bindLangToggle(apply);
    apply(curLang);
    DN.injectFooterYear();
    DN.addReadingProgress();
    DN.addScrollToTop();
    DN.bindRevealOnScroll();
    DN.bindViewTransitions();
    DN.prefetchOnIdle();
    DN.initCmdK();              // Cmd/Ctrl+K global search modal

    // Article-only enhancements
    if (document.getElementById('proseZh') || document.querySelector('article .prose')) {
      DN.injectArticleHero();   // gradient SVG banner under H1
      DN.enhanceArticleImages(); // lazy-load + click-to-zoom lightbox
      DN.addReadingMeta();
      DN.addInlineTOC();
      DN.addFloatingTOC();
      DN.bindScrollMemory();
      DN.addInlineCTA();        // mid-article CTA card
      DN.injectAuthorBio('hs-author-bio');
      DN.injectShareToolbar('hs-share');
      DN.injectBMC('hs-bmc');
      DN.addRelatedArticles();
    }
    DN.addFontSizer();
    DN.injectReadProgress();
    DN.shuffleHeroCards();      // randomise #hs-cover-story + #hs-editor-pick on every load
    DN.injectSpotlight();
    DN.markNewArticles();       // animated NEW badge for last-14d articles
    DN.bindHomeSearch();
    DN.bindThemeToggle();
    DN.injectMobileBottomNav();
    DN.bindFAQDeepLink();
    DN.bindGAEvents();          // GA4 conversion events
    DN.bindWebVitals();         // LCP / CLS / INP → GA4
    DN.registerSW();

    // CRITICAL: re-apply lang to all DOM (including JS-injected elements like
    // author bio / share toolbar / related articles / spotlight / mobile nav /
    // theme toggle). Without this, those injected elements stay in zh until
    // user manually toggles language.
    DN.applyTextOnly(curLang);

    return { applyLang: apply };
  };
})();
