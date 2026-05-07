/**
 * Vercel Edge Middleware — sets enforce-mode CSP + Trusted Types headers.
 *
 * v31.5: Rewrote without `next/server` (this isn't a Next.js project).
 * Now uses the standard Web API `Response` and the Vercel Edge runtime's
 * built-in `fetch(request)` pattern.
 *
 * Strategy:
 *   - Generate per-request nonce.
 *   - Set CSP headers (enforce + Report-Only mirror) on every navigation.
 *   - DO NOT attempt streaming HTML rewrite — Vercel Edge Middleware can't
 *     modify response bodies in the non-Next.js mode without invoking a
 *     loopback fetch (which would 2× every request).
 *   - For nonce-based CSP enforcement, a build-time injection step (or a
 *     migration to Next/Astro) is the right path. For now we ship the same
 *     nonce-less enforce CSP as v29 — actual header-only application.
 */

export const config = {
  matcher: [
    '/((?!api|_next|_vercel|admin|sw\\.js|robots\\.txt|sitemap\\.xml|.*\\.(?:js|css|svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?|xml|json|txt|map)).*)',
  ],
};

const CSP = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://pagead2.googlesyndication.com https://www.clarity.ms https://*.clarity.ms https://cdn.jsdelivr.net`,
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net`,
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
  `report-uri /api/csp-report`,
  `upgrade-insecure-requests`,
].join('; ');

// Tighter Report-Only — no 'unsafe-inline'; we'd add nonces here when we
// migrate to a build pipeline that can stamp them.
const CSP_TIGHT = [
  `default-src 'self'`,
  `script-src 'self' https://www.googletagmanager.com https://www.google-analytics.com https://pagead2.googlesyndication.com https://www.clarity.ms https://*.clarity.ms`,
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
  `font-src 'self' https://fonts.gstatic.com data:`,
  `img-src 'self' data: https: blob:`,
  `connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://*.clarity.ms https://stats.g.doubleclick.net`,
  `frame-src https://www.google.com https://googleads.g.doubleclick.net https://www.youtube.com`,
  `frame-ancestors 'self'`,
  `base-uri 'self'`,
  `object-src 'none'`,
  `require-trusted-types-for 'script'`,
  `report-uri /api/csp-report`,
].join('; ');

export default function middleware(req) {
  const headers = new Headers();
  headers.set('Content-Security-Policy', CSP);
  headers.set('Content-Security-Policy-Report-Only', CSP_TIGHT);
  headers.set('Reporting-Endpoints', 'csp-endpoint="/api/csp-report"');

  // Returning a Response with no body and `x-middleware-next: 1` lets the
  // upstream serve the actual content while Vercel merges our headers in.
  // This is the documented non-Next.js pattern for edge middleware.
  headers.set('x-middleware-next', '1');
  return new Response(null, { headers });
}
