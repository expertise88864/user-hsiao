// LPUSH returns newest reports first. A metric ID represents one page metric;
// later reports replace earlier values instead of counting a second page load.
export function selectCwvSamples(rows, cutoff) {
  const valid = rows.filter(s => s && Number.isFinite(s.v) && s.v >= 0 && s.t > cutoff);
  const standard = valid.filter(s => s.version === 'web-vitals-6');
  const seen = new Set();
  return (standard.length ? standard : valid).filter(sample => {
    if (!sample.id) return true;
    if (seen.has(sample.id)) return false;
    seen.add(sample.id);
    return true;
  });
}
