import { IN_UP, IN_DOWN, IN_LEFT, IN_RIGHT, IN_KICK } from '../config/physicsConfig.js';
import { SIDE } from '../game/MatchController.js';
import { makeRng } from '../util/rng.js';

/**
 * Dificuldades variam reação, antecipação, precisão e frequência de decisão —
 * nunca velocidade: bots usam exatamente as mesmas entradas que humanos.
 */
export const BOT_DIFFICULTY = Object.freeze({
  easy: Object.freeze({ reaction: 20, anticipation: 0.3, aimError: 0.38, decisionEvery: 12, interceptSlack: 0.65, shootRange: 300 }),
  medium: Object.freeze({ reaction: 11, anticipation: 0.75, aimError: 0.17, decisionEvery: 6, interceptSlack: 0.82, shootRange: 420 }),
  hard: Object.freeze({ reaction: 6, anticipation: 1, aimError: 0.06, decisionEvery: 3, interceptSlack: 0.92, shootRange: 520 }),
});

const ROLES_BY_SIZE = {
  1: ['allround'],
  2: ['attacker', 'defender'],
  3: ['attacker', 'defender', 'keeper'],
  4: ['attacker', 'defender', 'keeper', 'attacker'],
};

const HISTORY = 32;

/**
 * Cérebro de um bot. Máquina de estados:
 * position → intercept → attack → shoot → recover/return, e defend (goleiro/zagueiro).
 * Lê apenas o estado público da partida (posições/velocidades), com atraso
 * de percepção que depende da dificuldade.
 */
export class BotBrain {
  constructor(id, difficulty = 'medium', seed = 1) {
    this.id = id;
    this.setDifficulty(difficulty);
    this.rng = makeRng(seed * 2654435761 + id);
    this.state = 'position';
    this.role = 'allround';
    this.target = { x: 0, y: 0 };
    this.wantKick = false;
    this.kickDir = null;
    this.releaseTicks = 0;
    this.aimY = 0;
    this.hist = new Float64Array(HISTORY * 4);
    this.histCount = 0;
    this.lastDecision = -999;
  }

  setDifficulty(d) {
    this.difficultyName = BOT_DIFFICULTY[d] ? d : 'medium';
    this.diff = BOT_DIFFICULTY[this.difficultyName];
  }

  _record(ball) {
    const i = (this.histCount % HISTORY) * 4;
    this.hist[i] = ball.x; this.hist[i + 1] = ball.y; this.hist[i + 2] = ball.vx; this.hist[i + 3] = ball.vy;
    this.histCount++;
  }

  /** Bola percebida: estado de `reaction` ticks atrás, extrapolado parcialmente. */
  _perceive(geo) {
    const lag = Math.min(this.diff.reaction, this.histCount - 1, HISTORY - 1);
    const i = ((this.histCount - 1 - lag) % HISTORY) * 4;
    const out = { x: this.hist[i], y: this.hist[i + 1], vx: this.hist[i + 2], vy: this.hist[i + 3] };
    const ahead = Math.round(lag * this.diff.anticipation);
    return ahead > 0 ? this._predict(out, ahead, geo) : out;
  }

  /** Previsão simples da trajetória: amortecimento + reflexão nas linhas. */
  _predict(b, ticks, geo, damping = 0.988, r = 10) {
    let { x, y, vx, vy } = b;
    const ylim = geo.H - r;
    const xlim = geo.W - r;
    for (let t = 0; t < ticks; t++) {
      x += vx; y += vy;
      if (y > ylim) { y = 2 * ylim - y; vy = -vy * 0.5; }
      else if (y < -ylim) { y = -2 * ylim - y; vy = -vy * 0.5; }
      if (Math.abs(y) > geo.G) {
        if (x > xlim) { x = 2 * xlim - x; vx = -vx * 0.5; }
        else if (x < -xlim) { x = -2 * xlim - x; vx = -vx * 0.5; }
      }
      vx *= damping; vy *= damping;
    }
    return { x, y, vx, vy };
  }

