import { createReadStream, statSync } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.md': 'text/plain; charset=utf-8',
};

/**
 * Servidor de arquivos estáticos com proteção contra path traversal.
 * mounts: [{prefix:'/shared/', dir:'/abs/shared'}, {prefix:'/', dir:'/abs/client'}]
 */
export function createStaticHandler(mounts) {
  const roots = mounts.map((m) => ({ prefix: m.prefix, dir: resolve(m.dir) }));
  return function serveStatic(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return false; }
    if (pathname.includes('\0')) return false;
    for (const m of roots) {
      if (!pathname.startsWith(m.prefix)) continue;
      let rel = pathname.slice(m.prefix.length);
      if (rel === '' || rel.endsWith('/')) rel += 'index.html';
      const file = resolve(join(m.dir, rel));
      if (file !== m.dir && !file.startsWith(m.dir + sep)) { res.writeHead(403); res.end(); return true; }
      let st;
      try { st = statSync(file); } catch { continue; }
      if (!st.isFile()) continue;
      const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': st.size,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'same-origin',
      });
      if (req.method === 'HEAD') { res.end(); return true; }
      createReadStream(file).pipe(res);
      return true;
    }
    return false;
  };
}
