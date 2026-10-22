import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchController } from '../shared/game/MatchController.js';
import { getBuiltinArena } from '../shared/maps/arenas.js';
import { IN_KICK, IN_RIGHT, IN_UP, IN_LEFT, physicsConfig } from '../shared/config/physicsConfig.js';
import { playingMatch, parkPlayers, run } from './helpers.js';

const BR = physicsConfig.ball.radius;

test('gol quando a bola cruza integralmente a linha dentro da abertura', () => {
  const m = playingMatch();
  parkPlayers(m);
  m.ball.x = m.geo.W - 60; m.ball.y = 0; m.ball.vx = 8;
  const goals = [];
  run(m, 60, () => {}); // eventos são lidos após cada tick
  // reexecuta capturando eventos
  const m2 = playingMatch(); parkPlayers(m2);
  m2.ball.x = m2.geo.W - 60; m2.ball.vx = 8;
  for (let i = 0; i < 60; i++) for (const e of m2.tick()) if (e.type === 'goal') goals.push(e);
  assert.equal(goals.length, 1, 'exatamente um gol');
  assert.equal(goals[0].team, 'red', 'bola no gol da direita = gol do vermelho');
  assert.deepEqual(m2.score, { red: 1, blue: 0 });
  assert.equal(m.score.red, 1);
});

test('gol limítrofe: bola rente à trave por dentro entra; por fora não', () => {
  const inside = playingMatch(); parkPlayers(inside);
  const G = inside.geo.G, pr = inside.geo.postRadius;
  inside.ball.x = inside.geo.W - 80; inside.ball.y = G - pr - BR - 0.5; inside.ball.vx = 9;
  run(inside, 60);
  assert.equal(inside.score.red, 1, 'entrou rente à trave');

  const outside = playingMatch(); parkPlayers(outside);
  outside.ball.x = outside.geo.W - 80; outside.ball.y = G + pr + BR + 0.5; outside.ball.vx = 9;
  run(outside, 120);
  assert.equal(outside.score.red, 0, 'por fora da trave não é gol');
});

test('bola sobre a linha (sem cruzar inteira) não é gol', () => {
  const m = playingMatch(); parkPlayers(m);
  // Para ~5 unidades além da linha: centro além da linha, mas não a bola inteira.
  const travel = 55;
  m.ball.x = m.geo.W - 50; m.ball.vx = travel * (1 - physicsConfig.ball.damping);
  run(m, 900);
  assert.ok(m.ball.x > m.geo.W && m.ball.x < m.geo.W + BR, `parou sobre a linha (x=${m.ball.x})`);
  assert.equal(m.score.red, 0);
});

test('placar atualiza uma única vez por gol, mesmo com a bola parada na rede', () => {
  const m = playingMatch(); parkPlayers(m);
  m.ball.x = m.geo.W - 30; m.ball.vx = 10;
  let goalEvents = 0;
  for (let i = 0; i < 140; i++) for (const e of m.tick()) if (e.type === 'goal') goalEvents++;
  assert.equal(goalEvents, 1);
  assert.equal(m.score.red, 1);
  assert.equal(m.phase, 'goal');
});

test('após o gol: comemoração, reposicionamento e novo kickoff do time que sofreu', () => {
  const m = playingMatch(); parkPlayers(m);
  m.ball.x = m.geo.W - 30; m.ball.vx = 10;
  run(m, 20);
  assert.equal(m.phase, 'goal');
  run(m, physicsConfig.match.goalCelebrationTicks + 5);
  assert.equal(m.phase, 'kickoff');
  assert.equal(m.kickoffTeam, 'blue');
  assert.equal(m.ball.x, 0); assert.equal(m.ball.y, 0);
});

