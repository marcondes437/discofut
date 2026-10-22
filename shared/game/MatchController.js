import {
  physicsConfig, IN_UP, IN_DOWN, IN_LEFT, IN_RIGHT, IN_KICK, TICK_RATE,
} from '../config/physicsConfig.js';
import { PhysicsWorld, createBody } from '../physics/PhysicsWorld.js';
import { buildArenaGeometry } from '../maps/arenaGeometry.js';

export const TEAMS = ['red', 'blue'];
export const OTHER = { red: 'blue', blue: 'red' };
export const SIDE = { red: -1, blue: 1 }; // lado que cada time defende

export const DEFAULT_SETTINGS = Object.freeze({
  timeLimit: 3,         // minutos (0 = sem limite)
  scoreLimit: 3,        // gols (0 = sem limite)
  overtime: 'golden',   // 'golden' (gol de ouro) | 'draw' (termina empatado)
  kickMode: 'press',    // 'press' (1 chute por toque) | 'repeat' (repete enquanto segura)
  kickCooldown: 8,      // ticks
  teamSize: 4,          // máximo por time (1v1..4v4)
  allowEmptyTeams: false,
  countdown: true,
});

function clampInt(v, lo, hi, def) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}

/** Normaliza configurações vindas de UI/rede. */
export function sanitizeSettings(s = {}, base = DEFAULT_SETTINGS) {
  const o = { ...base };
  if (!s || typeof s !== 'object') return o;
  if ('timeLimit' in s) o.timeLimit = clampInt(s.timeLimit, 0, 30, base.timeLimit);
  if ('scoreLimit' in s) o.scoreLimit = clampInt(s.scoreLimit, 0, 20, base.scoreLimit);
  if ('overtime' in s) o.overtime = s.overtime === 'draw' ? 'draw' : 'golden';
  if ('kickMode' in s) o.kickMode = s.kickMode === 'repeat' ? 'repeat' : 'press';
  if ('kickCooldown' in s) o.kickCooldown = clampInt(s.kickCooldown, 4, 30, base.kickCooldown);
  if ('teamSize' in s) o.teamSize = clampInt(s.teamSize, 1, 4, base.teamSize);
  if ('allowEmptyTeams' in s) o.allowEmptyTeams = !!s.allowEmptyTeams;
  if ('countdown' in s) o.countdown = !!s.countdown;
  return o;
}

/**
 * Aplica a aceleração de uma entrada ao corpo do jogador (8 direções,
 * diagonais normalizadas, resposta rápida ao inverter direção).
 * Compartilhado entre simulação autoritativa e predição do cliente.
 */
export function applyMovementInput(b, bits, cfg = physicsConfig) {
  let dx = 0, dy = 0;
  if (bits & IN_RIGHT) dx += 1;
  if (bits & IN_LEFT) dx -= 1;
  if (bits & IN_DOWN) dy += 1;
  if (bits & IN_UP) dy -= 1;
  if (dx === 0 && dy === 0) return;
  const inv = dx !== 0 && dy !== 0 ? Math.SQRT1_2 : 1;
  const ux = dx * inv, uy = dy * inv;
  let a = (bits & IN_KICK) ? cfg.player.kickingAccel : cfg.player.accel;
  if (ux * b.vx + uy * b.vy < 0) a *= cfg.player.turnBoost;
  b.vx += ux * a;
  b.vy += uy * a;
}

/**
 * Barreira do kickoff: cada time fica no próprio campo; o time que dá a saída
 * pode entrar no círculo central, o outro não.
 */
export function kickoffConstraint(b, team, kickoffTeam, kr) {
  const s = SIDE[team];
  const r = b.r;
  const inHalf = s * b.x >= r;
  if (team === kickoffTeam) {
    if (inHalf) return;
    const d = Math.hypot(b.x, b.y);
    if (d <= kr) return;
    const dHalf = r - s * b.x;
    const dCircle = d - kr;
    if (dHalf <= dCircle) {
      b.x = s * r;
      if (s * b.vx < 0) b.vx = 0;
    } else {
      b.x = (b.x / d) * kr; b.y = (b.y / d) * kr;
      const vr = (b.vx * b.x + b.vy * b.y) / kr;
      if (vr > 0) { b.vx -= (b.x / kr) * vr; b.vy -= (b.y / kr) * vr; }
    }
    return;
  }
  if (!inHalf) {
    b.x = s * r;
    if (s * b.vx < 0) b.vx = 0;
  }
  const minD = kr + r;
  const d = Math.hypot(b.x, b.y);
  if (d < minD) {
    let nx, ny;
    if (d < 1e-6) { nx = s; ny = 0; } else { nx = b.x / d; ny = b.y / d; }
    b.x = nx * minD; b.y = ny * minD;
    const vr = b.vx * nx + b.vy * ny;
    if (vr < 0) { b.vx -= nx * vr; b.vy -= ny * vr; }
    if (s * b.x < r) b.x = s * r;
  }
}

