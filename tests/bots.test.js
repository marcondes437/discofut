import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchController } from '../shared/game/MatchController.js';
import { BotManager } from '../shared/ai/BotController.js';
import { getBuiltinArena } from '../shared/maps/arenas.js';
import { IN_MASK } from '../shared/config/physicsConfig.js';

function botMatch(size, diffRed, diffBlue, minutes = 2, arena = 'classic') {
  // Completion tests have a fixed time budget; golden goal may continue indefinitely after a tie.
  const m = new MatchController({ arena: getBuiltinArena(arena), settings: { timeLimit: minutes, scoreLimit: 0, countdown: false, overtime: 'draw' } });
  const bots = new BotManager();
  let id = 1;
  for (let i = 0; i < size; i++) { m.addPlayer(id, { team: 'red', isBot: true }); bots.add(id++, diffRed); }
  for (let i = 0; i < size; i++) { m.addPlayer(id, { team: 'blue', isBot: true }); bots.add(id++, diffBlue); }
  m.start();
  return { m, bots };
}

function play(m, bots, maxTicks) {
  let goals = 0, kicks = 0;
  for (let t = 0; t < maxTicks && m.phase !== 'ended'; t++) {
    bots.apply(m);
    for (const p of m.players.values()) assert.equal(p.input & ~IN_MASK, 0, 'bots usam apenas bits de entrada válidos');
    for (const e of m.tick()) { if (e.type === 'goal') goals++; if (e.type === 'kick') kicks++; }
    for (const b of m.world.bodies) assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
  }
  return { goals, kicks };
}

test('bots 1v1 (médio) jogam, chutam e marcam gols', () => {
  const { m, bots } = botMatch(1, 'medium', 'medium', 2);
  const r = play(m, bots, 60 * 60 * 3);
  assert.ok(r.kicks > 10, `chutes: ${r.kicks}`);
  assert.ok(r.goals >= 1, `gols: ${r.goals}`);
  assert.equal(m.phase, 'ended');
});

test('bots 3v3 com funções (goleiro/defensor/atacante) completam uma partida', () => {
  const { m, bots } = botMatch(3, 'hard', 'easy', 2);
  const r = play(m, bots, 60 * 60 * 3);
  assert.equal(m.phase, 'ended');
  assert.ok(r.kicks > 10);
  const roles = [...bots.brains.values()].map((b) => b.role);
  assert.ok(roles.includes('keeper') && roles.includes('defender') && roles.includes('attacker'));
});

test('dificuldade difícil vence a fácil na maioria das partidas', () => {
  let hardGoals = 0, easyGoals = 0;
  for (let i = 0; i < 3; i++) {
    const { m, bots } = botMatch(2, 'hard', 'easy', 2);
    bots.seed = 100 + i;
    play(m, bots, 60 * 60 * 3);
    hardGoals += m.score.red; easyGoals += m.score.blue;
  }
  assert.ok(hardGoals > easyGoals, `difícil ${hardGoals} x fácil ${easyGoals}`);
});

test('bot sozinho em treino marca no gol vazio', () => {
  const m = new MatchController({ arena: getBuiltinArena('training'), settings: { allowEmptyTeams: true, timeLimit: 0, scoreLimit: 0, countdown: false } });
  const bots = new BotManager();
  m.addPlayer(1, { team: 'red', isBot: true }); bots.add(1, 'medium');
  m.start();
  const r = play(m, bots, 60 * 40);
  assert.ok(r.goals >= 1, `gols ${r.goals}`);
});