test('kickoff: time sem a saída não entra no círculo nem cruza o meio', () => {
  const m = new MatchController({ arena: getBuiltinArena('classic'), settings: { countdown: false } });
  m.addPlayer(1, { team: 'red' });
  m.addPlayer(2, { team: 'blue' });
  m.start();
  assert.equal(m.phase, 'kickoff');
  assert.equal(m.kickoffTeam, 'red');
  const blue = m.players.get(2).body;
  m.setInput(2, IN_LEFT);
  run(m, 240);
  assert.equal(m.phase, 'kickoff', 'bola ainda não foi tocada');
  assert.ok(blue.x >= blue.r - 1e-6, 'azul não cruzou o meio');
  assert.ok(Math.hypot(blue.x, blue.y) >= m.geo.kickoffRadius + blue.r - 1e-6, 'azul fora do círculo central');
  // Vermelho (saída) pode entrar no círculo e tocar a bola.
  m.setInput(1, IN_RIGHT);
  let started = false;
  for (let i = 0; i < 240 && !started; i++) { m.tick(); started = m.phase === 'playing'; }
  assert.ok(started, 'toque do time da saída libera a partida');
});

test('chute só ocorre no alcance e respeita cooldown/repetição', () => {
  const m = playingMatch({ settings: { kickMode: 'press', kickCooldown: 8 } });
  parkPlayers(m);
  const red = m.players.get(1);
  // Fora de alcance: nada acontece.
  red.body.x = -100; red.body.y = 0; m.ball.x = 0; m.ball.y = 0;
  m.setInput(1, IN_KICK);
  let kicks = 0;
  for (let i = 0; i < 10; i++) for (const e of m.tick()) if (e.type === 'kick') kicks++;
  assert.equal(kicks, 0, 'sem chute remoto');
  // Segurar a tecla e chegar ao alcance: um chute (modo press).
  m.setInput(1, 0); m.tick();
  red.body.x = m.ball.x - (red.body.r + BR + 2); red.body.y = m.ball.y; red.body.vx = 0;
  m.ball.vx = 0; m.ball.vy = 0;
  m.setInput(1, IN_KICK);
  for (const e of m.tick()) if (e.type === 'kick') kicks++;
  assert.equal(kicks, 1);
  assert.ok(m.ball.vx > 4, 'impulso na direção jogador→bola');
  // Segurando: não repete no modo press, mesmo com a bola de volta ao alcance.
  for (let i = 0; i < 30; i++) {
    m.ball.x = red.body.x + red.body.r + BR + 1; m.ball.y = red.body.y; m.ball.vx = 0; m.ball.vy = 0;
    for (const e of m.tick()) if (e.type === 'kick') kicks++;
  }
  assert.equal(kicks, 1, 'modo press não repete enquanto segura');
});

test('chutes consecutivos no modo repetição respeitam o cooldown', () => {
  const m = playingMatch({ settings: { kickMode: 'repeat', kickCooldown: 10 } });
  parkPlayers(m);
  const red = m.players.get(1);
  red.body.x = -50; red.body.y = 0;
  m.setInput(1, IN_KICK);
  let kicks = 0;
  for (let i = 0; i < 61; i++) {
    m.ball.x = red.body.x + red.body.r + BR + 1; m.ball.y = red.body.y; m.ball.vx = 0; m.ball.vy = 0;
    red.body.vx = 0; red.body.vy = 0;
    for (const e of m.tick()) if (e.type === 'kick') kicks++;
  }
  assert.ok(kicks >= 5 && kicks <= 7, `≈6 chutes em 1 s com cooldown 10 (obtido ${kicks})`);
});

test('diagonais normalizadas: velocidade máxima igual em todas as direções', () => {
  const speed = (bits) => {
    const m = playingMatch(); parkPlayers(m);
    const b = m.players.get(1).body; b.x = -200; b.y = 0;
    m.setInput(1, bits);
    run(m, 25);
    return Math.hypot(b.vx, b.vy);
  };
  const straight = speed(IN_RIGHT);
  const diag = speed(IN_RIGHT | IN_UP);
  assert.ok(Math.abs(straight - diag) < 1e-9, `${straight} vs ${diag}`);
});