function newStats() {
  return { goals: 0, assists: 0, ownGoals: 0, kicks: 0, touches: 0, saves: 0, steals: 0, ticksPlayed: 0 };
}

/**
 * Controlador de partida compartilhado entre o modo offline (cliente) e o
 * servidor autoritativo. Contém física, regras, estados e estatísticas.
 *
 * Fases: lobby → (waiting) → countdown → kickoff → playing → goal → kickoff … → ended
 * "paused" é um sinalizador ortogonal; "overtime" indica prorrogação/gol de ouro.
 */
export class MatchController {
  constructor({ arena, settings = {}, cfg = physicsConfig } = {}) {
    this.cfg = cfg;
    this.settings = sanitizeSettings(settings);
    /** @type {Map<number, any>} */
    this.players = new Map();
    this.events = [];
    this._delivered = 0;
    this.phase = 'lobby';
    this.paused = false;
    this.overtime = false;
    this.score = { red: 0, blue: 0 };
    this.tickCount = 0;
    this.clockTicks = 0;
    this.phaseTicks = 0;
    this.kickoffTeam = 'red';
    this.winner = null;
    this.pendingEnd = null;
    this.lastGoal = null;
    this.touchHistory = [];
    this.setArena(arena);
  }

  // ---------------------------------------------------------------- arena
  setArena(def) {
    this.arena = def;
    this.geo = buildArenaGeometry(def, this.cfg);
    const oldPlayers = [...this.players.values()];
    this.world = new PhysicsWorld(this.geo, this.cfg);
    this.world.playerConstraint = (b) => this._kickoffConstraint(b);
    this.ball = this.world.addBody(createBody('ball', 0, 0, this.cfg));
    for (const p of oldPlayers) {
      p.body = null;
      if (p.team !== 'spec') this._createBody(p);
    }
    this.resetPositions();
  }

  setSettings(s) {
    this.settings = sanitizeSettings(s, this.settings);
  }

