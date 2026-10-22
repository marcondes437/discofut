import { ARENA_FORMAT, ARENA_VERSION } from './arenas.js';
import { physicsConfig } from '../config/physicsConfig.js';

export const ARENA_LIMITS = Object.freeze({
  maxJsonBytes: 64 * 1024,
  width: [300, 2400],
  height: [200, 1400],
  goalDepth: [25, 120],
  postRadius: [3, 20],
  margin: [0, 200],
  maxSpawnsPerTeam: 8,
  maxObstacles: 64,
  discRadius: [2, 150],
  bounce: [0, 2],
  nameLength: [1, 40],
});

const HEX = /^#[0-9a-fA-F]{6}$/;
const MASK_VALUES = ['all', 'ball', 'player'];

function num(v) { return typeof v === 'number' && Number.isFinite(v); }
function inRange(v, [a, b]) { return num(v) && v >= a && v <= b; }
function point(p) { return Array.isArray(p) && p.length === 2 && num(p[0]) && num(p[1]); }
function round2(v) { return Math.round(v * 100) / 100; }

export function sanitizeName(s, max = 40) {
  if (typeof s !== 'string') return '';
  // Remove caracteres de controle e sinais de marcação HTML.
  return s.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
}

function segDistToPoint(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy || 1e-9;
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + dx * t - px, ay + dy * t - py);
}

/**
 * Valida e normaliza uma arena. Aceita objeto ou string JSON.
 * Retorna {ok:true, arena} ou {ok:false, errors:[...]}.
 * Nunca lança exceção para entradas malformadas.
 */
