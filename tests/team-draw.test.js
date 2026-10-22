import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/rooms/Room.js';
import { RoomManager } from '../server/rooms/RoomManager.js';

function setup(count) {
  const room = new Room(new RoomManager(), { code: 'TEST', name: 'Sorteio', maxPlayers: 16, settings: { teamSize: 1 } });
  for (let id = 1; id <= count; id++) room.join({ id, name: `P${id}`, token: `${id}` });
  const host = room.members.get(1);
  const draw = () => { host.adminTimes = []; room._onAdmin(host, { a: 'draw_3v3' }, Date.now()); };
  return { room, host, draw };
}

for (const count of [6, 8, 16]) {
  test(`3v3 com ${count} pessoas: três por time, sem repetição, restantes assistem`, () => {
    const { room, draw } = setup(count);
    for (let i = 0; i < 10; i++) {
      draw();
      assert.equal(room.match.settings.teamSize, 3);
      assert.equal(room.match.teamCount('red'), 3);
      assert.equal(room.match.teamCount('blue'), 3);
      const active = [...room.match.players.values()].filter(p => p.team !== 'spec');
      assert.equal(new Set(active.map(p => p.id)).size, 6);
      assert.equal(room.state().members.filter(p => p.team === 'spec').length, count - 6);
      assert.equal(room.match.phase, 'lobby');
    }
  });
}

test('menos de seis conectados, não-admin e partida em andamento não alteram os times', () => {
  const { room, draw } = setup(5);
  draw();
  assert.equal(room.match.settings.teamSize, 1);
  room.join({ id: 6, name: 'P6', token: '6' });
  room._onAdmin(room.members.get(2), { a: 'draw_3v3' }, Date.now());
  assert.equal(room.match.settings.teamSize, 1);
  room.members.get(6).away = true; draw();
  assert.equal(room.match.settings.teamSize, 1);
  room.members.get(6).away = false;
  room.match.phase = 'playing'; draw();
  assert.equal(room.match.settings.teamSize, 1);
  assert.equal(room.match.phase, 'playing');
});

test('sorteio 3v3 não substitui as duplas de um campeonato', () => {
  const { room, host, draw } = setup(8);
  room._onAdmin(host, { a: 'tournament_draw' }, Date.now());
  const teams = JSON.stringify(room.state().tournament.teams);
  draw();
  assert.equal(room.match.settings.teamSize, 2);
  assert.equal(JSON.stringify(room.state().tournament.teams), teams);
});