  _assignRole(match, me) {
    const mates = match.teamPlayers(me.team);
    const roles = ROLES_BY_SIZE[Math.min(4, mates.length)] || ROLES_BY_SIZE[1];
    const humans = mates.filter((p) => !p.isBot).length;
    const bots = mates.filter((p) => p.isBot).sort((a, b) => a.id - b.id);
    const idx = humans + bots.indexOf(me);
    this.role = roles[Math.min(idx, roles.length - 1)];
  }

  /** Calcula os bits de entrada deste tick. */
  update(match) {
    const me = match.players.get(this.id);
    if (!me || !me.body) return 0;
    const geo = match.geo;
    const ball = match.ball;
    this._record(ball);
    const phase = match.phase;
    if (match.paused || phase === 'countdown' || phase === 'lobby') return 0;

    const body = me.body;
    const s = SIDE[me.team];        // lado do próprio gol
    const att = -s;                 // direção de ataque (x)
    const now = match.tickCount;

    if (now - this.lastDecision >= this.diff.decisionEvery) {
      this.lastDecision = now;
      this._assignRole(match, me);
      this._decide(match, me, geo, s, att);
    }

    // Execução contínua: segue o alvo e decide o chute com dados atuais percebidos.
    let bits = this._steer(body, this.target);
    const pb = this._perceive(geo);
    const dist = Math.hypot(pb.x - body.x, pb.y - body.y) - body.r - ball.r;
    let kick = false;
    if (this.wantKick && dist < match.cfg.kick.range + 2) {
      const dx = pb.x - body.x, dy = pb.y - body.y;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d, uy = dy / d;
      const dir = this.kickDir;
      const align = dir ? ux * dir.x + uy * dir.y : 1;
      if (align > 0.82 || (this.state === 'clear' && ux * att > -0.1)) kick = true;
    }
    // Bola prensada na parede: chuta se a direção não for contra o próprio campo.
    if (!kick && dist < match.cfg.kick.range + 1) {
      const nearWall = Math.abs(pb.y) > geo.H - 32 || (Math.abs(pb.x) > geo.W - 32 && Math.abs(pb.y) > geo.G);
      if (nearWall) {
        const dx = pb.x - body.x, dy = pb.y - body.y;
        const d = Math.hypot(dx, dy) || 1;
        if ((dx / d) * att > 0.15) kick = true;
      }
    }
    // Política de chute "press": soltar a tecla depois de cada chute.
    if (this.releaseTicks > 0) { this.releaseTicks--; kick = false; }
    if (kick && match.settings.kickMode === 'press' && me.prevKick && !me.kickArmed) {
      kick = false;
      this.releaseTicks = 2;
    }
    if (kick) bits |= IN_KICK;
    return bits;
  }

