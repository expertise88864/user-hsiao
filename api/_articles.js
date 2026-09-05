/** Flat DN.ARTICLES literals. No eval; strings/comments cannot end a record. */
function tokens(source, offset = 0) {
  const re = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|[A-Za-z_$][\w$]*|-?\d+(?:\.\d+)?|[\s\S]/gy;
  const out = [];
  re.lastIndex = offset;
  let m;
  while ((m = re.exec(source))) {
    if (/^(?:\s|\/\/|\/\*)/.test(m[0])) continue;
    out.push({ text: m[0], start: m.index, end: re.lastIndex });
    // The catalog is a flat array; quoted brackets are one string token.
    if (m[0] === ']') break;
  }
  return out;
}

function stringValue(raw) {
  return raw.slice(1, -1).replace(/\\(u\{[0-9a-f]+\}|u[0-9a-f]{4}|x[0-9a-f]{2}|\r?\n|[\s\S])/gi, (_, escape) => {
    if (escape.startsWith('u{')) return String.fromCodePoint(parseInt(escape.slice(2, -1), 16));
    if (/^[ux][0-9a-f]+$/i.test(escape)) return String.fromCharCode(parseInt(escape.slice(1), 16));
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0', '\n': '', '\r\n': '' })[escape] ?? escape;
  });
}

export function catalogRecords(source) {
  const assignment = /\bDN\.ARTICLES\s*=\s*\[/.exec(source);
  if (!assignment) throw new Error('DN.ARTICLES not found');
  const ts = tokens(source, assignment.index + assignment[0].length);
  const records = [];
  const slugs = new Set();
  let i = 0;
  while (ts[i]?.text !== ']') {
    const opening = ts[i++];
    if (opening?.text !== '{') throw new Error('Invalid DN.ARTICLES record');
    const values = Object.create(null), fields = Object.create(null);
    while (ts[i]?.text !== '}') {
      const key = ts[i++];
      if (!key || !/^[A-Za-z_$][\w$]*$/.test(key.text) || ts[i++]?.text !== ':') throw new Error('Invalid catalog field');
      const value = ts[i++];
      if (!value || Object.hasOwn(values, key.text)) throw new Error('Missing or duplicate catalog field');
      if (/^['"]/.test(value.text) && value.text.at(-1) === value.text[0] && value.text.length >= 2) values[key.text] = stringValue(value.text);
      else if (/^-?\d+(?:\.\d+)?$/.test(value.text)) values[key.text] = Number(value.text);
      else throw new Error('Catalog fields must be literal strings or numbers');
      fields[key.text] = value;
      if (ts[i]?.text === ',') i++;
      else if (ts[i]?.text !== '}') throw new Error('Invalid catalog separator');
    }
    const closing = ts[i++];
    if (typeof values.slug !== 'string' || !/^[a-z0-9-]+$/.test(values.slug) || slugs.has(values.slug)) throw new Error('Invalid or duplicate catalog slug');
    slugs.add(values.slug);
    records.push({ start: opening.start, end: closing.end, values, fields });
    if (ts[i]?.text === ',') i++;
    else if (ts[i]?.text !== ']') throw new Error('Invalid catalog record separator');
  }
  return records;
}

export function patchCatalogFields(source, updates) {
  const records = catalogRecords(source), edits = [];
  for (const [slug, fields] of Object.entries(updates)) {
    const row = records.find(r => r.values.slug === slug);
    if (!row) throw new Error(`Catalog entry not found: ${slug}`);
    const added = [];
    for (const [key, value] of Object.entries(fields)) {
      if (!/^[A-Za-z_$][\w$]*$/.test(key) || !(typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))) throw new Error('Invalid catalog update');
      if (row.values[key] === value) continue;
      const literal = typeof value === 'number' ? String(value) : "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r') + "'";
      if (row.fields[key]) edits.push({ ...row.fields[key], replacement: literal });
      else added.push(`${key}:${literal}`);
    }
    if (added.length) {
      // Insert after the last VALUE, before an optional trailing comma/comment.
      const end = Math.max(...Object.values(row.fields).map(f => f.end));
      edits.push({ start: end, end, replacement: ', ' + added.join(', ') });
    }
  }
  let out = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
  const after = catalogRecords(out);
  for (const row of records) {
    const expected = { ...row.values, ...(updates[row.values.slug] || {}) };
    if (JSON.stringify(after.find(r => r.values.slug === row.values.slug)?.values) !== JSON.stringify(expected)) throw new Error('Catalog verification failed');
  }
  return out;
}
