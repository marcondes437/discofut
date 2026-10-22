import { randomBytes, randomInt } from 'node:crypto';
import { Room } from './Room.js';
import { LIMITS, PROTOCOL_VERSION, cleanText, cleanName } from '../../shared/protocol/messages.js';
import { sanitizeSettings } from '../../shared/game/MatchController.js';
import { getBuiltinArena } from '../../shared/maps/arenas.js';
import { TICK_RATE } from '../../shared/config/physicsConfig.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Sessões (identidade com token de reconexão) e salas. Executa o laço
 * global de simulação a 60 Hz para todas as salas.
 */
export class RoomManager {
  constructor({ log = () => {} } = {}) {
    this.rooms = new Map();         // code → Room
    this.sessions = new Map();      // token → session
    this._nextId = 1;
    this.log = log;
    this._loop = null;
    this._acc = 0;
    this._last = 0;
  }

  nextId() { return this._nextId++; }

  start() {
    const step = 1000 / TICK_RATE;
    this._last = performance.now();
    this._loop = setInterval(() => {
      const now = performance.now();
      this._acc += now - this._last;
      this._last = now;
      if (this._acc > 250) this._acc = 250;
      let n = 0;
      while (this._acc >= step && n < 10) {
        this._acc -= step; n++;
        const wall = Date.now();
        for (const room of this.rooms.values()) {
          try { room.tick(wall); } catch (e) { this.log('erro na sala', room.code, e); }
        }
      }
      this._gcSessions();
    }, 2);
    this._loop.unref?.();
  }

  stop() { clearInterval(this._loop); }

  _gcSessions(now = Date.now()) {
    if (now - (this._lastGc || 0) < 2000) return;
    this._lastGc = now;
    for (const [token, s] of this.sessions) {
      if (!s.conn && now - s.lastSeen > LIMITS.reconnectGraceMs + 5000 && !s.room) this.sessions.delete(token);
    }
  }

  _newCode() {
    for (let i = 0; i < 1000; i++) {
      let c = '';
      for (let k = 0; k < 5; k++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
    throw new Error('sem códigos livres');
  }

  listRooms() {
    return [...this.rooms.values()].filter((r) => r.visibility !== 'unlisted').map((r) => r.listing());
  }

  closeRoom(room) {
    room.closed = true;
    this.rooms.delete(room.code);
    this.log(`sala ${room.code} encerrada`);
  }

  // ---------------------------------------------------------- conexões
  onClose(conn) {
    const s = conn.session;
    if (!s) return;
    s.conn = null;
    s.lastSeen = Date.now();
    if (s.room) s.room.disconnected(s);
  }

  /** Despacha uma mensagem já validada como objeto JSON com campo t. */
  handle(conn, msg) {
    if (msg.t === 'hello') return this._hello(conn, msg);
    const s = conn.session;
    if (!s) return conn.send({ t: 'err', code: 'hello', msg: 'Handshake ausente.' });
    switch (msg.t) {
      case 'ping': conn.send({ t: 'pong', c: msg.c, s: Date.now() }); if (s.room) s.room.handle(s, msg); return undefined;
      case 'list': return conn.send({ t: 'rooms', list: this.listRooms() });
      case 'create': return this._create(s, msg);
      case 'join': return this._join(s, msg);
      case 'leave':
        if (s.room) s.room.leave(s.id);
        return conn.send({ t: 'left' });
      case 'name': {
        const n = cleanName(msg.name);
        if (n && !s.room) s.name = n;
        return undefined;
      }
      default:
        if (s.room) s.room.handle(s, msg);
        return undefined;
    }
  }

  _hello(conn, msg) {
    if (conn.session) return;
    if (msg.v !== PROTOCOL_VERSION) {
      conn.send({ t: 'err', code: 'version', msg: 'Versão do cliente incompatível: recarregue a página.' });
      conn.close(4003, 'versao');
      return;
    }
    const name = cleanName(msg.name) || `Jogador${randomInt(100, 999)}`;
    let s = typeof msg.token === 'string' ? this.sessions.get(msg.token) : null;
    if (s && s.conn) s = null; // token em uso por outra aba: nova identidade
    if (s && s.ip && s.ip !== conn.ip && !s.room) s = null;
    if (!s) {
      s = { id: this.nextId(), token: randomBytes(18).toString('hex'), name, conn: null, room: null, ip: conn.ip, lastSeen: Date.now() };
      this.sessions.set(s.token, s);
    }
    s.conn = conn; s.ip = conn.ip; s.lastSeen = Date.now();
    if (!s.room) s.name = name;
    conn.session = s;
    conn.send({ t: 'welcome', id: s.id, token: s.token, name: s.name });
    if (s.room) {
      if (!s.room.closed && s.room.members.has(s.id)) s.room.reattach(s);
      else s.room = null;
    }
  }

  _create(s, msg) {
    if (s.room) s.room.leave(s.id);
    if (this.rooms.size >= LIMITS.maxRooms) return s.conn.send({ t: 'err', code: 'rooms', msg: 'Servidor cheio: limite de salas atingido.' });
    const name = cleanText(msg.name, LIMITS.roomNameLength);
    if (name.length < 2) return s.conn.send({ t: 'err', code: 'create', msg: 'Nome da sala deve ter ao menos 2 caracteres.' });
    const visibility = ['public', 'private', 'unlisted'].includes(msg.visibility) ? msg.visibility : 'public';
    const password = typeof msg.password === 'string' ? msg.password.slice(0, LIMITS.passwordLength) : '';
    if (visibility === 'private' && password.length < 1) return s.conn.send({ t: 'err', code: 'create', msg: 'Sala privada precisa de senha.' });
    const maxPlayers = Number.isInteger(msg.maxPlayers) ? Math.min(LIMITS.maxPlayers, Math.max(LIMITS.minPlayers, msg.maxPlayers)) : 8;
    const settings = sanitizeSettings(msg.settings || {});
    const arenaId = typeof msg.arena === 'string' && getBuiltinArena(msg.arena) ? msg.arena : 'classic';
    const room = new Room(this, { code: this._newCode(), name, visibility, password: visibility === 'public' ? '' : password, maxPlayers, settings, arenaId });
    this.rooms.set(room.code, room);
    this.log(`sala ${room.code} criada por ${s.name}`);
    room.join(s);
    return undefined;
  }

  _join(s, msg) {
    const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase().slice(0, 8) : '';
    const room = this.rooms.get(code);
    if (!room) return s.conn.send({ t: 'err', code: 'join', msg: 'Sala não encontrada (código inválido ou sala encerrada).' });
    if (s.room === room) return room.reattach(s);
    if (room.isBanned(s)) return s.conn.send({ t: 'err', code: 'join', msg: 'Você está temporariamente banido desta sala.' });
    if (room.humanCount() >= room.maxPlayers) return s.conn.send({ t: 'err', code: 'join', msg: 'Sala cheia.' });
    if (!room.checkPassword(msg.password)) return s.conn.send({ t: 'err', code: 'password', msg: 'Senha incorreta.' });
    if (s.room) s.room.leave(s.id);
    const n = cleanName(msg.name);
    if (n) s.name = n;
    room.join(s);
    return undefined;
  }
}
