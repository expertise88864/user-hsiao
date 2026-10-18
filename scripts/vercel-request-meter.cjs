// Counts the requests a CI job sends to the deployment under test. Preview and
// production are both served by Vercel, and every request counts against the
// account's shared CDN request allowance (the Hobby quota ran out 2026-10-18).
// Each job prints one `[vercel-requests]` line; summing them across a run's
// logs gives the per-push total. Counting only: nothing is blocked or changed.
const { httpRequestCount } = require('./preview-access.cjs');

function createMeter(label, origin) {
  const target = new URL(origin).origin;
  let browser = 0;
  let manual = 0;
  // Only this meter's share of the process-wide module counter.
  const httpBase = httpRequestCount();
  const http = () => httpRequestCount() - httpBase;
  const counts = request => {
    try { if (new URL(request.url()).origin === target) browser++; } catch { /* data:, about: */ }
  };
  return {
    // Playwright BrowserContext / Page or Puppeteer Page: all emit 'request',
    // including (in Chromium) requests made by a service worker of the context.
    attach(emitter) { emitter.on('request', counts); return emitter; },
    // Requests made outside an attached browser (e.g. APIRequestContext).
    add(count = 1) { manual += count; },
    total() { return browser + manual + http(); },
    report() {
      const other = manual + http();
      console.log('[vercel-requests] ' + label + ': ' + (browser + other) +
        ' (browser ' + browser + ', other ' + other + ') host=' + new URL(target).hostname.replace(/^[^.]+(?=\.vercel\.app$)/, '<preview>'));
    },
  };
}

module.exports = { createMeter };
