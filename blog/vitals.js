// Use the standard algorithms (session-window CLS, interaction-group INP,
// BFCache and prerender handling). Keep the existing dashboard's CLS x1000 unit.
const { onCLS, onINP, onLCP, onFCP, onTTFB } = require('web-vitals');

function observeVitals(send) {
  const report = metric => send(metric.name, metric.value, metric.id);
  [onCLS, onINP, onLCP, onFCP, onTTFB].forEach(observe => observe(report));
}

module.exports = { observeVitals };
