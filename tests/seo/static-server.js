const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const PORT = Number(process.env.PORT || 4173);

const TYPES = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8',
};

function resolveRequest(url) {
  const parsed = new URL(url, `http://127.0.0.1:${PORT}`);
  let pathname = decodeURIComponent(parsed.pathname);
  if (pathname.includes('\0')) return null;
  if (pathname === '/') pathname = '/index.html';

  const candidates = [];
  if (path.extname(pathname)) {
    candidates.push(pathname);
  } else {
    candidates.push(`${pathname}.html`);
    candidates.push(path.join(pathname, 'index.html'));
  }

  for (const candidate of candidates) {
    const abs = path.resolve(ROOT, candidate.replace(/^[/\\]+/, ''));
    if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) continue;
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  return null;
}

http.createServer((req, res) => {
  const file = resolveRequest(req.url || '/');
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`SEO static server listening on http://127.0.0.1:${PORT}`);
});
