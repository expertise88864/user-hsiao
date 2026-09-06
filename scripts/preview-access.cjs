// CI-only authentication. Never put credentials in URLs, global browser headers,
// traces or saved storage-state files. Cookies remain in the browser's memory.
const assert = require('node:assert/strict');
const PRODUCTION = 'https://hsiao.chendermatologist.com';

function targetUrl(value) {
  const url = new URL(value);
  assert.ok(url.protocol === 'https:' && !url.username && !url.password &&
    !url.port && !url.search && !url.hash && url.pathname === '/', 'Invalid deployment origin');
  assert.ok(url.origin === PRODUCTION || url.hostname.endsWith('.vercel.app'), 'Unexpected deployment host');
  return url;
}

async function previewCookies(value, request, secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
  const base = targetUrl(value);
  if (base.origin === PRODUCTION) return [];
  assert.ok(secret, 'Protected Preview requires repository secret VERCEL_AUTOMATION_BYPASS_SECRET');
  // This isolated HTTP client performs exactly one request and never follows a
  // redirect with the secret. Vercel sets a cookie on its redirect response.
  const client = await request.newContext();
  try {
    const response = await client.get(base.href, {
      maxRedirects: 0,
      headers: { 'x-vercel-protection-bypass': secret, 'x-vercel-set-bypass-cookie': 'true' },
    }).catch(() => { throw new Error('Preview authentication request failed'); });
    assert.ok([200, 301, 302, 303, 307, 308].includes(response.status()), 'Preview authentication rejected');
    const location = response.headers().location;
    if (location) assert.equal(new URL(location, base).origin, base.origin, 'Preview authentication redirected off origin');
    const state = await client.storageState();
    const cookies = state.cookies.filter(cookie =>
      cookie.domain.replace(/^\./, '') === base.hostname && cookie.secure)
      .map(cookie => ({ ...cookie, domain: base.hostname, httpOnly: true }));
    assert.ok(cookies.length, 'Preview authentication did not establish a scoped secure cookie');
    return cookies;
  } finally { await client.dispose(); }
}

async function verifyContent(page, baseValue, route, response) {
  const base = targetUrl(baseValue);
  assert.equal(response && response.status(), 200, 'Expected HTTP 200 from website');
  const current = new URL(page.url());
  assert.equal(current.origin, base.origin, 'Website redirected to login or another deployment');
  const path = value => value.replace(/\/$/, '') || '/';
  assert.equal(path(current.pathname), path(new URL(route, base).pathname), 'Unexpected final page path');
  await page.waitForFunction(() => {
    const main = document.querySelector('main');
    const h1 = document.querySelector('main h1');
    const canonical = document.querySelector('link[rel="canonical"]');
    return document.title.trim() && main && main.innerText.trim().length > 50 &&
      h1 && h1.innerText.trim() && canonical &&
      new URL(canonical.href).origin === 'https://hsiao.chendermatologist.com';
  });
}

module.exports = { targetUrl, previewCookies, verifyContent, PRODUCTION };
