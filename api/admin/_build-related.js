/**
 * POST /api/admin/build-related — pre-compute related-article ranking for
 * every article via TF-IDF cosine similarity, with medical-dictionary terms
 * up-weighted 3× (so "視網膜剝離" dominates similarity over filler words).
 *
 * Output: writes `assets/related.json`:
 *   {
 *     "<slug>": [
 *       { "slug": "<other>", "score": 0.42, "reasons": ["青光眼", "視神經"] },
 *       ...3 entries per source
 *     ],
 *     ...
 *   }
 *
 * Client-side: DN.addRelatedArticles loads this file and uses its order
 * instead of category+random. Fallback to old behaviour if file missing.
 *
 * Why TF-IDF + medical-dict weight:
 *   - Plain TF-IDF over CJK gets confused by common 「的、是、可」 chars
 *     (no whitespace tokenisation). We use bigram tokens instead.
 *   - Medical-dictionary terms (e.g. "視網膜剝離") get 3× boost, so
 *     articles sharing rare clinical terms rank higher than ones sharing
 *     filler bigrams.
 *
 * Cost: O(N²) similarity comparison over articles. With ≤30 articles this
 * is <100ms. Recompute when new articles are added or content materially
 * changes.
 */
import { requireAdmin, ghGetFile, ghPutFile } from './_auth.js';

const RELATED_PATH = 'assets/related.json';
const DICT_PATH = 'assets/medical-dictionary.json';

// Tokenise CJK + Latin: produces overlapping bigrams (CJK) + lowercase
// alpha words (Latin). Strip HTML, scripts, styles first.
function tokenize(html) {
  const text = html
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .toLowerCase();

  const tokens = [];
  // CJK bigrams
  const cjk = text.match(/[一-鿿]{2,}/g) || [];
  cjk.forEach(run => {
    for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2));
  });
  // Latin words
  const latin = text.match(/[a-z][a-z0-9-]{2,}/g) || [];
  latin.forEach(w => tokens.push(w));
  return tokens;
}

function tf(tokens) {
  const map = new Map();
  for (const t of tokens) map.set(t, (map.get(t) || 0) + 1);
  return map;
}

function idfFromCorpus(docTfs) {
  const N = docTfs.length;
  const df = new Map();
  for (const m of docTfs) {
    for (const t of m.keys()) df.set(t, (df.get(t) || 0) + 1);
  }
  const idf = new Map();
  for (const [t, count] of df) idf.set(t, Math.log(N / count) + 1);
  return idf;
}

function tfidf(tfMap, idf, dictBoost) {
  const out = new Map();
  for (const [t, tfVal] of tfMap) {
    const idfVal = idf.get(t) || 1;
    const boost = dictBoost.get(t) || 1;
    out.set(t, tfVal * idfVal * boost);
  }
  return out;
}

function cosineSim(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (const [t, va] of a) {
    magA += va * va;
    const vb = b.get(t);
    if (vb) dot += va * vb;
  }
  for (const vb of b.values()) magB += vb * vb;
  if (!magA || !magB) return 0;
  return dot / Math.sqrt(magA * magB);
}

function topShared(a, b, idf, k) {
  // Find the top-k shared tokens by combined tfidf weight (for "reasons" hint)
  const shared = [];
  for (const [t, va] of a) {
    if (b.has(t)) shared.push({ t, w: va * (b.get(t)) });
  }
  return shared.sort((x, y) => y.w - x.w).slice(0, k).map(x => x.t);
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const t0 = Date.now();
  try {
    // 1. Load article list from blog-shared.js
    const sharedJs = await ghGetFile('blog/blog-shared.js');
    if (!sharedJs) return res.status(500).json({ error: 'blog-shared.js not found' });
    const m = sharedJs.content.match(/DN\.ARTICLES\s*=\s*(\[[\s\S]*?\]);/);
    if (!m) return res.status(500).json({ error: 'DN.ARTICLES not found' });
    const re = /\{\s*slug\s*:\s*'([^']+)'/g;
    const slugs = [];
    let row;
    while ((row = re.exec(m[1])) !== null) slugs.push(row[1]);

    // 2. Filter out stubs (≤300 lines)
    const articleHtmls = await Promise.all(slugs.map(async (slug) => {
      const f = await ghGetFile(`blog/${slug}.html`);
      if (!f) return null;
      const lineCount = (f.content.match(/\n/g) || []).length;
      if (lineCount < 300) return null;  // skip stub files
      return { slug, html: f.content };
    }));
    const real = articleHtmls.filter(Boolean);
    if (real.length < 2) return res.status(200).json({ ok: false, message: 'need ≥2 real articles' });

    // 3. Load medical dictionary for term boosting
    const dictFile = await ghGetFile(DICT_PATH);
    const dict = dictFile ? (() => { try { return JSON.parse(dictFile.content); } catch (e) { return {}; } })() : {};
    const dictBoost = new Map();
    Object.keys(dict).forEach(term => {
      // Add bigrams of dict term for matching CJK bigram tokens
      if (term.length >= 2) {
        for (let i = 0; i < term.length - 1; i++) {
          dictBoost.set(term.slice(i, i + 2), 3);
        }
      }
      // English equivalent (lowercased word)
      if (dict[term].en) {
        dict[term].en.toLowerCase().split(/\s+/).forEach(w => {
          if (w.length >= 3) dictBoost.set(w, 3);
        });
      }
    });

    // 4. Tokenise + TF
    const tfs = real.map(a => tf(tokenize(a.html)));
    const idf = idfFromCorpus(tfs);
    const vecs = tfs.map(tfMap => tfidf(tfMap, idf, dictBoost));

    // 5. Pairwise cosine similarity
    const result = {};
    for (let i = 0; i < real.length; i++) {
      const sims = [];
      for (let j = 0; j < real.length; j++) {
        if (i === j) continue;
        const s = cosineSim(vecs[i], vecs[j]);
        sims.push({ slug: real[j].slug, score: s, reasons: topShared(vecs[i], vecs[j], idf, 3) });
      }
      sims.sort((a, b) => b.score - a.score);
      result[real[i].slug] = sims.slice(0, 3).map(x => ({
        slug: x.slug,
        score: Math.round(x.score * 100) / 100,
        reasons: x.reasons,
      }));
    }

    // 6. Persist to assets/related.json
    const out = JSON.stringify(result, null, 2);
    const existing = await ghGetFile(RELATED_PATH);
    if (existing && existing.content === out) {
      return res.status(200).json({ ok: true, noop: true, articles: real.length });
    }
    const r = await ghPutFile(
      RELATED_PATH, out,
      `admin: rebuild related.json (TF-IDF, ${real.length} articles, ${Date.now() - t0}ms)`,
      existing ? existing.sha : undefined
    );

    res.status(200).json({
      ok: true,
      articles: real.length,
      ms: Date.now() - t0,
      commit: r.commitSha,
      preview: Object.fromEntries(Object.entries(result).slice(0, 3)),
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
