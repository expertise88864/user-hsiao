/** Read-only observations, deliberately separate from the release gate. */
import { createHash } from 'node:crypto';
import { requireAdmin, getRepoConfig } from './_auth.js';

const ORIGIN = 'https://hsiao.chendermatologist.com';
const SHA = /^[a-f0-9]{40}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_BYTES = 2 * 1024 * 1024;

function headers(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
}

async function bytes(response, limit = MAX_BYTES) {
  if (!response.ok || !response.body) throw new Error('Unavailable');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error('Too large');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); }
}

function blobSha(content) {
  return createHash('sha1').update('blob ' + content.length + '\0').update(content).digest('hex');
}

function previewUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith('.vercel.app') &&
      !url.username && !url.password && !url.port && !url.search && !url.hash &&
      (url.pathname === '/' || url.pathname === '') ? url.origin : null;
  } catch { return null; }
}

export default async function publicationStatus(req, res) {
  headers(res);
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const { slug, blob, commit = '' } = req.query || {};
  if (typeof slug !== 'string' || slug.length > 100 || !SLUG.test(slug) ||
      typeof blob !== 'string' || !SHA.test(blob) || typeof commit !== 'string' || commit && !SHA.test(commit)) {
    return res.status(400).json({ error: 'Invalid article version' });
  }
  const { owner, repo, token } = getRepoConfig();
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    return res.status(503).json({ error: 'Repository unavailable' });
  }
  const repository = owner + '/' + repo;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const options = { method: 'GET', redirect: 'error', cache: 'no-store', signal: controller.signal };
  const gh = async path => {
    if (!token) throw new Error('Unavailable');
    const response = await fetch('https://api.github.com/repos/' + repository + path, {
      ...options, headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token }
    });
    return JSON.parse((await bytes(response)).toString('utf8'));
  };
  const result = {
    checkedAt: new Date().toISOString(), saved: { blob, commit },
    production: { state: 'unknown', sha: '', includesSavedCommit: 'unknown', url: ORIGIN + '/blog/' + slug },
    preview: { state: commit ? 'unknown' : 'no_receipt', sha: commit, url: null },
    // The browser has not run _delivery.py, the full policy or post-release
    // smoke checks. No collection of deployment statuses can replace them.
    releaseVerified: false,
    commitUrl: commit ? 'https://github.com/' + repository + '/commit/' + commit : null
  };
  try {
    await Promise.allSettled([
      (async () => {
        const response = await fetch(ORIGIN + '/api/admin/site-version', options);
        const version = JSON.parse((await bytes(response, 4096)).toString('utf8'));
        if (version.environment !== 'production' || version.repository !== repository || !SHA.test(version.sha || '')) return;
        result.production.sha = version.sha;
        await Promise.allSettled([
          (async () => {
            // Actual canonical bytes; main or historical Ready is not proof.
            const live = await fetch(result.production.url, options);
            if (!/^text\/html(?:;|$)/i.test(live.headers.get('content-type') || '')) return;
            const content = await bytes(live);
            result.production.state = blobSha(content) === blob ? 'matching_content' : 'different_content';
          })(),
          (async () => {
            if (!commit) return;
            if (commit === version.sha) result.production.includesSavedCommit = 'yes';
            else {
              const comparison = await gh('/compare/' + commit + '...' + version.sha);
              if (comparison.base_commit?.sha === commit && comparison.merge_base_commit?.sha === commit &&
                  ['ahead', 'identical'].includes(comparison.status)) result.production.includesSavedCommit = 'yes';
              else if (comparison.base_commit?.sha === commit && ['behind', 'diverged'].includes(comparison.status)) {
                result.production.includesSavedCommit = 'no';
              }
            }
          })()
        ]);
      })(),
      (async () => {
        if (!commit) return;
        const pulls = await gh('/commits/' + commit + '/pulls?per_page=100');
        if (!Array.isArray(pulls)) return;
        if (!pulls.some(pr => pr.head?.sha === commit && pr.head?.repo?.full_name === repository && pr.base?.repo?.full_name === repository)) {
          result.preview.state = pulls.length < 100 ? 'no_candidate_pr' : 'unknown';
          return;
        }
        const deployments = await gh('/deployments?sha=' + commit + '&per_page=100');
        if (!Array.isArray(deployments)) return;
        const deployment = deployments.find(d => d.sha === commit && d.environment?.toLowerCase() === 'preview' &&
          d.production_environment === false && ['vercel[bot]', 'vercel'].includes(d.creator?.login));
        if (!deployment) { result.preview.state = deployments.length < 100 ? 'not_found' : 'unknown'; return; }
        const statuses = await gh('/deployments/' + deployment.id + '/statuses?per_page=1');
        const latest = Array.isArray(statuses) && statuses[0];
        if (!latest) return;
        if (latest.state !== 'success') {
          result.preview.state = ['pending', 'queued', 'in_progress', 'failure', 'error', 'inactive'].includes(latest.state) ? latest.state : 'unknown';
          return;
        }
        const url = previewUrl(latest.environment_url);
        if (url) { result.preview.state = 'ready'; result.preview.url = url + '/blog/' + slug; }
      })()
    ]);
  } finally { clearTimeout(timer); }
  return res.json(result);
}
