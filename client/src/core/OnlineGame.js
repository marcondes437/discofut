import { physicsConfig, IN_KICK, TICK_RATE } from '@shared/config/physicsConfig.js';
import { PhysicsWorld, createBody } from '@shared/physics/PhysicsWorld.js';
import { buildArenaGeometry } from '@shared/maps/arenaGeometry.js';
import { applyMovementInput, kickoffConstraint } from '@shared/game/MatchController.js';
import { ReplayBuffer } from '../replay/ReplayBuffer.js';

const MS_PER_TICK = 1000 / TICK_RATE;
const HISTORY = 240;

/**
 * Sessão online: envia apenas entradas (com número de sequência), recebe
 * snapshots do servidor autoritativo, interpola jogadores remotos e a bola,
 * e prediz/reconcilia o próprio jogador.
 */
export class OnlineGame {
  constructor(app, net, joined) {
    this.app = app;
    this.net = net;
    this.kind = 'online';
    this.myId = joined.you;
    this.room = null;
    this.rv = -1;
    this.snaps = [];
    this.latest = null;
    this.tickOffset = null;
    this.seq = 0;
    this.history = new Array(HISTORY);
    this.ack = -1;
    this.predBody = null;
    this.predWorld = null;
    this.smoothX = 0; this.smoothY = 0;
    this.lastBits = 0;
    this.labels = new Map();
    this.replay = new ReplayBuffer(8);
    this.replayView = null;
    this.stats = { snapshots: 0, late: 0, lastGapMs: 0, lastRecv: 0 };
    this.offs = [];
    this.onRoom = null;            // callback para a UI do lobby
    this.onEvent = null;
    this._unsubs = [
      net.on('s', (m) => this._onSnapshot(m)),
      net.on('room', (m) => this._onRoom(m.rv, m.room)),
      net.on('joined', (m) => { this.myId = m.you; this._onRoom(m.rv, m.room, true); }),
      net.on('ev', (m) => this._onEvent(m.e)),
    ];
    this._onRoom(joined.rv, joined.room, true);
  }

  destroy() {
    for (const u of this._unsubs) u();
    document.getElementById('replay-badge').hidden = true;
  }

  // -------------------------------------------------------------- room
  get me() { return this.room?.members.find((m) => m.id === this.myId) || null; }
  get myTeam() { return this.me?.team || 'spec'; }
  get isAdmin() { return !!this.me?.admin; }
  nameOf = (id) => this.room?.members.find((m) => m.id === id)?.name ?? '?';

  _onRoom(rv, room, force = false) {
    if (!force && rv <= this.rv) return; // estado versionado: ignora antigos
    this.rv = rv;
    const prevArena = this.room ? JSON.stringify(this.room.arena) : '';
    const prevTeam = this.myTeam;
    this.room = room;
    if (JSON.stringify(room.arena) !== prevArena) {
      this.geo = buildArenaGeometry(room.arena);
      this.app.renderer.setArena(this.geo);
      this.app.camera.snap();
      this.predWorld = new PhysicsWorld(this.geo);
      this.predBody = null;
    }
    this.labels.clear();
    for (const team of ['red', 'blue']) {
      room.members.filter((m) => m.team === team).forEach((m, i) => this.labels.set(m.id, String(i + 1)));
    }
    if (this.myTeam !== prevTeam || !this.predBody) this._resetPrediction();
    if (this.onRoom) this.onRoom(room);
  }

  _resetPrediction() {
    if (!this.predWorld) return;
    this.predWorld.bodies.length = 0;
    this.predBody = null;
    if (this.myTeam === 'spec') return;
    const b = createBody('player');
    b.id = this.myId;
    this.predWorld.addBody(b);
    this.predBody = b;
    this.predValid = false;
  }

  // --------------------------------------------------------- snapshots
  _onSnapshot(msg) {
    const now = performance.now();
    const d = msg.d;
    if (this.latest && d.tick <= this.latest.tick && d.ph !== 'lobby') return; // fora de ordem
    if (this.stats.lastRecv) {
      const gap = now - this.stats.lastRecv;
      const expected = 1000 / (this.room?.settings.snapshotRate || 30);
      if (gap > expected * 2.5) this.stats.late++;
      this.stats.lastGapMs = gap;
    }
    this.stats.lastRecv = now;
    this.stats.snapshots++;
    const off = d.tick - now / MS_PER_TICK;
    if (this.tickOffset === null || Math.abs(off - this.tickOffset) > 30) this.tickOffset = off;
    else this.tickOffset += (off - this.tickOffset) * 0.06;
    this.latest = d;
    this.snaps.push({ tick: d.tick, d });
    if (this.snaps.length > 40) this.snaps.shift();
    if (msg.e && msg.e.length) {
      const evs = msg.e.map((x) => (x[0] === 'k' ? { type: 'kick', id: x[1] } : { type: 'impact', kind: x[1], speed: x[2] }));
      this.app.audio.playEvents(evs);
    }
    this.ack = msg.a;
    this._reconcile(d);
  }

