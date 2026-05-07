/**
 * GitHub Contents API helpers — Edge-runtime safe (no Node `crypto` import).
 *
 * Split out from _auth.js in v31.5 because:
 *   - Edge Functions (api/og.js, api/csp-report.js, middleware.js) must NOT
 *     transitively import Node-only modules.
 *   - _auth.js still uses Node `crypto` for the HMAC session cookie, which
 *     is fine for the Node-runtime admin API routes that import it.
 *
 * Anything that just talks to GitHub goes here. Anything that handles admin
 * authentication stays in _auth.js.
 */

export function getRepoConfig() {
  const owner   = process.env.GITHUB_OWNER  || 'expertise88864';
  const repo    = process.env.GITHUB_REPO   || 'user-hsiao';
  const branch  = process.env.GITHUB_BRANCH || 'main';
  const token   = process.env.GITHUB_TOKEN;
  return { owner, repo, branch, token };
}

/**
 * Fetch a file from GitHub repo. Returns { content (utf-8), sha } or null if 404.
 */
export async function ghGetFile(path) {
  const { owner, repo, branch, token } = getRepoConfig();
  if (!token) throw new Error('GITHUB_TOKEN env var not configured');
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`;
  const r = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub GET ${path} failed: ${r.status} ${await r.text()}`);
  const data = await r.json();
  // Decode base64 — works in both Node and Edge runtimes via atob
  const b64 = (data.content || '').replace(/\n/g, '');
  const binary = atob(b64);
  // UTF-8 decode the byte string
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const content = new TextDecoder('utf-8').decode(bytes);
  return { content, sha: data.sha };
}

/**
 * Create or update a file via GitHub Contents API. `sha` required for update,
 * omit for create. `content` may be a string (utf-8 encoded) or already-base64.
 * Returns { commitSha, contentSha }.
 */
export async function ghPutFile(path, content, message, sha, opts = {}) {
  const { owner, repo, branch, token } = getRepoConfig();
  if (!token) throw new Error('GITHUB_TOKEN env var not configured');
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  // Encode content to base64 — Edge-safe (uses TextEncoder + btoa)
  let b64;
  if (opts.alreadyBase64) {
    b64 = content;
  } else {
    const enc = new TextEncoder().encode(content);
    let s = '';
    for (let i = 0; i < enc.length; i++) s += String.fromCharCode(enc[i]);
    b64 = btoa(s);
  }
  const body = { message: message || `admin: update ${path}`, content: b64, branch };
  if (sha) body.sha = sha;
  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`GitHub PUT ${path} failed: ${r.status} — ${errText.slice(0, 200)}`);
  }
  const data = await r.json();
  return { commitSha: data.commit?.sha || '', contentSha: data.content?.sha || '' };
}
