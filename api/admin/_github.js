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

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
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

/**
 * Atomically commit multiple UTF-8 files with the Git Data API.
 *
 * The branch ref update is non-forced. If another admin/CMS write lands after
 * the base ref is read, GitHub rejects the update instead of silently dropping
 * either writer's work.
 */
export async function ghCommitFiles(files, message) {
  const { owner, repo, branch, token } = getRepoConfig();
  if (!token) throw new Error('GITHUB_TOKEN env var not configured');
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('ghCommitFiles requires at least one file');
  }

  const api = `https://api.github.com/repos/${owner}/${repo}`;
  const refResponse = await fetch(`${api}/git/ref/heads/${encodeURIComponent(branch)}`, {
    headers: githubHeaders(token),
  });
  if (!refResponse.ok) {
    throw new Error(`GitHub ref lookup failed: ${refResponse.status} ${await refResponse.text()}`);
  }
  const ref = await refResponse.json();
  const baseCommitSha = ref.object?.sha;
  if (!baseCommitSha) throw new Error('GitHub branch ref did not include a commit SHA');

  const commitResponse = await fetch(`${api}/git/commits/${baseCommitSha}`, {
    headers: githubHeaders(token),
  });
  if (!commitResponse.ok) {
    throw new Error(`GitHub base commit lookup failed: ${commitResponse.status} ${await commitResponse.text()}`);
  }
  const baseCommit = await commitResponse.json();
  const baseTreeSha = baseCommit.tree?.sha;
  if (!baseTreeSha) throw new Error('GitHub base commit did not include a tree SHA');

  const tree = [];
  for (const file of files) {
    if (!file || !file.path || typeof file.content !== 'string') {
      throw new Error('Each atomic commit file needs path + UTF-8 content');
    }
    if (file.expectedSha) {
      const currentResponse = await fetch(
        `${api}/contents/${encodeURIComponent(file.path)}?ref=${encodeURIComponent(baseCommitSha)}`,
        { headers: githubHeaders(token) }
      );
      if (!currentResponse.ok) {
        throw new Error(`GitHub concurrency check failed for ${file.path}: ${currentResponse.status}`);
      }
      const current = await currentResponse.json();
      if (current.sha !== file.expectedSha) {
        throw new Error(`GitHub file changed during atomic commit; retry ${file.path}`);
      }
    }
    const blobResponse = await fetch(`${api}/git/blobs`, {
      method: 'POST',
      headers: githubHeaders(token),
      body: JSON.stringify({ content: file.content, encoding: 'utf-8' }),
    });
    if (!blobResponse.ok) {
      throw new Error(`GitHub blob create failed for ${file.path}: ${blobResponse.status} ${await blobResponse.text()}`);
    }
    const blob = await blobResponse.json();
    tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  const treeResponse = await fetch(`${api}/git/trees`, {
    method: 'POST',
    headers: githubHeaders(token),
    body: JSON.stringify({ base_tree: baseTreeSha, tree }),
  });
  if (!treeResponse.ok) {
    throw new Error(`GitHub tree create failed: ${treeResponse.status} ${await treeResponse.text()}`);
  }
  const newTree = await treeResponse.json();

  const newCommitResponse = await fetch(`${api}/git/commits`, {
    method: 'POST',
    headers: githubHeaders(token),
    body: JSON.stringify({
      message: message || 'admin: atomic content update',
      tree: newTree.sha,
      parents: [baseCommitSha],
    }),
  });
  if (!newCommitResponse.ok) {
    throw new Error(`GitHub commit create failed: ${newCommitResponse.status} ${await newCommitResponse.text()}`);
  }
  const newCommit = await newCommitResponse.json();

  const updateRefResponse = await fetch(`${api}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    headers: githubHeaders(token),
    body: JSON.stringify({ sha: newCommit.sha, force: false }),
  });
  if (!updateRefResponse.ok) {
    const detail = await updateRefResponse.text();
    throw new Error(`GitHub branch changed during atomic commit; retry the operation: ${updateRefResponse.status} ${detail}`);
  }

  return { commitSha: newCommit.sha, baseCommitSha };
}
