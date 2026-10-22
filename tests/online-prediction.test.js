import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { playingMatch, parkPlayers } from './helpers.js';
import { IN_KICK, IN_RIGHT } from '../shared/config/physicsConfig.js';

// Resolve the browser import map for Node without changing production imports.
const source = readFileSync(new URL('../client/src/core/OnlineGame.js', import.meta.url), 'utf8')
  .replaceAll(/'@shared\/([^']+)'/g, (_, path) => `'${new URL(`../shared/${path}`, import.meta.url).href}'`)
  .replace("'../replay/ReplayBuffer.js'", `'${new URL('../client/src/replay/ReplayBuffer.js', import.meta.url).href}'`);
const { OnlineGame } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function setup() {
  const match = playingMatch();
  parkPlayers(match);
  const p = match.players.get(1).body;
  p.x = -25; p.y = 0;
  const app = {
    settings: { get: () => true }, renderer: { setArena() {} }, camera: { snap() {} },
    audio: { playEvents() {} }, input: { sample: () => IN_KICK, endTick() {} },
  };
  const net = { on: () => () => {}, send() {}, jitter: 0 };
  const room = {
    arena: match.arena, settings: match.settings, phase: 'playing',
    members: [...match.players.values()].map(p => ({ id: p.id, team: p.team })),
  };
  const game = new OnlineGame(app, net, { you: 1, rv: 1, room });
  game._onSnapshot({ d: match.snapshot(), a: 0 });
  return { match, game, app };
}

test('online kick moves the ball on the input tick before another snapshot arrives', () => {
  const { game } = setup();
  game.tick();
  assert.ok(game.predBall.vx > 5);
  assert.ok(game._view(performance.now()).ball.x > 5);
  assert.equal(game.latest.b[0], 0, 'no server update needed for the response');
});

test('online physical contact pushes the ball immediately without kicking', () => {
  const { game, app } = setup();
  app.input.sample = () => IN_RIGHT;
  game.predBody.vx = 2;
  game.tick();
  assert.ok(game.predBall.vx > 0);
  assert.ok(game._view(performance.now()).ball.x > 0);
});

test('reconciliation replays pending kicks and does not apply an acknowledged kick twice', () => {
  const { match, game } = setup();
  game.tick();
  const x = game.predBall.x;
  game.ack = 0;
  game._reconcile(match.snapshot());
  assert.equal(game.predBall.x, x, 'pending kick is replayed from server state');
  match.setInput(1, IN_KICK);
  match.tick();
  game._onSnapshot({ d: match.snapshot(), a: 1 });
  assert.ok(Math.abs(game.predBall.x - x) < 0.01);
  const speed = game.predBall.vx;
  game.tick();
  assert.ok(game.predBall.vx < speed, 'holding press mode does not kick again');
});

test('paused snapshots stop ball prediction', () => {
  const { game } = setup();
  game.latest.pa = 1;
  game.tick();
  assert.equal(game.predBall.x, 0);
  assert.equal(game.predBall.vx, 0);
});

test('inputs are replayed even before the server acknowledges the first one', () => {
  const { game, match } = setup();
  game.ack = -1;
  game.tick();
  const x = game.predBall.x;
  game._reconcile(match.snapshot());
  assert.equal(game.predBall.x, x);
});

test('remote players and ball contacts are rendered on the same predicted tick', () => {
  const { game, match, app } = setup();
  app.input.sample = () => 0;
  const remote = match.players.get(2);
  remote.body.x = 25; remote.body.y = 0;
  remote.body.vx = -2; remote.body.vy = 0;
  remote.input = 4;
  game._reconcile(match.snapshot());
  game.tick();
  const body = game.predWorld.bodies.find(b => b.id === 2);
  const view = game._view(performance.now());
  assert.equal(view.players.find(p => p.id === 2).x, body.x);
  assert.ok(game.predBall.vx < 0, 'remote contact also affects the ball immediately');
});

test('ordinary ball corrections keep the displayed position continuous', () => {
  const { game, match } = setup();
  game.tick();
  const before = game._view(performance.now()).ball.x;
  const d = match.snapshot();
  d.b[0] = 2;
  game._onSnapshot({ d: { ...d, tick: d.tick + 1 }, a: 0 });
  assert.equal(game._view(performance.now()).ball.x, before);
  assert.notEqual(game.predBall.x, before, 'server correction still updates simulation');
});

test('ball smoothing is cleared on a goal or restart', () => {
  const { game, match } = setup();
  game.ballSmoothX = 20;
  const d = match.snapshot();
  game._onSnapshot({ d: { ...d, ph: 'goal', tick: d.tick + 1 }, a: 0 });
  assert.equal(game.ballSmoothX, 0);
});

