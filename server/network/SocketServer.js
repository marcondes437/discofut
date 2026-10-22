import { WebSocketServer } from 'ws';
import { LIMITS } from '../../shared/protocol/messages.js';

/**
 * Camada de transporte: aceita conexões WebSocket em /ws, aplica limites
 * (tamanho, taxa de mensagens, conexões por IP) e entrega mensagens JSON
 * validadas ao RoomManager.
 */
export class SocketServer {
  constructor(httpServer, manager, { trustProxy = false, log = () => {} } = {}) {
    this.manager = manager;
    this.log = log;
    this.trustProxy = trustProxy;
    this.perIp = new Map();
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: LIMITS.maxMessageBytes, perMessageDeflate: false });
    this.wss.on('connection', (ws, req) => this._onConnection(ws, req));
    this._hb = setInterval(() => this._heartbeat(), 10000);
    this._hb.unref?.();
  }

  close() {
    clearInterval(this._hb);
    for (const c of this.wss.clients) c.terminate();
    this.wss.close();
  }

  _ip(req) {
    if (this.trustProxy) {
      const xf = req.headers['x-forwarded-for'];
      if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
    }
    return req.socket.remoteAddress || '?';
  }

  _heartbeat() {
    for (const ws of this.wss.clients) {
      if (ws._alive === false) { ws.terminate(); continue; }
      ws._alive = false;
      try { ws.ping(); } catch { /* ignora */ }
    }
  }

  _onConnection(ws, req) {
    const ip = this._ip(req);
    const count = (this.perIp.get(ip) || 0) + 1;
    if (count > LIMITS.maxConnectionsPerIp) {
      ws.close(4003, 'Muitas conexões deste endereço.');
      return;
    }
    this.perIp.set(ip, count);
    ws._alive = true;
    ws.on('pong', () => { ws._alive = true; });

    const conn = {
      ws, ip, session: null,
      tokens: LIMITS.msgPerSecond, lastRefill: Date.now(), dropped: 0,
      send(obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); },
      sendRaw(str) { if (ws.readyState === 1) ws.send(str); },
      close(code, reason) { try { ws.close(code, reason); } catch { /* ignora */ } },
    };

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      // Token bucket por conexão.
      const now = Date.now();
      conn.tokens = Math.min(LIMITS.msgPerSecond * 1.5, conn.tokens + ((now - conn.lastRefill) / 1000) * LIMITS.msgPerSecond);
      conn.lastRefill = now;
      if (conn.tokens < 1) {
        if (++conn.dropped > 600) conn.close(4002, 'Excesso de mensagens.');
        return;
      }
      conn.tokens -= 1;
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') return;
      try { this.manager.handle(conn, msg); } catch (e) { this.log('erro ao tratar mensagem', e); }
    });

    ws.on('close', () => {
      const n = (this.perIp.get(ip) || 1) - 1;
      if (n <= 0) this.perIp.delete(ip); else this.perIp.set(ip, n);
      this.manager.onClose(conn);
    });
    ws.on('error', () => { /* fechamento tratado em close */ });
  }
}
