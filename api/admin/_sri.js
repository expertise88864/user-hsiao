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
  if (!url || !/^https?:\/\//.test(url)) return res.status(400).json({ error: 'invalid url' });

  try {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) return res.status(r.status).json({ error: `fetch failed: ${r.status}` });
    const buf = await r.arrayBuffer();
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
