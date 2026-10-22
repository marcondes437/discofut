import { h, field, select, segmented, keyLabel, toast, fmtClock } from './dom.js';
import { ACCENTS, DEFAULT_KEYS } from '../core/Settings.js';
import { LOCAL_PROFILES } from '../input/InputManager.js';

const KEY_ACTIONS = [['up', 'Cima'], ['down', 'Baixo'], ['left', 'Esquerda'], ['right', 'Direita'], ['kick', 'Chutar']];

export function homeScreen(app) {
  const s = app.settings;
  const nick = h('input', { id: 'nick', maxlength: '20', placeholder: 'Seu apelido', value: s.get('nickname'), autocomplete: 'nickname', 'aria-label': 'Apelido' });
  const saveNick = () => {
    const v = nick.value.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
    s.set('nickname', v);
    return v;
  };
  nick.addEventListener('change', saveNick);
  const requireNick = () => {
    const v = saveNick();
    if (!v) { toast('Escolha um apelido primeiro.', 'error'); nick.focus(); return false; }
    return true;
  };
  const status = h('span', { class: 'conn-state' }, 'Verificando servidor…');
  app.probeServer().then((ok) => {
    status.textContent = ok ? '● Servidor online' : '● Servidor indisponível — jogue offline';
    status.className = `conn-state ${ok ? 'ok' : 'bad'}`;
  });
  const btn = (label, sub, onclick, cls = '') => h('button', { class: `btn ${cls}`, type: 'button', onclick: () => { app.audio.play('ui'); onclick(); } }, label, h('small', {}, sub));
  return h('section', { class: 'screen', 'aria-label': 'Menu principal' },
    h('div', { class: 'brand' },
      h('div', { class: 'logo', 'aria-hidden': 'true' }),
      h('div', {}, h('div', { class: 'title' }, 'Disco', h('b', {}, 'Fut')), h('div', { class: 'sub' }, 'Futebol de discos 2D · física própria · multiplayer'))),
    h('label', { class: 'field', style: { marginBottom: '14px' } }, 'Apelido', nick),
    h('div', { class: 'menu-grid' },
      btn('Jogar Offline', 'Treino, bots ou 2 jogadores', () => app.openOfflineSetup(), 'primary'),
      btn('Buscar Salas', 'Salas reais deste servidor', () => requireNick() && app.openRooms()),
      btn('Criar Sala', 'Pública, privada ou por código', () => requireNick() && app.openCreateRoom()),
      btn('Editor de Arenas', 'Crie, teste e exporte JSON', () => app.openEditor()),
      btn('Configurações', 'Som, vídeo, atalhos', () => app.openSettings(() => app.goHome())),
      btn('Como Jogar', 'Controles e regras', () => app.openHowTo()),
    ),
    h('div', { class: 'btn-row between' }, status, h('span', { class: 'note' }, 'F3: modo de depuração')),
  );
}

