import { physicsConfig, IN_KICK, TICK_RATE } from '@shared/config/physicsConfig.js';
import { PhysicsWorld, createBody } from '@shared/physics/PhysicsWorld.js';
import { buildArenaGeometry } from '@shared/maps/arenaGeometry.js';
import { applyMovementInput, applyKickImpulse, updateKickInput, kickoffConstraint } from '@shared/game/MatchController.js';
import { ReplayBuffer } from '../replay/ReplayBuffer.js';

const MS_PER_TICK = 1000 / TICK_RATE;
const HISTORY = 240;
const MAX_REMOTE_PREDICTION_TICKS = 18;

/**
 * Sessão online: envia apenas entradas (com número de sequência), recebe
 * snapshots do servidor autoritativo e prediz/reconcilia os contatos entre
 * jogadores e bola. Sem predição, usa interpolação curta dos snapshots.
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
    this.predBall = null;
    this.predValid = false;
    this.smoothX = 0; this.smoothY = 0;
    this.ballSmoothX = 0; this.ballSmoothY = 0;
    this.predPhase = null;
    this.remoteSmooth = new Map();
    this.remoteVisuals = new Map();
    this.remotePredictionTicks = 0;
    this.predKick = { prevKick: false, kickArmed: false, kickBuffer: 0, kickCooldown: 0 };
    this.predictedKickSounds = [];
    if (this.myTeam === 'spec') return;
    this.predBall = this.predWorld.addBody(createBody('ball'));
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
    if (this.latest && d.ph !== 'lobby') {
      if (d.tick < this.latest.tick) return;
      if (d.tick === this.latest.tick && d.ph === this.latest.ph && d.pa === this.latest.pa
          && msg.a <= this.ack && !msg.e?.length) return;
    }
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
    if (this.snaps.at(-1)?.tick === d.tick) this.snaps.pop();
    this.snaps.push({ tick: d.tick, d });
    if (this.snaps.length > 40) this.snaps.shift();
    if (msg.e && msg.e.length) {
      this.predictedKickSounds = this.predictedKickSounds.filter((sound) => now - sound.at < 1500);
      const evs = msg.e.filter((x) => {
        if (x[0] !== 'k' || x[1] !== this.myId) return true;
        const index = this.predictedKickSounds.findIndex((sound) => sound.seq <= msg.a);
        if (index < 0) return true;
        this.predictedKickSounds.splice(index, 1);
        return false;
      }).map((x) => (x[0] === 'k' ? { type: 'kick', id: x[1] } : { type: 'impact', kind: x[1], speed: x[2] }));
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
    const oldBallX = this.predBall.x + this.ballSmoothX;
    const oldBallY = this.predBall.y + this.ballSmoothY;
    const oldRemotes = new Map();
    for (const body of this.predWorld.bodies) {
      if (body.kind !== 'player' || body === pb) continue;
      const offset = this.remoteSmooth.get(body.id);
      oldRemotes.set(body.id, this.remoteVisuals.get(body.id) || {
        x: body.x + (offset?.x || 0), y: body.y + (offset?.y || 0),
      });
    }
    pb.x = mine[1]; pb.y = mine[2]; pb.vx = mine[3]; pb.vy = mine[4];
    const ball = this.predBall;
    [ball.x, ball.y, ball.vx, ball.vy] = d.b;
    ball.px = ball.x; ball.py = ball.y;
    this.predKick = { kickCooldown: mine[6] || 0, kickArmed: !!mine[7], prevKick: !!mine[8], kickBuffer: mine[10] || 0 };
    // Rebuild all discs from the authoritative state before replaying inputs.
    this.predWorld.bodies.length = 0;
    this.remotePredictionTicks = 0;
    this.predWorld.addBody(ball);
    for (const p of d.p) {
      if (p[0] === this.myId) { this.predWorld.addBody(pb); continue; }
      const remote = createBody('player', p[1], p[2]);
      remote.id = p[0]; remote.vx = p[3]; remote.vy = p[4];
      remote.input = p[9] || 0;
      remote.kickState = { kickCooldown: p[6] || 0, kickArmed: !!p[7], prevKick: !!p[8], kickBuffer: p[10] || 0 };
      this.predWorld.addBody(remote);
    }
    // Reaplica as entradas ainda não confirmadas pelo servidor.
    for (let s = Math.max(1, this.ack + 1, this.seq - HISTORY + 1); s <= this.seq; s++) {
      const h = this.history[s % HISTORY];
      if (!h || h.s !== s) continue;
      this._predStep(h.k, d.ph, d.kt, true);
    }
    const ballEx = oldBallX - ball.x, ballEy = oldBallY - ball.y;
    const continuous = this.predValid && this.predPhase === d.ph && !d.pa;
    this.remoteSmooth.clear();
    for (const body of this.predWorld.bodies) {
      if (body.kind !== 'player' || body === pb) continue;
      const old = oldRemotes.get(body.id);
      if (continuous && old) {
        const x = old.x - body.x, y = old.y - body.y;
        if (x * x + y * y < 60 * 60) this.remoteSmooth.set(body.id, { x, y });
      }
      body.px = body.x; body.py = body.y;
    }
    this.remoteVisuals.clear();
    // Preserve visual continuity across ordinary corrections, never across resets/goals.
    if (continuous && ballEx * ballEx + ballEy * ballEy < 60 * 60) {
      this.ballSmoothX = ballEx; this.ballSmoothY = ballEy;
    } else { this.ballSmoothX = 0; this.ballSmoothY = 0; }
    this.predPhase = d.ph;
    if (this.predValid) {
      // Suaviza correções pequenas; teleporta em divergências grandes.
      const ex = oldX - pb.x, ey = oldY - pb.y;
      if (ex * ex + ey * ey < 60 * 60) { this.smoothX += ex; this.smoothY += ey; } else { this.smoothX = 0; this.smoothY = 0; }
    }
    pb.px = pb.x; pb.py = pb.y;
    this.predValid = true;
  }

  _predStep(bits, phase, kickoffTeam, replaying = false) {
    const b = this.predBody;
    if (this.latest?.pa || (phase !== 'playing' && phase !== 'kickoff')) return;
    for (const body of this.predWorld.bodies) {
      if (body.kind !== 'player') continue;
      // Do not keep inventing an opponent's movement during a network outage.
      if (body !== b && this.remotePredictionTicks >= MAX_REMOTE_PREDICTION_TICKS) {
        body.vx = 0; body.vy = 0;
        continue;
      }
      const fired = this._predictInput(body, body === b ? bits : body.input, body === b ? this.predKick : body.kickState);
      if (fired && body === b && !replaying) {
        this.app.audio.playEvents([{ type: 'kick', id: this.myId }]);
        const now = performance.now();
        this.predictedKickSounds = this.predictedKickSounds.filter((sound) => now - sound.at < 1500);
        this.predictedKickSounds.push({ seq: this.seq, at: now });
        this.ballSmoothX = 0; this.ballSmoothY = 0;
      }
    }
    const team = this.myTeam;
    const kr = this.geo.kickoffRadius;
    this.predWorld.playerConstraint = phase === 'kickoff' ? (body) => {
      const bodyTeam = body === b ? team : this.room.members.find((m) => m.id === body.id)?.team;
      if (bodyTeam) kickoffConstraint(body, bodyTeam, kickoffTeam, kr);
    } : null;
    this.predWorld.step();
    this.remotePredictionTicks++;
  }

  _predictInput(b, bits, k) {
    applyMovementInput(b, bits, physicsConfig);
    return updateKickInput(k, bits, this.room.settings, () => applyKickImpulse(b, this.predBall));
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
    return this.myTeam !== 'spec' && ph && ph !== 'lobby' && ph !== 'countdown' && !(this.latest?.pa ?? this.room?.paused);
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
    return (TICK_RATE / rate) + Math.min(2, jitterTicks * 0.5);
  }

  _view(now, alpha = 1) {
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
    const useWorldPred = usePred && !this.latest.pa && ['playing', 'kickoff'].includes(this.latest.ph);
    const predicted = useWorldPred ? new Map(this.predWorld.bodies.map((body) => [body.id, body])) : null;
    for (const p of A.p) {
      const m = members.get(p[0]);
      if (!m || m.team === 'spec') continue;
      const q = bMap ? bMap.get(p[0]) : null;
      let [x, y] = q ? [p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t] : [p[1] + p[3] * ext, p[2] + p[4] * ext];
      let kicking = !!p[5];
      const local = p[0] === this.myId;
      if (local) kicking = (this.lastBits & IN_KICK) !== 0 || kicking;
      if (local && usePred) { x = this.predBody.x + this.smoothX; y = this.predBody.y + this.smoothY; }
      else if (predicted?.has(p[0])) {
        // Draw contacts on the same timeline as the predicted ball.
        const body = predicted.get(p[0]);
        const offset = this.remoteSmooth.get(p[0]);
        const fraction = Math.max(0, Math.min(1, alpha));
        x = body.px + (body.x - body.px) * fraction + (offset?.x || 0);
        y = body.py + (body.y - body.py) * fraction + (offset?.y || 0);
      }
      players.push({ id: p[0], x, y, vx: p[3], vy: p[4], team: m.team, label: this.labels.get(p[0]) || '', name: m.name, kicking, local, bot: m.bot });
    }
    const useBallPred = useWorldPred;
    const ball = useBallPred ? this.predBall : { x: ballPos[0], y: ballPos[1], vx: A.b[2], vy: A.b[3] };
    return { ball: { x: ball.x + (useBallPred ? this.ballSmoothX : 0), y: ball.y + (useBallPred ? this.ballSmoothY : 0) }, ballVel: { vx: ball.vx, vy: ball.vy }, players, server: A };
  }

  render(alpha, dt) {
    const app = this.app;
    if (!this.geo) return;
    const decay = Math.exp(-dt * 12);
    this.smoothX *= decay; this.smoothY *= decay;
    const ballDecay = Math.exp(-dt * 25);
    this.ballSmoothX *= ballDecay; this.ballSmoothY *= ballDecay;
    // Stable LAN connections can settle corrections in about one physics tick.
    const correctionRate = Math.max(24, Math.min(60, 1000 / (MS_PER_TICK + (this.net.jitter || 0) * 2)));
    const remoteDecay = Math.exp(-dt * correctionRate);
    for (const offset of this.remoteSmooth.values()) {
      offset.x *= remoteDecay; offset.y *= remoteDecay;
    }
    let view = this.replayView || this._view(performance.now(), alpha);
    if (!view) view = { ball: { x: 0, y: 0 }, players: [] };
    if (!this.replayView) {
      this.remoteVisuals.clear();
      for (const player of view.players) {
        if (!player.local) this.remoteVisuals.set(player.id, { x: player.x, y: player.y });
      }
    }
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
