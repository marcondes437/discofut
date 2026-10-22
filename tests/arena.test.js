import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_ARENAS, getBuiltinArena } from '../shared/maps/arenas.js';
import { validateArena } from '../shared/maps/arenaValidate.js';
import { buildArenaGeometry } from '../shared/maps/arenaGeometry.js';
import { MatchController } from '../shared/game/MatchController.js';

test('todas as arenas embutidas são válidas e geram geometria', () => {
  for (const a of BUILTIN_ARENAS) {
    const r = validateArena(a);
    assert.ok(r.ok, `${a.id}: ${r.errors?.join(' ')}`);
    const g = buildArenaGeometry(r.arena);
    assert.ok(g.segments.length >= 14);
    assert.equal(g.statics.filter((s) => s.tag === 'post').length, 4);
  }
});

test('somente a arena experimental tem obstáculos', () => {
  for (const a of BUILTIN_ARENAS) assert.equal(a.obstacles.length > 0, a.id === 'experimental');
});

test('JSON exportado pode ser reimportado sem perdas', () => {
  const a = getBuiltinArena('experimental');
  const r1 = validateArena(JSON.stringify(a));
  assert.ok(r1.ok);
  const r2 = validateArena(JSON.stringify(r1.arena));
  assert.deepEqual(r2.arena, r1.arena);
});

test('entradas malformadas ou maliciosas são rejeitadas sem lançar exceção', () => {
  const base = getBuiltinArena('classic');
  const cases = [
    null, 42, 'não é json', '[]', '{}',
    { ...base, format: 'outro' },
    { ...base, width: 1e9 },
    { ...base, width: NaN },
    { ...base, height: '350' },
    { ...base, goal: { width: 10, depth: 45, postRadius: 8 } },
    { ...base, goal: { width: 140, depth: 5, postRadius: 8 } },
    { ...base, kickoffRadius: 10000 },
    { ...base, spawns: { red: [], blue: [[100, 0]] } },
    { ...base, spawns: { red: [[100, 0]], blue: [[150, 0]] } },             // vermelho no campo errado
    { ...base, spawns: { red: [[-5000, 0]], blue: [[150, 0]] } },           // fora do campo
    { ...base, spawns: { red: Array(9).fill([-150, 0]), blue: [[150, 0]] } },
    { ...base, obstacles: Array(65).fill({ type: 'disc', p: [0, 100], r: 5 }) },
    { ...base, obstacles: [{ type: 'disc', p: [0, 0], r: 20 }] },           // bloqueia a saída
    { ...base, obstacles: [{ type: 'segment', a: [0, 0], b: [0, 0] }] },
    { ...base, obstacles: [{ type: 'laser', p: [0, 0] }] },
    { ...base, obstacles: [{ type: 'disc', p: [0, 100], r: 5, mask: 'tudo' }] },
    { ...base, obstacles: [{ type: 'disc', p: [-150, 0], r: 20 }] },        // sobre um spawn
    { ...base, colors: { grass: 'red; background:url(x)' } },
    JSON.stringify({ ...base, name: 'x'.repeat(70000) }),
  ];
  for (const c of cases) {
    const r = validateArena(c);
    assert.equal(r.ok, false, `deveria rejeitar: ${JSON.stringify(c)?.slice(0, 80)}`);
    assert.ok(r.errors.length > 0);
  }
});

test('nome é sanitizado e __proto__ não polui objetos', () => {
  const base = getBuiltinArena('classic');
  const evil = JSON.parse(JSON.stringify({ ...base, name: '<img src=x onerror=alert(1)>Campo' }).replace('"format"', '"__proto__":{"polluted":true},"format"'));
  const r = validateArena(evil);
  assert.ok(r.ok);
  assert.equal(r.arena.name.includes('<'), false);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(r.arena, '__proto__'), false);
});

test('arena personalizada válida é jogável (gol detectado)', () => {
  const custom = {
    format: 'discofut-arena', version: 1, name: 'Minha', width: 500, height: 300,
    goal: { width: 100, depth: 40, postRadius: 6 }, margin: 30, kickoffRadius: 50,
    spawns: { red: [[-100, 0]], blue: [[100, 0]] },
    obstacles: [{ type: 'segment', a: [-50, 100], b: [50, 100], mask: 'all', bounce: 1 }],
  };
  const r = validateArena(custom);
  assert.ok(r.ok, r.errors?.join(' '));
  const m = new MatchController({ arena: r.arena, settings: { countdown: false } });
  m.addPlayer(1, { team: 'red' }); m.addPlayer(2, { team: 'blue' });
  m.start(); m.phase = 'playing';
  m.players.get(2).body.y = 120; m.players.get(1).body.y = -120;
  m.ball.x = 200; m.ball.vx = 6;
  for (let i = 0; i < 60; i++) m.tick();
  assert.equal(m.score.red, 1);
});
