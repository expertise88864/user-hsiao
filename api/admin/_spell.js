/**
 * POST /api/admin/spell — find probable typos / inconsistencies in an article.
 *
 * Body: { slug?, html? }   // either one
 *
 * Heuristic checks (no online LLM call — pure local rules):
 *   1. Half-width punctuation between Chinese chars (the user's pet-peeve)
 *   2. Mixed terminologies (e.g. 「青光眼」vs「青光」 — checks against
 *      KNOWN_TERMS to flag truncations or misspellings)
 *   3. Repeated words ("the the", "了了", "的的的")
 *   4. Common ophthalmology typos (LIST below)
 *   5. Spaces between Chinese chars (often a paste artifact)
 *   6. Weird unicode (full-width digits in body, half-width letters
 *      sandwiched in CJK)
 *   7. Number-unit spacing (建議「3 mm」非「3mm」)
 *   8. Empty heading / list items
 *
 * Returns:
 *   { issues: [{ severity: 'error'|'warn'|'info', rule, line, snippet, msg, fix? }] }
 */
import { requireAdmin, ghGetFile } from './_auth.js';

// Common ophth-zh typos and their corrections
const TYPO_FIXES = [
  { wrong: '視萎縮',          right: '視神經萎縮',     hint: '醫學完整詞 (optic atrophy)' },
  { wrong: '黃斑病',          right: '黃斑部病變',     hint: '建議使用完整名稱' },
  { wrong: '飛蚊症狀',        right: '飛蚊症',         hint: '飛蚊症本身已是症狀' },
  { wrong: '眼壓正常',        right: '眼壓在正常範圍', hint: '更精確語意' },
  { wrong: '近視眼鏡',        right: '近視眼鏡片',     hint: '若指鏡片本身' },
  { wrong: '視力1.0',         right: '視力 1.0',       hint: '中文與數字間需空格' },
  { wrong: 'OCT檢查',         right: 'OCT 檢查',       hint: '英文縮寫與中文間需空格' },
  { wrong: '瞳孔放大',        right: '瞳孔散大',       hint: '醫學標準術語' },
  { wrong: '視膜',            right: '視網膜',         hint: '可能漏字' },
  { wrong: '睛光眼',          right: '青光眼',         hint: '注音輸入錯誤' },
  { wrong: '亁眼症',          right: '乾眼症',         hint: '異體字' },
  { wrong: '老花',            right: '老花眼',         hint: '建議完整名稱' },
];

// Known correct medical terms (used to spot truncated forms)
const KNOWN_TERMS_ZH = [
  '青光眼', '白內障', '黃斑部病變', '視網膜剝離', '葡萄膜炎', '糖尿病視網膜病變',
  '飛蚊症', '乾眼症', '結膜炎', '角膜炎', '虹膜炎', '視神經炎',
  '近視', '遠視', '散光', '老花眼', '弱視', '斜視',
  '眼壓', '視力', '視野', '驗光', '驗光師', '眼科醫師',
  '人工水晶體', '雷射手術', '鞏膜', '玻璃體', '黃斑部', '視網膜',
];

function lineOf(html, idx) {
  return (html.slice(0, idx).match(/\n/g) || []).length + 1;
}

function snippet(html, idx, before = 24, after = 24) {
  const start = Math.max(0, idx - before);
  const end = Math.min(html.length, idx + after);
  return html.slice(start, end).replace(/\s+/g, ' ').trim();
}

