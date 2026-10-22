// Arenas originais embutidas (formato declarativo próprio "discofut-arena" v1).
// Coordenadas em unidades do mundo com origem no centro do campo; o time
// vermelho defende o gol da esquerda (x negativo) e o azul o da direita.

export const ARENA_FORMAT = 'discofut-arena';
export const ARENA_VERSION = 1;

function mirror(points) {
  return points.map(([x, y]) => [-x, y]);
}

const DEFAULT_COLORS = {
  grass: '#3f8f4a',
  grassAlt: '#3a8544',
  lines: '#e9f3e6',
  net: '#d9e4d6',
  border: '#2e6b37',
};

function base(id, name, width, height, goalWidth, goalDepth, margin, kickoffRadius, redSpawns, extra = {}) {
  return {
    format: ARENA_FORMAT,
    version: ARENA_VERSION,
    id,
    name,
    width,
    height,
    goal: { width: goalWidth, depth: goalDepth, postRadius: 8 },
    margin,
    kickoffRadius,
    spawns: { red: redSpawns, blue: mirror(redSpawns) },
    colors: { ...DEFAULT_COLORS, ...(extra.colors || {}) },
    obstacles: extra.obstacles || [],
    experimental: !!extra.experimental,
  };
}

export const BUILTIN_ARENAS = [
  base('classic', 'Clássica', 760, 350, 140, 45, 50, 80,
    [[-150, 0], [-250, -95], [-250, 95], [-335, 0]]),
  base('compact', 'Compacta', 560, 260, 110, 40, 40, 60,
    [[-120, 0], [-190, -70], [-190, 70], [-245, 0]],
    { colors: { grass: '#3d8a5a', grassAlt: '#377f52', border: '#2b6343' } }),
  base('large', 'Grande', 1150, 520, 170, 50, 60, 100,
    [[-220, 0], [-380, -150], [-380, 150], [-510, 0]],
    { colors: { grass: '#468f43', grassAlt: '#40863d', border: '#326b30' } }),
  base('training', 'Treino', 760, 350, 140, 45, 50, 80,
    [[-150, 0], [-250, -95], [-250, 95], [-335, 0]],
    { colors: { grass: '#4b7f86', grassAlt: '#45767c', lines: '#eef6f7', border: '#35605f' } }),
  base('experimental', 'Experimental (obstáculos)', 820, 380, 140, 45, 50, 80,
    [[-160, 0], [-260, -100], [-260, 100], [-360, 0]],
    {
      experimental: true,
      colors: { grass: '#6b7f3c', grassAlt: '#637637', border: '#4b5a2a' },
      obstacles: [
        { type: 'disc', p: [0, -125], r: 16, mask: 'all', bounce: 0.9 },
        { type: 'disc', p: [0, 125], r: 16, mask: 'all', bounce: 0.9 },
        { type: 'segment', a: [-410, -150], b: [-370, -190], mask: 'ball', bounce: 1 },
        { type: 'segment', a: [-410, 150], b: [-370, 190], mask: 'ball', bounce: 1 },
        { type: 'segment', a: [410, -150], b: [370, -190], mask: 'ball', bounce: 1 },
        { type: 'segment', a: [410, 150], b: [370, 190], mask: 'ball', bounce: 1 },
        { type: 'segment', a: [-200, -60], b: [-200, 60], mask: 'all', bounce: 0.6 },
        { type: 'segment', a: [200, -60], b: [200, 60], mask: 'all', bounce: 0.6 },
      ],
    }),
];

export function getBuiltinArena(id) {
  const a = BUILTIN_ARENAS.find((x) => x.id === id);
  return a ? structuredCloneSafe(a) : null;
}

export function structuredCloneSafe(obj) {
  return JSON.parse(JSON.stringify(obj));
}
