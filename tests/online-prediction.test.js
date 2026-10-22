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
  game.tick();
  assert.ok(game.predBall.vx < 5.2, 'holding press mode does not kick again');
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
