/** Minimal public identity; no credentials, request headers or messages. */
export default function siteVersion(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || '';
  const owner = process.env.VERCEL_GIT_REPO_OWNER || '';
  const repo = process.env.VERCEL_GIT_REPO_SLUG || '';
  const environment = process.env.VERCEL_ENV;
  const valid = process.env.VERCEL_GIT_PROVIDER === 'github' && /^[a-f0-9]{40}$/.test(sha) &&
    /^[A-Za-z0-9_.-]+$/.test(owner) && /^[A-Za-z0-9_.-]+$/.test(repo) &&
    ['production', 'preview', 'development'].includes(environment);
  return res.json(valid ? { sha, repository: owner + '/' + repo, environment } : { environment: 'unknown' });
}
