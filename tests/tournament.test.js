import test from 'node:test';
import assert from 'node:assert/strict';
import { DoublesTournament } from '../server/rooms/DoublesTournament.js';
import { Room } from '../server/rooms/Room.js';
import { RoomManager } from '../server/rooms/RoomManager.js';

const players = count => Array.from({ length: count }, (_, id) => ({ id: id + 1, name: `Jogador ${id + 1}` }));

for (const count of [4, 6, 8, 10, 12, 14, 16]) {
  test(`${count} jogadores: duplas completas, folgas e campeão após uma partida por vez`, () => {
    const tournament = new DoublesTournament(players(count), () => 0);
    assert.deepEqual(tournament.teams.flatMap(t => t.players.map(p => p.id)).sort((a,b) => a-b), players(count).map(p => p.id));
    let played = 0;
    while (tournament.status === 'running') {
      const next = tournament.start();
      assert.notEqual(next.red, next.blue);
      assert.equal(tournament.nextMatch(), null);
      assert.throws(() => tournament.start());
      tournament.finish(next.red, { red: 3, blue: 1 });
      played++;
      assert.ok(played < 8);
    }
    assert.equal(played, count / 2 - 1);
    assert.notEqual(tournament.champion, null);
    assert.equal(tournament.rounds.at(-1)[0].winner, tournament.champion);
  });
}

test('sorteio valida pares, limites e jogadores duplicados', () => {
  for (const count of [0, 2, 3, 5, 17, 18]) assert.throws(() => new DoublesTournament(players(count)));
  assert.throws(() => new DoublesTournament([players(4)[0], ...players(3)]));
});

test('saída de integrante elimina a dupla por W.O. e mantém a chave avançando', () => {
  const t = new DoublesTournament(players(8));
  const first = t.start();
  assert.equal(t.withdraw(t.teams[first.red].players[0].id), true);
  assert.equal(t.rounds[0][0].winner, first.blue);
  assert.equal(t.rounds[0][0].reason, 'W.O.');
  while (t.status === 'running') { const match = t.start(); t.finish(match.red, { red: 1, blue: 0 }); }
  assert.notEqual(t.champion, first.red);
});

function setup(count = 16) {
  const room = new Room(new RoomManager(), {
    code: 'TEST', name: 'Campeonato', maxPlayers: 16, visibility: 'public',
    settings: { teamSize: 4, scoreLimit: 1, timeLimit: 0 },
  });
  for (const p of players(count)) room.join({ ...p, token: `test${p.id}` });
  const host = room.members.get(1);
  const admin = (a, extra = {}) => room._onAdmin(host, { a, ...extra }, Date.now() + 2000);
  return { room, host, admin };
}

test('sala: sorteio de 16 pessoas, quatro em campo, sete jogos, campeão e retorno ao normal', () => {
  const { room, admin } = setup();
  admin('tournament_draw');
  assert.equal(room.state().tournament.teams.length, 8);
  assert.equal(room.match.settings.teamSize, 2);
  assert.equal(room.match.settings.overtime, 'golden');
  assert.equal(room.match.teamCount('red'), 0);
  let played = 0;
  while (room.tournament.status === 'running') {
    admin('tournament_next');
    assert.equal(room.match.teamCount('red'), 2);
    assert.equal(room.match.teamCount('blue'), 2);
    assert.equal(room.state().members.filter(p => p.team === 'spec').length, 12);
    const active = { ...room.tournament.active };
    admin('tournament_next');
    assert.deepEqual(room.tournament.active, active, 'não inicia partidas simultâneas');
    // One authoritative goal ends the match and advances its winner.
    room.match.phase = 'playing';
    room.match.ball.x = room.match.geo.W + room.match.ball.r - 1;
    room.match.ball.y = 0;
    room.match.ball.vx = 4;
    for (let i = 0; i < 170 && room.tournament.active; i++) room.tick(Date.now());
    assert.equal(room.tournament.active, null);
    played++;
    hostReset();
  }
  function hostReset() { room.members.get(1).adminTimes = []; }
  assert.equal(played, 7);
  assert.notEqual(room.tournament.champion, null);
  hostReset(); admin('tournament_cancel');
  assert.equal(room.tournament, null);
  assert.equal(room.match.settings.teamSize, 4);
  assert.equal(room.teamsLocked, false);
});

test('sala: controles protegidos, desconexão temporária e cancelamento', () => {
  const { room, host, admin } = setup(8);
  room._onAdmin(room.members.get(2), { a: 'tournament_draw' }, Date.now());
  assert.equal(room.tournament, null, 'somente administradores sorteiam');
  admin('tournament_draw');
  room._onTeam(host, { team: 'red' });
  assert.equal(room.match.players.get(host.id).team, 'spec', 'até o admin respeita as duplas');
  admin('settings', { settings: { teamSize: 4, overtime: 'draw' } });
  assert.equal(room.match.settings.teamSize, 2);
  const next = room.tournament.nextMatch();
  const id = room.tournament.teams[next.red].players[0].id;
  room.disconnected(room.members.get(id).session);
  admin('tournament_next');
  assert.equal(room.tournament.active, null, 'aguarda reconexão sem iniciar jogo incompleto');
  room.reattach(room.members.get(id).session);
  admin('tournament_next');
  assert.ok(room.tournament.active);
  room.leave(id);
  assert.equal(room.tournament.active, null);
  assert.equal(room.match.phase, 'lobby');
  admin('tournament_cancel');
  assert.equal(room.state().tournament, null);
});
