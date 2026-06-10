/**
 * GET /api/admin/dictionary  → returns the medical-term dictionary (zh→en+definition+anchor).
 * POST /api/admin/dictionary?action=autolink — given an article slug, scan its
 *      body and auto-wrap first occurrence of every dictionary term with a
 *      tooltip / glossary link, then commit.
 *
 * The dictionary lives in /assets/medical-dictionary.json (canonical JSON
 * file in the repo). On first run it is created with seed data.
 *
 * The auto-link transform:
 *   - Looks up each <p>, <li>, <td> body (skips headings / scripts / a / img)
 *   - For each canonical term, wraps the FIRST occurrence in
 *       <span class="hs-dict" data-term="<key>" title="<def>"><term></span>
 *   - Subsequent occurrences are left alone (avoid noise)
 *   - Idempotent: if the term is already inside .hs-dict it skips
 */
import { requireAdmin, ghGetFile, ghPutFile } from './_auth.js';
import { commitArticleWithModifiedDate } from './_article-commit.js';

const DICT_PATH = 'assets/medical-dictionary.json';

const SEED_DICT = {
  '青光眼': { en: 'glaucoma', def: '視神經因眼壓或血流異常受損,造成視野缺損的疾病。', anchor: 'glaucoma-warnings' },
  '白內障': { en: 'cataract', def: '水晶體混濁造成視力模糊,常見於老化、外傷或長期紫外線暴露。', anchor: 'cataract-surgery-faq' },
  '黃斑部病變': { en: 'macular degeneration', def: '視網膜中央黃斑部退化,影響中央視力與閱讀能力。', anchor: '' },
  '視網膜剝離': { en: 'retinal detachment', def: '視網膜與脈絡膜分離,屬眼科急症,需即刻手術。', anchor: 'floaters-retinal-detachment' },
  '飛蚊症': { en: 'floaters', def: '玻璃體混濁產生的浮游影像,多數為良性老化現象。', anchor: 'floaters-retinal-detachment' },
  '乾眼症': { en: 'dry eye disease', def: '淚液分泌不足或品質異常,造成眼睛乾澀、不適。', anchor: 'dry-eye-myths' },
  '結膜炎': { en: 'conjunctivitis', def: '結膜發炎,可由病毒、細菌或過敏引起。', anchor: 'red-eye-conjunctivitis' },
  '近視': { en: 'myopia', def: '眼球過長造成遠處影像聚焦於視網膜前方。', anchor: 'pediatric-myopia-control' },
  '散光': { en: 'astigmatism', def: '角膜或水晶體弧度不對稱造成的屈光異常。', anchor: '' },
  '老花眼': { en: 'presbyopia', def: '隨年齡水晶體調節力下降,看近處模糊。', anchor: '' },
  '視神經炎': { en: 'optic neuritis', def: '視神經發炎,常與多發性硬化症相關。', anchor: '' },
  '葡萄膜炎': { en: 'uveitis', def: '葡萄膜（虹膜、睫狀體、脈絡膜）發炎,可致視力威脅。', anchor: '' },
  '糖尿病視網膜病變': { en: 'diabetic retinopathy', def: '糖尿病引起的視網膜微血管病變,長期高血糖的視力併發症。', anchor: '' },
  '玻璃體': { en: 'vitreous body', def: '填充於眼球後段的透明膠狀物質。', anchor: '' },
  '黃斑部': { en: 'macula', def: '視網膜中央視力最敏銳的區域,負責中央視野與色彩辨識。', anchor: '' },
  '眼壓': { en: 'intraocular pressure (IOP)', def: '眼內房水所形成的壓力,正常 10–21 mmHg。', anchor: '' },
  '人工水晶體': { en: 'intraocular lens (IOL)', def: '白內障手術置入的人工鏡片,取代混濁的天然水晶體。', anchor: 'cataract-surgery-faq' },
  '淚膜': { en: 'tear film', def: '覆蓋於角膜表面的三層淚液結構（油脂、水液、黏液）。', anchor: 'dry-eye-myths' },
  '視野': { en: 'visual field', def: '眼睛固視時所能看到的全部範圍,青光眼診斷的關鍵指標。', anchor: '' },
  '視網膜': { en: 'retina', def: '眼球內側的感光神經組織,負責將光訊號轉成神經訊號。', anchor: '' },
};

async function ensureDict() {
  const existing = await ghGetFile(DICT_PATH);
  if (existing) return existing;
  const seed = JSON.stringify(SEED_DICT, null, 2);
  await ghPutFile(DICT_PATH, seed, `admin: seed medical dictionary`);
  return await ghGetFile(DICT_PATH);
}

