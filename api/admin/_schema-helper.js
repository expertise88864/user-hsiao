/**
 * POST /api/admin/schema-helper — auto-extract Q&A pairs from an article
 * and inject a schema.org FAQPage JSON-LD block. Optionally HowTo / Article
 * fallback if the article has no FAQ structure.
 *
 * Body: { slug, type? }
 *   type: 'faqpage' (default) | 'howto' | 'medicalwebpage'
 *
 * FAQPage detection heuristic:
 *   - <details> + <summary> blocks (most articles use these)
 *   - h2/h3 ending with `?` followed by a paragraph
 *   - .myth-card .myth + .truth pairs
 *
 * Why this matters: FAQPage rich snippets show up in Google as expanded
 * Q&A boxes that take significant SERP real estate. HsiaoEye's myth-busting
 * format is a perfect fit.
 *
 * Returns { ok, type, qaCount, applied, commit }.
 */
import { requireAdmin, ghGetFile } from './_auth.js';
import { commitArticleWithModifiedDate } from './_article-commit.js';

function stripTags(s) {
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractFaqPairs(html) {
  const pairs = [];

  // Pattern 1: <details><summary>Q</summary><p>A</p>...</details>
  const detRe = /<details[^>]*>([\s\S]*?)<\/details>/gi;
  let m;
  while ((m = detRe.exec(html)) !== null) {
    const block = m[1];
    const sM = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
    if (!sM) continue;
    const q = stripTags(sM[1]);
    const aHtml = block.replace(/<summary[^>]*>[\s\S]*?<\/summary>/i, '');
    const a = stripTags(aHtml);
    if (q && a && q.length < 200 && a.length > 20) pairs.push({ q, a });
  }

  // Pattern 2: <div class="myth-card"> with .myth (Q) + .truth (A)
  const mythRe = /<div[^>]*class="[^"]*\bmyth-card\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*\bmyth-card\b|<h[12]|<\/section)/gi;
  while ((m = mythRe.exec(html)) !== null) {
    const block = m[1];
    const mM = block.match(/class="[^"]*\bmyth\b[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p|span)>/i);
    const tM = block.match(/class="[^"]*\btruth\b[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p|span)>/i);
    if (mM && tM) {
      const q = stripTags(mM[1]);
      const a = stripTags(tM[1]);
      if (q && a) pairs.push({ q, a });
    }
  }

  // Pattern 3: <h2>...?</h2> followed by <p>...</p>
  const h2qRe = /<h2[^>]*>([^<]*[？?])<\/h2>\s*(?:<p[^>]*>([\s\S]*?)<\/p>)/gi;
  while ((m = h2qRe.exec(html)) !== null) {
    const q = stripTags(m[1]);
    const a = stripTags(m[2]);
    if (q && a) pairs.push({ q, a });
  }

  // Dedup by question text (first wins)
  const seen = new Set();
  return pairs.filter(p => { if (seen.has(p.q)) return false; seen.add(p.q); return true; });
}

function buildFaqPage(pairs, articleUrl, articleTitle) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    name: articleTitle,
    url: articleUrl,
    mainEntity: pairs.map(p => ({
      '@type': 'Question',
      name: p.q,
      acceptedAnswer: { '@type': 'Answer', text: p.a.slice(0, 1000) },
    })),
  };
}

function buildHowTo(pairs, articleUrl, articleTitle) {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: articleTitle,
    url: articleUrl,
    step: pairs.map((p, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: p.q,
      text: p.a.slice(0, 1000),
    })),
  };
}

function injectJsonLd(html, jsonLd) {
  const tag = `<script type="application/ld+json">\n${JSON.stringify(jsonLd, null, 0)}\n</script>`;

  // Remove any pre-existing FAQPage / HowTo block to avoid duplicates.
  // CRITICAL: match ONE block at a time (lazy up to the first </script>) and
  // decide per-block. The previous single mega-regex used `\{[^]*?…\}` which
  // matched ACROSS </script> boundaries: on a normal article whose FAQPage is
  // preceded by MedicalScholarlyArticle / MedicalWebPage / BreadcrumbList
  // blocks, `[^]*?` spanned from the FIRST ld+json block to the FAQPage and
  // deleted every schema block in between (verified: 4 of 5 blocks removed on
  // dry-eye-myths). Per-block matching removes ONLY the FAQPage/HowTo block.
  const stripped = html.replace(
    /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi,
    (full, inner) => (/"@type"\s*:\s*"(FAQPage|HowTo)"/.test(inner) ? '' : full)
  );

  // Insert before </head>
  return stripped.replace('</head>', tag + '\n</head>');
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { slug, type = 'faqpage' } = body || {};
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'Invalid slug' });
  if (!['faqpage', 'howto'].includes(type)) return res.status(400).json({ error: 'type must be faqpage or howto' });

  try {
    const file = await ghGetFile(`blog/${slug}.html`);
    if (!file) return res.status(404).json({ error: 'not found' });
    const pairs = extractFaqPairs(file.content);
    if (pairs.length < 2) {
      return res.status(200).json({ ok: false, qaCount: pairs.length, message: '需要至少 2 個 Q&A 才能生成結構化資料。試著用 <details><summary> 或 myth-card 包裝你的問答。' });
    }
    const titleM = file.content.match(/<title>([^|<]+)/);
    const title = titleM ? titleM[1].trim() : slug;
    const articleUrl = `https://hsiao.chendermatologist.com/blog/${slug}`;
    const jsonLd = type === 'howto'
      ? buildHowTo(pairs, articleUrl, title)
      : buildFaqPage(pairs, articleUrl, title);
    const out = injectJsonLd(file.content, jsonLd);
    if (out === file.content) return res.status(200).json({ ok: true, noop: true, qaCount: pairs.length });
    const result = await commitArticleWithModifiedDate({
      slug,
      content: out,
      articleSha: file.sha,
      message: `admin: inject ${type} schema (${pairs.length} Q&A) for ${slug}`,
    });
    res.status(200).json({ ok: true, type, qaCount: pairs.length, commit: result.commitSha, applied: pairs.slice(0, 3).map(p => p.q) });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
}
