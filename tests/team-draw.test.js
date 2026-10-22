import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/rooms/Room.js';
import { RoomManager } from '../server/rooms/RoomManager.js';

function setup(count, teamSize = 1) {
  const room = new Room(new RoomManager(), { code: 'TEST', name: 'Sorteio', maxPlayers: 16, settings: { teamSize } });
  for (let id = 1; id <= count; id++) room.join({ id, name: `P${id}`, token: `${id}` });
  const host = room.members.get(1);
  const draw = (a = 'draw_3v3') => { host.adminTimes = []; room._onAdmin(host, { a }, Date.now()); };
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
  draw('draw_teams');
  assert.equal(room.match.settings.teamSize, 2);
  assert.equal(JSON.stringify(room.state().tournament.teams), teams);
});

for (const size of [1, 2, 3, 4]) {
  for (const count of [2, 3, 6, 16]) {
    test(`sorteio geral no modo ${size}v${size} com ${count} participantes mantém o modo e equilibra os times`, () => {
      const { room, draw } = setup(count, size);
      draw('draw_teams');
      const selected = Math.min(count, size * 2);
      assert.equal(room.match.settings.teamSize, size);
      assert.equal(room.match.teamCount('red'), Math.ceil(selected / 2));
      assert.equal(room.match.teamCount('blue'), Math.floor(selected / 2));
      assert.equal(room.state().members.filter(p => p.team === 'spec').length, count - selected);
      assert.equal(new Set([...room.match.players.values()].filter(p => p.team !== 'spec').map(p => p.id)).size, selected);
    });
  }
}

test('sorteio geral inclui bots, ignora desconectados e exige dois participantes', () => {
  const { room, draw } = setup(2, 3);
  room.members.get(2).away = true;
  draw('draw_teams');
  assert.equal(room.match.teamCount('blue'), 0);
  room.members.set(3, { id: 3, name: 'Bot', isBot: true });
  room.match.addPlayer(3, { name: 'Bot', isBot: true });
  draw('draw_teams');
  assert.equal(room.match.teamCount('red'), 1);
  assert.equal(room.match.teamCount('blue'), 1);
  assert.equal(room.match.players.get(2).team, 'spec');
  assert.notEqual(room.match.players.get(3).team, 'spec');
});
