import { h, select, field, popMenu, pickFile, toast } from './dom.js';
import { copyText } from './RoomBrowser.js';
import { statsTable } from './Menu.js';
import { BUILTIN_ARENAS } from '@shared/maps/arenas.js';
import { validateArena } from '@shared/maps/arenaValidate.js';

const PHASE_LABEL = { lobby: 'No lobby', waiting: 'Aguardando jogadores', countdown: 'Começando', kickoff: 'Em jogo', playing: 'Em jogo', goal: 'Em jogo', ended: 'Encerrada' };

/** Painel da sala: times, espectadores, administração, regras e chat. */
export class RoomLobby {
  constructor(app, game) {
    this.app = app;
    this.game = game;
    this.net = app.net;
    this.cols = {};
    this.el = this._build();
  }

  admin(a, extra = {}) { this.net.send({ t: 'admin', a, ...extra }); }

  _build() {
    const app = this.app;
    this.title = h('h2', {});
    this.phasePill = h('span', { class: 'pill' });
    this.codeEl = h('code', {});
    this.linkBtn = h('button', { class: 'btn small', type: 'button', onclick: () => copyText(this._link()) }, 'Copiar link');
    this.backBtn = h('button', { class: 'btn small primary', type: 'button', onclick: () => app.hideLobby() }, 'Voltar ao jogo (Esc)');
    this.connEl = h('span', { class: 'conn-state' });
    const head = h('div', { class: 'screen-head' },
      h('div', {}, h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, this.title, this.phasePill),
        h('div', { class: 'share', style: { marginTop: '6px' } }, 'Código', this.codeEl, this.linkBtn, this.connEl)),
      h('div', { class: 'btn-row', style: { marginTop: 0 } }, this.backBtn,
        h('button', { class: 'btn small', type: 'button', onclick: () => app.openSettings(() => app.showLobby()) }, 'Configurações'),
        h('button', { class: 'btn small danger', type: 'button', onclick: () => app.leaveRoom() }, 'Sair da sala')));

    const mkCol = (team, label) => {
      const count = h('span', { class: 'note' });
      const join = h('button', { class: 'btn small', type: 'button', onclick: () => this.net.send({ t: 'team', team }) }, team === 'spec' ? 'Assistir' : 'Entrar');
      const ul = h('ul', { 'aria-label': label });
      const col = h('div', { class: `room-col ${team}` }, h('header', {}, h('span', {}, label, ' ', count), join), ul);
      this.cols[team] = { col, ul, count, join };
      return col;
    };
    const columns = h('div', { class: 'room-cols' }, mkCol('red', 'Vermelho'), mkCol('spec', 'Espectadores'), mkCol('blue', 'Azul'));

    // Controles do administrador.
    this.btnStart = h('button', { class: 'btn primary', type: 'button', onclick: () => this.admin('start') }, '▶ Iniciar');
    this.btnStop = h('button', { class: 'btn', type: 'button', onclick: () => this.admin('stop') }, '■ Parar');
    this.btnRestart = h('button', { class: 'btn', type: 'button', onclick: () => this.admin('restart') }, '↺ Reiniciar');
    this.btnPause = h('button', { class: 'btn', type: 'button', onclick: () => this.admin(this.game.room?.paused ? 'resume' : 'pause') }, 'Pausar');
    this.btnBalance = h('button', { class: 'btn', type: 'button', onclick: () => this.admin('balance') }, 'Auto-balancear');
    this.btnLock = h('button', { class: 'btn', type: 'button', onclick: () => this.admin('lock', { value: !this.game.room?.settings.teamsLocked }) }, 'Bloquear times');
    const botTeam = select([['red', 'Vermelho'], ['blue', 'Azul']], 'blue', { class: 'input', 'aria-label': 'Time do bot' });
    const botDiff = select([['easy', 'Fácil'], ['medium', 'Médio'], ['hard', 'Difícil']], 'medium', { class: 'input', 'aria-label': 'Dificuldade do bot' });
    const btnBot = h('button', { class: 'btn', type: 'button', onclick: () => this.admin('addbot', { team: botTeam.value, difficulty: botDiff.value }) }, '+ Bot');
    this.btnBot = btnBot;
    this.adminBar = h('div', {},
      h('div', { class: 'btn-row' }, this.btnStart, this.btnStop, this.btnRestart, this.btnPause, this.btnBalance, this.btnLock),
      h('div', { class: 'btn-row', style: { alignItems: 'center' } }, botTeam, botDiff, btnBot, h('span', { class: 'note' }, 'Bots aparecem marcados como BOT.')));
    this.nonAdminNote = h('p', { class: 'note' }, 'Só o anfitrião/administradores iniciam a partida e alteram regras. Use "Entrar" para escolher um time.');
    this.resultsBox = h('div', {});
    this.tournamentBox = h('section', { class: 'tournament-box', 'aria-label': 'Campeonato de duplas' });

