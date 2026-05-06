/**
 * Shared auth helper — verify the admin session cookie set by /api/admin/login.
 * Throws 401 if invalid. Use as the first line of every protected route.
 */
import crypto from 'crypto';

const SESSION_COOKIE = 'hs_admin_session';

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex').slice(0, 32);
}

function getSessionFromReq(req) {
  const cookieHeader = req.headers.cookie || '';
  const m = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function verifySessionToken(token, secret) {
  if (!token || !secret) return false;
  const [expStr, sig] = String(token).split('.');
  const exp = parseInt(expStr, 10);
  if (!exp || exp < Date.now()) return false;
  const expectedSig = sign(String(exp), secret);
  if (!sig || sig.length !== expectedSig.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
  } catch (e) { return false; }
}

/**
 * Returns true if request is authenticated, otherwise sends 401 and returns false.
 * Usage:
 *   import { requireAdmin } from './_auth.js';
 *   if (!requireAdmin(req, res)) return;
 */
export function requireAdmin(req, res) {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) {
    res.status(500).json({ error: 'ADMIN_PASSWORD env var not configured' });
    return false;
  }
  const token = getSessionFromReq(req);
  if (!verifySessionToken(token, secret)) {
    res.status(401).json({ error: 'Unauthorized — please login at /admin' });
    return false;
  }
  return true;
}

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
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub GET ${path} failed: ${r.status} ${await r.text()}`);
  const data = await r.json();
  const content = Buffer.from(data.content, data.encoding || 'base64').toString('utf-8');
  return { content, sha: data.sha };
}

/**
 * Create or update a file via GitHub Contents API. `sha` required for update,
 * omit for create. Returns { commitSha }.
 */
export async function ghPutFile(path, content, message, sha) {
  const { owner, repo, branch, token } = getRepoConfig();
  if (!token) throw new Error('GITHUB_TOKEN env var not configured');
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const body = {
    message: message || `admin: update ${path}`,
    content: Buffer.from(content, 'utf-8').toString('base64'),
    branch,
  };
  if (sha) body.sha = sha;
  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
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
