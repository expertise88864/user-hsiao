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
  } catch (e) { /* ignore */ }
  return new Response(null, { status: 204 });
}