    // Configurações da sala.
    const S = (opts, key, cast = Number) => {
      const s = select(opts, '', { onchange: (e) => this.admin('settings', { settings: { [key]: cast(e.target.value) } }) });
      s.dataset.key = key;
      return s;
    };
    this.arenaSel = h('select', { onchange: (e) => this._onArena(e.target) });
    this.setInputs = {
      teamSize: S([[1, '1v1'], [2, '2v2'], [3, '3v3'], [4, '4v4']], 'teamSize'),
      timeLimit: S([[0, 'Sem limite'], [1, '1 min'], [2, '2 min'], [3, '3 min'], [5, '5 min'], [7, '7 min'], [10, '10 min'], [15, '15 min']], 'timeLimit'),
      scoreLimit: S([[0, 'Sem limite'], [1, '1'], [2, '2'], [3, '3'], [5, '5'], [7, '7'], [10, '10']], 'scoreLimit'),
      overtime: S([['golden', 'Gol de ouro'], ['draw', 'Empate']], 'overtime', String),
      kickMode: S([['press', 'Um por toque'], ['repeat', 'Repetir']], 'kickMode', String),
      kickCooldown: S([[4, '4 ticks'], [6, '6 ticks'], [8, '8 ticks'], [12, '12 ticks'], [20, '20 ticks']], 'kickCooldown'),
      snapshotRate: S([[20, '20 Hz'], [30, '30 Hz'], [60, '60 Hz']], 'snapshotRate'),
      maxPlayers: S([2, 4, 6, 8, 10, 12, 16].map((n) => [n, String(n)]), 'maxPlayers'),
    };
    const I = this.setInputs;
    this.settingsFs = h('fieldset', {},
      h('div', { class: 'form-grid' },
        h('label', { class: 'field', style: { gridColumn: '1 / -1' } }, 'Arena', this.arenaSel),
        field('Modo', I.teamSize), field('Tempo', I.timeLimit), field('Limite de gols', I.scoreLimit), field('Empate', I.overtime),
        field('Chute', I.kickMode), field('Cooldown do chute', I.kickCooldown), field('Snapshots', I.snapshotRate), field('Máx. pessoas', I.maxPlayers)));
    const settingsBox = h('div', { class: 'settings-box' }, h('h3', { style: { marginTop: 0 } }, 'Regras da sala'), this.settingsFs);
    this.chat = app.chat.createLobbyChat();

