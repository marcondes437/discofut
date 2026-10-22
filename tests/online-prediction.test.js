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