export function offlineSetupScreen(app) {
  const st = { mode: 'bots', teamSize: 1, difficulty: 'medium', myTeam: 'red', arena: app.settings.get('lastArena'), timeLimit: 3, scoreLimit: 3, overtime: 'golden', kickMode: 'press' };
  if (!app.arenas.all().some((a) => a.id === st.arena)) st.arena = 'classic';
  const arenaSel = select(app.arenas.all().map((a) => [a.id, a.name]), st.arena, { onchange: (e) => { st.arena = e.target.value; } });
  const sizeSel = select([[1, '1 contra 1'], [2, '2 contra 2'], [3, '3 contra 3'], [4, '4 contra 4']], st.teamSize, { onchange: (e) => { st.teamSize = +e.target.value; } });
  const diffSel = select([['easy', 'Fácil'], ['medium', 'Médio'], ['hard', 'Difícil']], st.difficulty, { onchange: (e) => { st.difficulty = e.target.value; } });
  const teamSel = select([['red', 'Vermelho'], ['blue', 'Azul']], st.myTeam, { onchange: (e) => { st.myTeam = e.target.value; } });
  const timeSel = select([[0, 'Sem limite'], [1, '1 min'], [2, '2 min'], [3, '3 min'], [5, '5 min'], [7, '7 min'], [10, '10 min']], st.timeLimit, { onchange: (e) => { st.timeLimit = +e.target.value; } });
  const scoreSel = select([[0, 'Sem limite'], [1, '1 gol'], [2, '2 gols'], [3, '3 gols'], [5, '5 gols'], [7, '7 gols'], [10, '10 gols']], st.scoreLimit, { onchange: (e) => { st.scoreLimit = +e.target.value; } });
  const otSel = select([['golden', 'Gol de ouro'], ['draw', 'Termina empatado']], st.overtime, { onchange: (e) => { st.overtime = e.target.value; } });
  const kickSel = select([['press', 'Um chute por toque'], ['repeat', 'Repetir enquanto segura']], st.kickMode, { onchange: (e) => { st.kickMode = e.target.value; } });
  const matchFields = h('div', { class: 'form-grid' },
    field('Times', sizeSel), field('Dificuldade dos bots', diffSel), field('Seu time', teamSel),
    field('Tempo', timeSel), field('Limite de gols', scoreSel), field('Empate no tempo', otSel));
  const p2note = h('p', { class: 'note', hidden: true },
    'Jogador 1: ', h('kbd', {}, 'W A S D'), ' + ', h('kbd', {}, 'Espaço'), ' · Jogador 2: ', h('kbd', {}, 'Setas'), ' + ', h('kbd', {}, LOCAL_PROFILES.p2.kick.slice(0, 3).map(keyLabel).join(' / ')),
    '. Bots completam os times maiores.');
  const trainNote = h('p', { class: 'note', hidden: true }, 'Sozinho com a bola e os dois gols. Sem tempo ou placar limite: pratique condução e finalização.');
  const update = () => {
    const training = st.mode === 'training';
    matchFields.hidden = training;
    teamSel.disabled = st.mode === 'local2p';
    p2note.hidden = st.mode !== 'local2p';
    trainNote.hidden = !training;
  };
  update();
  return h('section', { class: 'screen', 'aria-label': 'Jogar offline' },
    h('div', { class: 'screen-head' }, h('h2', {}, 'Jogar offline ', h('span', { class: 'badge-offline' }, 'offline')),
      h('button', { class: 'btn small', onclick: () => app.goHome() }, '← Voltar')),
    h('p', {}, 'Partida local no seu navegador — não precisa de servidor nem de internet.'),
    h('h3', {}, 'Modo'),
    segmented([['training', 'Treino solo'], ['bots', 'Amistoso com bots'], ['local2p', '2 jogadores (mesmo teclado)']], st.mode, (v) => { st.mode = v; update(); }),
    trainNote, p2note,
    h('h3', {}, 'Arena'),
    h('div', { class: 'form-grid' }, field('Arena', arenaSel), field('Chute', kickSel)),
    h('h3', {}, 'Partida'),
    matchFields,
    h('div', { class: 'btn-row end' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => {
        app.settings.set('lastArena', st.arena);
        app.startOffline({ ...st, arena: app.arenas.get(st.arena) });
      } }, 'Começar ▶')),
  );
}

export function howToScreen(app) {
  const k = app.settings.get('keys');
  const list = (a) => k[a].map(keyLabel).join(', ');
  return h('section', { class: 'screen wide', 'aria-label': 'Como jogar' },
    h('div', { class: 'screen-head' }, h('h2', {}, 'Como jogar'), h('button', { class: 'btn small', onclick: () => app.goHome() }, '← Voltar')),
    h('div', { class: 'howto-grid' },
      h('section', {}, h('h3', {}, 'Controles'), h('ul', {},
        h('li', {}, 'Mover (8 direções): ', list('up'), ' / ', list('left'), ' / ', list('down'), ' / ', list('right')),
        h('li', {}, 'Chutar: ', list('kick'), ' — a bola precisa estar encostada no seu disco'),
        h('li', {}, 'Segurar chute deixa você mais lento (bom para domínio)'),
        h('li', {}, 'Enter: chat (online) · Esc: menu da sala / pausa'),
        h('li', {}, 'F3: depuração (hitboxes e vetores)'))),
      h('section', {}, h('h3', {}, 'Regras'), h('ul', {},
        h('li', {}, 'Gol só vale quando a bola cruza inteira a linha, entre as traves'),
        h('li', {}, 'Na saída de bola, cada time fica no próprio campo; só quem dá a saída entra no círculo'),
        h('li', {}, 'Quem sofre o gol dá a saída seguinte'),
        h('li', {}, 'Fim por limite de gols ou tempo; empate pode ir para o gol de ouro'))),
      h('section', {}, h('h3', {}, 'Online'), h('ul', {},
        h('li', {}, 'Crie uma sala e compartilhe o link ou o código'),
        h('li', {}, 'O servidor decide posições, chutes e gols — o cliente só envia teclas'),
        h('li', {}, 'Anfitrião/admin: times, arena, regras, bots, pausa, expulsar e banir'),
        h('li', {}, 'Entrou como espectador? Clique em "Entrar" num time (se não estiverem bloqueados)'))),
      h('section', {}, h('h3', {}, 'Dicas'), h('ul', {},
        h('li', {}, 'O chute sai na direção do seu centro para o centro da bola: posicione-se atrás dela'),
        h('li', {}, 'Encostar sem chutar conduz a bola com controle'),
        h('li', {}, 'Use as tabelas nas paredes: os rebotes são previsíveis'),
        h('li', {}, 'Replay do último gol: no menu de pausa ou ao fim da partida'))),
    ));
}

