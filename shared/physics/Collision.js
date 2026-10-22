// Rotinas de colisão para corpos circulares.
// Convenção: corpos têm {x, y, vx, vy, r, invMass, bounce}.
// As funções corrigem penetração (posição) e aplicam impulso apenas na normal.
// Retornam a velocidade relativa de aproximação (>0) quando houve impacto, 0 se
// houve só contato sem aproximação, ou -1 se não houve contato.

const EPS = 1e-9;

/** Colisão entre dois discos dinâmicos. */
export function collideDiscDisc(a, b) {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const rs = a.r + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rs * rs) return -1;
  const totalInv = a.invMass + b.invMass;
  if (totalInv <= 0) return -1;
  let d = Math.sqrt(d2);
  if (d < EPS) {
    // Centros coincidentes: separa numa direção determinística.
    dx = 1; dy = 0; d = 1;
    const overlap0 = rs;
    a.x -= overlap0 * (a.invMass / totalInv);
    b.x += overlap0 * (b.invMass / totalInv);
    return 0;
  }
  const nx = dx / d;
  const ny = dy / d;
  const overlap = rs - d;
  const ka = a.invMass / totalInv;
  const kb = b.invMass / totalInv;
  a.x -= nx * overlap * ka;
  a.y -= ny * overlap * ka;
  b.x += nx * overlap * kb;
  b.y += ny * overlap * kb;
  const rv = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny; // >0: aproximando
  if (rv <= 0) return 0;
  const e = a.bounce * b.bounce;
  const j = ((1 + e) * rv) / totalInv;
  a.vx -= nx * j * a.invMass;
  a.vy -= ny * j * a.invMass;
  b.vx += nx * j * b.invMass;
  b.vy += ny * j * b.invMass;
  return rv;
}

/** Colisão disco dinâmico vs disco estático (traves, pilares). */
export function collideDiscStatic(a, s) {
  const dx = a.x - s.x;
  const dy = a.y - s.y;
  const rs = a.r + s.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rs * rs) return -1;
  let d = Math.sqrt(d2);
  let nx, ny;
  if (d < EPS) { nx = 0; ny = -1; d = 0; } else { nx = dx / d; ny = dy / d; }
  const overlap = rs - d;
  a.x += nx * overlap;
  a.y += ny * overlap;
  const rv = -(a.vx * nx + a.vy * ny);
  if (rv <= 0) return 0;
  const e = a.bounce * s.bounce;
  const j = (1 + e) * rv;
  a.vx += nx * j;
  a.vy += ny * j;
  return rv;
}

/**
 * Colisão disco vs segmento estático (dupla face). O segmento deve ter
 * {ax, ay, bx, by, dx, dy, len2, bounce} pré-calculados (ver makeSegment).
 */
export function collideDiscSegment(a, s) {
  // Ponto mais próximo no segmento.
  let t = ((a.x - s.ax) * s.dx + (a.y - s.ay) * s.dy) / s.len2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const px = s.ax + s.dx * t;
  const py = s.ay + s.dy * t;
  const ox = a.x - px;
  const oy = a.y - py;
  const d2 = ox * ox + oy * oy;
  if (d2 >= a.r * a.r) return -1;
  let d = Math.sqrt(d2);
  let nx, ny;
  if (d < EPS) {
    // Centro exatamente sobre o segmento: usa a normal geométrica, voltada
    // contra a velocidade para devolver o corpo ao lado de onde veio.
    const l = Math.sqrt(s.len2);
    nx = -s.dy / l; ny = s.dx / l;
    if (nx * a.vx + ny * a.vy > 0) { nx = -nx; ny = -ny; }
    d = 0;
  } else { nx = ox / d; ny = oy / d; }
  const overlap = a.r - d;
  a.x += nx * overlap;
  a.y += ny * overlap;
  const rv = -(a.vx * nx + a.vy * ny);
  if (rv <= 0) return 0;
  const e = a.bounce * s.bounce;
  const j = (1 + e) * rv;
  a.vx += nx * j;
  a.vy += ny * j;
  return rv;
}

/** Cria um segmento estático com dados pré-calculados. */
export function makeSegment(ax, ay, bx, by, mask, bounce, tag = '') {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = Math.max(dx * dx + dy * dy, EPS);
  return { ax, ay, bx, by, dx, dy, len2, mask, bounce, tag };
}

/** Distância entre superfícies de dois discos (negativa se sobrepostos). */
export function surfaceDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y) - a.r - b.r;
}