test('pause and resume snapshots are applied even when the simulation tick did not advance', () => {
  const { game, match } = setup();
  const d = match.snapshot();
  game._onSnapshot({ d: { ...d, pa: 1 }, a: 0 });
  assert.equal(game.latest.pa, 1);
  assert.equal(game.canControl(), false);
  game._onSnapshot({ d: { ...d, pa: 0 }, a: 0 });
  assert.equal(game.latest.pa, 0);
  assert.equal(game.canControl(), true);
  assert.equal(game.snaps.length, 1, 'same-tick updates replace the buffered state');
});

test('kick audio is immediate, is not replayed during reconciliation and is not doubled by confirmation', () => {
  const { game, app, match } = setup();
  const sounds = [];
  app.audio.playEvents = events => sounds.push(...events);
  game.tick();
  assert.equal(sounds.filter(e => e.type === 'kick').length, 1, 'local kick has immediate feedback');
  game._reconcile(match.snapshot());
  assert.equal(sounds.filter(e => e.type === 'kick').length, 1, 'replaying input is silent');
  match.setInput(1, IN_KICK);
  match.tick();
  game._onSnapshot({ d: match.snapshot(), a: 1, e: [['k', 1]] });
  assert.equal(sounds.filter(e => e.type === 'kick').length, 1, 'confirmation is silent');
});

test('a buffered shot stays consistent between client prediction and server simulation', () => {
  const { game, app, match } = setup();
  match.players.get(1).kickCooldown = 4;
  game._reconcile(match.snapshot());
  for (let i = 0; i < 4; i++) {
    const bits = i === 0 ? IN_KICK : 0;
    app.input.sample = () => bits;
    game.tick();
    match.setInput(1, bits);
    match.tick();
  }
  assert.equal(match.players.get(1).stats.kicks, 1);
  assert.ok(Math.abs(game.predBall.x - match.ball.x) < 0.001);
  assert.ok(Math.abs(game.predBall.vx - match.ball.vx) < 0.001);
});

function movingOpponent() {
  const context = setup();
  const { game, match, app } = context;
  const remote = match.players.get(2);
  Object.assign(remote.body, { x: 100, y: 100, vx: 1, vy: 0 });
  remote.input = IN_RIGHT;
  app.input.sample = () => 0;
  app.camera.update = () => {};
  app.renderer.draw = () => {};
  app.hud = { update() {}, setNet() {} };
  game._reconcile(match.snapshot());
  return context;
}

test('opponent movement is interpolated between physics ticks on fast displays', () => {
  const { game } = movingOpponent();
  game.tick();
  const x = alpha => game._view(performance.now(), alpha).players.find(p => p.id === 2).x;
  assert.ok(x(0) < x(0.5));
  assert.ok(x(0.5) < x(1));
});

test('small opponent corrections remain continuous and converge while rendering', () => {
  const { game, match } = movingOpponent();
  game.tick();
  game.render(0.5, 1 / 144);
  const before = game.remoteVisuals.get(2).x;
  const d = match.snapshot();
  d.p.find(p => p[0] === 2)[1] += 5;
  game._onSnapshot({ d: { ...d, tick: d.tick + 1 }, a: game.seq });
  assert.ok(Math.abs(game._view(performance.now()).players.find(p => p.id === 2).x - before) < 1e-8);
  const initialError = Math.abs(game.remoteSmooth.get(2).x);
  for (let i = 0; i < 20; i++) game.render(1, 1 / 144);
  assert.ok(Math.abs(game.remoteSmooth.get(2).x) < initialError / 20);
});

test('large opponent teleports snap to the server instead of sliding across the field', () => {
  const { game, match } = movingOpponent();
  const d = match.snapshot();
  d.p.find(p => p[0] === 2)[1] = 250;
  game._onSnapshot({ d: { ...d, tick: d.tick + 1 }, a: 0 });
  assert.equal(game.remoteSmooth.has(2), false);
  assert.equal(game._view(performance.now()).players.find(p => p.id === 2).x, 250);
});

test('an opponent stops being extrapolated indefinitely during missing snapshots', () => {
  const { game } = movingOpponent();
  for (let i = 0; i < 30; i++) game.tick();
  const body = game.predWorld.bodies.find(b => b.id === 2);
  const x = body.x;
  for (let i = 0; i < 60; i++) game.tick();
  assert.equal(body.x, x);
  assert.equal(body.vx, 0);
});