  // -------------------------------------------------------------- players
  addPlayer(id, { name = 'Jogador', team = 'spec', isBot = false } = {}) {
    const p = {
      id, name, team: 'spec', isBot,
      input: 0, prevKick: false, kickArmed: false, kickCooldown: 0, kicking: false,
      body: null, stats: newStats(), joinedAt: this.tickCount,
    };
    this.players.set(id, p);
    if (team !== 'spec') this.setTeam(id, team);
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.body) this.world.removeBody(p.body);
    this.players.delete(id);
  }

  teamCount(team) {
    let n = 0;
    for (const p of this.players.values()) if (p.team === team) n++;
    return n;
  }

  teamPlayers(team) {
    const out = [];
    for (const p of this.players.values()) if (p.team === team) out.push(p);
    return out;
  }

  /** Move jogador entre times. Retorna false se o time estiver cheio. */
  setTeam(id, team) {
    const p = this.players.get(id);
    if (!p) return false;
    if (team !== 'red' && team !== 'blue') team = 'spec';
    if (p.team === team) return true;
    if (team !== 'spec' && this.teamCount(team) >= this.settings.teamSize) return false;
    if (p.body) { this.world.removeBody(p.body); p.body = null; }
    p.team = team;
    p.input = 0; p.prevKick = false; p.kickArmed = false; p.kicking = false;
    if (team !== 'spec') {
      this._createBody(p);
      this._placeAtSpawn(p, this.teamPlayers(team).indexOf(p));
    }
    return true;
  }

  _createBody(p) {
    const b = createBody('player', 0, 0, this.cfg);
    b.id = p.id;
    b.owner = p;
    p.body = b;
    this.world.addBody(b);
  }

  _placeAtSpawn(p, index) {
    const list = this.geo.spawns[p.team];
    const s = list[index % list.length];
    const extra = Math.floor(index / list.length);
    const side = SIDE[p.team];
    const b = p.body;
    b.x = s[0] + side * extra * (b.r * 2.2);
    b.y = s[1];
    // Garante que fique dentro do próprio campo.
    const lim = this.geo.W - b.r;
    if (Math.abs(b.x) > lim) b.x = side * lim;
    b.vx = 0; b.vy = 0; b.px = b.x; b.py = b.y;
  }

  setInput(id, bits) {
    const p = this.players.get(id);
    if (p) p.input = bits | 0;
  }

  // ---------------------------------------------------------------- flow
  canPlay() {
    if (this.settings.allowEmptyTeams) return this.teamCount('red') + this.teamCount('blue') > 0;
    return this.teamCount('red') > 0 && this.teamCount('blue') > 0;
  }

  isRunning() { return this.phase !== 'lobby'; }

  start() {
    this.score = { red: 0, blue: 0 };
    this.clockTicks = 0;
    this.overtime = false;
    this.winner = null;
    this.pendingEnd = null;
    this.lastGoal = null;
    this.paused = false;
    this.kickoffTeam = 'red';
    this.touchHistory.length = 0;
    for (const p of this.players.values()) p.stats = newStats();
    this.resetPositions();
    if (!this.canPlay()) this._setPhase('waiting');
    else if (this.settings.countdown) this._setPhase('countdown');
    else this._beginKickoff();
  }

  stop() {
    this.paused = false;
    this.resetPositions();
    this._setPhase('lobby');
  }

  setPaused(v) {
    if (this.phase === 'lobby') return false;
    this.paused = !!v;
    this.events.push({ type: 'pause', paused: this.paused });
    return true;
  }

  resetPositions() {
    const b = this.ball;
    b.x = 0; b.y = 0; b.vx = 0; b.vy = 0; b.px = 0; b.py = 0;
    for (const team of TEAMS) {
      this.teamPlayers(team).forEach((p, i) => this._placeAtSpawn(p, i));
    }
    for (const p of this.players.values()) {
      p.kickCooldown = 0; p.kickArmed = false;
    }
  }

  _setPhase(phase) {
    this.phase = phase;
    this.phaseTicks = 0;
    this.events.push({ type: 'phase', phase });
  }

  _beginKickoff() {
    this.resetPositions();
    this._setPhase('kickoff');
    this.events.push({ type: 'whistle', team: this.kickoffTeam });
  }

  // ------------------------------------------------------------ main tick
  /** Avança um tick (1/60 s). Retorna a lista de eventos do tick. */
  tick() {
    // Descarta só os eventos já entregues; eventos gerados fora do tick
    // (start/stop/pausa) são entregues no próximo retorno.
    if (this._delivered) { this.events.splice(0, this._delivered); this._delivered = 0; }
    if (this.phase === 'lobby' || this.paused) { this._delivered = this.events.length; return this.events; }
    this.tickCount++;
    this.phaseTicks++;
    const ph = this.phase;

    if ((ph === 'kickoff' || ph === 'playing') && !this.canPlay()) {
      this._setPhase('waiting');
      this._delivered = this.events.length;
      return this.events;
    }

    switch (ph) {
      case 'waiting':
        if (this.canPlay()) {
          if (this.settings.countdown) { this.resetPositions(); this._setPhase('countdown'); }
          else this._beginKickoff();
          break;
        }
        this._simulate(false);
        // Aquecimento: bola nunca fica dentro do gol.
        if (Math.abs(this.ball.x) > this.geo.W + this.ball.r) this._resetBall();
        break;
      case 'countdown': {
        const total = this.cfg.match.countdownTicks;
        if (this.phaseTicks === 1 || this.phaseTicks % TICK_RATE === 1) {
          const n = Math.ceil((total - this.phaseTicks + 1) / TICK_RATE);
          if (n > 0) this.events.push({ type: 'count', n });
        }
        if (this.phaseTicks >= total) this._beginKickoff();
        break;
      }
      case 'kickoff':
        this._simulate(true);
        if (this.phase === 'kickoff') {
          const b = this.ball;
          if (this.touchHistory.length && this.touchHistory[this.touchHistory.length - 1].tick === this.tickCount) this._setPhase('playing');
          else if (b.x * b.x + b.y * b.y > 4) this._setPhase('playing');
        }
        break;
      case 'playing':
        this._simulate(true);
        if (this.phase === 'playing') {
          this.clockTicks++;
          for (const p of this.players.values()) if (p.team !== 'spec') p.stats.ticksPlayed++;
          this._checkTime();
        }
        break;
      case 'goal':
        this._simulate(false);
        if (this.phaseTicks >= this.cfg.match.goalCelebrationTicks) {
          if (this.pendingEnd) this._end(this.pendingEnd);
          else this._beginKickoff();
        }
        break;
      case 'ended':
        this._simulate(false);
        break;
      default:
        break;
    }
    this._delivered = this.events.length;
    return this.events;
  }

  _resetBall() {
    const b = this.ball;
    b.x = 0; b.y = 0; b.vx = 0; b.vy = 0; b.px = 0; b.py = 0; b.invalid = false;
  }

  _simulate(goalsCount) {
    const ball = this.ball;
    const cfg = this.cfg;
    // 1) Entradas: aceleração e chutes.
    for (const p of this.players.values()) {
      const b = p.body;
      if (!b) continue;
      const bits = p.input;
      const kickHeld = (bits & IN_KICK) !== 0;
      if (kickHeld && !p.prevKick) p.kickArmed = true;
      if (!kickHeld) p.kickArmed = false;
      p.kicking = kickHeld;
      applyMovementInput(b, bits, cfg);
      if (p.kickCooldown > 0) p.kickCooldown--;
      if (kickHeld && p.kickCooldown === 0 && (this.settings.kickMode === 'repeat' || p.kickArmed)) {
        this._tryKick(p);
      }
      p.prevKick = kickHeld;
    }

    // 2) Física.
    const preVx = ball.vx, preVy = ball.vy;
    this.world.step();
    if (ball.invalid) {
      ball.invalid = false;
      this.events.push({ type: 'ballReset' });
      this._resetBall();
    }
    for (const b of this.world.bodies) b.invalid = false;

    // 3) Toques e impactos.
    for (const body of this.world.ballTouches) this._registerTouch(body.owner, preVx, preVy);
    let strongest = null;
    for (const im of this.world.impacts) if (!strongest || im.speed > strongest.speed) strongest = im;
    if (strongest) this.events.push({ type: 'impact', kind: strongest.type, speed: Math.round(strongest.speed * 100) / 100 });

    // 4) Gol.
    if (goalsCount) this._checkGoal();
  }

  _tryKick(p) {
    const b = p.body;
    const ball = this.ball;
    const dx = ball.x - b.x;
    const dy = ball.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d - b.r - ball.r > this.cfg.kick.range) return false; // impede chute remoto
    const nx = d > 1e-6 ? dx / d : 1;
    const ny = d > 1e-6 ? dy / d : 0;
    const preVx = ball.vx, preVy = ball.vy;
    ball.vx += nx * this.cfg.kick.strength * ball.invMass;
    ball.vy += ny * this.cfg.kick.strength * ball.invMass;
    if (this.cfg.kick.kickback) {
      b.vx -= nx * this.cfg.kick.kickback * b.invMass;
      b.vy -= ny * this.cfg.kick.kickback * b.invMass;
    }
    p.kickCooldown = this.settings.kickCooldown;
    p.kickArmed = false;
    p.stats.kicks++;
    this.events.push({ type: 'kick', id: p.id });
    this._registerTouch(p, preVx, preVy);
    return true;
  }

  _registerTouch(p, bvx, bvy) {
    if (!p || p.team === 'spec') return;
    const hist = this.touchHistory;
    const last = hist.length ? hist[hist.length - 1] : null;
    if (last && last.id === p.id && this.tickCount - last.tick < 2) { last.tick = this.tickCount; return; }
    p.stats.touches++;
    // Recuperação: tomou a bola do adversário com o jogador em movimento (não conta rebote em quem está parado).
    const moving = p.body && p.body.vx * p.body.vx + p.body.vy * p.body.vy > 0.5;
    if (last && last.team !== p.team && this.phase === 'playing' && moving) p.stats.steals++;
    // Defesa: bola vinha em direção ao próprio gol, dentro da abertura.
    const side = SIDE[p.team];
    const lineX = side * this.geo.W;
    const ball = this.ball;
    if (side * bvx > 1.5 && Math.abs(lineX - ball.x) < 260) {
      const t = (lineX - ball.x) / bvx;
      const yAt = ball.y + bvy * t;
      if (t > 0 && Math.abs(yAt) < this.geo.G + ball.r) p.stats.saves++;
    }
    if (last && last.id === p.id) last.tick = this.tickCount;
    else hist.push({ id: p.id, team: p.team, tick: this.tickCount });
    if (hist.length > 8) hist.shift();
  }

  _checkGoal() {
    const b = this.ball;
    const geo = this.geo;
    for (const team of TEAMS) {
      const side = SIDE[team];              // gol defendido por `team`
      const plane = side * (geo.W + b.r);   // bola inteira além da linha
      const crossed = side < 0 ? (b.x < plane && b.px >= plane) : (b.x > plane && b.px <= plane);
      if (crossed && Math.abs(b.y) < geo.G) {
        this._goal(OTHER[team]);
        return;
      }
    }
  }

  _goal(scoringTeam) {
    if (this.phase !== 'playing' && this.phase !== 'kickoff') return; // nunca gol duplo
    this.score[scoringTeam]++;
    const hist = this.touchHistory;
    const lastT = hist.length ? hist[hist.length - 1] : null;
    let scorer = null, assist = null, ownGoal = false;
    if (lastT) {
      const sp = this.players.get(lastT.id);
      scorer = lastT.id;
      ownGoal = lastT.team !== scoringTeam;
      if (sp) { if (ownGoal) sp.stats.ownGoals++; else sp.stats.goals++; }
      if (!ownGoal) {
        for (let i = hist.length - 2; i >= 0; i--) {
          const h = hist[i];
          if (h.id === lastT.id) continue;
          if (h.team === scoringTeam && this.tickCount - h.tick <= this.cfg.match.assistWindowTicks) {
            assist = h.id;
            const ap = this.players.get(h.id);
            if (ap) ap.stats.assists++;
          }
          break;
        }
      }
    }
    this.lastGoal = { team: scoringTeam, scorer, assist, ownGoal, tick: this.tickCount, clock: this.clockTicks };
    this.touchHistory.length = 0;
    this.kickoffTeam = OTHER[scoringTeam];
    this._setPhase('goal');
    this.events.push({ type: 'goal', team: scoringTeam, scorer, assist, ownGoal, score: { ...this.score } });
    const lim = this.settings.scoreLimit;
    if (this.overtime || (lim > 0 && this.score[scoringTeam] >= lim)) this.pendingEnd = scoringTeam;
  }

  _checkTime() {
    const limit = this.settings.timeLimit * 60 * TICK_RATE;
    if (limit <= 0 || this.overtime || this.clockTicks < limit) return;
    const { red, blue } = this.score;
    if (red !== blue) this._end(red > blue ? 'red' : 'blue');
    else if (this.settings.overtime === 'golden') {
      this.overtime = true;
      this.events.push({ type: 'overtime' });
    } else this._end('draw');
  }

  _end(winner) {
    this.winner = winner;
    this.pendingEnd = null;
    this._setPhase('ended');
    this.events.push({ type: 'end', winner, score: { ...this.score } });
  }

  // -------------------------------------------------- kickoff constraints
  _kickoffConstraint(b) {
    if (this.phase !== 'kickoff') return;
    const p = b.owner;
    if (!p || p.team === 'spec') return;
    kickoffConstraint(b, p.team, this.kickoffTeam, this.geo.kickoffRadius);
  }

  // ------------------------------------------------------ serialization
  /** Estado compacto para rede/replay. */
  snapshot() {
    const r2 = (v) => Math.round(v * 100) / 100;
    const b = this.ball;
    const players = [];
    for (const p of this.players.values()) {
      if (!p.body) continue;
      const pb = p.body;
      players.push([p.id, r2(pb.x), r2(pb.y), r2(pb.vx), r2(pb.vy), p.kicking ? 1 : 0]);
    }
    return {
      tick: this.tickCount,
      ph: this.phase,
      pa: this.paused ? 1 : 0,
      sc: [this.score.red, this.score.blue],
      cl: this.clockTicks,
      ot: this.overtime ? 1 : 0,
      kt: this.kickoffTeam,
      pt: this.phaseTicks,
      b: [r2(b.x), r2(b.y), r2(b.vx), r2(b.vy)],
      p: players,
    };
  }

  statsTable() {
    const rows = [];
    for (const p of this.players.values()) {
      rows.push({ id: p.id, name: p.name, team: p.team, isBot: p.isBot, ...p.stats, seconds: Math.round(p.stats.ticksPlayed / TICK_RATE) });
    }
    return rows;
  }
}