  _reconcile(d) {
    const pb = this.predBody;
    if (!pb) return;
    const mine = d.p.find((p) => p[0] === this.myId);
    if (!mine) return;
    const oldX = pb.x, oldY = pb.y;
    pb.x = mine[1]; pb.y = mine[2]; pb.vx = mine[3]; pb.vy = mine[4];
    // Reaplica as entradas ainda não confirmadas pelo servidor.
    if (this.ack >= 0) {
      for (let s = this.ack + 1; s <= this.seq; s++) {
        const h = this.history[s % HISTORY];
        if (!h || h.s !== s) continue;
        this._predStep(h.k, d.ph, d.kt);
      }
    }
    if (this.predValid) {
      // Suaviza correções pequenas; teleporta em divergências grandes.
      const ex = oldX - pb.x, ey = oldY - pb.y;
      if (ex * ex + ey * ey < 60 * 60) { this.smoothX += ex; this.smoothY += ey; } else { this.smoothX = 0; this.smoothY = 0; }
    }
    pb.px = pb.x; pb.py = pb.y;
    this.predValid = true;
  }

  _predStep(bits, phase, kickoffTeam) {
    const b = this.predBody;
    applyMovementInput(b, bits, physicsConfig);
    const team = this.myTeam;
    const kr = this.geo.kickoffRadius;
    this.predWorld.playerConstraint = phase === 'kickoff' ? (body) => kickoffConstraint(body, team, kickoffTeam, kr) : null;
    this.predWorld.step();
  }

  _onEvent(e) {
    this.app.audio.playEvents([e]);
    this.app.hud.handleEvents([e], this.nameOf);
    if (e.type === 'goal') {
      const label = e.scorer != null ? `${e.ownGoal ? 'Gol contra de ' : ''}${this.nameOf(e.scorer)}` : '';
      this.replay.captureGoal(label, 5, 70);
    }
    if (this.onEvent) this.onEvent(e);
  }

  // -------------------------------------------------------------- loop
  canControl() {
    const ph = this.latest?.ph || this.room?.phase;
    return this.myTeam !== 'spec' && ph && ph !== 'lobby' && ph !== 'countdown' && !this.room?.paused;
  }

  tick() {
    const input = this.app.input;
    if (this.replay.playing) {
      this.replayView = this.replay.step();
      if (!this.replayView) this.stopReplay();
    }
    if (this.canControl() && !this.replay.playing) {
      const bits = input.sample('main');
      input.endTick();
      const s = ++this.seq;
      this.history[s % HISTORY] = { s, k: bits };
      this.net.send({ t: 'in', s, k: bits });
      this.lastBits = bits;
      if (this.predBody && this.predValid && this.app.settings.get('prediction')) {
        this._predStep(bits, this.latest?.ph, this.latest?.kt);
      }
    } else {
      input.endTick();
      if (this.lastBits !== 0 && this.myTeam !== 'spec') {
        const s = ++this.seq;
        this.history[s % HISTORY] = { s, k: 0 };
        this.net.send({ t: 'in', s, k: 0 });
      }
      this.lastBits = 0;
    }
    if (this.latest && this.latest.ph !== 'lobby' && !this.replay.playing) {
      const v = this._view(performance.now());
      if (v) { this.replay.record(v); this.replay.extend(v); }
    }
  }

  /** Solta todas as teclas no servidor (perda de foco, chat aberto). */
  releaseInputs() {
    this.app.input.releaseAll();
  }

  startReplay() {
    if (!this.replay.start()) return false;
    document.getElementById('replay-badge').hidden = false;
    return true;
  }

  stopReplay() {
    this.replay.stop();
    this.replayView = null;
    document.getElementById('replay-badge').hidden = true;
  }

  interpDelayTicks() {
    const rate = this.room?.settings.snapshotRate || 30;
    const jitterTicks = (this.net.jitter || 0) / MS_PER_TICK;
    return (TICK_RATE / rate) * 1.4 + Math.min(6, jitterTicks * 1.5) + 1;
  }

