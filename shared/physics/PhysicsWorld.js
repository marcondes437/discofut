import { physicsConfig, CG_BALL, CG_PLAYER } from '../config/physicsConfig.js';
import { collideDiscDisc, collideDiscStatic, collideDiscSegment } from './Collision.js';

/**
 * Cria um corpo circular. kind: 'ball' | 'player'.
 * px/py guardam a posição do tick anterior (para renderização interpolada).
 */
export function createBody(kind, x = 0, y = 0, cfg = physicsConfig) {
  const c = kind === 'ball' ? cfg.ball : cfg.player;
  return {
    kind,
    id: null,
    x, y, vx: 0, vy: 0, px: x, py: y,
    r: c.radius,
    invMass: c.invMass,
    damping: c.damping,
    bounce: c.bounce,
    maxSpeed: c.maxSpeed,
    cg: kind === 'ball' ? CG_BALL : CG_PLAYER,
  };
}

/**
 * Mundo físico com corpos dinâmicos (bola + jogadores) e geometria estática
 * (segmentos e discos fixos), integrado com timestep fixo e subpassos.
 */
export class PhysicsWorld {
  /**
   * @param {{segments:any[], statics:any[], bounds:{minX:number,maxX:number,minY:number,maxY:number}}} geometry
   */
  constructor(geometry, cfg = physicsConfig) {
    this.cfg = cfg;
    this.segments = geometry.segments;
    this.statics = geometry.statics;
    this.bounds = geometry.bounds;
    /** @type {any[]} */
    this.bodies = [];
    this.ball = null;
    /** Restrição posicional opcional aplicada aos jogadores (barreira do kickoff). */
    this.playerConstraint = null;
    // Contatos do último passo (estruturas reutilizadas para evitar alocações).
    this.ballTouches = [];   // corpos de jogadores que tocaram a bola
    this.impacts = [];       // {type:'wall'|'post'|'player', speed}
    this.invalidBodies = 0;  // corpos corrigidos pelo failsafe no último passo
    this._impactPool = [];
  }

  addBody(body) {
    // Bola sempre na primeira posição para ordem de resolução estável.
    if (body.kind === 'ball') { this.ball = body; this.bodies.unshift(body); }
    else this.bodies.push(body);
    return body;
  }

  removeBody(body) {
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
    if (this.ball === body) this.ball = null;
  }

  _pushImpact(type, speed) {
    let o = this._impactPool[this.impacts.length];
    if (!o) { o = { type: '', speed: 0 }; this._impactPool.push(o); }
    o.type = type; o.speed = speed;
    this.impacts.push(o);
  }

  _touch(player) {
    if (this.ballTouches.indexOf(player) < 0) this.ballTouches.push(player);
  }

  /** Avança a simulação em exatamente um tick. */
  step() {
    const bodies = this.bodies;
    const n = bodies.length;
    const solver = this.cfg.solver;
    this.ballTouches.length = 0;
    this.impacts.length = 0;
    this.invalidBodies = 0;

    let maxV = 0;
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      b.px = b.x; b.py = b.y;
      const v = Math.abs(b.vx) + Math.abs(b.vy);
      if (v > maxV) maxV = v;
    }
    let sub = Math.ceil(maxV / solver.maxSubstepTravel);
    if (sub < 1) sub = 1; else if (sub > solver.maxSubsteps) sub = solver.maxSubsteps;
    const inv = 1 / sub;

    for (let s = 0; s < sub; s++) {
      for (let i = 0; i < n; i++) {
        const b = bodies[i];
        b.x += b.vx * inv;
        b.y += b.vy * inv;
      }
      for (let it = 0; it < solver.iterations; it++) {
        const record = it === 0;
        // Disco-disco (jogador-bola e jogador-jogador).
        for (let i = 0; i < n; i++) {
          const a = bodies[i];
          for (let j = i + 1; j < n; j++) {
            const b = bodies[j];
            const rv = collideDiscDisc(a, b);
            if (rv < 0) continue;
            if (a.kind === 'ball') this._touch(b);
            else if (b.kind === 'ball') this._touch(a);
            if (record && rv > 0.4) this._pushImpact(a.kind === 'ball' || b.kind === 'ball' ? 'ball-player' : 'player', rv);
          }
        }
        // Disco vs geometria estática.
        for (let i = 0; i < n; i++) {
          const b = bodies[i];
          const statics = this.statics;
          for (let k = 0; k < statics.length; k++) {
            const st = statics[k];
            if ((st.mask & b.cg) === 0) continue;
            const rv = collideDiscStatic(b, st);
            if (record && rv > 0.4 && b.kind === 'ball') this._pushImpact('post', rv);
          }
          const segs = this.segments;
          for (let k = 0; k < segs.length; k++) {
            const sg = segs[k];
            if ((sg.mask & b.cg) === 0) continue;
            const rv = collideDiscSegment(b, sg);
            if (record && rv > 0.4 && b.kind === 'ball') this._pushImpact(sg.tag === 'net' ? 'net' : 'wall', rv);
          }
          if (b.kind === 'player' && this.playerConstraint) this.playerConstraint(b);
        }
      }
    }

    // Amortecimento, limite de velocidade e failsafe.
    const bd = this.bounds;
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      b.vx *= b.damping;
      b.vy *= b.damping;
      const sp2 = b.vx * b.vx + b.vy * b.vy;
      if (sp2 > b.maxSpeed * b.maxSpeed) {
        const k = b.maxSpeed / Math.sqrt(sp2);
        b.vx *= k; b.vy *= k;
      }
      if (Math.abs(b.vx) < 1e-4) b.vx = 0;
      if (Math.abs(b.vy) < 1e-4) b.vy = 0;
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.vx) || !Number.isFinite(b.vy)) {
        b.x = 0; b.y = 0; b.vx = 0; b.vy = 0; b.px = 0; b.py = 0;
        b.invalid = true; this.invalidBodies++;
        continue;
      }
      if (b.x < bd.minX || b.x > bd.maxX || b.y < bd.minY || b.y > bd.maxY) {
        b.x = Math.min(bd.maxX, Math.max(bd.minX, b.x));
        b.y = Math.min(bd.maxY, Math.max(bd.minY, b.y));
        b.vx = 0; b.vy = 0;
        b.invalid = true; this.invalidBodies++;
      }
    }
  }
}
