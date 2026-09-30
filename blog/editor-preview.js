// Preview-only support. The blob document never represents a published route.
(function () {
  'use strict';
  const path = document.documentElement.getAttribute('data-hs-editor-preview-path') || '';
  if (location.protocol !== 'blob:' || !/^\/(?:en\/)?blog\/[a-z0-9-]+\/?$/.test(path)) return;
  // Loaded before the shared reader bundle. Only this local document supplies
  // preview context; ordinary readers do not download this module.
  const DN = (window.DN = window.DN || {});
  DN.editorPreview = { path: path, lang: document.documentElement.lang.toLowerCase().startsWith('en') ? 'en' : 'zh' };
  // <base> resolves assets, but native # links would otherwise leave the blob
  // for the published article. Keep authored and runtime TOC/FAQ links local.
  document.addEventListener('click', function (e) {
    const anchor = e.target.closest && e.target.closest('a[href^="#"]');
    if (!anchor || anchor.hasAttribute('download')) return;
    const hash = anchor.getAttribute('href');
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.ctrlKey || e.metaKey || e.shiftKey || anchor.target === '_blank') {
      window.open(location.href.split('#')[0] + hash, '_blank', 'noopener');
    } else {
      location.hash = hash;
    }
  }, true);
})();
