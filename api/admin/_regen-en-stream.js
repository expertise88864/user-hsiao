/**
 * GET /api/admin/regen-en-stream — same as /api/admin/regen-en but streams
 * Server-Sent Events so the admin UI can show real-time progress.
 *
 * Each event:
 *   data: { type: 'start',    total: N }
 *   data: { type: 'progress', done: i, total: N, current: 'blog/<slug>.html', ok: true }
 *   data: { type: 'complete', ok, failed, noop }
 *
 * Auth: same HMAC cookie check as the rest of /api/admin/*.
 *
 * Use:
 *   const es = new EventSource('/api/admin/regen-en-stream');
 *   es.addEventListener('progress', e => { ... });
 */
import { requireAdmin, ghGetFile, ghPutFile } from './_auth.js';

const DOMAIN = 'https://hsiao.chendermatologist.com';

const EN_BANNER = `<div id="hs-en-banner" style="background:linear-gradient(180deg,#e3edf6,#b8cfe3);border-bottom:1px solid #3a5a7c;padding:9px 18px;text-align:center;font-size:12.5px;color:#243b56;font-family:Inter,system-ui,sans-serif;line-height:1.5;font-weight:500">
  🌐 You are reading the English-mode interface. Some article body content is currently Chinese-only — full translation in progress.
  <a href="#" id="hs-en-banner-zh" style="margin-left:8px;color:#0f172a;font-weight:700;text-decoration:underline">Switch to 中文 ↗</a>
</div>`;

const EN_LANG_BOOTSTRAP = `<script>
try { localStorage.setItem('hs_lang', 'en'); document.cookie = 'hs_lang=en;path=/;max-age=31536000;samesite=lax'; } catch (e) {}
document.addEventListener('DOMContentLoaded', function () {
  var sw = document.getElementById('hs-en-banner-zh');
  if (sw) sw.href = location.pathname.replace(/^\\/en\\//, '/').replace(/^\\/en$/, '/');
});
</script>`;

function transform(html, zhCanonical, enCanonical) {
  let s = html.replace(/<html\s+lang="[^"]*"/, '<html lang="en"');
  s = s.replace(/<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/, `<link rel="canonical" href="${DOMAIN}${enCanonical}" />`);
  const hreflang =
    `<link rel="alternate" hreflang="x-default" href="${DOMAIN}${zhCanonical}" />\n` +
    `<link rel="alternate" hreflang="zh-Hant-TW" href="${DOMAIN}${zhCanonical}" />\n` +
    `<link rel="alternate" hreflang="en" href="${DOMAIN}${enCanonical}" />`;
  s = s.replace(/(<link\s+rel="alternate"\s+hreflang="[^"]*"\s+href="[^"]*"\s*\/?>\s*\n?)+/, hreflang + '\n');
  s = s.replace(/(<script\s+src="\/blog\/blog-shared\.js[^"]*"[^>]*><\/script>)/, EN_LANG_BOOTSTRAP + '\n$1');
  if (s.includes('<a href="#main-content" class="skip-link"')) {
    s = s.replace(/(\n<header\s+class="sticky)/, `\n${EN_BANNER}$1`);
  } else {
    s = s.replace(/(<\/header>)/, `$1\n${EN_BANNER}`);
  }
  if (s.includes('<meta property="og:locale"')) {
    s = s.replace(/<meta property="og:locale" content="[^"]*"\s*\/?>/, '<meta property="og:locale" content="en_US" />');
  } else {
    s = s.replace('</head>', '<meta property="og:locale" content="en_US" />\n<meta property="og:locale:alternate" content="zh_TW" />\n</head>');
  }
  return s;
}

async function listAllSlugs() {
  const file = await ghGetFile('blog/blog-shared.js');
  if (!file) return [];
  const m = file.content.match(/DN\.ARTICLES\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) return [];
  const re = /\{\s*slug\s*:\s*'([^']+)'/g;
  const slugs = [];
  let row;
  while ((row = re.exec(m[1])) !== null) slugs.push(row[1]);
  return slugs;
}

async function regenOne(slug) {
  const zhPath = `blog/${slug}.html`;
  const enPath = `en/blog/${slug}.html`;
  const zhCanon = `/blog/${slug}`;
  const enCanon = `/en/blog/${slug}`;
  const src = await ghGetFile(zhPath);
  if (!src) return { slug, ok: false, error: 'source not found' };
  const out = transform(src.content, zhCanon, enCanon);
  const existing = await ghGetFile(enPath);
  if (existing && existing.content === out) return { slug, ok: true, noop: true };
  const r = await ghPutFile(enPath, out, `admin: regen ${enPath}`, existing ? existing.sha : undefined);
  return { slug, ok: true, commit: r.commitSha };
}

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');  // disable nginx buffering on Vercel

  function send(type, payload) {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  try {
    const slugs = await listAllSlugs();
    send('start', { total: slugs.length });

    let okCount = 0, failCount = 0, noopCount = 0;
    for (let i = 0; i < slugs.length; i++) {
      const slug = slugs[i];
      try {
        const r = await regenOne(slug);
        if (r.ok) {
          okCount++;
          if (r.noop) noopCount++;
        } else { failCount++; }
        send('progress', { done: i + 1, total: slugs.length, current: slug, ok: r.ok, noop: !!r.noop });
      } catch (e) {
        failCount++;
        send('progress', { done: i + 1, total: slugs.length, current: slug, ok: false, error: String(e.message || e) });
      }
    }
    send('complete', { ok: okCount, failed: failCount, noop: noopCount, total: slugs.length });
    res.end();
  } catch (e) {
    send('error', { error: String(e.message || e) });
    res.end();
  }
}
