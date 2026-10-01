// CI preparation page only: bounded numeric geometry, never text, HTML,
// request headers, cookies or storage. No font waits or loading-policy changes.
const KEY = '__hsCIStartupFontGeometry';

async function installStartupGeometry(page) {
  return page.evaluateOnNewDocument(key => {
    if (window !== window.top) return;
    const selectors = ['main h1', 'main .tldr', 'main > section', 'main > article', '.article-list-item'];
    const limit = 48;
    const events = [];
    const observers = [];
    let dropped = 0;
    const rect = value => ({x:value.x, y:value.y, width:value.width, height:value.height});
    const capture = (kind, entry) => {
      if (events.length >= limit) { dropped++; return; }
      const sample = {kind, time:entry?.startTime ?? performance.now(), sampledAt:performance.now(), fontStatus:document.fonts.status,
        geometry:selectors.flatMap(selector => {
          const element = document.querySelector(selector);
          return element ? [{selector, ...rect(element.getBoundingClientRect())}] : [];
        })};
      if (kind === 'layout-shift') {
        sample.value = entry.value;
        sample.hadRecentInput = entry.hadRecentInput;
        sample.sources = (entry.sources || []).map(source => ({
          selector:selectors.find(selector => source.node?.closest?.(selector)) || null,
          before:rect(source.previousRect), after:rect(source.currentRect),
        }));
      }
      events.push(sample);
    };
    const observe = type => {
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (type === 'layout-shift' || entry.name === 'first-contentful-paint') capture(type, entry);
        }
      });
      observer.observe({type, buffered:true});
      observers.push(observer);
    };
    observe('paint');
    observe('layout-shift');
    const parsed = () => capture('dom-content-loaded');
    const fontsLoaded = () => capture('fonts-loading-done');
    document.addEventListener('DOMContentLoaded', parsed, {once:true});
    document.fonts.addEventListener('loadingdone', fontsLoaded);
    window[key] = {
      read() {
        for (const observer of observers) {
          for (const entry of observer.takeRecords()) {
            if (entry.entryType === 'layout-shift' || entry.name === 'first-contentful-paint') capture(entry.entryType, entry);
          }
        }
        return {schemaVersion:1, phase:'preparation-page-startup', viewport:{width:innerWidth,height:innerHeight},
          captureFinishedAt:performance.now(), firstContentfulPaintObserved:events.some(event => event.kind === 'paint'),
          fontCompletionObserved:events.some(event => event.kind === 'fonts-loading-done'), limit, dropped, events};
      },
      dispose() {
        observers.forEach(observer => observer.disconnect());
        document.removeEventListener('DOMContentLoaded', parsed);
        document.fonts.removeEventListener('loadingdone', fontsLoaded);
        delete window[key];
      },
    };
  }, KEY);
}

async function readStartupGeometry(page) {
  return page.evaluate(key => {
    if (!window[key]) throw new Error('Startup geometry unavailable');
    return window[key].read();
  }, KEY);
}

async function removeStartupGeometry(page, script) {
  await page.removeScriptToEvaluateOnNewDocument(script.identifier);
  await page.evaluate(key => window[key]?.dispose(), KEY);
}

module.exports = {installStartupGeometry, readStartupGeometry, removeStartupGeometry, KEY};
