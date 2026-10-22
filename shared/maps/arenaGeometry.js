import { CG_BALL, CG_PLAYER, CG_ALL, physicsConfig } from '../config/physicsConfig.js';
import { makeSegment } from '../physics/Collision.js';

export const MASKS = { ball: CG_BALL, player: CG_PLAYER, all: CG_ALL };

/**
 * Converte a definição declarativa da arena em geometria física e dados de
 * regras (linhas de gol, aberturas, limites, spawns).
 */
export function buildArenaGeometry(def, cfg = physicsConfig) {
  const W = def.width / 2;
  const H = def.height / 2;
  const G = def.goal.width / 2;
  const D = def.goal.depth;
  const pr = def.goal.postRadius;
  const M = def.margin;
  const wallB = cfg.wall.bounce;
  const segments = [];
  const statics = [];

  // Linhas do campo: só a bola colide (jogadores podem sair um pouco do campo).
  segments.push(makeSegment(-W, -H, W, -H, CG_BALL, wallB, 'line'));
  segments.push(makeSegment(-W, H, W, H, CG_BALL, wallB, 'line'));
  for (const s of [-1, 1]) {
    segments.push(makeSegment(s * W, -H, s * W, -G, CG_BALL, wallB, 'line'));
    segments.push(makeSegment(s * W, G, s * W, H, CG_BALL, wallB, 'line'));
    // Rede do gol: colide com todos.
    segments.push(makeSegment(s * W, -G, s * (W + D), -G, CG_ALL, 0.5, 'net'));
    segments.push(makeSegment(s * (W + D), -G, s * (W + D), G, CG_ALL, 0.4, 'net'));
    segments.push(makeSegment(s * (W + D), G, s * W, G, CG_ALL, 0.5, 'net'));
    // Traves.
    statics.push({ x: s * W, y: -G, r: pr, mask: CG_ALL, bounce: cfg.wall.postBounce * 2, tag: 'post' });
    statics.push({ x: s * W, y: G, r: pr, mask: CG_ALL, bounce: cfg.wall.postBounce * 2, tag: 'post' });
  }
  // Limite externo para jogadores.
  const PX = W + M;
  const PY = H + M;
  segments.push(makeSegment(-PX, -PY, PX, -PY, CG_PLAYER, 0.5, 'bound'));
  segments.push(makeSegment(PX, -PY, PX, PY, CG_PLAYER, 0.5, 'bound'));
  segments.push(makeSegment(PX, PY, -PX, PY, CG_PLAYER, 0.5, 'bound'));
  segments.push(makeSegment(-PX, PY, -PX, -PY, CG_PLAYER, 0.5, 'bound'));

  for (const o of def.obstacles || []) {
    const mask = MASKS[o.mask] ?? CG_ALL;
    const bounce = Number.isFinite(o.bounce) ? o.bounce : 1;
    if (o.type === 'segment') {
      segments.push(makeSegment(o.a[0], o.a[1], o.b[0], o.b[1], mask, bounce, 'obstacle'));
    } else if (o.type === 'disc') {
      statics.push({ x: o.p[0], y: o.p[1], r: o.r, mask, bounce, tag: 'obstacle' });
    }
  }

  const ext = Math.max(PX, W + D) + 40;
  const extY = PY + 40;
  return {
    def,
    W, H, G, D, M, postRadius: pr,
    kickoffRadius: def.kickoffRadius,
    segments,
    statics,
    bounds: { minX: -ext, maxX: ext, minY: -extY, maxY: extY },
    /** Retângulo visível recomendado para a câmera (unidades do mundo). */
    view: { halfW: Math.max(PX, W + D) + 10, halfH: PY + 10 },
    spawns: def.spawns,
    goals: {
      red: { x: -W, side: -1 },   // gol defendido pelo vermelho (esquerda)
      blue: { x: W, side: 1 },
    },
  };
}
