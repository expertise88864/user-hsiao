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

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const text = await req.text();
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
