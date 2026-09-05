/**
 * GET  /api/admin/md?slug=<slug>            — extract Markdown from existing article HTML
 * POST /api/admin/md  { slug, markdown }    — save Markdown back as HTML (re-render)
 *
 * Strategy: HsiaoEye articles use a fairly tight HTML subset under <div id="proseZh">
 * (h1/h2/h3, p, ul/ol/li, blockquote, figure/img, table, a, strong, em, code).
 * We can round-trip these to/from Markdown without losing structural fidelity.
 *
 * Limitations: complex inline styles (e.g. <span style="color:red">) are
 * preserved as raw HTML inside Markdown — Markdown allows raw HTML.
 *
 * The renderer is a small custom converter — no `marked` / `markdown-it`
 * dependency to keep Edge bundle slim.
 */
import { requireAdmin, ghGetFile } from './_auth.js';
import { commitArticleWithModifiedDate } from './_article-commit.js';
import { articleBlobSha } from './_save.js';
import { GitHubConflictError } from './_github.js';

export function markdownCanRoundTrip(html) {
  const prose = html.match(/<div\s+id="proseZh"[^>]*>([\s\S]*?)<\/div>\s*<\/article>/i);
  return Boolean(prose && !/\bdata-(?:zh|en)\s*=/i.test(prose[0]));
}

// ── HTML → Markdown ──────────────────────────────────────────────────
function htmlToMarkdown(html) {
  // Extract just the prose section
  const m = html.match(/<div\s+id="proseZh"[^>]*>([\s\S]*?)<\/div>\s*<\/article>/i);
  if (!m) return null;
  let s = m[1];

  // Comments first
  s = s.replace(/<!--[\s\S]*?-->/g, '');

  // Block-level conversions (top-down, easier-to-greedy first)
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, l, t) => '\n' + '#'.repeat(parseInt(l)) + ' ' + inline(t).trim() + '\n\n');
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, t) => '\n> ' + inline(t).trim().replace(/\n/g, '\n> ') + '\n\n');

  // Lists (handle ul/ol)
  s = s.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, body) => {
    const items = [];
    body.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (mm, t) => { items.push('- ' + inline(t).trim()); return ''; });
    return '\n' + items.join('\n') + '\n\n';
  });
  s = s.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, body) => {
    const items = [];
    let n = 1;
    body.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (mm, t) => { items.push((n++) + '. ' + inline(t).trim()); return ''; });
    return '\n' + items.join('\n') + '\n\n';
  });

  // Tables (simple — header from first <tr>)
  s = s.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, body) => {
    const rows = [];
    body.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (mm, rt) => {
      const cells = [];
      rt.replace(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi, (mmm, c) => { cells.push(inline(c).trim().replace(/\|/g, '\\|')); return ''; });
      rows.push(cells);
      return '';
    });
    if (!rows.length) return '';
    let out = '\n| ' + rows[0].join(' | ') + ' |\n';
    out += '|' + rows[0].map(() => '---').join('|') + '|\n';
    rows.slice(1).forEach(r => { out += '| ' + r.join(' | ') + ' |\n'; });
    return out + '\n';
  });

  // Figures (image + caption)
  s = s.replace(/<figure[^>]*>([\s\S]*?)<\/figure>/gi, (_, body) => {
    const imgM = body.match(/<img[^>]+src="([^"]+)"[^>]*?(?:\s+alt="([^"]*)")?[^>]*\/?>/i);
    const capM = body.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
    if (!imgM) return '\n' + body + '\n';
    const alt = imgM[2] || (capM ? inline(capM[1]).trim() : '');
    let out = '\n![' + alt + '](' + imgM[1] + ')';
    if (capM) out += '\n\n*' + inline(capM[1]).trim() + '*';
    return out + '\n\n';
  });

  // Bare images
  s = s.replace(/<img[^>]+src="([^"]+)"[^>]*?(?:\s+alt="([^"]*)")?[^>]*\/?>/gi, (_, src, alt) => `![${alt||''}](${src})`);

  // Paragraphs
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => '\n' + inline(t).trim() + '\n\n');

  // <hr>
  s = s.replace(/<hr\s*\/?>/gi, '\n---\n\n');

  // Final pass: collapse 3+ blank lines, trim
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

