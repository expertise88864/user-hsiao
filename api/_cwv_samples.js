// LPUSH returns newest reports first. A metric ID represents one page metric;
// later reports replace earlier values instead of counting a second page load.
export function selectCwvSamples(rows, cutoff) {
  const valid = rows.filter(s => s && Number.isFinite(s.v) && s.v >= 0 &&
    Number.isFinite(s.t) && s.t > cutoff);
  const standard = valid.filter(s => s.version === 'web-vitals-6');
  const seen = new Set();
  return (standard.length ? standard : valid).filter(sample => {
    if (!sample.id) return true;
    if (seen.has(sample.id)) return false;
    seen.add(sample.id);
    return true;
  });
}

// A percentile requires the distribution, not an average times a coefficient.
// Nearest rank: rank ceil(0.75 * N), expressed as a zero-based array index.
export function summarizeCwvSamples(metric, rows, cutoff) {
  const samples = selectCwvSamples(rows, cutoff);
  if (!samples.length) return null;
  const values = samples.map(s => s.v).sort((a, b) => a - b);
  const divisor = metric === 'CLS' ? 1000 : 1;
  return {
    name: metric,
    samples: values.length,
    avg: values.reduce((sum, value) => sum + value, 0) / values.length / divisor,
    p75: values[Math.ceil(values.length * 0.75) - 1] / divisor,
    source: 'kv',
    status: 'measured',
    method: samples[0].version === 'web-vitals-6' ? 'web-vitals-6' : 'legacy',
    percentileMethod: 'nearest-rank',
    oldestSampleAt: Math.min(...samples.map(s => s.t)),
    newestSampleAt: Math.max(...samples.map(s => s.t)),
  };
}
