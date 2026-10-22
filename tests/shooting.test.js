import test from 'node:test';
import assert from 'node:assert/strict';
import { playingMatch, parkPlayers } from './helpers.js';
import { applyKickImpulse } from '../shared/game/MatchController.js';
import { createBody } from '../shared/physics/PhysicsWorld.js';
import { IN_KICK, physicsConfig } from '../shared/config/physicsConfig.js';

function setup() {
  const match = playingMatch();
  parkPlayers(match);
  const player = match.players.get(1);
  player.body.x = -27; player.body.y = 0;
  return { match, player };
}

test('a stationary shot leaves with more speed while remaining inside the ball speed limit', () => {
  const { match } = setup();
  match.setInput(1, IN_KICK);
  match.tick();
  assert.ok(match.ball.vx > 6);
  assert.ok(match.ball.vx < match.ball.maxSpeed);
});

test('a quick second tap during cooldown fires once when ready even after releasing', () => {
  const { match, player } = setup();
  match.setInput(1, IN_KICK); match.tick();
  match.setInput(1, 0); match.tick();
  match.setInput(1, IN_KICK); match.tick();
  match.setInput(1, 0);
  for (let i = 0; i < 12; i++) {
    match.ball.x = player.body.x + 27; match.ball.y = player.body.y;
    match.ball.vx = 0; match.ball.vy = 0;
    match.tick();
  }
  assert.equal(player.stats.kicks, 2, 'the second tap is preserved and never repeats');
});

test('a buffered tap expires instead of firing long after the button was released', () => {
  const { match, player } = setup();
  player.body.x = -100;
  match.setInput(1, IN_KICK); match.tick();
  match.setInput(1, 0);
  for (let i = 0; i <= physicsConfig.kick.bufferTicks; i++) match.tick();
  player.body.x = -27;
  match.tick();
  assert.equal(player.stats.kicks, 0);
});

test('receiving a fast incoming pass produces an outgoing shot and preserves sideways motion', () => {
  const player = createBody('player', -27, 0);
  const ball = createBody('ball');
  ball.vx = -18; ball.vy = 2;
  assert.equal(applyKickImpulse(player, ball), true);
  assert.ok(ball.vx > 4, 'the shot travels away from the player');
  assert.equal(ball.vy, 2, 'sideways momentum is preserved');
});

test('slightly wider kick reach is symmetric and still rejects remote shots', () => {
  for (const side of [-1, 1]) {
    const player = createBody('player', side * 30, 0);
    const ball = createBody('ball');
    assert.equal(applyKickImpulse(player, ball), true);
    assert.ok(ball.vx * side < 0);
    player.x = side * 40;
    ball.vx = 0;
    assert.equal(applyKickImpulse(player, ball), false);
    assert.equal(ball.vx, 0);
  }
});
