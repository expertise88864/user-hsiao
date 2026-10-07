// Shared collection eligibility and public analytics bootstrap. This marker is
// an opt-out preference, never an authentication credential or visitor ID.
(function () {
  'use strict';
  const HOST = 'hsiao.chendermatologist.com';
  const OPT_OUT = 'hs_telemetry_optout';
  const BOT = /(bot|spider|crawl|slurp|teoma|monitor|headless|playwright|puppeteer|selenium|electron|preview|fetcher|inspect|lighthouse|pagespeed|gtmetrix|httrack|wget|curl|python-requests|axios|node-fetch|go-http|libwww|scrapy|chatgpt|gptbot|claudebot|anthropic|perplexity|cohere|bytespider|ahrefs|semrush|mj12|dotbot|baidu|yandex|ccbot|google-extended|amazonbot|applebot|facebot|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegrambot|discordbot|skype|slackbot|embedly|bingpreview)/i;
  function exclusionReason(context) {
    if (context.hostname !== HOST || context.protocol !== 'https:') return 'environment';
    if (/^\/(?:en\/)?admin(?:[/.]|$)/.test(context.pathname || '') ||
        new URLSearchParams(context.search || '').get('admin') === '1' || context.adminEditing) return 'admin';
    if (context.optOut) return 'opt_out';
    if (context.doNotTrack === '1' || context.globalPrivacyControl === true) return 'privacy_preference';
    if (context.webdriver === true || BOT.test(context.userAgent || '')) return 'automation';
    if (context.prerendering) return 'prerender';
    return null;
  }
  function reason(win) {
    try {
      const nav = win.navigator || {}, doc = win.document;
      return exclusionReason({
        hostname: win.location.hostname, protocol: win.location.protocol,
        pathname: win.location.pathname, search: win.location.search,
        userAgent: nav.userAgent, webdriver: nav.webdriver,
        doNotTrack: nav.doNotTrack || win.doNotTrack, globalPrivacyControl: nav.globalPrivacyControl,
        optOut: /(?:^|;\s*)hs_telemetry_optout=1(?:;|$)/.test(doc.cookie || ''),
        adminEditing: !!doc.body?.classList.contains('hs-admin'), prerendering: doc.prerendering,
      });
    } catch (e) { return 'unavailable'; }
  }
  function allowed(win) { return reason(win) === null; }
  // Constructed synchronously by the executing shared script; no extra request.
  // The returned reporter fixes context at the first eligible measurement bind.
  function createVitalsReporter(win, script) {
    let epoch = 'unknown', context;
    try {
      const url = new URL(script.src, win.location.href);
      const epochs = url.searchParams.getAll('v');
      if (url.origin === win.location.origin && /^\/blog\/blog-shared(?:\.min)?\.js$/.test(url.pathname) &&
          epochs.length === 1 && /^20[0-9]{6}$/.test(epochs[0])) epoch = epochs[0];
    } catch (e) {}
    function capture() {
      if (!context) {
        const width = win.innerWidth;
        context = { contextVersion: 1, assetEpoch: epoch,
          viewportBand: typeof width !== 'number' || !Number.isFinite(width) || width <= 0
            ? 'unknown' : width < 768 ? 'narrow' : width < 1200 ? 'medium' : 'wide' };
      }
      return context;
    }
    function send(name, value, id) {
      if (!allowed(win)) return;
      try {
        if (typeof win.gtag === 'function') win.gtag('event', name, {
          event_category: 'Web Vitals', event_label: id,
          value: Math.round(name === 'CLS' ? value * 1000 : value), non_interaction: true,
        });
      } catch (e) {}
      try {
        const sample = { name, value: name === 'CLS' ? value * 1000 : value,
          page: win.location.pathname, version: 'web-vitals-6', id };
        const payload = JSON.stringify({ ...sample, ...capture() });
        if (win.navigator.sendBeacon) {
          win.navigator.sendBeacon('/api/cwv-ingest', new win.Blob([payload], { type: 'application/json' }));
        } else {
          win.fetch('/api/cwv-ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: payload, keepalive: true }).catch(function () {});
        }
      } catch (e) {}
    }
    return { capture, send };
  }
  function bootstrap(win) {
    const doc = win.document;
    let activated = false;
    // Google's documented opt-out flag is read at send time. A getter also
    // covers an admin login in another tab without polling or visitor IDs.
    Object.defineProperty(win, 'ga-disable-G-0ZKDQP9DNH', {
      configurable: true, get: function () { return !allowed(win); },
    });
    // Also gate later event calls when an admin login in another tab changes
    // the opt-out cookie. We do not transmit the marker to an analytics vendor.
    win.gtag = function () {
      if (allowed(win) && activated) win.dataLayer.push(arguments);
    };
    function load(src, id, endpoint) {
      if (doc.getElementById(id)) return;
      const script = doc.createElement('script');
      script.id = id;
      script.src = src;
      script.async = true;
      if (endpoint) script.dataset.endpoint = endpoint;
      doc.head.appendChild(script);
    }
    function activate() {
      if (activated || !allowed(win)) return;
      activated = true;
      win.dataLayer = win.dataLayer || [];
      win.gtag('consent', 'default', {
        ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
        analytics_storage: 'granted', functionality_storage: 'granted',
        security_storage: 'granted', wait_for_update: 500,
      });
      win.gtag('js', new Date());
      win.gtag('config', 'G-0ZKDQP9DNH');
      // Register vendor-supported beforeSend callbacks before loading either
      // script. Recheck eligibility for automatic events after an admin login.
      ['va', 'si'].forEach(function (key) {
        win[key] = win[key] || function () {
          const queue = key + 'q';
          win[queue] = win[queue] || [];
          win[queue].push(Array.from(arguments));
        };
        win[key]('beforeSend', function (event) { return allowed(win) ? event : null; });
      });
      load('https://www.googletagmanager.com/gtag/js?id=G-0ZKDQP9DNH', 'hs-ga4');
      load('/_vercel/speed-insights/script.js', 'hs-speed-insights');
      load('/_vercel/insights/script.js', 'hs-vercel-insights', '/_vercel/insights/event');
    }
    if (doc.prerendering) doc.addEventListener('prerenderingchange', activate, { once: true });
    else activate();
  }
  const api = { HOST, OPT_OUT, exclusionReason, reason, allowed, bootstrap, createVitalsReporter };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (typeof window !== 'undefined') {
    if (window.HsiaoTelemetry) return;
    window.HsiaoTelemetry = api;
    bootstrap(window);
  }
})();
