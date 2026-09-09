// Vocabulary normalization improves discovery; it does not diagnose symptoms.
const terms = [
  ['乾眼', '干眼', '眼睛乾', 'dry eye'],
  ['白內障', '白内障', 'cataract'],
  ['青光眼', 'glaucoma'],
  ['飛蚊', '飞蚊', 'floaters'],
  ['近視', '近视', 'myopia'],
  ['眼軸', '眼轴', 'axial length'],
  ['logmar', 'log mar']
];

function normalize(text) {
  let value = String(text || '').normalize('NFKC').toLowerCase();
  terms.forEach((group, i) => {
    group.forEach(term => { value = value.split(term).join(' term' + i + ' '); });
  });
  return value.replace(/\s+/g, ' ').trim();
}

function rankSearch(index, query) {
  const q = normalize(query);
  if (!q) return index.slice(0, 8);
  const tokens = q.split(' ');
  return index.map((item, position) => {
    const title = normalize(item.title);
    const text = normalize(item.search);
    const relevant = tokens.every(token => text.includes(token) || title.includes(token));
    const score = relevant ? 40 + (title.startsWith(q) ? 120 : title.includes(q) ? 90 : 0) : 0;
    return { item, score, position };
  }).filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .slice(0, 10).map(row => row.item);
}

module.exports = { rankSearch };