test('fim por limite de gols', () => {
  const m = playingMatch({ settings: { scoreLimit: 2 } });
  for (let g = 0; g < 2; g++) {
    parkPlayers(m);
    m.phase = 'playing';
    m.ball.x = m.geo.W - 30; m.ball.y = 0; m.ball.vx = 10; m.ball.vy = 0;
    run(m, physicsConfig.match.goalCelebrationTicks + 30);
  }
  assert.equal(m.phase, 'ended');
  assert.equal(m.winner, 'red');
});

test('fim por tempo e gol de ouro em caso de empate', () => {
  const m = playingMatch({ settings: { timeLimit: 1, overtime: 'golden' } });
  parkPlayers(m);
  m.clockTicks = 60 * 60 - 1;
  run(m, 2);
  assert.ok(m.overtime, 'empate → prorrogação');
  assert.equal(m.phase, 'playing');
  m.ball.x = -m.geo.W + 30; m.ball.y = 0; m.ball.vx = -10;
  run(m, physicsConfig.match.goalCelebrationTicks + 30);
  assert.equal(m.phase, 'ended');
  assert.equal(m.winner, 'blue');

  const d = playingMatch({ settings: { timeLimit: 1, overtime: 'draw' } });
  parkPlayers(d);
  d.clockTicks = 60 * 60 - 1;
  run(d, 2);
  assert.equal(d.phase, 'ended');
  assert.equal(d.winner, 'draw');

  const w = playingMatch({ settings: { timeLimit: 1 } });
  parkPlayers(w);
  w.score.blue = 2;
  w.clockTicks = 60 * 60 - 1;
  run(w, 2);
  assert.equal(w.winner, 'blue');
});

test('autoria: gol contra e assistência', () => {
  const m = playingMatch({ red: 2, blue: 1 });
  parkPlayers(m);
  // Vermelho #1 toca, vermelho #2 finaliza → gol de #2, assistência de #1.
  m._registerTouch(m.players.get(1), 0, 0);
  m.tickCount += 10;
  m._registerTouch(m.players.get(2), 0, 0);
  m._goal('red');
  assert.equal(m.lastGoal.scorer, 2);
  assert.equal(m.lastGoal.assist, 1);
  assert.equal(m.players.get(2).stats.goals, 1);
  assert.equal(m.players.get(1).stats.assists, 1);

  const og = playingMatch(); parkPlayers(og);
  og._registerTouch(og.players.get(2), 0, 0); // azul toca por último
  og._goal('red');
  assert.equal(og.lastGoal.ownGoal, true);
  assert.equal(og.players.get(2).stats.ownGoals, 1);
});

test('time vazio volta para "aguardando" e retoma quando completa', () => {
  const m = playingMatch();
  m.setTeam(2, 'spec');
  m.tick();
  assert.equal(m.phase, 'waiting');
  m.setTeam(2, 'blue');
  m.tick();
  assert.equal(m.phase, 'kickoff');
});

test('pausa congela a simulação', () => {
  const m = playingMatch(); parkPlayers(m);
  m.ball.vx = 3;
  m.setPaused(true);
  const x = m.ball.x;
  run(m, 30);
  assert.equal(m.ball.x, x);
  m.setPaused(false);
  run(m, 5);
  assert.ok(m.ball.x > x);
});

test('limite de jogadores por time (modos 1v1 a 4v4)', () => {
  const m = new MatchController({ arena: getBuiltinArena('classic'), settings: { teamSize: 2 } });
  m.addPlayer(1, { team: 'red' });
  m.addPlayer(2, { team: 'red' });
  m.addPlayer(3);
  assert.equal(m.setTeam(3, 'red'), false);
  assert.equal(m.setTeam(3, 'blue'), true);
});