  _decide(match, me, geo, s, att) {
    const body = me.body;
    const pb = this._perceive(geo);
    const ownGoalX = s * geo.W;
    const phase = match.phase;
    this.wantKick = false;
    this.kickDir = null;

    // Kickoff: só o time que sai vai à bola.
    if (phase === 'kickoff') {
      const isKickTeam = match.kickoffTeam === me.team;
      const first = this._closestTeammateToBall(match, me, pb) === me;
      if (isKickTeam && first) { this._attack(match, me, geo, pb, s, att, true); return; }
      this.state = 'position';
      this._homePosition(match, me, geo, pb, s, att);
      return;
    }

    if (phase === 'goal' || phase === 'ended') {
      this.state = 'return';
      this._homePosition(match, me, geo, pb, s, att);
      return;
    }

    const myDist = Math.hypot(pb.x - body.x, pb.y - body.y);
    const closest = this._closestTeammateToBall(match, me, pb) === me;
    const ballInOwnHalf = s * pb.x > -40;
    const dangerous = Math.abs(pb.x - ownGoalX) < 200 && Math.abs(pb.y) < geo.G + 80;
    const towardOwn = s * pb.vx > 1;

    switch (this.role) {
      case 'keeper': {
        if (dangerous && (myDist < 140 || closest)) { this._clear(match, me, geo, pb, s, att); return; }
        this.state = 'defend';
        const kx = s * (geo.W - 32);
        let ty = pb.y * 0.55;
        if (towardOwn && Math.abs(pb.vx) > 0.5) {
          const t = (kx - pb.x) / pb.vx;
          if (t > 0 && t < 120) ty = this._predict(pb, Math.round(t), geo).y;
        }
        ty = Math.max(-geo.G + 6, Math.min(geo.G - 6, ty));
        this.target = { x: kx, y: ty };
        return;
      }
      case 'defender': {
        if ((ballInOwnHalf && closest) || (dangerous && myDist < 160)) {
          if (dangerous) this._clear(match, me, geo, pb, s, att);
          else this._attack(match, me, geo, pb, s, att, false);
          return;
        }
        this.state = 'position';
        const gx = ownGoalX, gy = 0;
        const f = 0.38;
        let tx = gx + (pb.x - gx) * f;
        const ty = (pb.y - gy) * f;
        if (s * tx < 40) tx = s * 40;
        this.target = { x: tx, y: ty };
        return;
      }
      case 'attacker': {
        if (closest || !ballInOwnHalf || myDist < 120) { this._attack(match, me, geo, pb, s, att, false); return; }
        this.state = 'recover';
        this.target = { x: pb.x + att * 90, y: pb.y * 0.6 };
        return;
      }
      default: { // allround (sozinho no time)
        if (dangerous && towardOwn && s * (body.x - pb.x) < 0) {
          // Bola indo para o gol e eu à frente dela: volta para defender.
          this.state = 'defend';
          const p = this._predict(pb, 20, geo);
          this.target = { x: (p.x + ownGoalX) / 2, y: p.y * 0.6 };
          return;
        }
        if (dangerous) { this._clear(match, me, geo, pb, s, att); return; }
        this._attack(match, me, geo, pb, s, att, false);
      }
    }
  }

