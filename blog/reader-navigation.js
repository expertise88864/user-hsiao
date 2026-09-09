// One delegated handler covers static and subsequently rendered links.
function bindReaderNavigation(doc, emit) {
  doc.addEventListener('click', event => {
    const link = event.target.closest && event.target.closest('a[href]');
    if (!link) return;
    const related = link.closest('#hs-related');
    const route = link.dataset.readerRoute;
    if (!related && !route) return;
    const params = {
      destination: link.getAttribute('href').split('?')[0].slice(0, 160),
      placement: related ? 'related' : route
    };
    if (related) params.target_slug = (link.getAttribute('href') || '').split('/').pop();
    emit(related ? 'related_click' : 'reading_shortcut', params);
  });
  if (typeof IntersectionObserver === 'undefined') return;
  const seen = new WeakSet();
  const observer = new IntersectionObserver(entries => {
    if (doc.visibilityState !== 'visible' || doc.prerendering) return;
    entries.forEach(entry => {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.5 || seen.has(entry.target)) return;
      seen.add(entry.target);
      observer.unobserve(entry.target);
      emit('related_view', { destination: entry.target.getAttribute('href'), placement: 'related' });
    });
  }, { threshold: 0.5 });
  function observe() {
    doc.querySelectorAll('#hs-related a[href]').forEach(link => {
      if (!seen.has(link)) observer.observe(link);
    });
  }
  observe();
  // Re-observe on foreground entry: visibility changes alone need not produce
  // a new intersection record for a card already within the viewport.
  doc.addEventListener('visibilitychange', () => { observer.disconnect(); observe(); });
}

module.exports = { bindReaderNavigation };
