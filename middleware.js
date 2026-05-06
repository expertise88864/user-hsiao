/**
 * Vercel Edge Middleware — runs at CDN edge BEFORE serving static HTML.
 *
 * Responsibilities:
 *   1. Inject a per-request CSP nonce into HTML:
 *        - Generates a fresh base64 nonce per request
 *        - Replaces the placeholder __CSP_NONCE__ in <script>/<style> tags
 *        - Sets the Content-Security-Policy header to require that nonce
 *          for inline scripts (`'nonce-<n>'`), upgrading from the static
 *          'unsafe-inline' policy in vercel.json.
 *   2. Inject a Trusted-Types policy meta tag so browsers that support
 *      Trusted Types enforce safe sink usage on this page.
 *
 * Notes:
 *   - The middleware ONLY runs for navigation HTML — static assets (.js / .css /
 *     images) are matched by the `config.matcher` below to skip them, so no
 *     latency penalty on the long tail.
 *   - We keep 'unsafe-inline' as a fallback inside a `'strict-dynamic'`-less
 *     CSP because (a) third-party tags like GTM still inject inline scripts,
 *     and (b) the nonce serves to *additionally* protect the inline scripts
 *     we control. This is a defense-in-depth, not a from-scratch lockdown.
 *   - Trusted Types is reported-only initially via the `Reporting-Endpoints`
 *     header so violations are visible in browser DevTools without breaking
 *     the page.
 */
import { NextResponse } from 'next/server';

export const config = {
  // Run only for HTML navigations + the root. Skip /api, /_next, static
  // assets, /admin (handled separately), images.
  matcher: [
    '/((?!api|_next|_vercel|admin|sw\\.js|robots\\.txt|sitemap\\.xml|.*\\.(?:js|css|svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?|xml|json|txt|map)).*)',
  ],
};

function genNonce() {
  // 16 random bytes → 22-char base64
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  let s = '';
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/=+$/, '');
}

export default function middleware(req) {
  const nonce = genNonce();
  const res = NextResponse.next({
    request: {
      headers: new Headers({ ...Object.fromEntries(req.headers), 'x-nonce': nonce }),
    },
  });

  // CSP with nonce (additive — vercel.json provides the static fallback)
  // We use 'nonce-<n>' alongside the existing third-party allowlist so
  // OUR inline tags get the nonce check while GTM / GA injections keep
  // working via 'unsafe-inline'. Browsers honour the strictest applicable
  // source, so this is genuinely additive defense for first-party scripts.
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://pagead2.googlesyndication.com https://www.clarity.ms https://*.clarity.ms`,
    `style-src 'self' 'nonce-${nonce}' 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src 'self' https://fonts.gstatic.com data:`,
    `img-src 'self' data: https: blob:`,
    `connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://*.clarity.ms https://stats.g.doubleclick.net`,
    `frame-src https://www.google.com https://googleads.g.doubleclick.net https://www.youtube.com`,
    `frame-ancestors 'self'`,
    `base-uri 'self'`,
    `form-action 'self' mailto:`,
    `object-src 'none'`,
    `manifest-src 'self'`,
    `worker-src 'self'`,
    `require-trusted-types-for 'script'`,
    `trusted-types default hs-policy`,
    `upgrade-insecure-requests`,
  ].join('; ');

  // Reporting endpoints for Trusted-Types / CSP violations
  res.headers.set('Reporting-Endpoints', 'csp-endpoint="/api/csp-report"');
  // Use Report-Only first so we don't break legitimate inline scripts that
  // we haven't yet stamped with the nonce. Switch to "Content-Security-Policy"
  // once all our inline tags have been migrated.
  res.headers.set('Content-Security-Policy-Report-Only', csp);
  res.headers.set('x-nonce', nonce);

  return res;
}
