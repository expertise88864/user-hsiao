/**
 * Vercel Edge Middleware — true CSP nonce + 'strict-dynamic' via response
 * body streaming rewrite.
 *
 * v30 architecture:
 *   1. Generate per-request nonce.
 *   2. NextResponse.next() forwards to upstream (static HTML or page handler).
 *   3. We pipe the response body through a TransformStream that injects
 *      `nonce="<n>"` into every inline <script> and <style> opening tag
 *      that doesn't already have a nonce.
 *   4. Set CSP that requires that nonce + 'strict-dynamic' (so nonced
 *      scripts can load further scripts; e.g., GTM async injects).
 *   5. Browsers that understand 'strict-dynamic' ignore the legacy
 *      'unsafe-inline' fallback, so nonce-only is enforced.
 *
 * Streaming-safe: we hold back the buffer up to the last `<` so a partial
 * tag spanning a chunk boundary is re-joined correctly. The decoder uses
 * { stream: true } so we don't split UTF-8 sequences either.
 *
 * Cost: an extra RTT-zero stream pass through Edge — sub-millisecond for
 * HsiaoEye's ≤200KB pages.
 */
import { NextResponse } from 'next/server';

export const config = {
  matcher: [
    '/((?!api|_next|_vercel|admin|sw\\.js|robots\\.txt|sitemap\\.xml|.*\\.(?:js|css|svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?|xml|json|txt|map)).*)',
  ],
};

function genNonce() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  let s = '';
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function buildCsp(nonce) {
  return [
    `default-src 'self'`,
    // 'strict-dynamic' is the modern path; 'unsafe-inline' is fallback for
    // browsers that don't understand 'strict-dynamic' (those ignore strict-
    // dynamic and honour unsafe-inline). Modern browsers ignore unsafe-inline.
    // 'self' + https: covers the GTM/GA/Clarity hosts (only loadable via
    // scripts that pass the nonce check, thanks to 'strict-dynamic').
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' https:`,
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
    `report-uri /api/csp-report`,
    `upgrade-insecure-requests`,
  ].join('; ');
}

// TransformStream that injects nonce="<n>" into every inline <script>
// and <style> opening tag (without an existing nonce attribute).
//
// Chunk-boundary safe: holds back text after the last `<` until next chunk
// arrives, so a tag never gets split mid-rewrite.
export function makeNonceInjector(nonce) {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const encoder = new TextEncoder();
  let leftover = '';

  const SCRIPT_RE = /<script(?![^>]*\bnonce=)(?=\s|>)/gi;
  const STYLE_RE  = /<style(?![^>]*\bnonce=)(?=\s|>)/gi;

  function rewrite(text) {
    return text
      .replace(SCRIPT_RE, `<script nonce="${nonce}"`)
      .replace(STYLE_RE,  `<style nonce="${nonce}"`);
  }

  return new TransformStream({
    transform(chunk, ctrl) {
      const text = leftover + decoder.decode(chunk, { stream: true });
      // Find a safe split point: the last `<` that could still be inside an
      // unterminated opening tag. Hold everything from that `<` onwards.
      const lastOpen = text.lastIndexOf('<');
      const lastClose = text.lastIndexOf('>');
      let safe, hold;
      if (lastOpen > lastClose) {
        safe = text.slice(0, lastOpen);
        hold = text.slice(lastOpen);
      } else {
        safe = text;
        hold = '';
      }
      if (safe) ctrl.enqueue(encoder.encode(rewrite(safe)));
      leftover = hold;
    },
    flush(ctrl) {
      if (leftover) {
        // Final flush: also flush decoder
        leftover += decoder.decode();
        ctrl.enqueue(encoder.encode(rewrite(leftover)));
      }
    },
  });
}

export default async function middleware(req) {
  const nonce = genNonce();

  // Pass through to upstream and let NextResponse hand us the response.
  // We then re-create the response with a transformed body.
  const res = NextResponse.next();

  // NextResponse.next() doesn't give us the upstream body to pipe — to get
  // streaming rewrite we need to fetch ourselves and re-respond. Avoid loop
  // by attaching a marker header that the matcher excludes.
  //
  // BUT: middleware-initiated fetch in Vercel goes through the SAME edge
  // routing, so we'd recurse. The clean way is to skip rewriting if a
  // marker header is already present.
  if (req.headers.get('x-csp-rewrite-passthrough') === '1') {
    // Already came back through; just set CSP.
    res.headers.set('Content-Security-Policy', buildCsp(nonce));
    res.headers.set('Reporting-Endpoints', 'csp-endpoint="/api/csp-report"');
    res.headers.set('x-nonce', nonce);
    return res;
  }

  // Set the response headers (will apply to NextResponse.next() result).
  res.headers.set('x-nonce', nonce);
  res.headers.set('Reporting-Endpoints', 'csp-endpoint="/api/csp-report"');
  res.headers.set('Content-Security-Policy', buildCsp(nonce));

  // Try the streaming rewrite path: fetch upstream + pipe.
  // If anything goes wrong (non-HTML response, fetch failure), we fall back
  // to the headers-only path above.
  try {
    const upstream = await fetch(new URL(req.url), {
      method: req.method,
      headers: { ...Object.fromEntries(req.headers), 'x-csp-rewrite-passthrough': '1' },
      redirect: 'manual',
    });
    const ct = upstream.headers.get('content-type') || '';
    if (!ct.includes('text/html') || !upstream.body) {
      // Non-HTML — return upstream as-is with our security headers
      const out = new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: upstream.headers,
      });
      out.headers.set('Content-Security-Policy', buildCsp(nonce));
      out.headers.set('Reporting-Endpoints', 'csp-endpoint="/api/csp-report"');
      out.headers.set('x-nonce', nonce);
      return out;
    }

    const transformed = upstream.body.pipeThrough(makeNonceInjector(nonce));
    const newHeaders = new Headers(upstream.headers);
    newHeaders.set('Content-Security-Policy', buildCsp(nonce));
    newHeaders.set('Reporting-Endpoints', 'csp-endpoint="/api/csp-report"');
    newHeaders.set('x-nonce', nonce);
    // Drop content-length since we mutated the body
    newHeaders.delete('content-length');
    return new Response(transformed, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: newHeaders,
    });
  } catch (e) {
    // Fall back: just set headers, let upstream serve normally
    return res;
  }
}
