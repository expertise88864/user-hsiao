// Prints how many requests the scored Lighthouse runs sent to the deployment,
// from the network-requests audit of each saved LHR (.lighthouseci/lhr-*.json).
// Diagnostic only: it never changes, re-scores or fails a Lighthouse result.
const fs = require('node:fs');
const path = require('node:path');

if (!process.env.SITE_URL) { console.log('[vercel-requests] lighthouse scored runs: no deployment resolved'); process.exit(0); }
const origin = new URL(process.env.SITE_URL).origin;
const dir = path.resolve('.lighthouseci');
let runs = 0, total = 0;
for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
  if (!/^lhr-\d+\.json$/.test(name)) continue;
  const lhr = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const items = lhr.audits?.['network-requests']?.details?.items || [];
  runs++;
  total += items.filter(item => { try { return new URL(item.url).origin === origin; } catch { return false; } }).length;
}
console.log('[vercel-requests] lighthouse scored runs: ' + total + ' (' + runs + ' runs)');
