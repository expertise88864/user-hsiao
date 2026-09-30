import policy from '../assets/telemetry.js';
import { isAdminRequest } from './admin/_auth.js';

// Anonymous metrics are not authentication. Headers and the public opt-out
// marker can exclude data but can never grant any privileged operation.
export function telemetryExclusion(req) {
  if (process.env.VERCEL_ENV !== 'production') return 'environment';
  const headers = req.headers || {};
  let url;
  try {
    const reference = headers.origin || headers.referer;
    url = reference ? new URL(reference) : new URL('https://' + String(headers.host || ''));
    if (url.origin !== 'https://' + policy.HOST) return 'environment';
    // Origin has no path, so inspect a same-origin Referer for editor routes.
    if (headers.referer) {
      const ref = new URL(headers.referer);
      if (ref.origin !== url.origin) return 'environment';
      url = ref;
    }
  } catch (e) { return 'environment'; }
  const reason = policy.exclusionReason({
    hostname: url.hostname, protocol: url.protocol, pathname: url.pathname, search: url.search,
    userAgent: String(headers['user-agent'] || ''), doNotTrack: headers.dnt,
    globalPrivacyControl: headers['sec-gpc'] === '1',
    optOut: /(?:^|;\s*)hs_telemetry_optout=1(?:;|$)/.test(String(headers.cookie || '')),
  });
  if (reason) return reason;
  try { return isAdminRequest(req) ? 'admin' : null; }
  catch (e) { return 'invalid_session'; }
}