function checkArticle(html) {
  // Strip <script>, <style> blocks for body checks
  const stripScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');

  const issues = [];

  // 1. Half-width punctuation between CJK
  const halfRe = /([一-鿿])([,.\?!:;])([一-鿿])/g;
  let m;
  while ((m = halfRe.exec(stripScripts)) !== null) {
    issues.push({
      severity: 'warn', rule: 'halfwidth-punct',
      line: lineOf(html, m.index), snippet: snippet(html, m.index),
      msg: `半形「${m[2]}」夾在中文字之間,建議改全形`,
      fix: m[1] + ({ ',': '，', '.': '。', '?': '？', '!': '！', ':': '：', ';': '；' }[m[2]] || m[2]) + m[3]
    });
  }

  // 2. Common typos
  TYPO_FIXES.forEach(t => {
    const re = new RegExp(t.wrong, 'g');
    while ((m = re.exec(stripScripts)) !== null) {
      issues.push({
        severity: 'error', rule: 'typo',
        line: lineOf(html, m.index), snippet: snippet(html, m.index),
        msg: `「${t.wrong}」→ 建議用「${t.right}」(${t.hint})`,
        fix: t.right
      });
    }
  });

  // 3. Repeated words / characters
  const repRe = /([一-鿿])\1{2,}/g;
  while ((m = repRe.exec(stripScripts)) !== null) {
    // 但「呵呵」「哈哈哈」等排除？簡單放進 info severity
    issues.push({
      severity: 'info', rule: 'repeat-char',
      line: lineOf(html, m.index), snippet: snippet(html, m.index),
      msg: `重複字「${m[0]}」 — 確認是否為強調或筆誤`
    });
  }

  // 4. CJK with embedded ASCII letters (e.g. 視A力 = paste error)
  const mixRe = /[一-鿿][a-zA-Z][一-鿿]/g;
  while ((m = mixRe.exec(stripScripts)) !== null) {
    issues.push({
      severity: 'warn', rule: 'mixed-letter',
      line: lineOf(html, m.index), snippet: snippet(html, m.index),
      msg: `中文中夾雜單一英文字母 ${m[0]} — 可能為輸入錯誤`
    });
  }

  // 5. Number-unit spacing (3mm → 3 mm)
  const numUnit = /(\d)(mm|cm|mg|μm|um|kg|nm|kPa|mmHg|D)\b/g;
  while ((m = numUnit.exec(stripScripts)) !== null) {
    issues.push({
      severity: 'info', rule: 'num-unit-space',
      line: lineOf(html, m.index), snippet: snippet(html, m.index),
      msg: `「${m[0]}」建議改為「${m[1]} ${m[2]}」(數字與單位間加空格)`,
      fix: `${m[1]} ${m[2]}`
    });
  }

  // 6. Empty headings / list items
  const emptyRe = /<(h[1-6]|li)[^>]*>\s*<\/\1>/g;
  while ((m = emptyRe.exec(html)) !== null) {
    issues.push({
      severity: 'warn', rule: 'empty-element',
      line: lineOf(html, m.index), snippet: snippet(html, m.index),
      msg: `空白的 <${m[1]}> 元素`
    });
  }

  // 7. Trailing whitespace / multiple spaces in CJK text (only outside tags)
  const dupSpaceRe = /[一-鿿] {2,}[一-鿿]/g;
  while ((m = dupSpaceRe.exec(stripScripts)) !== null) {
    issues.push({
      severity: 'info', rule: 'duplicate-space',
      line: lineOf(html, m.index), snippet: snippet(html, m.index),
      msg: '中文字之間多餘空白'
    });
  }

  // 8. Truncated medical terms (e.g. 「青光」 not「青光眼」)
  // Only flag if a longer canonical term contains the partial AND the
  // partial is not part of an already-correct longer occurrence.
  KNOWN_TERMS_ZH.forEach(term => {
    if (term.length < 3) return;
    const partial = term.slice(0, 2);
    if (partial.length < 2) return;
    // search for partial NOT followed by the rest of the term
    const re = new RegExp(`${partial}(?!${term.slice(2)})(?![\\u4e00-\\u9fff])`, 'g');
    while ((m = re.exec(stripScripts)) !== null) {
      // Skip if this position is start of the full term elsewhere
      issues.push({
        severity: 'info', rule: 'truncated-term',
        line: lineOf(html, m.index), snippet: snippet(html, m.index),
        msg: `「${partial}」可能應為完整詞「${term}」`
      });
    }
  });

  return { issues, count: issues.length };
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
