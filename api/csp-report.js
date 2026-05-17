/**
 * POST /api/csp-report — collects CSP violation reports from the browser.
 *
 * The browser sends these as `application/csp-report` JSON when the CSP
 * `report-uri` / `report-to` directive points here. We log them to stdout
 * (Vercel function logs) so you can review violations during the
 * migration period from Report-Only → enforcement.
 *
 * Responses with 204 No Content (the spec recommends this).
 */
export const config = { runtime: 'edge' };

// v37.28 — edge runtime can't easily share state, but we can do a simple
// per-IP token bucket using URL-level dedup + payload-size cap. The big
// risk is somebody POSTing 1 MB junk to flood our logs; the small risk
// is a real browser dumping 50 CSP violations from one stuck inline
// handler. Body cap + Origin allowlist below mitigates both cheaply.
const MAX_BODY_BYTES = 8 * 1024;   // 8 KB — real CSP reports are ~1-2 KB
const ALLOWED_ORIGINS = [
  'https://hsiao.chendermatologist.com',
  'https://www.hsiao.chendermatologist.com',
];

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  // Browser-generated CSP reports DON'T carry Origin (they're fire-and-forget
  // from the browser's CSP enforcer, not from a script). So Origin is
  // empty for legit reports. Reject if Origin is present AND not our own.
  const origin = req.headers.get('origin');
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return new Response(null, { status: 204 });  // silently drop
  }
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      return new Response(null, { status: 413 });
    }
    let body;
    try { body = JSON.parse(text); } catch (e) { body = { raw: text.slice(0, 1000) }; }
    const report = body['csp-report'] || body;
    // Strip noisy / large fields
    const compact = {
      blocked: report['blocked-uri'] || report.blockedURL,
      effective: report['effective-directive'] || report.effectiveDirective,
      violated: report['violated-directive'] || report.violatedDirective,
      docUri: report['document-uri'] || report.documentURL,
      original: (report['original-policy'] || '').slice(0, 200),
      sourceFile: report['source-file'] || report.sourceFile,
      line: report['line-number'] || report.lineNumber,
      sample: (report['script-sample'] || '').slice(0, 80),
      ua: req.headers.get('user-agent')?.slice(0, 80),
      ts: new Date().toISOString(),
    };
    console.log('[CSP-report]', JSON.stringify(compact));

    // v37.35 — also persist to KV as a capped LIST so /api/admin/csp can
    // surface them in the dashboard. Fire-and-forget (don't await): the
    // browser already has a 204 incoming and we don't want to slow it.
    // List is trimmed to last MAX_KV_REPORTS entries.
    persistToKv(compact).catch(() => {});
  } catch (e) { /* ignore */ }
  return new Response(null, { status: 204 });
}

// ── KV persistence (Edge-runtime safe; only fetch + std env vars) ──
const MAX_KV_REPORTS = 200;
const KV_LIST_KEY = 'csp:reports';

async function persistToKv(compact) {
  const url = (typeof process !== 'undefined') && process.env && process.env.KV_REST_API_URL;
  const tok = (typeof process !== 'undefined') && process.env && process.env.KV_REST_API_TOKEN;
  if (!url || !tok) return;
  const headers = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };
  const payload = JSON.stringify(compact);
  // LPUSH adds to front (newest-first when LRANGE 0 -1).
  await fetch(`${url}/lpush/${encodeURIComponent(KV_LIST_KEY)}/${encodeURIComponent(payload)}`,
              { method: 'POST', headers }).catch(() => {});
  // Trim to keep memory bounded.
  await fetch(`${url}/ltrim/${encodeURIComponent(KV_LIST_KEY)}/0/${MAX_KV_REPORTS - 1}`,
              { method: 'POST', headers }).catch(() => {});
}
