import { MatchController } from '../shared/game/MatchController.js';
import { getBuiltinArena } from '../shared/maps/arenas.js';
import { PhysicsWorld, createBody } from '../shared/physics/PhysicsWorld.js';
import { buildArenaGeometry } from '../shared/maps/arenaGeometry.js';

export function classicGeo() {
  return buildArenaGeometry(getBuiltinArena('classic'));
}

export function emptyWorld() {
  const geo = classicGeo();
  const w = new PhysicsWorld(geo);
  const ball = w.addBody(createBody('ball'));
  return { geo, w, ball };
}

/** Partida em andamento (fase playing) com N jogadores por time. */
export function playingMatch({ red = 1, blue = 1, settings = {} } = {}) {
  const m = new MatchController({ arena: getBuiltinArena('classic'), settings: { countdown: false, ...settings } });
  let id = 1;
  for (let i = 0; i < red; i++) m.addPlayer(id++, { name: `R${i}`, team: 'red' });
  for (let i = 0; i < blue; i++) m.addPlayer(id++, { name: `B${i}`, team: 'blue' });
  m.start();
  m.phase = 'playing';
  return m;
}

/** Afasta todos os jogadores para não interferirem no teste. */
export function parkPlayers(m) {
  let i = 0;
  for (const p of m.players.values()) {
    if (!p.body) continue;
    p.body.x = p.team === 'red' ? -300 : 300;
    p.body.y = -140 + (i++ % 4) * 20;
    p.body.vx = 0; p.body.vy = 0;
  }
}

export function run(m, ticks, fn) {
  for (let t = 0; t < ticks; t++) { if (fn) fn(t); m.tick(); }
}