  _closestTeammateToBall(match, me, pb) {
    let best = null, bd = Infinity;
    for (const p of match.teamPlayers(me.team)) {
      if (!p.body) continue;
      const d = Math.hypot(p.body.x - pb.x, p.body.y - pb.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  _interceptPoint(body, pb, geo) {
    const speed = 2.4 * this.diff.interceptSlack;
    for (let t = 0; t <= 90; t += 3) {
      const p = t === 0 ? pb : this._predict(pb, t, geo);
      const d = Math.hypot(p.x - body.x, p.y - body.y) - body.r - 10;
      if (d <= speed * t) return p;
    }
    return this._predict(pb, 90, geo);
  }

  _homePosition(match, me, geo, pb, s, att) {
    const idx = match.teamPlayers(me.team).indexOf(me);
    const sp = geo.spawns[me.team][Math.max(0, idx) % geo.spawns[me.team].length];
    this.target = { x: sp[0], y: sp[1] };
  }

  /** Ataque: ir para trás da bola alinhado ao gol adversário e chutar. */
  _attack(match, me, geo, pb, s, att, kickoff) {
    const body = me.body;
    const ip = kickoff ? pb : this._interceptPoint(body, pb, geo);
    const goalX = att * (geo.W + 10);
    // Mira no canto oposto ao goleiro adversário mais próximo do gol.
    let keeperY = 0, kd = Infinity;
    for (const p of match.players.values()) {
      if (p.team === me.team || p.team === 'spec' || !p.body) continue;
      const d = Math.abs(p.body.x - goalX);
      if (d < kd) { kd = d; keeperY = p.body.y; }
    }
    const err = (this.rng() * 2 - 1) * this.diff.aimError;
    const corner = geo.G * 0.55 * (keeperY > 0 ? -1 : 1);
    this.aimY = kd < 120 ? corner : corner * 0.4;
    let ux = goalX - ip.x, uy = this.aimY - ip.y;
    let ul = Math.hypot(ux, uy) || 1;
    ux /= ul; uy /= ul;
    const c = Math.cos(err), sn = Math.sin(err);
    const rx = ux * c - uy * sn, ry = ux * sn + uy * c;
    const dirToGoal = { x: rx, y: ry };
    const behindDist = body.r + 10 + 2;
    const behind = { x: ip.x - rx * behindDist, y: ip.y - ry * behindDist };
    const toBallX = ip.x - body.x, toBallY = ip.y - body.y;
    const tbl = Math.hypot(toBallX, toBallY) || 1;
    const aligned = (toBallX / tbl) * rx + (toBallY / tbl) * ry;
    const ahead = att * (body.x - ip.x) > -4; // estou entre a bola e o gol adversário
    if (ahead && aligned < 0.3 && tbl < 110) {
      // Contorna a bola para não empurrá-la contra o próprio gol.
      const sideSign = body.y >= ip.y ? 1 : -1;
      this.state = 'recover';
      this.target = { x: ip.x - att * (behindDist + 6), y: ip.y + sideSign * (behindDist + 22) };
      return;
    }
    const distGoal = Math.hypot(goalX - ip.x, this.aimY - ip.y);
    if (aligned > 0.8) {
      // Alinhado: avança através da bola (condução) e chuta se estiver em alcance de finalização.
      this.state = distGoal < this.diff.shootRange || kickoff ? 'shoot' : 'attack';
      this.target = { x: ip.x + rx * 30, y: ip.y + ry * 30 };
      if (this.state === 'shoot') { this.wantKick = true; this.kickDir = dirToGoal; }
      return;
    }
    this.state = 'intercept';
    this.target = behind;
  }

  /** Afasta a bola da área de perigo (chute em direção ao campo adversário). */
  _clear(match, me, geo, pb, s, att) {
    const body = me.body;
    const ip = this._interceptPoint(body, pb, geo);
    this.state = 'clear';
    // Aproxima pelo lado do próprio gol.
    const bx = ip.x - att * (body.r + 8);
    this.target = { x: bx, y: ip.y + (ip.y > body.y ? -3 : 3) };
    const dx = ip.x - body.x, dy = ip.y - body.y;
    if (Math.hypot(dx, dy) < 60) this.target = { x: ip.x + att * 20, y: ip.y };
    this.wantKick = true;
    this.kickDir = { x: att, y: 0 };
  }

  /** Converte alvo em teclas (8 direções), com antecipação de frenagem. */
  _steer(body, target) {
    const k = 12; // ticks de "olhar adiante" para frear antes do alvo
    const ex = target.x - (body.x + body.vx * k);
    const ey = target.y - (body.y + body.vy * k);
    const ax = Math.abs(ex), ay = Math.abs(ey);
    const dead = 3;
    let bits = 0;
    if (ax > dead && ax >= ay * 0.42) bits |= ex > 0 ? IN_RIGHT : IN_LEFT;
    if (ay > dead && ay >= ax * 0.42) bits |= ey > 0 ? IN_DOWN : IN_UP;
    return bits;
  }
}

/** Gerencia vários bots de uma partida. */
export class BotManager {
  constructor() { this.brains = new Map(); this.seed = 7; }
  add(id, difficulty) { this.brains.set(id, new BotBrain(id, difficulty, this.seed++)); }
  remove(id) { this.brains.delete(id); }
  has(id) { return this.brains.has(id); }
  setDifficulty(id, d) { const b = this.brains.get(id); if (b) b.setDifficulty(d); }
  /** Aplica entradas de todos os bots antes do tick da partida. */
  apply(match) {
    for (const [id, brain] of this.brains) match.setInput(id, brain.update(match));
  }
}
