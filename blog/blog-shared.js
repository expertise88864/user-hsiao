/* ============================================================
 * HsiaoEye - shared runtime (zh / en)
 *   - language detection + 2-button / dropdown toggle
 *   - reading progress bar
 *   - scroll-to-top button
 *   - mobile hamburger drawer
 *   - reveal-on-scroll, view transitions
 *   - service worker registration + update toast
 *   - prefetch on idle
 *   - author bio injector, share toolbar, footer year, breadcrumbs
 *   - article TOC auto-build
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
  DN.AUTHOR_AFFIL_ZH = '彰化基督教醫院 眼科';
  DN.AUTHOR_AFFIL_EN = 'Changhua Christian Hospital, Department of Ophthalmology';
  DN.AUTHOR_ROLE_ZH  = '住院醫師 R2';
  DN.AUTHOR_ROLE_EN  = 'Ophthalmology PGY-2';
  DN.AUTHOR_EMAIL    = 'hsiao.minchien@gmail.com';   // placeholder — update when wife confirms
  DN.BMC_URL         = '';                            // empty until BMC account is created
  DN.AUTHOR_BIO_URL  = '/about';

  // ---------- article catalog (single source of truth) ----------
  DN.ARTICLES = [
    { slug:'dry-eye-myths', title:'乾眼症 8 大迷思', cat:'myth', tag:'乾眼症', date:'2026-05-04', tag_en:'Dry Eye' }
  ];

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
    try { localStorage.setItem('hs_lang', code); } catch (e) { /* ignore */ }
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

  // ---------- author bio block (injected at article footer) ----------
  // 醫療法 §85-86: 醫院全名只允許在 /about + 文章末作者 bio
  DN.injectAuthorBio = function (mountId) {
    const mount = document.getElementById(mountId || 'hs-author-bio');
    if (!mount) return;
    mount.innerHTML =
      '<div style="background:#fff;border:1px solid var(--border);border-radius:16px;padding:20px 22px;margin:32px 0 24px;box-shadow:0 8px 18px -10px rgba(58,90,124,.18)">' +
        '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">' +
          '<div style="width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,#d6e4f0,#8fb3d4);display:flex;align-items:center;justify-content:center;font-size:24px;color:#fff;flex-shrink:0">👁️</div>' +
          '<div style="flex:1;min-width:200px">' +
            '<div style="font-family:\'Noto Serif TC\',Georgia,serif;font-size:16px;font-weight:700;color:var(--ink)">' +
              '<span data-zh="' + DN.AUTHOR_NAME_ZH + '" data-en="' + DN.AUTHOR_NAME_EN + '">' + DN.AUTHOR_NAME_ZH + '</span>' +
              '<span style="font-size:11.5px;font-weight:600;color:var(--blue-deep);margin-left:8px;padding:2px 8px;border-radius:6px;background:var(--blue-soft);border:1px solid #b8cfe3;font-family:Inter,sans-serif" data-zh="眼科 R2" data-en="Ophthalmology PGY-2">眼科 R2</span>' +
            '</div>' +
            '<div style="font-size:13px;color:#334155;line-height:1.85;margin-top:6px" ' +
              'data-zh="<strong>現職</strong>:' + DN.AUTHOR_AFFIL_ZH + ' 住院醫師<br/><strong>學歷</strong>:高雄醫學大學 學士後醫學系" ' +
              'data-en="<strong>Position</strong>: Resident, ' + DN.AUTHOR_AFFIL_EN + '<br/><strong>Education</strong>: KMU School of Post-Baccalaureate Medicine">' +
              '<strong>現職</strong>:' + DN.AUTHOR_AFFIL_ZH + ' 住院醫師<br/>' +
              '<strong>學歷</strong>:高雄醫學大學 學士後醫學系' +
            '</div>' +
          '</div>' +
          '<a href="' + DN.AUTHOR_BIO_URL + '" style="padding:8px 14px;border-radius:9999px;background:var(--blue-deep);color:#fff;font-size:13px;font-weight:600;text-decoration:none;flex-shrink:0" data-zh="完整自介 →" data-en="Full bio →">完整自介 →</a>' +
        '</div>' +
        '<div style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--line);font-size:12px;line-height:1.75;color:#64748b" ' +
          'data-zh="本文為眼科住院醫師的<strong>衛教與學習筆記</strong>,內容依據國際醫學文獻與臨床指引整理,僅作為<strong>一般教育用途</strong>。任何用藥、停藥、調整劑量或就醫決定,請以您的主治醫師判斷為準。" ' +
          'data-en="This article is a residency-level patient-education note, compiled from international literature. For general education only — not medical advice.">' +
          '本文為眼科住院醫師的<strong>衛教與學習筆記</strong>,內容依據國際醫學文獻與臨床指引整理,僅作為<strong>一般教育用途</strong>。任何用藥、停藥、調整劑量或就醫決定,請以您的主治醫師判斷為準。' +
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

  // ---------- TOC auto-build (from h2[id] inside article) ----------
  DN.buildTOC = function (mountId, articleSelector) {
    const mount = document.getElementById(mountId || 'hs-toc');
    if (!mount) return;
    const article = document.querySelector(articleSelector || 'article');
    if (!article) return;
    const heads = article.querySelectorAll('h2[id]');
    if (!heads.length) { mount.style.display = 'none'; return; }
    let html = '<h4 data-zh="本文目錄" data-en="Contents">本文目錄</h4><ol>';
    heads.forEach(function (h) {
      const id = h.id;
      const text = (h.dataset.zh || h.textContent).replace(/<[^>]+>/g, '');
      html += '<li><a href="#' + id + '" data-zh="' + text + '">' + text + '</a></li>';
    });
    html += '</ol>';
    mount.innerHTML = html;
  };

  // ---------- service worker registration ----------
  DN.registerSW = function () {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').then(function (reg) {
      DN.bindSWUpdateToast(reg);
    }).catch(function () { /* ignore */ });
  };

  // ---------- orchestrator ----------
  DN.initBlog = function (opts) {
    opts = opts || {};
    const lang = DN.detectLang();
    DN.applyTextOnly(lang);
    DN.bindLangToggle(function (l) { DN.applyTextOnly(l); });
    DN.injectFooterYear();
    DN.injectMobileMenu();
    DN.addReadingProgress();
    DN.addScrollToTop();
    DN.bindRevealOnScroll();
    DN.bindViewTransitions();
    DN.prefetchOnIdle();
    DN.injectAuthorBio('hs-author-bio');
    DN.injectShareToolbar('hs-share');
    DN.injectBMC('hs-bmc');
    DN.buildTOC('hs-toc', opts.articleSelector || 'article');
    DN.registerSW();
  };
})();
