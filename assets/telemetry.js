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
  const api = { HOST, OPT_OUT, exclusionReason, reason, allowed, bootstrap };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (typeof window !== 'undefined') {
    if (window.HsiaoTelemetry) return;
    window.HsiaoTelemetry = api;
    bootstrap(window);
  }
})();
