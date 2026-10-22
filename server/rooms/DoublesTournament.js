import { randomInt } from 'node:crypto';

const resolved = (match) => match.status === 'done' || match.status === 'bye';

export class DoublesTournament {
  constructor(players, pick = randomInt) {
    if (players.length < 4 || players.length > 16 || players.length % 2) {
      throw new Error('Reúna de 4 a 16 jogadores, em quantidade par.');
    }
    if (new Set(players.map(p => p.id)).size !== players.length) throw new Error('Jogadores duplicados.');
    const shuffled = players.map(p => ({ id: p.id, name: p.name }));
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = pick(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    this.teams = [];
    for (let i = 0; i < shuffled.length; i += 2) {
      this.teams.push({ id: i / 2, players: shuffled.slice(i, i + 2), withdrawn: false });
    }
    let size = 2;
    while (size < this.teams.length) size *= 2;
    this.rounds = [];
    for (let count = size / 2; count >= 1; count /= 2) {
      this.rounds.push(Array.from({ length: count }, () => ({ red: null, blue: null, winner: null, status: 'pending', score: null, reason: '' })));
    }
    const byes = size - this.teams.length;
    let team = 0;
    this.rounds[0].forEach((match, i) => {
      match.red = team++;
      match.blue = i < byes ? null : team++;
      match.status = 'ready';
    });
    this.active = null;
    this.status = 'running';
    this.champion = null;
    this._refresh();
  }

  _refresh() {
    for (let r = 0; r < this.rounds.length; r++) {
      this.rounds[r].forEach((match, i) => {
        if (resolved(match) || match.status === 'playing') return;
        if (r > 0) {
          const a = this.rounds[r - 1][i * 2], b = this.rounds[r - 1][i * 2 + 1];
          if (!resolved(a) || !resolved(b)) return;
          match.red = a.winner; match.blue = b.winner;
          match.status = 'ready';
        }
        const red = match.red !== null && !this.teams[match.red].withdrawn;
        const blue = match.blue !== null && !this.teams[match.blue].withdrawn;
        if (!red || !blue) {
          match.winner = red ? match.red : blue ? match.blue : null;
          match.status = 'bye';
          match.reason = match.red === null || match.blue === null ? 'Folga' : 'W.O.';
        }
      });
    }
    const final = this.rounds.at(-1)[0];
    if (resolved(final)) { this.status = 'finished'; this.champion = final.winner; }
  }

  nextMatch() {
    if (this.status !== 'running' || this.active) return null;
    for (let round = 0; round < this.rounds.length; round++) {
      const index = this.rounds[round].findIndex(m => m.status === 'ready');
      if (index >= 0) return { round, index, ...this.rounds[round][index] };
    }
    return null;
  }

  start() {
    const next = this.nextMatch();
    if (!next) throw new Error('Não há partida pronta ou já existe uma em andamento.');
    this.active = { round: next.round, index: next.index };
    this.rounds[next.round][next.index].status = 'playing';
    return next;
  }

  current() { return this.active ? this.rounds[this.active.round][this.active.index] : null; }

  finish(winner, score, reason = '') {
    const match = this.current();
    if (!match) throw new Error('Nenhuma partida do campeonato em andamento.');
    if (winner !== null && winner !== match.red && winner !== match.blue) throw new Error('Vencedor inválido.');
    match.winner = winner; match.score = score ? { ...score } : null;
    match.status = 'done'; match.reason = reason;
    this.active = null;
    this._refresh();
  }

  withdraw(playerId) {
    const team = this.teams.find(t => t.players.some(p => p.id === playerId));
    if (!team || this.status !== 'running') return false;
    team.withdrawn = true;
    const match = this.current();
    if (match && (match.red === team.id || match.blue === team.id)) {
      const other = match.red === team.id ? match.blue : match.red;
      this.finish(this.teams[other].withdrawn ? null : other, null, 'W.O.');
      return true;
    }
    this._refresh();
    return false;
  }

  state() {
    return { status: this.status, teams: this.teams, rounds: this.rounds, active: this.active, next: this.nextMatch(), champion: this.champion };
  }
}
