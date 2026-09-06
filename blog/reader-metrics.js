// Reading time is cumulative foreground time, independent of timer throttling.
// Dependencies are injected so visibility transitions can be tested without a DOM.
function createVisibleClock(now, visible) {
  let total = 0;
  let started = visible ? now() : null;
  return {
    setVisible(next) {
      const time = now();
      if (started !== null) total += Math.max(0, time - started);
      started = next ? time : null;
    },
    elapsed() { return total + (started === null ? 0 : Math.max(0, now() - started)); }
  };
}

function observeReadingTime(doc, emit, now = () => performance.now()) {
  const clock = createVisibleClock(now, doc.visibilityState === 'visible' && !doc.prerendering);
  const milestones = [[30000, 'time_30s'], [120000, 'time_2min']];
  let timer;
  function check() {
    clearTimeout(timer);
    const elapsed = clock.elapsed();
    while (milestones.length && elapsed >= milestones[0][0]) emit(milestones.shift()[1]);
    // Keep tracking visibility after the last milestone: article_read shares
    // this clock and may reach its scroll threshold later in the page visit.
    if (milestones.length && doc.visibilityState === 'visible' && !doc.prerendering) {
      timer = setTimeout(check, Math.max(1, milestones[0][0] - elapsed));
    }
  }
  function update() {
    clock.setVisible(doc.visibilityState === 'visible' && !doc.prerendering);
    check();
  }
  doc.addEventListener('visibilitychange', update);
  doc.addEventListener('prerenderingchange', update);
  check();
  return clock;
}

module.exports = { createVisibleClock, observeReadingTime };