export function validateArena(input) {
  const errors = [];
  let raw = input;
  if (typeof input === 'string') {
    if (input.length > ARENA_LIMITS.maxJsonBytes) return { ok: false, errors: ['Arquivo grande demais (máx. 64 KB).'] };
    try { raw = JSON.parse(input); } catch { return { ok: false, errors: ['JSON inválido.'] }; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['Arena deve ser um objeto JSON.'] };
  try {
    if (JSON.stringify(raw).length > ARENA_LIMITS.maxJsonBytes) return { ok: false, errors: ['Arena grande demais (máx. 64 KB).'] };
  } catch { return { ok: false, errors: ['Arena não serializável.'] }; }

  if (raw.format !== ARENA_FORMAT) errors.push(`Campo "format" deve ser "${ARENA_FORMAT}".`);
  if (raw.version !== ARENA_VERSION) errors.push(`Versão suportada: ${ARENA_VERSION}.`);
  const name = sanitizeName(raw.name, ARENA_LIMITS.nameLength[1]);
  if (name.length < 1) errors.push('Nome da arena é obrigatório.');
  if (!inRange(raw.width, ARENA_LIMITS.width)) errors.push(`Largura deve estar entre ${ARENA_LIMITS.width.join(' e ')}.`);
  if (!inRange(raw.height, ARENA_LIMITS.height)) errors.push(`Altura deve estar entre ${ARENA_LIMITS.height.join(' e ')}.`);
  const goal = raw.goal || {};
  const ballR = physicsConfig.ball.radius;
  const playerR = physicsConfig.player.radius;
  if (!num(goal.width)) errors.push('Largura do gol inválida.');
  if (!inRange(goal.depth, ARENA_LIMITS.goalDepth)) errors.push(`Profundidade do gol deve estar entre ${ARENA_LIMITS.goalDepth.join(' e ')}.`);
  if (!inRange(goal.postRadius, ARENA_LIMITS.postRadius)) errors.push(`Raio da trave deve estar entre ${ARENA_LIMITS.postRadius.join(' e ')}.`);
  if (!inRange(raw.margin, ARENA_LIMITS.margin)) errors.push(`Margem externa deve estar entre ${ARENA_LIMITS.margin.join(' e ')}.`);
  if (errors.length) return { ok: false, errors };

  const W = raw.width / 2, H = raw.height / 2;
  if (goal.width < 2 * (ballR + goal.postRadius) + 20) errors.push('Gol estreito demais para a bola passar.');
  if (goal.width > raw.height - 40) errors.push('Gol mais largo que o campo permite.');
  if (goal.depth < 2.5 * ballR) errors.push('Gol raso demais para a bola cruzar a linha.');
  const kr = raw.kickoffRadius;
  if (!num(kr) || kr < 30 || kr > Math.min(W, H) - 10) errors.push('Raio do círculo central inválido.');

  const spawns = raw.spawns || {};
  const out = { red: [], blue: [] };
  for (const team of ['red', 'blue']) {
    const list = spawns[team];
    if (!Array.isArray(list) || list.length < 1 || list.length > ARENA_LIMITS.maxSpawnsPerTeam) {
      errors.push(`Spawns do time ${team === 'red' ? 'vermelho' : 'azul'}: informe de 1 a ${ARENA_LIMITS.maxSpawnsPerTeam} pontos.`);
      continue;
    }
    list.forEach((p, i) => {
      if (!point(p)) { errors.push(`Spawn ${team} #${i + 1} inválido.`); return; }
      const [x, y] = p;
      const sideOk = team === 'red' ? x <= -playerR : x >= playerR;
      if (!sideOk) errors.push(`Spawn ${team} #${i + 1} precisa estar no próprio campo.`);
      if (Math.abs(x) > W - playerR || Math.abs(y) > H - playerR) errors.push(`Spawn ${team} #${i + 1} fora do campo.`);
      if (num(kr) && Math.hypot(x, y) < kr + playerR) errors.push(`Spawn ${team} #${i + 1} dentro do círculo central.`);
      out[team].push([round2(x), round2(y)]);
    });
  }

  const colors = {};
  const rc = raw.colors || {};
  for (const k of ['grass', 'grassAlt', 'lines', 'net', 'border']) {
    if (rc[k] === undefined) continue;
    if (typeof rc[k] !== 'string' || !HEX.test(rc[k])) errors.push(`Cor "${k}" deve estar no formato #rrggbb.`);
    else colors[k] = rc[k];
  }

  const obstacles = [];
  const obs = raw.obstacles === undefined ? [] : raw.obstacles;
  const lim = { x: W + goal.depth + raw.margin + 40, y: H + raw.margin + 40 };
  if (!Array.isArray(obs)) errors.push('"obstacles" deve ser uma lista.');
  else if (obs.length > ARENA_LIMITS.maxObstacles) errors.push(`Máximo de ${ARENA_LIMITS.maxObstacles} obstáculos.`);
  else {
    obs.forEach((o, i) => {
      if (!o || typeof o !== 'object') { errors.push(`Obstáculo #${i + 1} inválido.`); return; }
      const mask = o.mask === undefined ? 'all' : o.mask;
      if (!MASK_VALUES.includes(mask)) { errors.push(`Obstáculo #${i + 1}: máscara inválida.`); return; }
      const bounce = o.bounce === undefined ? 1 : o.bounce;
      if (!inRange(bounce, ARENA_LIMITS.bounce)) { errors.push(`Obstáculo #${i + 1}: elasticidade entre 0 e 2.`); return; }
      const inside = (p) => Math.abs(p[0]) <= lim.x && Math.abs(p[1]) <= lim.y;
      if (o.type === 'segment') {
        if (!point(o.a) || !point(o.b) || !inside(o.a) || !inside(o.b)) { errors.push(`Obstáculo #${i + 1}: pontos inválidos ou fora da arena.`); return; }
        if (Math.hypot(o.a[0] - o.b[0], o.a[1] - o.b[1]) < 2) { errors.push(`Obstáculo #${i + 1}: segmento curto demais.`); return; }
        if (segDistToPoint(o.a[0], o.a[1], o.b[0], o.b[1], 0, 0) < ballR + 2 && mask !== 'player') errors.push(`Obstáculo #${i + 1} bloqueia o centro (saída de bola).`);
        obstacles.push({ type: 'segment', a: o.a.map(round2), b: o.b.map(round2), mask, bounce });
      } else if (o.type === 'disc') {
        if (!point(o.p) || !inside(o.p)) { errors.push(`Obstáculo #${i + 1}: centro inválido.`); return; }
        if (!inRange(o.r, ARENA_LIMITS.discRadius)) { errors.push(`Obstáculo #${i + 1}: raio entre ${ARENA_LIMITS.discRadius.join(' e ')}.`); return; }
        if (Math.hypot(o.p[0], o.p[1]) < o.r + ballR + 2 && mask !== 'player') errors.push(`Obstáculo #${i + 1} bloqueia o centro (saída de bola).`);
        obstacles.push({ type: 'disc', p: o.p.map(round2), r: round2(o.r), mask, bounce });
      } else errors.push(`Obstáculo #${i + 1}: tipo deve ser "segment" ou "disc".`);
    });
  }
  // Spawns não podem nascer dentro de obstáculos que afetam jogadores.
  for (const team of ['red', 'blue']) {
    out[team].forEach(([x, y], i) => {
      for (const o of obstacles) {
        if (o.mask === 'ball') continue;
        const d = o.type === 'disc' ? Math.hypot(x - o.p[0], y - o.p[1]) - o.r : segDistToPoint(o.a[0], o.a[1], o.b[0], o.b[1], x, y);
        if (d < playerR + 1) { errors.push(`Spawn ${team} #${i + 1} sobreposto a um obstáculo.`); break; }
      }
    });
  }

  if (errors.length) return { ok: false, errors };
  let id = typeof raw.id === 'string' ? raw.id.replace(/[^a-z0-9_-]/gi, '').slice(0, 40) : '';
  if (!id) id = 'custom';
  return {
    ok: true,
    arena: {
      format: ARENA_FORMAT,
      version: ARENA_VERSION,
      id,
      name,
      width: round2(raw.width),
      height: round2(raw.height),
      goal: { width: round2(goal.width), depth: round2(goal.depth), postRadius: round2(goal.postRadius) },
      margin: round2(raw.margin),
      kickoffRadius: round2(kr),
      spawns: out,
      colors: {
        grass: '#3f8f4a', grassAlt: '#3a8544', lines: '#e9f3e6', net: '#d9e4d6', border: '#2e6b37',
        ...colors,
      },
      obstacles,
      experimental: obstacles.length > 0,
    },
  };
}
