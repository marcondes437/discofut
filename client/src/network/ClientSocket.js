import { PROTOCOL_VERSION } from '@shared/protocol/messages.js';

const TOKEN_KEY = 'discofut.token';

/**
 * Conexão WebSocket com o servidor autoritativo: handshake, reconexão
 * automática com backoff, medição de ping/jitter e despacho de mensagens.
 */
export class ClientSocket {
  constructor(settings) {
    this.settings = settings;
    this.ws = null;
    this.state = 'idle'; // idle | connecting | open | reconnecting | closed
    this.handlers = new Map();
    this.id = null;
    this.wantOpen = false;
    this.retries = 0;
    this.rtt = 0; this.jitter = 0; this._rttSamples = 0;
    this._pingTimer = 0;
    this._retryTimer = 0;
    this.lastError = '';
    this.sentBytes = 0; this.recvBytes = 0;
  }

  url() {
    const custom = (this.settings.get('serverUrl') || new URLSearchParams(location.search).get('server') || '').trim();
    if (custom) return custom.replace(/^http/, 'ws');
    if (location.protocol === 'file:') return null;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }

  _emit(type, data) {
    const hs = this.handlers.get(type);
    if (hs) for (const fn of [...hs]) { try { fn(data); } catch (e) { console.error(e); } }
  }

  _setState(s) { this.state = s; this._emit('state', s); }

  /** Conecta e resolve após o "welcome" do servidor. */
  connect() {
    if (this.state === 'open') return Promise.resolve();
    if (this._pending) return this._pending; // evita sockets duplicados com cliques repetidos
    this.wantOpen = true;
    this._pending = new Promise((resolve, reject) => {
      const done = () => { offOk(); offFail(); this._pending = null; };
      const offOk = this.on('welcome', () => { done(); resolve(); });
      const offFail = this.on('connectFailed', (msg) => { done(); reject(new Error(msg)); });
      if (this.state !== 'connecting' && this.state !== 'reconnecting') this._open();
    });
    return this._pending;
  }

  _open() {
    clearTimeout(this._retryTimer);
    const url = this.url();
    if (!url) { this._emit('connectFailed', 'Página aberta como arquivo local: servidor indisponível.'); return; }
    this._setState(this.retries ? 'reconnecting' : 'connecting');
    let ws;
    try { ws = new WebSocket(url); } catch (e) { this._fail('Endereço de servidor inválido.'); return; }
    this.ws = ws;
    const timeout = setTimeout(() => { if (ws.readyState !== 1) ws.close(); }, 6000);
    ws.onopen = () => {
      clearTimeout(timeout);
      let token = null;
      try { token = sessionStorage.getItem(TOKEN_KEY); } catch { /* ignora */ }
      this._sendRaw({ t: 'hello', v: PROTOCOL_VERSION, name: this.settings.get('nickname') || 'Jogador', token });
    };
    ws.onmessage = (ev) => {
      this.recvBytes += ev.data.length || 0;
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;
      if (msg.t === 'welcome') {
        this.id = msg.id;
        try { sessionStorage.setItem(TOKEN_KEY, msg.token); } catch { /* ignora */ }
        this.retries = 0;
        this._setState('open');
        this._startPing();
      } else if (msg.t === 'pong') {
        const rtt = performance.now() - msg.c;
        if (this._rttSamples === 0) this.rtt = rtt;
        this.jitter = this.jitter * 0.8 + Math.abs(rtt - this.rtt) * 0.2;
        this.rtt = this.rtt * 0.75 + rtt * 0.25;
        this._rttSamples++;
        this._emit('ping', this.rtt);
        return;
      }
      this._emit(msg.t, msg);
    };
    ws.onclose = (ev) => {
      clearTimeout(timeout);
      this._stopPing();
      const wasOpen = this.state === 'open';
      this.ws = null;
      if (!this.wantOpen || ev.code === 4001 || ev.code === 4003) {
        this._setState('closed');
        if (ev.code === 4003) this._emit('connectFailed', ev.reason || 'Conexão recusada pelo servidor.');
        return;
      }
      if (!wasOpen && this.retries === 0) { this._fail('Servidor indisponível.'); return; }
      this.retries++;
      if (this.retries > 8) { this._fail('Não foi possível reconectar.'); return; }
      this._setState('reconnecting');
      this._retryTimer = setTimeout(() => this._open(), Math.min(4000, 300 * 2 ** (this.retries - 1)));
    };
    ws.onerror = () => { /* tratado em onclose */ };
  }

  _fail(msg) {
    this.lastError = msg;
    this.wantOpen = false;
    this.retries = 0;
    this._setState('closed');
    this._emit('connectFailed', msg);
  }

  _startPing() {
    this._stopPing();
    const ping = () => this._sendRaw({ t: 'ping', c: performance.now(), r: Math.round(this.rtt) });
    ping();
    this._pingTimer = setInterval(ping, 2000);
  }

  _stopPing() { clearInterval(this._pingTimer); }

  _sendRaw(obj) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    const s = JSON.stringify(obj);
    this.sentBytes += s.length;
    this.ws.send(s);
    return true;
  }

  send(obj) { return this.state === 'open' && this._sendRaw(obj); }

  close() {
    this.wantOpen = false;
    clearTimeout(this._retryTimer);
    this._stopPing();
    if (this.ws) { try { this.ws.close(1000, 'bye'); } catch { /* ignora */ } }
    this.ws = null;
    this._setState('closed');
  }
}