function autolinkOnce(html, dict) {
  // Build sorted term list (longest first so 「黃斑部病變」 beats 「黃斑部」)
  const terms = Object.keys(dict).sort((a, b) => b.length - a.length);

  // Only operate on body (after </head>); also skip <a>, <script>, <style>, headings (h1-h6), .hs-dict
  const headEnd = html.indexOf('</head>');
  if (headEnd === -1) return html;
  const head = html.slice(0, headEnd);
  let body = html.slice(headEnd);

  // Track which terms already linked
  const seen = new Set();

  // Tokenize: walk body, splitting at protected blocks. Then in unprotected
  // text-runs, do per-term first-occurrence replacement.
  const PROTECT_RE = /<(a|script|style|h[1-6]|figcaption|svg|code|pre)[\s\S]*?<\/\1>|<[^>]+>|&[a-zA-Z]+;|<!--[\s\S]*?-->/g;

  // First pass: collect already-linked terms
  const dictBlockRe = /<span\s+class="hs-dict"[^>]*data-term="([^"]+)"/g;
  let m;
  while ((m = dictBlockRe.exec(body)) !== null) seen.add(m[1]);

  // Walk body, splitting into protected/unprotected segments
  const segments = [];
  let lastIdx = 0;
  let pm;
  while ((pm = PROTECT_RE.exec(body)) !== null) {
    if (pm.index > lastIdx) segments.push({ text: body.slice(lastIdx, pm.index), protected: false });
    segments.push({ text: pm[0], protected: true });
    lastIdx = pm.index + pm[0].length;
  }
  if (lastIdx < body.length) segments.push({ text: body.slice(lastIdx), protected: false });

  // For each term, wrap its first occurrence in any unprotected segment
  terms.forEach(term => {
    if (seen.has(term)) return;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.protected) continue;
      const idx = seg.text.indexOf(term);
      if (idx === -1) continue;
      const entry = dict[term];
      const tooltipDef = (entry.def || '').replace(/"/g, '&quot;');
      const enLabel = (entry.en || '').replace(/"/g, '&quot;');
      const anchor = entry.anchor;
      const inner = anchor
        ? `<a href="/blog/${anchor}" class="hs-dict-link" data-term="${term}" title="${tooltipDef}">${term}</a>`
        : `<span class="hs-dict" data-term="${term}" data-en="${enLabel}" title="${tooltipDef}">${term}</span>`;
      seg.text = seg.text.slice(0, idx) + inner + seg.text.slice(idx + term.length);
      seen.add(term);
      break;
    }
  });

  body = segments.map(s => s.text).join('');
  return head + body;
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;

  if (req.method === 'GET') {
    try {
      const file = await ensureDict();
      let dict = {};
      try { dict = JSON.parse(file.content); } catch (e) { dict = SEED_DICT; }
      return res.status(200).json({ dict, count: Object.keys(dict).length });
    } catch (e) {
      return res.status(500).json({ error: String(e.message || e) });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // POST with action=update → save edited dictionary
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const action = (req.query && req.query.action) || (body && body.action);

  try {
    if (action === 'update') {
      const { dict } = body || {};
      if (!dict || typeof dict !== 'object') return res.status(400).json({ error: 'dict object required' });
      const file = await ensureDict();
      const out = JSON.stringify(dict, null, 2);
      if (file.content === out) return res.status(200).json({ ok: true, noop: true });
      const r = await ghPutFile(DICT_PATH, out, `admin: update medical dictionary`, file.sha);
      return res.status(200).json({ ok: true, commit: r.commitSha, count: Object.keys(dict).length });
    }

    if (action === 'autolink') {
      const { slug } = body || {};
      if (!slug || !/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'slug required' });
      const dictFile = await ensureDict();
      const dict = JSON.parse(dictFile.content);
      const articleFile = await ghGetFile(`blog/${slug}.html`);
      if (!articleFile) return res.status(404).json({ error: `Article ${slug} not found` });
      const out = autolinkOnce(articleFile.content, dict);
      if (out === articleFile.content) return res.status(200).json({ ok: true, noop: true, slug });
      const r = await commitArticleWithModifiedDate({
        slug,
        content: out,
        articleSha: articleFile.sha,
        message: `admin: autolink medical terms in ${slug}`,
      });
      return res.status(200).json({ ok: true, commit: r.commitSha, slug });
    }

    return res.status(400).json({ error: 'action must be update or autolink' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