    return h('section', { class: 'screen wide', 'aria-label': 'Sala' }, head,
      h('div', { class: 'room-layout' },
        h('div', {}, columns, this.adminBar, this.nonAdminNote, this.tournamentBox, this.resultsBox),
        h('div', { class: 'room-side' }, settingsBox, this.chat.box)));
  }

  _link() {
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    u.searchParams.set('sala', this.game.room.code);
    return u.toString();
  }

  async _onArena(sel) {
    const v = sel.value;
    const room = this.game.room;
    if (v === '__import') {
      sel.value = room.arena.id;
      const f = await pickFile();
      if (!f) return;
      if (f.error) { toast(f.error, 'error'); return; }
      const r = validateArena(f.text);
      if (!r.ok) { toast(`Arena inválida: ${r.errors.slice(0, 3).join(' ')}`, 'error', 6000); return; }
      this.admin('arena', { custom: r.arena });
      return;
    }
    if (v.startsWith('custom:')) {
      const def = this.app.arenas.get(v.slice(7));
      this.admin('arena', { custom: def });
      return;
    }
    this.admin('arena', { id: v });
  }

  _memberMenu(ev, m) {
    const r = this.game.room;
    const items = [];
    for (const [team, label] of [['red', 'Mover para Vermelho'], ['spec', 'Mover para Espectadores'], ['blue', 'Mover para Azul']]) {
      if (!r.tournament && m.team !== team) items.push({ label, action: () => this.admin('move', { id: m.id, team }) });
    }
    items.push('-');
    if (m.bot) items.push({ label: 'Remover bot', danger: true, action: () => this.admin('rmbot', { id: m.id }) });
    else if (m.id !== this.game.myId) {
      if (!m.admin) items.push({ label: 'Tornar administrador', action: () => this.admin('admin', { id: m.id, value: true }) });
      else if (r.hostId === this.game.myId && !m.host) items.push({ label: 'Remover administrador', action: () => this.admin('admin', { id: m.id, value: false }) });
      if (!m.host) {
        items.push({ label: m.muted ? 'Liberar chat' : 'Silenciar no chat', action: () => this.admin(m.muted ? 'unmute' : 'mute', { id: m.id }) });
        items.push({ label: 'Expulsar', danger: true, action: () => this.admin('kick', { id: m.id }) });
        items.push({ label: 'Banir (10 min)', danger: true, action: () => this.admin('ban', { id: m.id }) });
      }
    }
    const rect = ev.currentTarget.getBoundingClientRect();
    popMenu(rect.left, rect.bottom + 4, items);
  }

  update(room) {
    if (!room) return;
    const game = this.game;
    const isAdmin = game.isAdmin;
    const running = room.phase !== 'lobby';
    this.title.textContent = room.name;
    this.phasePill.textContent = room.paused ? 'Pausada' : PHASE_LABEL[room.phase] || room.phase;
    this.phasePill.className = `pill ${running && room.phase !== 'ended' ? 'live' : ''}`;
    this.codeEl.textContent = room.code;
    this.backBtn.hidden = !running;
    const net = this.net;
    this.connEl.textContent = net.state === 'open' ? `● ${Math.round(net.rtt)} ms` : net.state === 'reconnecting' ? '● Reconectando…' : '● Desconectado';
    this.connEl.className = `conn-state ${net.state === 'open' ? 'ok' : net.state === 'reconnecting' ? 'mid' : 'bad'}`;

    const teamSize = room.settings.teamSize;
    const locked = !!room.tournament || (room.settings.teamsLocked && !isAdmin);
    for (const team of ['red', 'spec', 'blue']) {
      const c = this.cols[team];
      const list = room.members.filter((m) => m.team === team);
      c.count.textContent = team === 'spec' ? `(${list.length})` : `${list.length}/${teamSize}`;
      c.join.hidden = game.myTeam === team;
      c.join.disabled = locked || (team !== 'spec' && list.length >= teamSize);
      c.join.title = locked ? 'Times bloqueados' : '';
      c.ul.replaceChildren(...list.map((m) => {
        const li = h('li', { class: m.id === game.myId ? 'me' : '' },
          h('span', { class: 'nm', title: m.name }, m.name),
          m.host ? h('span', { class: 'pill admin', title: 'Anfitrião' }, '★') : m.admin ? h('span', { class: 'pill admin' }, 'admin') : '',
          m.bot ? h('span', { class: 'pill bot' }, `BOT${m.difficulty ? ` ${({ easy: 'F', medium: 'M', hard: 'D' })[m.difficulty]}` : ''}`) : '',
          m.muted ? h('span', { class: 'pill', title: 'Silenciado' }, '🔇') : '',
          m.away ? h('span', { class: 'pill away' }, 'caiu') : '',
          !m.bot ? h('span', { class: 'ping' }, m.ping ? `${m.ping}ms` : '') : '');
        if (isAdmin) li.append(h('button', { class: 'menu', type: 'button', 'aria-label': `Ações para ${m.name}`, onclick: (e) => this._memberMenu(e, m) }, '⋮'));
        return li;
      }));
    }

    this.adminBar.hidden = !isAdmin;
    this.nonAdminNote.hidden = isAdmin;
    this.btnStart.hidden = running;
    this.btnStop.hidden = !running;
    this.btnRestart.hidden = !running;
    this.btnPause.hidden = !running || room.phase === 'ended';
    this.btnPause.textContent = room.paused ? 'Retomar' : 'Pausar';
    this.btnLock.textContent = room.settings.teamsLocked ? 'Desbloquear times' : 'Bloquear times';
    for (const button of [this.btnStart, this.btnStop, this.btnRestart, this.btnBalance, this.btnLock]) button.disabled = !!room.tournament;
    this.btnBot.disabled = !!room.tournament;

    this.settingsFs.disabled = !isAdmin || !!room.tournament;
    this._updateTournament(room, isAdmin);
    for (const [k, inp] of Object.entries(this.setInputs)) {
      if (document.activeElement === inp) continue;
      const v = k === 'maxPlayers' ? room.maxPlayers : room.settings[k];
      inp.value = String(v);
    }
    if (document.activeElement !== this.arenaSel) {
      const opts = BUILTIN_ARENAS.map((a) => [a.id, a.name]);
      const isBuiltin = BUILTIN_ARENAS.some((a) => a.id === room.arena.id);
      if (!isBuiltin) opts.push([room.arena.id, `${room.arena.name} (personalizada)`]);
      if (isAdmin) {
        for (const c of this.app.arenas.all().filter((a) => !a.builtin && a.id !== room.arena.id)) opts.push([`custom:${c.id}`, `Enviar: ${c.name}`]);
        opts.push(['__import', 'Importar arquivo JSON…']);
      }
      this.arenaSel.replaceChildren(...opts.map(([v, l]) => h('option', { value: v }, l)));
      this.arenaSel.value = room.arena.id;
      this.arenaSel.disabled = !isAdmin || (running && room.phase !== 'ended');
      this.arenaSel.title = running && room.phase !== 'ended' ? 'Pare a partida para trocar a arena' : '';
    }

    this.resultsBox.replaceChildren();
    if (room.phase === 'ended' && room.stats) {
      const w = room.winner === 'draw' ? 'Empate' : `Vitória do ${room.winner === 'red' ? 'Vermelho' : 'Azul'}`;
      this.resultsBox.append(h('h3', {}, `Resultado: ${w} — ${room.score.red} × ${room.score.blue}`), statsTable(room.stats),
        game.replay.hasReplay() ? h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: () => { this.app.hideLobby(); game.startReplay(); } }, 'Replay do último gol (local)')) : '');
    }
  }

  _updateTournament(room, isAdmin) {
    const t = room.tournament;
    const players = room.members.filter(p => !p.bot && !p.away);
    const canDraw = players.length >= 4 && players.length <= 16 && players.length % 2 === 0
      && !room.members.some(p => p.bot) && ['lobby', 'ended'].includes(room.phase);
    const teamName = id => id === null ? 'A definir' : t.teams[id].players.map(p => p.name).join(' + ');
    const buttons = [];
    if (isAdmin) {
      if (!t && room.maxPlayers < 16) buttons.push(h('button', {
        class: 'btn', type: 'button', onclick: () => this.admin('settings', { settings: { maxPlayers: 16 } }),
      }, 'Permitir até 16 participantes'));
      if (!t || t.status === 'finished') buttons.push(h('button', {
        class: 'btn primary', type: 'button', disabled: !canDraw,
        onclick: () => this.admin('tournament_draw'),
      }, t ? 'Novo sorteio' : 'Sortear duplas'));
      if (t?.status === 'running') buttons.push(h('button', {
        class: 'btn primary', type: 'button', disabled: !t.next,
        onclick: () => this.admin('tournament_next'),
      }, t.active ? 'Partida em andamento' : 'Iniciar próxima partida'));
      if (t) buttons.push(h('button', {
        class: 'btn', type: 'button',
        onclick: () => { if (t.status === 'finished' || confirm('Cancelar o campeonato e voltar ao modo normal?')) this.admin('tournament_cancel'); },
      }, t.status === 'finished' ? 'Voltar ao modo normal' : 'Cancelar campeonato'));
    }
    const content = [h('h3', {}, 'Campeonato de duplas'),
      h('p', { class: 'note' }, t
        ? 'Mata-mata 2v2. Uma partida por vez; os demais assistem. Empates vão para gol de ouro.'
        : `${players.length}/16 jogadores presentes. Reúna de 4 a 16 pessoas, em quantidade par. O sorteio inclui os espectadores. Remova os bots e pare a partida para sortear.`),
      h('div', { class: 'btn-row' }, buttons)];
    if (t) {
      if (t.status === 'finished') content.push(h('p', { class: 'tournament-champion', role: 'status' },
        t.champion === null ? 'Campeonato encerrado sem campeão.' : `Dupla campeã: ${teamName(t.champion)}`));
      const roster = h('ul', { class: 'tournament-roster' }, t.teams.map(team =>
        h('li', {}, `Dupla ${team.id + 1}: ${teamName(team.id)}${team.withdrawn ? ' — desistiu' : ''}`)));
      content.push(roster, h('div', { class: 'tournament-rounds' }, t.rounds.map((matches, r) => {
        const remaining = t.rounds.length - r;
        const title = remaining === 1 ? 'Final' : remaining === 2 ? 'Semifinais' : 'Quartas de final';
        return h('section', { class: 'tournament-round', 'aria-label': title }, h('h4', {}, title), matches.map((match, i) => {
          const next = t.next?.round === r && t.next?.index === i;
          const label = match.status === 'playing' ? 'Em jogo' : next ? 'Próxima partida' : match.status === 'bye' ? match.reason : match.status === 'done' ? 'Encerrada' : 'Aguardando';
          return h('div', { class: `tournament-match ${match.status === 'playing' || next ? 'live' : ''}` },
            h('span', { class: 'pill' }, label),
            h('p', {}, match.red === null && match.status === 'bye' ? 'Folga' : teamName(match.red)),
            h('span', { class: 'note' }, match.score ? `${match.score.red} × ${match.score.blue}` : '×'),
            h('p', {}, match.blue === null && match.status === 'bye' ? 'Folga' : teamName(match.blue)),
            match.winner !== null ? h('strong', {}, `Avançou: ${teamName(match.winner)}${match.reason === 'W.O.' ? ' (W.O.)' : ''}`) : '');
        }));
      })));
    }
    this.tournamentBox.replaceChildren(...content);
  }

  dispose() { this.chat.dispose(); }
}
