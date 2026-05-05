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

  // ---------- spotlight (最近更新 + 熱門推薦) ----------
  // Populates two homepage <ol> lists from DN.ARTICLES.
  //   #hs-recent-list  — most recent by date desc
  //   #hs-popular-list — curated by DN.POPULAR_SLUGS, falls back to recent
  DN.POPULAR_SLUGS = ['floaters-retinal-detachment', 'pediatric-myopia-control', 'dry-eye-myths'];   // edit this list to curate
  DN.injectSpotlight = function () {
    const all = (DN.ARTICLES || []).slice();
    if (!all.length) return;
    const byDate = all.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    const recent = byDate.slice(0, 3);
    const popularSet = new Set(DN.POPULAR_SLUGS);
    const popular = all.filter(function (a) { return popularSet.has(a.slug); }).slice(0, 3);
    const popularFinal = popular.length ? popular : recent;

    function attr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
    function render(host, items, emptyText) {
      if (!host) return;
      if (!items.length) { host.innerHTML = '<li style="padding:14px 16px;background:#fff;border:1px solid var(--border);border-radius:12px;font-size:14px;color:var(--muted)">' + emptyText + '</li>'; return; }
      host.innerHTML = items.map(function (a) {
        var titleZh = a.title || '';
        var titleEn = a.title_en || a.title || '';
        var tagZh = a.tag || '';
        var tagEn = a.tag_en || a.tag || '';
        var tagShortZh = tagZh.slice(0, 4);
        var tagShortEn = (a.tag_en || tagZh).slice(0, 4);
        return '<li><a href="/blog/' + a.slug + '" style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;background:#fff;border:1px solid var(--border);border-radius:12px;text-decoration:none;color:var(--ink);transition:all .15s;box-shadow:0 1px 2px rgba(15,23,42,.04)">' +
          '<span data-zh="' + attr(tagShortZh) + '" data-en="' + attr(tagShortEn) + '" style="flex-shrink:0;width:36px;height:36px;border-radius:10px;background:var(--blue-soft);color:var(--blue-deep);font-weight:700;font-size:11px;display:inline-flex;align-items:center;justify-content:center;letter-spacing:.04em">' + tagShortZh + '</span>' +
          '<span style="flex:1;min-width:0">' +
            '<span data-zh="' + attr(titleZh) + '" data-en="' + attr(titleEn) + '" style="display:block;font-family:\'Noto Serif TC\',Georgia,serif;font-size:14.5px;font-weight:700;line-height:1.4;color:var(--ink)">' + titleZh + '</span>' +
            '<span data-zh="' + attr(tagZh + ' · ' + a.date) + '" data-en="' + attr(tagEn + ' · ' + a.date) + '" style="display:block;font-size:11.5px;color:var(--muted);margin-top:4px">' + tagZh + ' · ' + a.date + '</span>' +
          '</span>' +
        '</a></li>';
      }).join('');
    }
    render(document.getElementById('hs-recent-list'), recent, '尚無文章');
    render(document.getElementById('hs-popular-list'), popularFinal, '尚無文章');
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

    // Article-only enhancements
    if (document.getElementById('proseZh') || document.querySelector('article .prose')) {
      DN.addReadingMeta();
      DN.addInlineTOC();
      DN.addFloatingTOC();
      DN.bindScrollMemory();
      DN.injectAuthorBio('hs-author-bio');
      DN.injectShareToolbar('hs-share');
      DN.injectBMC('hs-bmc');
      DN.addRelatedArticles();
    }
    DN.addFontSizer();
    DN.injectReadProgress();
    DN.injectSpotlight();
    DN.bindHomeSearch();
    DN.bindThemeToggle();
    DN.injectMobileBottomNav();
    DN.bindFAQDeepLink();
    DN.registerSW();

    // CRITICAL: re-apply lang to all DOM (including JS-injected elements like
    // author bio / share toolbar / related articles / spotlight / mobile nav /
    // theme toggle). Without this, those injected elements stay in zh until
    // user manually toggles language.
    DN.applyTextOnly(curLang);

    return { applyLang: apply };
  };
})();
