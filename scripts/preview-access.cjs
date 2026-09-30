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

// Exercise the deployed dispatcher, rather than trusting build metadata or a
// successful HTML screenshot to prove the runtime identity endpoint works.
async function verifyRuntimeIdentity(client, baseValue, sha, repository) {
  const base = targetUrl(baseValue);
  assert.notEqual(base.origin, PRODUCTION, 'Runtime Preview check requires Preview');
  assert.match(sha || '', /^[a-f0-9]{40}$/, 'Missing exact candidate SHA');
  assert.match(repository || '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'Invalid candidate repository');
  const url = new URL('/api/admin/site-version', base).href;
  const response = await client.get(url, { maxRedirects: 0 })
    .catch(() => { throw new Error('Preview runtime identity request failed'); });
  assert.equal(response.status(), 200, 'Preview runtime identity must return HTTP200');
  assert.equal(response.url(), url, 'Preview runtime identity changed URL');
  const headers = response.headers();
  assert.match(headers['content-type'] || '', /^application\/json(?:;|$)/i, 'Preview runtime identity must return JSON');
  assert.ok((headers['cache-control'] || '').toLowerCase().split(',').map(v => v.trim()).includes('no-store'), 'Runtime identity must not be cached');
  const robots = (headers['x-robots-tag'] || '').toLowerCase().split(',').map(v => v.trim());
  assert.ok(robots.includes('noindex') && robots.includes('nofollow'), 'Runtime identity must not be indexed');
  if (headers['content-length']) assert.ok(Number(headers['content-length']) <= 4096, 'Runtime identity response too large');
  const bytes = await response.body();
  assert.ok(bytes.length <= 4096, 'Runtime identity response too large');
  let identity;
  try { identity = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('Invalid Preview runtime identity JSON'); }
  assert.ok(identity && typeof identity === 'object' && !Array.isArray(identity), 'Invalid Preview runtime identity');
  assert.deepEqual(Object.keys(identity).sort(), ['environment', 'repository', 'sha'], 'Unexpected public runtime identity fields');
  assert.equal(identity.environment, 'preview', 'Runtime deployment is not Preview');
  assert.equal(identity.sha, sha, 'Runtime deployment SHA mismatch');
  assert.equal(identity.repository, repository, 'Runtime deployment repository mismatch');
  return { environment: identity.environment, repository: identity.repository, sha: identity.sha };
}

module.exports = { targetUrl, previewCookies, verifyContent, verifyRuntimeIdentity, PRODUCTION };