export function settingsScreen(app, onBack) {
  const s = app.settings;
  const row = (label, input) => field(label, input);
  const range = (key, min, max, step, fmt) => {
    const out = h('span', { class: 'note' }, fmt(s.get(key)));
    const inp = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(s.get(key)),
      oninput: (e) => { s.set(key, +e.target.value); out.textContent = fmt(+e.target.value); } });
    return h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, inp, out);
  };
  const check = (key, label) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: !!s.get(key), onchange: (e) => s.set(key, e.target.checked) }), label);

  const keysBox = h('div', { class: 'keys-table' });
  let listening = null;
  const renderKeys = () => {
    keysBox.replaceChildren();
    const keys = s.get('keys');
    for (const [act, label] of KEY_ACTIONS) {
      const binds = h('div', { class: 'binds' });
      for (const code of keys[act]) {
        binds.append(h('span', { class: 'bind' }, h('kbd', {}, keyLabel(code)),
          h('button', { type: 'button', title: 'Remover', 'aria-label': `Remover ${keyLabel(code)}`, onclick: () => {
            if (keys[act].length <= 1) { toast('Cada ação precisa de ao menos uma tecla.', 'error'); return; }
            s.set('keys', { ...keys, [act]: keys[act].filter((c) => c !== code) }); renderKeys();
          } }, '×')));
      }
      const add = h('button', { class: 'btn small', type: 'button', onclick: () => {
        if (listening) listening.classList.remove('listening');
        listening = add; add.classList.add('listening'); add.textContent = 'Pressione uma tecla…';
        const onKey = (e) => {
          e.preventDefault(); e.stopPropagation();
          window.removeEventListener('keydown', onKey, true);
          listening = null;
          if (e.code === 'Escape' || e.code === 'Enter') { renderKeys(); return; }
          const cur = s.get('keys');
          const next = {};
          for (const a of Object.keys(cur)) next[a] = cur[a].filter((c) => c !== e.code); // tecla única por ação
          next[act] = [...next[act], e.code].slice(-6);
          for (const a of Object.keys(next)) if (!next[a].length) next[a] = [...DEFAULT_KEYS[a]].filter((c) => c !== e.code).slice(0, 1);
          s.set('keys', next); renderKeys();
        };
        window.addEventListener('keydown', onKey, true);
      } }, '+ Tecla');
      binds.append(add);
      keysBox.append(h('span', {}, label), binds);
    }
  };
  renderKeys();

  const swatches = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Cor de destaque' },
    ACCENTS.map((c) => h('button', { type: 'button', style: { background: c }, 'aria-label': `Cor ${c}`, 'aria-pressed': String(s.get('accent') === c),
      onclick: (e) => { s.set('accent', c); for (const b of swatches.children) b.setAttribute('aria-pressed', 'false'); e.currentTarget.setAttribute('aria-pressed', 'true'); } })));
  const server = h('input', { value: s.get('serverUrl'), placeholder: 'automático (mesmo endereço da página)', onchange: (e) => s.set('serverUrl', e.target.value.trim()) });

  return h('section', { class: 'screen', 'aria-label': 'Configurações' },
    h('div', { class: 'screen-head' }, h('h2', {}, 'Configurações'), h('button', { class: 'btn small', onclick: onBack }, '← Voltar')),
    h('h3', {}, 'Áudio'),
    h('div', { class: 'form-grid' }, row('Volume', range('volume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)), h('div', {}, check('muted', 'Silenciar tudo'))),
    h('h3', {}, 'Vídeo'),
    h('div', { class: 'form-grid' },
      row('Zoom', range('zoom', 0.6, 2, 0.05, (v) => `${v.toFixed(2)}×`)),
      row('Qualidade', select([['high', 'Alta'], ['low', 'Baixa (mais leve)']], s.get('quality'), { onchange: (e) => { s.set('quality', e.target.value); app.renderer.resize(); app.renderer.invalidate(); } })),
      row('Limite de FPS', select([[0, 'Monitor (vsync)'], [60, '60'], [30, '30']], s.get('fpsCap'), { onchange: (e) => s.set('fpsCap', +e.target.value) })),
      row('Cor de destaque', swatches)),
    h('div', { style: { display: 'flex', gap: '18px', flexWrap: 'wrap', marginTop: '10px' } },
      check('showNames', 'Mostrar nomes'), check('showFps', 'Mostrar FPS'), check('debug', 'Depuração (F3)'), check('prediction', 'Predição local online')),
    h('h3', {}, 'Atalhos (jogo e online)'),
    keysBox,
    h('p', { class: 'note' }, 'No modo 2 jogadores os controles são fixos (WASD+Espaço e Setas+Num0/./Enter).'),
    h('h3', {}, 'Rede'),
    field('Servidor (ws:// ou wss://)', server),
    h('div', { class: 'btn-row between' },
      h('button', { class: 'btn danger', type: 'button', onclick: () => { s.reset(); toast('Configurações restauradas.', 'ok'); onBack(); } }, 'Restaurar padrões'),
      h('button', { class: 'btn primary', type: 'button', onclick: onBack }, 'Pronto')),
  );
}

export function pauseScreen(app, game) {
  const items = [
    h('button', { class: 'btn primary', onclick: () => app.closePause() }, 'Continuar'),
    h('button', { class: 'btn', onclick: () => { app.closePause(); game.restart(); } }, 'Reiniciar partida'),
    h('button', { class: 'btn', disabled: !game.replay.hasReplay(), onclick: () => { app.closePause(); game.startReplay(); } }, 'Replay do último gol'),
    h('button', { class: 'btn', onclick: () => app.openSettings(() => app.showPause()) }, 'Configurações'),
    h('button', { class: 'btn danger', onclick: () => app.goHome() }, 'Sair para o menu'),
  ];
  return h('section', { class: 'screen narrow', 'aria-label': 'Pausa' },
    h('h2', {}, 'Pausado ', h('span', { class: 'badge-offline' }, 'offline')),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, items));
}

export function statsTable(rows) {
  const players = rows.filter((r) => r.team !== 'spec' || r.goals || r.seconds);
  players.sort((a, b) => (a.team > b.team ? -1 : a.team < b.team ? 1 : b.goals - a.goals));
  return h('table', { class: 'list stats' },
    h('thead', {}, h('tr', {}, ['Jogador', 'Gols', 'Assist.', 'Defesas', 'Recup.', 'Chutes', 'Contra', 'Tempo'].map((t) => h('th', {}, t)))),
    h('tbody', {}, players.map((r) => h('tr', {},
      h('td', {}, h('span', { class: `dot ${r.team}` }), r.name, r.isBot ? ' ' : '', r.isBot ? h('span', { class: 'pill bot' }, 'BOT') : ''),
      h('td', {}, r.goals), h('td', {}, r.assists), h('td', {}, r.saves), h('td', {}, r.steals), h('td', {}, r.kicks), h('td', {}, r.ownGoals),
      h('td', {}, fmtClock(r.seconds * 60))))),
  );
}

export function resultsScreen(app, res, { onAgain, onReplay, onExit, offline = true }) {
  const title = res.winner === 'draw' ? 'Empate' : res.winner ? `Vitória do ${res.winner === 'red' ? 'Vermelho' : 'Azul'}` : 'Partida encerrada';
  return h('section', { class: 'screen', 'aria-label': 'Resultado' },
    h('div', { class: 'result-title' }, title, offline ? ' ' : '', offline ? h('span', { class: 'badge-offline' }, 'offline') : ''),
    h('div', { class: 'result-score' }, h('span', { class: 'red' }, res.score.red), h('span', {}, '×'), h('span', { class: 'blue' }, res.score.blue)),
    h('p', { class: 'note', style: { textAlign: 'center' } }, `Tempo de jogo ${fmtClock(res.clockTicks)}. Assistências e defesas são estimadas pelos toques na bola.`),
    statsTable(res.stats),
    h('div', { class: 'btn-row end' },
      onReplay ? h('button', { class: 'btn', onclick: onReplay }, 'Replay do último gol') : null,
      onExit ? h('button', { class: 'btn', onclick: onExit }, 'Menu') : null,
      onAgain ? h('button', { class: 'btn primary', onclick: onAgain }, 'Jogar novamente') : null),
  );
}