  _view(now) {
    if (!this.snaps.length) return null;
    const est = now / MS_PER_TICK + (this.tickOffset || 0);
    const rt = est - this.interpDelayTicks();
    let a = this.snaps[0], b = null;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].tick <= rt) { a = this.snaps[i]; b = this.snaps[i + 1] || null; break; }
    }
    let t = 0, ext = 0;
    if (b) t = (rt - a.tick) / Math.max(1, b.tick - a.tick);
    else ext = Math.min(6, Math.max(0, rt - a.tick)); // extrapolação curta
    const A = a.d, B = b ? b.d : null;
    const bp = (x, y, vx, vy, x2, y2) => (B ? [x + (x2 - x) * t, y + (y2 - y) * t] : [x + vx * ext, y + vy * ext]);
    const ballPos = bp(A.b[0], A.b[1], A.b[2], A.b[3], B?.b[0], B?.b[1]);
    const bMap = B ? new Map(B.p.map((p) => [p[0], p])) : null;
    const members = new Map((this.room?.members || []).map((m) => [m.id, m]));
    const players = [];
    const usePred = this.app.settings.get('prediction') && this.predBody && this.predValid && A.ph !== 'lobby';
    for (const p of A.p) {
      const m = members.get(p[0]);
      if (!m || m.team === 'spec') continue;
      const q = bMap ? bMap.get(p[0]) : null;
      let [x, y] = q ? [p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t] : [p[1] + p[3] * ext, p[2] + p[4] * ext];
      let kicking = !!p[5];
      const local = p[0] === this.myId;
      if (local) kicking = (this.lastBits & IN_KICK) !== 0 || kicking;
      if (local && usePred) { x = this.predBody.x + this.smoothX; y = this.predBody.y + this.smoothY; }
      players.push({ id: p[0], x, y, vx: p[3], vy: p[4], team: m.team, label: this.labels.get(p[0]) || '', name: m.name, kicking, local, bot: m.bot });
    }
    return { ball: { x: ballPos[0], y: ballPos[1] }, ballVel: { vx: A.b[2], vy: A.b[3] }, players, server: A };
  }

  render(alpha, dt) {
    const app = this.app;
    if (!this.geo) return;
    const decay = Math.exp(-dt * 12);
    this.smoothX *= decay; this.smoothY *= decay;
    let view = this.replayView || this._view(performance.now());
    if (!view) view = { ball: { x: 0, y: 0 }, players: [] };
    if (this.predBody && this.predValid && this.app.settings.get('debug') && this.latest) {
      const mine = this.latest.p.find((p) => p[0] === this.myId);
      if (mine) view.ghost = { x: mine[1], y: mine[2] };
      view.debugText = `srv tick ${this.latest.tick} · ack ${this.ack}/${this.seq} · atraso ${this.interpDelayTicks().toFixed(1)}t`;
    }
    app.camera.update(app.renderer.cssW, app.renderer.cssH, this.geo.view, view.ball, app.settings.get('zoom'), dt);
    app.renderer.draw(view, app.camera);
    const L = this.latest;
    const r = this.room;
    if (r) {
      app.hud.update({
        score: L ? { red: L.sc[0], blue: L.sc[1] } : r.score,
        clockTicks: L ? L.cl : 0,
        timeLimit: r.settings.timeLimit,
        overtime: L ? !!L.ot : r.overtime,
        phase: L && r.phase !== 'lobby' ? L.ph : r.phase,
        paused: L ? !!L.pa : r.paused,
        kickoffTeam: L?.kt,
        extraStatus: this.myTeam === 'spec' && r.phase !== 'lobby' ? 'Você é espectador' : '',
      });
    }
    this._updateNet();
  }

  _updateNet() {
    const n = this.net;
    if (n.state !== 'open') {
      this.app.hud.setNet(`<span class="bad">${n.state === 'reconnecting' ? 'Reconectando…' : 'Desconectado'}</span>`);
      return;
    }
    const rtt = Math.round(n.rtt);
    const cls = rtt < 80 ? 'good' : rtt < 160 ? 'mid' : 'bad';
    const stale = this.latest && this.room?.phase !== 'lobby' && performance.now() - this.stats.lastRecv > 600;
    this.app.hud.setNet(`<span class="${cls}">${rtt} ms</span> · jitter ${Math.round(n.jitter)} ms${this.stats.late ? ` · ${this.stats.late} snapshots atrasados` : ''}${stale ? ' · <span class="bad">sem dados</span>' : ''}`);
  }
}
