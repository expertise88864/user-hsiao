/**
 * POST /api/admin/seo-score — compute an editorial / SEO heuristic score for
 * an article. Returns a 0–100 score plus a list of warnings the editor can act on.
 *
 * Body: { slug: string }   // analyzes the live article in repo
 *
 * Heuristics (each checks contributes to score):
 *   - title length (Chinese 12–28 chars, English 40–65 chars)
 *   - meta description length (70–160)
 *   - body word count (≥800 zh chars)
 *   - has at least one h2
 *   - has at least one image
 *   - has internal links (≥2)
 *   - has external citation links (≥1)
 *   - has structured data (JSON-LD MedicalScholarlyArticle or Article)
 *   - canonical present
 *   - hreflang block present
 *   - og:image present
 *   - half-width punctuation (Chinese text) — penalise count
 *   - has tldr / introduction paragraph
 */
import { requireAdmin, ghGetFile } from './_auth.js';

function checkArticle(html) {
  const checks = [];
  const add = (key, ok, weight, msg, hint) => checks.push({ key, ok, weight, msg, hint });

  // Title (12-28 zh chars excluding suffix)
  const titleM = html.match(/<title>([^<]+)<\/title>/);
  const title = titleM ? titleM[1] : '';
  const titleZh = title.split('|')[0].trim();
  const titleLen = Array.from(titleZh).length;
  add('title-length', titleLen >= 12 && titleLen <= 32, 8,
      `Title length (zh): ${titleLen} chars`,
      titleLen < 12 ? '建議至少 12 字' : titleLen > 32 ? '建議不超過 32 字' : '');

  // Meta description
  const descM = html.match(/<meta\s+name="description"\s+content="([^"]+)"/);
  const desc = descM ? descM[1] : '';
  const descLen = Array.from(desc).length;
  add('meta-description', descLen >= 50 && descLen <= 200, 8,
      `Meta description: ${descLen} chars`,
      !desc ? '缺少 meta description' : descLen < 50 ? '建議 50 字以上' : descLen > 200 ? '建議不超過 200 字' : '');

  // Word count (chars in <article>)
  const articleM = html.match(/<article[\s\S]*?<\/article>/);
  const articleHtml = articleM ? articleM[0] : html;
  const articleText = articleHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = Array.from(articleText).length;
  add('word-count', wordCount >= 800, 10,
      `Body length: ${wordCount} chars`,
      wordCount < 800 ? '建議內文至少 800 字' : '');

  // h2 count
  const h2Count = (articleHtml.match(/<h2[\s>]/g) || []).length;
  add('h2-count', h2Count >= 2, 6,
      `H2 sections: ${h2Count}`,
      h2Count < 2 ? '建議至少 2 個 H2 段落以利目錄' : '');

  // Image count
  const imgCount = (articleHtml.match(/<img[\s>]/g) || []).length + (articleHtml.match(/<svg[\s>]/g) || []).length;
  add('image-count', imgCount >= 1, 5,
      `Images / SVG figures: ${imgCount}`,
      imgCount < 1 ? '建議加入至少一張圖片或醫學插圖' : '');

  // Internal links
  const internalLinks = (articleHtml.match(/href="\/(blog|tools|notes|en|about)/g) || []).length;
  add('internal-links', internalLinks >= 1, 5,
      `Internal links: ${internalLinks}`,
      internalLinks < 1 ? '建議加入站內連結（其他文章 / 工具）' : '');

  // External citation links
  const externalLinks = (articleHtml.match(/href="https?:\/\/(?!hsiao\.chendermatologist\.com)/g) || []).length;
  add('external-citations', externalLinks >= 1, 6,
      `External citations: ${externalLinks}`,
      externalLinks < 1 ? '建議引用至少一份外部文獻或權威來源' : '');

  // JSON-LD structured data
  const hasJsonLd = /application\/ld\+json/i.test(html) && /MedicalScholarlyArticle|"Article"|MedicalCondition/i.test(html);
  add('structured-data', hasJsonLd, 8, `JSON-LD structured data: ${hasJsonLd ? 'yes' : 'no'}`,
      hasJsonLd ? '' : '缺少 schema.org Article 結構化資料');

  // canonical
  const hasCanonical = /<link\s+rel="canonical"/i.test(html);
  add('canonical', hasCanonical, 5, `Canonical: ${hasCanonical ? 'yes' : 'no'}`,
      hasCanonical ? '' : '缺少 canonical link');

  // hreflang
  const hreflangCount = (html.match(/rel="alternate"\s+hreflang/g) || []).length;
  add('hreflang', hreflangCount >= 2, 5, `Hreflang tags: ${hreflangCount}`,
      hreflangCount < 2 ? '建議至少有 zh / en hreflang' : '');

  // og:image
  const hasOgImage = /<meta\s+property="og:image"/i.test(html);
  add('og-image', hasOgImage, 5, `OG image: ${hasOgImage ? 'yes' : 'no'}`,
      hasOgImage ? '' : '缺少 og:image (社群分享預覽)');

  // Half-width punctuation count in Chinese context
  const halfwidthMatches = articleText.match(/[一-鿿][,.\?!:;][一-鿿]/g) || [];
  add('halfwidth-punct', halfwidthMatches.length === 0, 4,
      `Half-width punctuation in zh text: ${halfwidthMatches.length}`,
      halfwidthMatches.length > 0 ? `${halfwidthMatches.length} 處半形標點需轉全形` : '');

  // tldr / lead paragraph
  const hasTldr = /class="[^"]*\btldr\b/i.test(articleHtml) || /id="?tldr/i.test(articleHtml);
  add('tldr', hasTldr, 4, `TL;DR / lead: ${hasTldr ? 'yes' : 'no'}`,
      hasTldr ? '' : '建議加入精簡引言段（class="tldr"）');

  // meta keywords (legacy but still useful)
  const hasKeywords = /<meta\s+name="keywords"/i.test(html);
  add('meta-keywords', hasKeywords, 3, `Meta keywords: ${hasKeywords ? 'yes' : 'no'}`, '');

  // og:type article
  const hasOgType = /<meta\s+property="og:type"\s+content="article"/i.test(html);
  add('og-type-article', hasOgType, 3, `og:type article: ${hasOgType ? 'yes' : 'no'}`, '');

  // theme-color
  const hasThemeColor = /<meta\s+name="theme-color"/i.test(html);
  add('theme-color', hasThemeColor, 2, `theme-color: ${hasThemeColor ? 'yes' : 'no'}`, '');

  // Compute weighted score
  let total = 0, gotten = 0;
  checks.forEach(c => {
    total += c.weight;
    if (c.ok) gotten += c.weight;
  });
  const score = total > 0 ? Math.round((gotten / total) * 100) : 0;

  return {
    score,
    grade: score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F',
    checks,
    summary: { passed: checks.filter(c => c.ok).length, total: checks.length, halfwidth: halfwidthMatches.length, words: wordCount }
  };
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { slug, html: bodyHtml } = body || {};

  try {
    let html = bodyHtml;
    if (!html) {
      if (!slug || !/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'slug or html required' });
      const file = await ghGetFile(`blog/${slug}.html`);
      if (!file) return res.status(404).json({ error: `Article ${slug} not found` });
      html = file.content;
    }
    const result = checkArticle(html);
    res.status(200).json({ slug, ...result });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
