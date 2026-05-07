/**
 * POST /api/admin/seo-fix — auto-fix common SEO issues in an article.
 *
 * Body: { slug: string, fixes?: string[] }
 *   fixes: which subset to apply. If omitted, applies all.
 *
 * Auto-fixable issues:
 *   - canonical          — add <link rel="canonical">
 *   - hreflang           — add x-default + zh-Hant-TW + en alternate triplet
 *   - og-image           — add og:image pointing to /assets/og/<slug>.png
 *   - og-type-article    — add og:type=article
 *   - twitter-card       — add twitter:card=summary_large_image + image
 *   - theme-color        — add <meta name=theme-color content=#3a5a7c>
 *   - meta-keywords      — derive from existing tags / title (light heuristic)
 *   - jsonld             — add minimal MedicalScholarlyArticle JSON-LD if absent
 *   - meta-description   — derive from first <p> / .tldr if missing
 *
 * Returns: { ok, applied: [...], skipped: [...], commit }
 */
import { requireAdmin, ghGetFile, ghPutFile } from './_auth.js';

const DOMAIN = 'https://hsiao.chendermatologist.com';

// Each fixer takes (html, slug, meta) and returns { changed, html, note? }
function fixCanonical(html, slug) {
  if (/<link\s+rel="canonical"/i.test(html)) return { changed: false };
  const tag = `<link rel="canonical" href="${DOMAIN}/blog/${slug}" />`;
  return { changed: true, html: html.replace('</head>', tag + '\n</head>'), note: 'canonical' };
}

function fixHreflang(html, slug) {
  const has = (html.match(/rel="alternate"\s+hreflang/g) || []).length;
  if (has >= 3) return { changed: false };
  const block =
    `<link rel="alternate" hreflang="x-default" href="${DOMAIN}/blog/${slug}" />\n` +
    `<link rel="alternate" hreflang="zh-Hant-TW" href="${DOMAIN}/blog/${slug}" />\n` +
    `<link rel="alternate" hreflang="en" href="${DOMAIN}/en/blog/${slug}" />`;
  // Insert after existing canonical, or before </head>
  if (/<link\s+rel="canonical"[^>]+>/i.test(html)) {
    return { changed: true, html: html.replace(/(<link\s+rel="canonical"[^>]+>)/i, '$1\n' + block), note: 'hreflang' };
  }
  return { changed: true, html: html.replace('</head>', block + '\n</head>'), note: 'hreflang' };
}

function fixOgImage(html, slug) {
  if (/<meta\s+property="og:image"/i.test(html)) return { changed: false };
  const tag = `<meta property="og:image" content="${DOMAIN}/assets/og/${slug}.png" />\n` +
              `<meta property="og:image:width" content="1200" />\n` +
              `<meta property="og:image:height" content="630" />`;
  return { changed: true, html: html.replace('</head>', tag + '\n</head>'), note: 'og:image' };
}

function fixOgType(html) {
  if (/<meta\s+property="og:type"/i.test(html)) return { changed: false };
  return { changed: true, html: html.replace('</head>', '<meta property="og:type" content="article" />\n</head>'), note: 'og:type' };
}

function fixTwitterCard(html, slug) {
  if (/<meta\s+name="twitter:card"/i.test(html)) return { changed: false };
  const tags = `<meta name="twitter:card" content="summary_large_image" />\n` +
               `<meta name="twitter:image" content="${DOMAIN}/assets/og/${slug}.png" />\n` +
               `<meta name="twitter:site" content="@hsiao_eye" />`;
  return { changed: true, html: html.replace('</head>', tags + '\n</head>'), note: 'twitter:card' };
}

function fixThemeColor(html) {
  if (/<meta\s+name="theme-color"/i.test(html)) return { changed: false };
  const tag = `<meta name="theme-color" content="#3a5a7c" />\n` +
              `<meta name="theme-color" content="#0f172a" media="(prefers-color-scheme: dark)" />`;
  return { changed: true, html: html.replace('</head>', tag + '\n</head>'), note: 'theme-color' };
}

function fixMetaDescription(html) {
  if (/<meta\s+name="description"/i.test(html)) return { changed: false };
  // Derive from <p class="tldr"> or first <p>
  let desc = '';
  const tldr = html.match(/<p[^>]*class="[^"]*\btldr\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
  if (tldr) desc = tldr[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!desc) {
    const first = html.match(/<article[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
    if (first) desc = first[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  if (!desc) return { changed: false };
  desc = desc.slice(0, 155);
  const safe = desc.replace(/"/g, '&quot;');
  const tag = `<meta name="description" content="${safe}" />`;
  return { changed: true, html: html.replace('</head>', tag + '\n</head>'), note: 'description' };
}

function fixJsonLd(html, slug) {
  if (/application\/ld\+json/i.test(html) && /MedicalScholarlyArticle|"Article"|MedicalCondition/i.test(html)) return { changed: false };
  // Extract title from <title>
  const titleM = html.match(/<title>([^|<]+)/);
  const title = titleM ? titleM[1].trim() : slug.replace(/-/g, ' ');
  const today = new Date().toISOString().slice(0, 10);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'MedicalScholarlyArticle',
    headline: title,
    inLanguage: 'zh-Hant-TW',
    datePublished: today,
    dateModified: today,
    author: { '@type': 'Person', name: '蕭閔謙 醫師' },
    publisher: { '@type': 'Person', name: '蕭閔謙 醫師', url: DOMAIN + '/' },
    image: `${DOMAIN}/assets/og/${slug}.png`,
    mainEntityOfPage: `${DOMAIN}/blog/${slug}`,
  };
  const tag = `<script type="application/ld+json">\n${JSON.stringify(jsonLd)}\n</script>`;
  return { changed: true, html: html.replace('</head>', tag + '\n</head>'), note: 'jsonld' };
}

const FIXERS = {
  canonical:        fixCanonical,
  hreflang:         fixHreflang,
  'og-image':       fixOgImage,
  'og-type':        fixOgType,
  'twitter-card':   fixTwitterCard,
  'theme-color':    fixThemeColor,
  description:      fixMetaDescription,
  jsonld:           fixJsonLd,
};

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { slug, fixes } = body || {};
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'Invalid slug' });
  const wanted = (Array.isArray(fixes) && fixes.length) ? fixes : Object.keys(FIXERS);

  try {
    const file = await ghGetFile(`blog/${slug}.html`);
    if (!file) return res.status(404).json({ error: `Article ${slug} not found` });

    let html = file.content;
    const applied = [];
    const skipped = [];
    for (const name of wanted) {
      const fn = FIXERS[name];
      if (!fn) { skipped.push({ name, reason: 'unknown fixer' }); continue; }
      try {
        const r = fn(html, slug);
        if (r.changed) { html = r.html; applied.push(name); }
        else skipped.push({ name, reason: 'already present' });
      } catch (e) {
        skipped.push({ name, reason: 'error: ' + (e.message || e) });
      }
    }

    if (!applied.length) {
      return res.status(200).json({ ok: true, applied, skipped, noop: true });
    }
    if (html === file.content) {
      return res.status(200).json({ ok: true, applied, skipped, noop: true });
    }
    const result = await ghPutFile(
      `blog/${slug}.html`, html,
      `admin: SEO auto-fix ${slug} (${applied.join(', ')})`,
      file.sha
    );
    res.status(200).json({ ok: true, applied, skipped, commit: result.commitSha });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
