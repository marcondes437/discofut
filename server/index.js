import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createStaticHandler } from './http/static.js';
import { SocketServer } from './network/SocketServer.js';
import { RoomManager } from './rooms/RoomManager.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Cria o servidor HTTP (arquivos do cliente + API) com WebSocket em /ws.
 * Variáveis de ambiente: PORT, HOST, TRUST_PROXY=1, STATIC_DIR (ex.: dist/public).
 */
export function createGameServer({ port = 8080, host = '0.0.0.0', trustProxy = false, staticDir = '', quiet = false } = {}) {
  const log = quiet ? () => {} : (...a) => console.log(new Date().toISOString(), ...a);
  const mounts = staticDir
    ? [{ prefix: '/', dir: resolve(ROOT, staticDir) }]
    : [{ prefix: '/shared/', dir: join(ROOT, 'shared') }, { prefix: '/', dir: join(ROOT, 'client') }];
  const serveStatic = createStaticHandler(mounts);
  const manager = new RoomManager({ log });

  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    if (url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, rooms: manager.rooms.size }));
      return;
    }
    if (url.startsWith('/api/rooms')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(manager.listRooms()));
      return;
    }
    if (serveStatic(req, res)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Não encontrado');
  });

  const sockets = new SocketServer(server, manager, { trustProxy, log });
  manager.start();

  return new Promise((resolveP, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      resolveP({
        server, manager, sockets,
        port: typeof addr === 'object' && addr ? addr.port : port,
        close: () => new Promise((r) => { manager.stop(); sockets.close(); server.close(() => r()); }),
      });
    });
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const port = Number(process.env.PORT) || 8080;
  const host = process.env.HOST || '0.0.0.0';
  let staticDir = process.env.STATIC_DIR || '';
  if (staticDir && !existsSync(resolve(ROOT, staticDir))) {
    console.warn(`STATIC_DIR "${staticDir}" não existe; servindo client/ e shared/ diretamente.`);
    staticDir = '';
  }
  createGameServer({ port, host, trustProxy: process.env.TRUST_PROXY === '1', staticDir })
    .then(({ port: p }) => {
      console.log(`DiscoFut rodando em http://localhost:${p}  (WebSocket em /ws)`);
    })
    .catch((e) => {
      console.error('Falha ao iniciar o servidor:', e.message);
      process.exit(1);
    });
  const shutdown = () => { console.log('Encerrando…'); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
