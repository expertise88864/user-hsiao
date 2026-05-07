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
import { requireAdmin, ghGetFile, ghPutFile } from './_auth.js';

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
      out.push(`<figure><img src="${imgM[2]}" alt="${imgM[1]}" loading="lazy" decoding="async" style="max-width:100%;border-radius:8px" />` +
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
      out.push(block.join('\n'));
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
function escInline(t) {
  return t
    // links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    // italic
    .replace(/(?<![*\w])\*([^*\n]+)\*(?![*\w])/g, '<em>$1</em>')
    .replace(/(?<![_\w])_([^_\n]+)_(?![_\w])/g, '<em>$1</em>')
    // code
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
function slugify(s) {
  return s.toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

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
      res.status(200).json({ slug, markdown: md, sha: file.sha });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
    return;
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { markdown } = body || {};
  if (typeof markdown !== 'string' || markdown.length < 10) {
    return res.status(400).json({ error: 'markdown required (≥10 chars)' });
  }

  try {
    const file = await ghGetFile(`blog/${slug}.html`);
    if (!file) return res.status(404).json({ error: 'not found' });
    const newProse = markdownToHtml(markdown);
    // Replace just the inner of <div id="proseZh">
    const out = file.content.replace(
      /(<div\s+id="proseZh"[^>]*>)[\s\S]*?(<\/div>\s*<\/article>)/i,
      `$1\n\n${newProse}\n\n$2`
    );
    if (out === file.content) return res.status(200).json({ ok: true, noop: true });
    const result = await ghPutFile(`blog/${slug}.html`, out, `admin: edit ${slug} via Markdown mode`, file.sha);
    res.status(200).json({ ok: true, commit: result.commitSha });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
}
