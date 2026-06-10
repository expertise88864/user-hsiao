/* HsiaoEye Trusted Types bootstrap.
 * Loaded synchronously before inline analytics and page runtime scripts.
 */
(function () {
  'use strict';

  if (!window.trustedTypes || !window.trustedTypes.createPolicy) return;
  if (window.__hsTrustedTypesReady) return;

  var scriptUrlAllow = /^(https?:\/\/(?:www\.googletagmanager\.com|www\.google-analytics\.com|www\.clarity\.ms|stats\.g\.doubleclick\.net|cdn\.jsdelivr\.net)\/|\/)/;

  function sanitizeHTML(value) {
    var output = String(value);
    output = output.replace(/<script[\s\S]*?<\/script>/gi, '');
    output = output.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    output = output.replace(
      /(href|src|action|formaction|xlink:href)\s*=\s*(["']?)\s*javascript:[^"'>\s]*\2/gi,
      '$1=$2#$2'
    );
    return output;
  }

  function allowScriptURL(value) {
    var url = String(value);
    if (scriptUrlAllow.test(url)) return url;
    throw new TypeError('script URL not in allow-list: ' + url);
  }

  var policy = {
    createHTML: sanitizeHTML,
    createScript: function (value) { return String(value); },
    createScriptURL: allowScriptURL,
  };

  try { window.trustedTypes.createPolicy('hs-policy', policy); } catch (error) {}
  try { window.trustedTypes.createPolicy('default', policy); } catch (error) {}
  window.__hsTrustedTypesReady = true;
})();
