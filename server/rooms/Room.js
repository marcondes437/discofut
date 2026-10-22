import { createHash, timingSafeEqual } from 'node:crypto';
import { MatchController, sanitizeSettings } from '../../shared/game/MatchController.js';
import { BotManager, BOT_DIFFICULTY } from '../../shared/ai/BotController.js';
import { getBuiltinArena, BUILTIN_ARENAS } from '../../shared/maps/arenas.js';
import { validateArena } from '../../shared/maps/arenaValidate.js';
import { LIMITS, SNAPSHOT_RATES, ADMIN_ACTIONS, cleanText } from '../../shared/protocol/messages.js';
import { IN_MASK, IN_KICK } from '../../shared/config/physicsConfig.js';

const MAX_BOTS = 8;
const CRITICAL_EVENTS = new Set(['goal', 'end', 'overtime', 'count', 'whistle', 'phase', 'pause', 'ballReset']);

function hashPassword(p) { return createHash('sha256').update(`discofut:${p}`).digest(); }

/**
 * Sala de jogo autoritativa: membros, administração, chat, partida simulada
 * a 60 Hz e publicação de snapshots.
 */
export class Room {
  constructor(manager, { code, name, visibility, password, maxPlayers, settings, arenaId }, now = Date.now()) {
    this.manager = manager;
    this.code = code;
    this.name = name;
    this.visibility = visibility;               // public | private | unlisted
    this.passwordHash = password ? hashPassword(password) : null;
    this.maxPlayers = maxPlayers;
    this.createdAt = now;
    this.members = new Map();                   // id → member
    this.hostId = null;
    this.rv = 0;
    this.dirty = true;
    this.bans = new Map();                      // chave (token/ip) → expira em
    this.snapshotRate = 60;
    this.teamsLocked = false;
    this.pendingEvents = [];
    this.lastPingBroadcast = 0;
    const arena = getBuiltinArena(arenaId) || getBuiltinArena('classic');
    this.match = new MatchController({ arena, settings: sanitizeSettings({ ...settings, countdown: true }) });
    this.bots = new BotManager();
    this.botDifficulty = new Map();
    this.closed = false;
  }

  // ------------------------------------------------------------ helpers
  humans() { return [...this.members.values()].filter((m) => !m.isBot); }
  humanCount() { return this.humans().length; }

  checkPassword(p) {
    if (!this.passwordHash) return true;
    if (typeof p !== 'string') return false;
    return timingSafeEqual(this.passwordHash, hashPassword(p.slice(0, LIMITS.passwordLength)));
  }

  isBanned(session, now = Date.now()) {
    for (const key of [`t:${session.token}`, `ip:${session.ip}`]) {
      const until = this.bans.get(key);
      if (until && until > now) return true;
      if (until) this.bans.delete(key);
    }
    return false;
  }

  listing() {
    const s = this.match.settings;
    return {
      code: this.code,
      name: this.name,
      players: this.humanCount(),
      bots: this.members.size - this.humanCount(),
      max: this.maxPlayers,
      mode: `${s.teamSize}v${s.teamSize}`,
      status: this.match.phase === 'lobby' ? 'lobby' : this.match.phase === 'ended' ? 'ended' : 'playing',
      locked: !!this.passwordHash,
      visibility: this.visibility,
      arena: this.match.arena.name,
    };
  }

  state() {
    const m = this.match;
    return {
      code: this.code,
      name: this.name,
      visibility: this.visibility,
      hasPassword: !!this.passwordHash,
      maxPlayers: this.maxPlayers,
      hostId: this.hostId,
      settings: { ...m.settings, snapshotRate: this.snapshotRate, teamsLocked: this.teamsLocked },
      arena: m.arena,
      members: [...this.members.values()].map((x) => ({
        id: x.id, name: x.name, team: m.players.get(x.id)?.team || 'spec', admin: x.admin, host: x.id === this.hostId,
        bot: x.isBot, muted: x.muted, away: x.away, ping: Math.round(x.ping || 0),
        difficulty: x.isBot ? this.botDifficulty.get(x.id) : undefined,
      })),
      phase: m.phase,
      paused: m.paused,
      score: m.score,
      overtime: m.overtime,
      kickoffTeam: m.kickoffTeam,
      winner: m.winner,
      lastGoal: m.lastGoal,
      stats: m.phase === 'ended' || m.phase === 'lobby' ? m.statsTable() : null,
    };
  }

