import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/rooms/Room.js';
import { RoomManager } from '../server/rooms/RoomManager.js';
import { IN_RIGHT, IN_LEFT, IN_KICK } from '../shared/config/physicsConfig.js';

function setup() {
  const room = new Room(new RoomManager(), {
    code: 'TEST', name: 'Latency test', visibility: 'public', maxPlayers: 4,
    settings: { allowEmptyTeams: true, timeLimit: 0, scoreLimit: 0 },
  });
  room.join({ id: 1, name: 'Player', token: 'test' });
  room.match.setTeam(1, 'red');
  room.match.start();
  room.match.phase = 'playing';
  return { room, member: room.members.get(1), player: room.match.players.get(1) };
}

test('a burst uses the latest direction on the next tick instead of waiting in the queue', () => {
  const { room, member, player } = setup();
  const now = Date.now();
  for (let s = 1; s <= 5; s++) room._onInput(member, { s, k: IN_RIGHT }, now);
  room._onInput(member, { s: 6, k: IN_LEFT }, now);
  room.tick(now);
  assert.equal(player.input, IN_LEFT);
  assert.equal(member.ackSeq, 6);
  assert.equal(member.queue.length, 0);
  assert.ok(player.body.vx < 0);
});

test('a kick pressed and released in one burst is preserved for one tick only', () => {
  const { room, member, player } = setup();
  player.body.x = -25; player.body.y = 0;
  const now = Date.now();
  room._onInput(member, { s: 1, k: IN_KICK }, now);
  room._onInput(member, { s: 2, k: 0 }, now);
  room.tick(now);
  assert.equal(player.stats.kicks, 1);
  assert.equal(member.ackSeq, 2);
  room.tick(now + 17);
  assert.equal(player.input, 0);
  assert.equal(player.prevKick, false);
});

test('jittery bursts over three seconds never accumulate input latency', () => {
  const { room, member } = setup();
  let seq = 0;
  const start = Date.now();
  for (let t = 0; t < 180; t++) {
    const now = start + t * 1000 / 60;
    if (t % 6 === 0) {
      for (let i = 0; i < 6; i++) room._onInput(member, { s: ++seq, k: seq % 2 ? IN_LEFT : IN_RIGHT }, now);
    }
    room.tick(now);
    assert.equal(member.ackSeq, seq);
    assert.equal(member.queue.length, 0);
  }
});