function inline(t) {
  return t
    .replace(/<br\s*\/?>/gi, '  \n')
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    // Strip remaining tags but keep their text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// ── Markdown → HTML ──────────────────────────────────────────────────
function markdownToHtml(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Heading
    const hM = line.match(/^(#{1,6})\s+(.+)$/);
    if (hM) {
      const lvl = hM[1].length;
      const id = slugify(hM[2]);
      out.push(`<h${lvl} id="${id}">${escInline(hM[2])}</h${lvl}>`);
      i++; continue;
    }

    // HR
    if (/^---+$/.test(line.trim())) { out.push('<hr>'); i++; continue; }

    // Blockquote (possibly multi-line)
    if (line.startsWith('> ')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      out.push(`<blockquote><p>${quoteLines.map(escInline).join('<br>')}</p></blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[-*]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s/, ''));
        i++;
      }
      out.push('<ul>' + items.map(t => `<li>${escInline(t)}</li>`).join('') + '</ul>');
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ''));
        i++;
      }
      out.push('<ol>' + items.map(t => `<li>${escInline(t)}</li>`).join('') + '</ol>');
      continue;
    }

    // Table (pipe-style)
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1])) {
      const headerRow = parseRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      out.push('<table class="dn"><thead><tr>' +
        headerRow.map(c => `<th>${escInline(c)}</th>`).join('') +
        '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + r.map(c => `<td>${escInline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table>');
      continue;
    }

    // Image (paragraph alone)
    const imgM = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (imgM) {
      out.push(`<figure><img src="${attrEsc(safeUrl(imgM[2], { allowDataImage: true }))}" alt="${attrEsc(imgM[1])}" loading="lazy" decoding="async" style="max-width:100%;border-radius:8px" />` +
        (lines[i + 1] && /^\*[^*]+\*\s*$/.test(lines[i + 1].trim())
          ? `<figcaption>${escInline(lines[i + 1].trim().slice(1, -1))}</figcaption></figure>`
          : '</figure>'));
      i += /^\*[^*]+\*\s*$/.test((lines[i + 1] || '').trim()) ? 2 : 1;
      continue;
    }

    // Blank
    if (line.trim() === '') { i++; continue; }

    // Raw HTML passthrough (line starts with `<` and looks like a tag)
    if (/^\s*<[a-z]/i.test(line)) {
      const block = [line];
      i++;
      while (i < lines.length && lines[i].trim() !== '') { block.push(lines[i]); i++; }
      out.push(sanitizeRawHtml(block.join('\n')));
      continue;
    }

    // Paragraph (collect until blank line)
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}|\d+\.|[-*]|\||---+|>\s|!\[)/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${para.map(escInline).join('<br>')}</p>`);
  }
  return out.join('\n');
}

function parseRow(line) {
  return line.replace(/^\||\|$/g, '').split('|').map(c => c.replace(/\\\|/g, '|').trim());
}
// --- URL / HTML safety helpers ---------------------------------------------
// Markdown here is admin-authored but the rendered HTML is committed and served
// to the public, so neutralize the obvious stored-XSS vectors (javascript: URLs,
// <script>, inline event handlers) before it lands in a blog/<slug>.html file.
function attrEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function safeUrl(url, opts) {
  const u = String(url || '').trim();
  if (/^(?:[/#?]|\.{0,2}\/)/.test(u)) return u;            // relative / anchor / query
  const m = u.match(/^([a-z][a-z0-9+.\-]*)\s*:/i);
  if (!m) return u;                                          // schemeless relative
  const s = m[1].toLowerCase();
  if (s === 'http' || s === 'https' || s === 'mailto' || s === 'tel') return u;
  if (opts && opts.allowDataImage && /^data:image\//i.test(u)) return u;
  return '';                                                 // block javascript:, vbscript:, data:(non-image), …
}
function decodeCodePoint(raw, radix) {
  const codePoint = parseInt(raw, radix);
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : '\ufffd';
}
function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => decodeCodePoint(hex, 16))
    .replace(/&#([0-9]+);?/g, (_, dec) => decodeCodePoint(dec, 10))
    .replace(/&(colon|tab|newline);/gi, (_, name) => ({
      colon: ':',
      tab: '\t',
      newline: '\n',
    })[name.toLowerCase()]);
}
function hasUnsafeHtmlUrl(value) {
  const normalized = decodeHtmlEntities(value)
    .replace(/[\u0000-\u0020\u007f]+/g, '')
    .toLowerCase();
  return /^(?:javascript|vbscript|data:text\/html):/.test(normalized);
}
function neutralizeUnsafeUrlAttributes(html) {
  return html.replace(
    /\b(href|src|action|formaction|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
    (full, name, rawValue) => {
      const quoted = /^(['"])([\s\S]*)\1$/.exec(rawValue);
      const value = quoted ? quoted[2] : rawValue;
      return hasUnsafeHtmlUrl(value) ? `${name}="#"` : full;
    }
  );
}
function sanitizeRawHtml(html) {
  const stripped = String(html)
    // drop <script>…</script> and stray <script> / </script>
    .replace(/<\s*(script|iframe|object|embed|svg|math|style|form)\b[\s\S]*?<\/\s*\1\s*>/gi, '')
    .replace(/<\s*\/?\s*(script|iframe|object|embed|svg|math|style|form)\b[^>]*>/gi, '')
    .replace(/<\s*(?:base|meta|link)\b[^>]*>/gi, '')
    // strip inline event handlers (onclick=, onerror=, …)
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\ssrcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  return neutralizeUnsafeUrlAttributes(stripped);
}

function textEsc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escInline(value) {
  const links = [];
  let t = String(value).replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (m, text, url) {
    const safe = safeUrl(url);
    const html = safe
      ? '<a href="' + attrEsc(safe) + '">' + textEsc(text) + '</a>'
      : textEsc(text);
    const index = links.push(html) - 1;
    return `\u0000LINK${index}\u0000`;
  });

  t = textEsc(t)
    // bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    // italic
    .replace(/(?<![*\w])\*([^*\n]+)\*(?![*\w])/g, '<em>$1</em>')
    .replace(/(?<![_\w])_([^_\n]+)_(?![_\w])/g, '<em>$1</em>')
    // code
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  return t.replace(/\u0000LINK(\d+)\u0000/g, (_, index) => links[Number(index)] || '');
}
function slugify(s) {
  return s.toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export { markdownToHtml, sanitizeRawHtml };

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  const slug = (req.query && req.query.slug) || (req.body && req.body.slug);
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'Invalid slug' });

  if (req.method === 'GET') {
    try {
      const file = await ghGetFile(`blog/${slug}.html`);
      if (!file) return res.status(404).json({ error: 'not found' });
      const md = htmlToMarkdown(file.content);
      if (md == null) return res.status(500).json({ error: 'failed to extract proseZh — article structure unsupported' });
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ slug, markdown: md, sha: file.sha, editable: markdownCanRoundTrip(file.content) });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
    return;
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { markdown, baseSha } = body || {};
  if (typeof baseSha !== 'string' || !/^[a-f0-9]{40}$/.test(baseSha)) {
    return res.status(409).json({ error: '請重新載入文章，取得目前版本後再儲存。' });
  }
  if (typeof markdown !== 'string' || markdown.length < 10) {
    return res.status(400).json({ error: 'markdown required (≥10 chars)' });
  }

  try {
    const file = await ghGetFile(`blog/${slug}.html`);
    if (!file) return res.status(404).json({ error: 'not found' });
    if (baseSha !== file.sha) return res.status(409).json({ error: '文章已有較新版本，請保留草稿並重新比較。' });
    if (!markdownCanRoundTrip(file.content)) {
      return res.status(409).json({ error: '本文含雙語內容，Markdown 轉換會遺失翻譯。請使用視覺編輯器。' });
    }
    const newProse = markdownToHtml(markdown);
    // Replace just the inner of <div id="proseZh">
    const out = file.content.replace(
      /(<div\s+id="proseZh"[^>]*>)[\s\S]*?(<\/div>\s*<\/article>)/i,
      (_, opening, closing) => `${opening}\n\n${newProse}\n\n${closing}`
    );
    if (out === file.content) return res.status(200).json({ ok: true, noop: true, sha: file.sha });
    const result = await commitArticleWithModifiedDate({
      slug,
      content: out,
      articleSha: file.sha,
      message: `admin: edit ${slug} via Markdown mode`,
    });
    res.status(200).json({ ok: true, commit: result.commitSha, sha: articleBlobSha(out) });
  } catch (e) { res.status(e instanceof GitHubConflictError ? 409 : 500).json({ error: String(e.message || e) }); }
}
