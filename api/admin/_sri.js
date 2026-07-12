/**
 * POST /api/admin/sri — compute SRI hash for a third-party script URL.
 *
 * Body: { url, alg? }   alg = sha256 | sha384 (default) | sha512
 *
 * Returns { sha384: '...', sha512: '...', size, attribute: 'integrity="sha384-..."' }
 *
 * Caveat for HsiaoEye:
 *   - GTM (`googletagmanager.com/gtag/js?id=G-...`) updates frequently.
 *     If you pin SRI hash, analytics will break next time Google ships a new
 *     gtag bundle. Recommended: SRI only first-party assets we host ourselves
 *     (which is automatically validated by `script-src 'self'` CSP).
 *
 * This endpoint is mainly for one-shot audits — paste the integrity attribute
 * into HTML when you need to lock a third-party version (e.g. a CDN-hosted
 * library you don't auto-update).
 */
import { requireAdmin } from './_auth.js';

// SRI is only meaningful for scripts the site actually pins: our own domain +
// the cross-origin hosts in the middleware CSP `script-src`. An unrestricted
// server-side fetch here is SSRF — an authed (or CSRF'd) admin could point
// `url` at http://localhost:<port>, a cloud metadata IP, or any internal
// service and use the returned size+hashes as an existence/content oracle.
// Allowlist the host; `.clarity.ms` is a wildcard in the CSP.
const SRI_ALLOWED_HOSTS = new Set([
  'hsiao.chendermatologist.com',
  'www.hsiao.chendermatologist.com',
  'cdn.jsdelivr.net',
  'www.googletagmanager.com',
  'www.google-analytics.com',
  'www.clarity.ms',
]);
function hostAllowedForSri(hostname) {
  return SRI_ALLOWED_HOSTS.has(hostname) || hostname.endsWith('.clarity.ms');
}
const MAX_SRI_BYTES = 5 * 1024 * 1024;  // SRI targets are JS libraries; cap at 5 MB

async function sha(buf, algName) {
  const h = await crypto.subtle.digest(algName, buf);
  // base64 encode (NOT base64url)
  let s = '';
  const arr = new Uint8Array(h);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { url } = body || {};
  let parsed;
  try { parsed = new URL(String(url || '')); } catch (e) { return res.status(400).json({ error: 'invalid url' }); }
  if (parsed.protocol !== 'https:') return res.status(400).json({ error: 'https:// url required' });
  if (!hostAllowedForSri(parsed.hostname)) {
    return res.status(400).json({ error: `host not allowed for SRI: ${parsed.hostname} (allowed: own domain, cdn.jsdelivr.net, and the CSP script-src hosts)` });
  }

  try {
    // redirect:'error' — a pinned SRI target must not redirect; this also
    // stops a redirect from bouncing the request off the allowlist to an
    // internal address.
    const r = await fetch(parsed.toString(), { redirect: 'error' });
    if (!r.ok) return res.status(r.status).json({ error: `fetch failed: ${r.status}` });
    const declared = Number(r.headers.get('content-length') || 0);
    if (declared > MAX_SRI_BYTES) return res.status(413).json({ error: 'resource too large for SRI (>5 MB)' });
    const buf = await r.arrayBuffer();
    if (buf.byteLength > MAX_SRI_BYTES) return res.status(413).json({ error: 'resource too large for SRI (>5 MB)' });
    const sha256 = await sha(buf, 'SHA-256');
    const sha384 = await sha(buf, 'SHA-384');
    const sha512 = await sha(buf, 'SHA-512');
    const size = buf.byteLength;

    const integrity = `sha384-${sha384}`;
    const html = `<script src="${url}" integrity="${integrity}" crossorigin="anonymous"></script>`;

    res.status(200).json({
      url,
      size,
      sizeKb: (size / 1024).toFixed(2),
      sha256: `sha256-${sha256}`,
      sha384: integrity,
      sha512: `sha512-${sha512}`,
      attribute: `integrity="${integrity}" crossorigin="anonymous"`,
      snippet: html,
      warning: /googletagmanager|googleadservices|gstatic|google-analytics/.test(url)
        ? 'Google scripts update frequently — pinning SRI here will break the script when Google ships an update. Prefer SRI for stable CDN-hosted libraries.'
        : null,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