  send(member, obj) {
    const c = member.session?.conn;
    if (c) c.send(obj);
  }

  sendRaw(member, str) {
    const c = member.session?.conn;
    if (c) c.sendRaw(str);
  }

  broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const m of this.members.values()) if (!m.isBot) this.sendRaw(m, s);
  }

  system(text) { this.broadcast({ t: 'chat', sys: 1, m: text }); }

  markDirty() { this.dirty = true; }

  // ------------------------------------------------------- membership
  join(session) {
    const id = session.id;
    const member = {
      id, name: session.name, isBot: false, session, admin: false, muted: false,
      queue: [], lastInput: 0, ackSeq: -1, lastQueuedSeq: -1, lastInputAt: 0,
      chat: [], adminTimes: [], away: false, awaySince: 0, ping: 0,
    };
    this.members.set(id, member);
    this.match.addPlayer(id, { name: session.name, team: 'spec' });
    if (this.hostId === null) {
      this.hostId = id; member.admin = true;
      // Anfitrião entra no time vermelho por conveniência.
      this.match.setTeam(id, 'red');
    }
    session.room = this;
    this.send(member, { t: 'joined', you: id, rv: ++this.rv, room: this.state() });
    this.system(`${session.name} entrou na sala.`);
    this.markDirty();
    return member;
  }

  /** Reconexão: reassocia a sessão ao membro existente. */
  reattach(session) {
    const m = this.members.get(session.id);
    if (!m) return false;
    m.session = session; m.away = false; m.awaySince = 0;
    m.queue.length = 0; m.lastQueuedSeq = -1; m.ackSeq = -1; m.lastInput = 0;
    this.send(m, { t: 'joined', you: m.id, rv: ++this.rv, room: this.state(), resumed: true });
    this.system(`${m.name} reconectou.`);
    this.markDirty();
    return true;
  }

  /** Conexão caiu: mantém o lugar durante o período de graça. */
  disconnected(session, now = Date.now()) {
    const m = this.members.get(session.id);
    if (!m) return;
    m.away = true; m.awaySince = now; m.queue.length = 0; m.lastInput = 0;
    this.match.setInput(m.id, 0);
    this.system(`${m.name} perdeu a conexão…`);
    this.markDirty();
  }

  leave(id, reason = '') {
    const m = this.members.get(id);
    if (!m) return;
    this.members.delete(id);
    this.match.removePlayer(id);
    if (m.isBot) { this.bots.remove(id); this.botDifficulty.delete(id); }
    if (m.session) m.session.room = null;
    this.system(`${m.name} saiu${reason ? ` (${reason})` : ''}.`);
    if (this.hostId === id) this._transferHost();
    this.markDirty();
    if (this.humanCount() === 0) this.manager.closeRoom(this);
  }

  _transferHost() {
    this.hostId = null;
    const candidates = this.humans().filter((x) => !x.away);
    const pool = candidates.length ? candidates : this.humans();
    const next = pool.find((x) => x.admin) || pool[0];
    if (next) {
      this.hostId = next.id;
      next.admin = true;
      this.system(`${next.name} agora é o anfitrião.`);
    }
  }

  // ---------------------------------------------------------- messages
  handle(session, msg, now = Date.now()) {
    const me = this.members.get(session.id);
    if (!me) return;
    switch (msg.t) {
      case 'in': return this._onInput(me, msg, now);
      case 'chat': return this._onChat(me, msg, now);
      case 'team': return this._onTeam(me, msg);
      case 'admin': return this._onAdmin(me, msg, now);
      case 'ping': if (Number.isFinite(msg.r)) me.ping = Math.max(0, Math.min(9999, msg.r)); return undefined;
      default: return undefined;
    }
  }

  _onInput(me, msg, now) {
    const s = msg.s, k = msg.k;
    if (!Number.isInteger(s) || s < 0 || !Number.isInteger(k) || (k & ~IN_MASK) !== 0) return;
    if (s <= me.lastQueuedSeq) return; // antigo/duplicado
    me.lastQueuedSeq = s;
    me.queue.push({ s, k });
    while (me.queue.length > LIMITS.inputQueueMax) me.queue.shift(); // limita latência acumulada
    me.lastInputAt = now;
  }

  _onChat(me, msg, now) {
    const text = cleanText(msg.m, LIMITS.chatLength);
    if (!text) return;
    if (me.muted) { this.send(me, { t: 'err', code: 'muted', msg: 'Você está silenciado nesta sala.' }); return; }
    me.chat = me.chat.filter((ts) => now - ts < LIMITS.chatWindowMs);
    if (me.chat.length >= LIMITS.chatBurst) { this.send(me, { t: 'err', code: 'rate', msg: 'Muitas mensagens: aguarde alguns segundos.' }); return; }
    me.chat.push(now);
    const team = this.match.players.get(me.id)?.team || 'spec';
    this.broadcast({ t: 'chat', id: me.id, name: me.name, team, m: text });
  }

  _onTeam(me, msg) {
    const team = ['red', 'blue', 'spec'].includes(msg.team) ? msg.team : null;
    if (!team) return;
    if (this.teamsLocked && !me.admin) { this.send(me, { t: 'err', code: 'locked', msg: 'Times bloqueados pelo anfitrião.' }); return; }
    if (!this.match.setTeam(me.id, team)) { this.send(me, { t: 'err', code: 'full', msg: 'Time cheio.' }); return; }
    this.markDirty();
  }

  _target(id) {
    return Number.isInteger(id) ? this.members.get(id) : null;
  }

  _onAdmin(me, msg, now) {
    const a = msg.a;
    if (!ADMIN_ACTIONS.includes(a)) return;
    if (!me.admin) { this.send(me, { t: 'err', code: 'forbidden', msg: 'Apenas administradores podem fazer isso.' }); return; }
    me.adminTimes = me.adminTimes.filter((ts) => now - ts < 1000);
    if (me.adminTimes.length >= LIMITS.adminPerSecond) return;
    me.adminTimes.push(now);
    const m = this.match;
    const deny = (text) => this.send(me, { t: 'err', code: 'admin', msg: text });
    switch (a) {
      case 'move': {
        const t = this._target(msg.id);
        const team = ['red', 'blue', 'spec'].includes(msg.team) ? msg.team : null;
        if (!t || !team) return deny('Jogador ou time inválido.');
        if (!m.setTeam(t.id, team)) return deny('Time cheio.');
        break;
      }
      case 'kick':
      case 'ban': {
        const t = this._target(msg.id);
        if (!t || t.id === me.id) return deny('Alvo inválido.');
        if (t.id === this.hostId) return deny('Não é possível remover o anfitrião.');
        if (t.isBot) { this.leave(t.id, 'removido'); break; }
        if (a === 'ban') {
          const until = now + LIMITS.banMs;
          this.bans.set(`t:${t.session.token}`, until);
          if (t.session.ip) this.bans.set(`ip:${t.session.ip}`, until);
        }
        this.send(t, { t: 'kicked', reason: a === 'ban' ? `Banido por ${me.name} (10 min).` : `Expulso por ${me.name}.` });
        this.leave(t.id, a === 'ban' ? 'banido' : 'expulso');
        break;
      }
      case 'mute':
      case 'unmute': {
        const t = this._target(msg.id);
        if (!t || t.isBot || t.id === this.hostId) return deny('Alvo inválido.');
        t.muted = a === 'mute';
        this.system(`${t.name} foi ${t.muted ? 'silenciado' : 'liberado para falar'}.`);
        break;
      }
      case 'admin': {
        const t = this._target(msg.id);
        if (!t || t.isBot) return deny('Alvo inválido.');
        const value = !!msg.value;
        if (!value && me.id !== this.hostId) return deny('Apenas o anfitrião remove administradores.');
        if (!value && t.id === this.hostId) return deny('O anfitrião é sempre administrador.');
        t.admin = value;
        this.system(`${t.name} ${value ? 'agora é' : 'não é mais'} administrador.`);
        break;
      }
      case 'start':
      case 'restart':
        m.start();
        this.system(`${me.name} iniciou a partida.`);
        break;
      case 'stop':
        m.stop();
        this.system(`${me.name} parou a partida.`);
        break;
      case 'pause':
      case 'resume':
        if (!m.setPaused(a === 'pause')) return deny('Nenhuma partida em andamento.');
        this.system(`${me.name} ${a === 'pause' ? 'pausou' : 'retomou'} a partida.`);
        break;
      case 'balance': this._balance(); this.system('Times balanceados automaticamente.'); break;
      case 'lock': this.teamsLocked = !!msg.value; break;
      case 'settings': {
        const s = msg.settings && typeof msg.settings === 'object' ? msg.settings : {};
        const next = sanitizeSettings({ ...s, countdown: true, allowEmptyTeams: false }, m.settings);
        m.setSettings(next);
        if (SNAPSHOT_RATES.includes(s.snapshotRate)) this.snapshotRate = s.snapshotRate;
        if ('teamsLocked' in s) this.teamsLocked = !!s.teamsLocked;
        if (Number.isInteger(s.maxPlayers)) {
          this.maxPlayers = Math.max(Math.max(LIMITS.minPlayers, this.humanCount()), Math.min(LIMITS.maxPlayers, s.maxPlayers));
        }
        // Reduz times que excedem o novo tamanho.
        for (const team of ['red', 'blue']) {
          const list = m.teamPlayers(team);
          for (let i = next.teamSize; i < list.length; i++) m.setTeam(list[i].id, 'spec');
        }
        break;
      }
      case 'arena': {
        if (m.phase !== 'lobby' && m.phase !== 'ended') return deny('Pare a partida antes de trocar a arena.');
        let def = null;
        if (typeof msg.id === 'string') def = getBuiltinArena(msg.id);
        else if (msg.custom !== undefined) {
          const r = validateArena(msg.custom);
          if (!r.ok) return deny(`Arena inválida: ${r.errors.slice(0, 3).join(' ')}`);
          def = r.arena;
        }
        if (!def) return deny('Arena desconhecida.');
        m.setArena(def);
        m.stop();
        this.system(`Arena alterada para "${def.name}".`);
        break;
      }
      case 'addbot': {
        const team = msg.team === 'blue' ? 'blue' : 'red';
        const diff = BOT_DIFFICULTY[msg.difficulty] ? msg.difficulty : 'medium';
        const nBots = [...this.members.values()].filter((x) => x.isBot).length;
        if (nBots >= MAX_BOTS) return deny('Limite de bots atingido.');
        if (m.teamCount(team) >= m.settings.teamSize) return deny('Time cheio.');
        const id = this.manager.nextId();
        const label = { easy: 'Fácil', medium: 'Médio', hard: 'Difícil' }[diff];
        const name = `Bot ${label} ${nBots + 1}`;
        this.members.set(id, { id, name, isBot: true, admin: false, muted: false, away: false, ping: 0 });
        m.addPlayer(id, { name, team, isBot: true });
        this.bots.add(id, diff);
        this.botDifficulty.set(id, diff);
        this.system(`${name} [BOT] adicionado ao ${team === 'red' ? 'Vermelho' : 'Azul'}.`);
        break;
      }
      case 'rmbot': {
        const t = this._target(msg.id);
        if (!t || !t.isBot) return deny('Bot inválido.');
        this.leave(t.id, 'removido');
        break;
      }
      case 'clearbans': this.bans.clear(); this.system('Banimentos removidos.'); break;
      default: return undefined;
    }
    this.markDirty();
    return undefined;
  }

  _balance() {
    const m = this.match;
    const players = [...m.teamPlayers('red'), ...m.teamPlayers('blue')];
    players.sort((x, y) => (x.isBot - y.isBot) || (x.id - y.id));
    for (const p of players) m.setTeam(p.id, 'spec');
    players.forEach((p, i) => m.setTeam(p.id, i % 2 === 0 ? 'red' : 'blue'));
  }

  // -------------------------------------------------------------- tick
  tick(now = Date.now()) {
    const m = this.match;
    for (const mem of this.members.values()) {
      if (mem.isBot) continue;
      if (mem.away) {
        if (now - mem.awaySince > LIMITS.reconnectGraceMs) { this.leave(mem.id, 'desconectado'); if (this.closed) return; continue; }
        m.setInput(mem.id, 0);
        continue;
      }
      let kickTap = false;
      if (mem.queue.length) {
        // Network bursts must not leave movement waiting several simulation ticks.
        // Keep a short kick tap even when its release arrived in the same burst.
        const inp = mem.queue[mem.queue.length - 1];
        kickTap = mem.queue.some((input) => (input.k & IN_KICK) !== 0);
        mem.lastInput = inp.k;
        mem.ackSeq = inp.s;
        mem.queue.length = 0;
      } else if (now - mem.lastInputAt > 500) mem.lastInput = 0; // cliente travado: solta as teclas
      m.setInput(mem.id, mem.lastInput | (kickTap ? IN_KICK : 0));
    }
    this.bots.apply(m);
    const events = m.tick();
    for (const e of events) {
      if (e.type === 'goal') {
        const who = e.scorer != null ? this.members.get(e.scorer)?.name : null;
        const team = e.team === 'red' ? 'Vermelho' : 'Azul';
        this.system(`Gol do ${team}${who ? (e.ownGoal ? ` (contra de ${who})` : ` — ${who}`) : ''}. ${e.score.red} × ${e.score.blue}`);
      } else if (e.type === 'end') {
        this.system(e.winner === 'draw' ? `Fim de jogo: empate ${e.score.red} × ${e.score.blue}.` : `Fim de jogo: vitória do ${e.winner === 'red' ? 'Vermelho' : 'Azul'} (${e.score.red} × ${e.score.blue}).`);
      }
      if (CRITICAL_EVENTS.has(e.type)) {
        this.broadcast({ t: 'ev', tick: m.tickCount, e });
        if (e.type !== 'count' && e.type !== 'whistle') this.markDirty();
      } else this.pendingEvents.push(e);
    }
    if (this.pendingEvents.length > 40) this.pendingEvents.splice(0, this.pendingEvents.length - 40);

    const every = Math.max(1, Math.round(60 / this.snapshotRate));
    if (m.phase !== 'lobby' && m.tickCount % every === 0) this._sendSnapshots();
    else if (m.phase === 'lobby' && this.dirty) this._sendSnapshots();

    if (now - this.lastPingBroadcast > 5000) { this.lastPingBroadcast = now; this.dirty = true; }
    if (this.dirty) {
      this.dirty = false;
      this.broadcast({ t: 'room', rv: ++this.rv, room: this.state() });
    }
  }

  _sendSnapshots() {
    const snap = this.match.snapshot();
    const d = JSON.stringify(snap);
    const e = this.pendingEvents.length ? JSON.stringify(this.pendingEvents.map((x) => (x.type === 'kick' ? ['k', x.id] : ['i', x.kind, x.speed]))) : '[]';
    this.pendingEvents.length = 0;
    for (const mem of this.members.values()) {
      if (mem.isBot || mem.away) continue;
      this.sendRaw(mem, `{"t":"s","a":${mem.ackSeq},"d":${d},"e":${e}}`);
    }
  }
}

export function listBuiltinArenas() {
  return BUILTIN_ARENAS.map((a) => ({ id: a.id, name: a.name }));
}
