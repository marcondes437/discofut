import { h, field, select, toast } from './dom.js';
import { BUILTIN_ARENAS } from '@shared/maps/arenas.js';

const STATUS = { lobby: 'No lobby', playing: 'Em jogo', ended: 'Encerrada' };

/** Lista de salas reais do servidor, com filtros e entrada por código. */
export function roomsScreen(app) {
  const net = app.net;
  const st = { list: [], filter: '', vacancies: false, loading: true, error: '' };
  const tbody = h('tbody');
  const info = h('div', { class: 'conn-state', role: 'status' }, 'Conectando ao servidor…');
  const search = h('input', { class: 'input', placeholder: 'Filtrar por nome', 'aria-label': 'Filtrar salas por nome', oninput: (e) => { st.filter = e.target.value.toLowerCase(); render(); } });
  const vac = h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { st.vacancies = e.target.checked; render(); } }), 'Só com vagas');
  const codeInp = h('input', { class: 'input', placeholder: 'Código (ex.: K7Q2M)', maxlength: '8', style: { width: '150px', textTransform: 'uppercase' }, 'aria-label': 'Código da sala' });

  function render() {
    tbody.replaceChildren();
    const rows = st.list.filter((r) => (!st.filter || r.name.toLowerCase().includes(st.filter)) && (!st.vacancies || r.players < r.max));
    if (st.error) {
      tbody.append(h('tr', {}, h('td', { colspan: '6', class: 'empty' }, st.error, h('div', { class: 'btn-row', style: { justifyContent: 'center' } },
        h('button', { class: 'btn primary', onclick: () => app.openOfflineSetup() }, 'Treinar offline'),
        h('button', { class: 'btn', onclick: refresh }, 'Tentar de novo')))));
      return;
    }
    if (!rows.length) {
      tbody.append(h('tr', {}, h('td', { colspan: '6', class: 'empty' }, st.loading ? 'Carregando…' : st.list.length ? 'Nenhuma sala corresponde aos filtros.' : 'Nenhuma sala aberta agora. Crie a primeira!')));
      return;
    }
    const ping = Math.round(net.rtt);
    for (const r of rows) {
      const full = r.players >= r.max;
      const tr = h('tr', { tabindex: '0', class: full ? 'full' : '', 'aria-label': `Sala ${r.name}`,
        onclick: () => !full && app.joinRoom(r.code, r.locked),
        onkeydown: (e) => { if (e.key === 'Enter' && !full) app.joinRoom(r.code, r.locked); } },
      h('td', {}, r.name, h('div', { class: 'note' }, r.arena)),
      h('td', { class: 'num' }, `${r.players}/${r.max}`, r.bots ? h('span', { class: 'note' }, ` +${r.bots} bot`) : ''),
      h('td', {}, r.mode),
      h('td', {}, h('span', { class: `pill ${r.status === 'playing' ? 'live' : ''}` }, STATUS[r.status] || r.status)),
      h('td', {}, r.locked ? h('span', { class: 'pill lock' }, '🔒 Senha') : h('span', { class: 'pill' }, 'Pública')),
      h('td', { class: 'num' }, net.state === 'open' ? `${ping} ms` : '—'));
      tbody.append(tr);
    }
  }

  async function refresh() {
    st.loading = true; st.error = ''; render();
    try {
      await app.ensureConnected();
      info.textContent = '● Conectado'; info.className = 'conn-state ok';
      net.send({ t: 'list' });
    } catch (e) {
      st.loading = false;
      st.error = /indispon/i.test(e.message) ? `${e.message} Sem servidor não há salas online.` : `Servidor indisponível: ${e.message}`;
      info.textContent = '● Offline'; info.className = 'conn-state bad';
      render();
    }
  }

  const off = net.on('rooms', (m) => { st.list = Array.isArray(m.list) ? m.list : []; st.loading = false; render(); });
  const timer = setInterval(() => { if (net.state === 'open') net.send({ t: 'list' }); }, 4000);
  refresh();

  const el = h('section', { class: 'screen wide', 'aria-label': 'Salas' },
    h('div', { class: 'screen-head' }, h('h2', {}, 'Salas online'),
      h('div', { class: 'btn-row', style: { marginTop: 0 } },
        h('button', { class: 'btn small', onclick: refresh }, '↻ Atualizar'),
        h('button', { class: 'btn small primary', onclick: () => app.openCreateRoom() }, '+ Criar sala'),
        h('button', { class: 'btn small', onclick: () => app.goHome() }, '← Voltar'))),
    h('div', { class: 'btn-row', style: { marginTop: 0, marginBottom: '10px', alignItems: 'center' } }, search, vac,
      h('span', { style: { flex: 1 } }),
      h('form', { style: { display: 'flex', gap: '6px' }, onsubmit: (e) => { e.preventDefault(); const c = codeInp.value.trim().toUpperCase(); if (c) app.joinRoom(c, null); } },
        codeInp, h('button', { class: 'btn', type: 'submit' }, 'Entrar com código'))),
    h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, ['Sala', 'Jogadores', 'Modo', 'Status', 'Privacidade', 'Ping'].map((t) => h('th', {}, t)))),
      tbody),
    h('div', { class: 'btn-row between' }, info, h('span', { class: 'note' }, 'A lista mostra apenas salas realmente abertas neste servidor. Salas "não listadas" entram só por código/link.')),
  );
  el._dispose = () => { off(); clearInterval(timer); };
  render();
  return el;
}

export function createRoomScreen(app) {
  const st = { name: `Sala de ${app.settings.get('nickname') || 'Jogador'}`.slice(0, 32), visibility: 'public', password: '', maxPlayers: 8, teamSize: 2, arena: 'classic', timeLimit: 3, scoreLimit: 3 };
  const err = h('div', { class: 'err', role: 'alert' });
  const pwd = h('input', { type: 'password', maxlength: '32', placeholder: 'Senha', autocomplete: 'new-password', oninput: (e) => { st.password = e.target.value; } });
  const pwdField = field('Senha', pwd);
  const updVis = () => { pwdField.hidden = st.visibility === 'public'; pwd.placeholder = st.visibility === 'private' ? 'Obrigatória' : 'Opcional'; };
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Criar e entrar');
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (st.name.trim().length < 2) { err.textContent = 'Dê um nome à sala (mínimo 2 caracteres).'; return; }
    if (st.visibility === 'private' && !st.password) { err.textContent = 'Sala privada precisa de senha.'; return; }
    submit.disabled = true; submit.textContent = 'Criando…';
    try {
      await app.ensureConnected();
      app.net.send({ t: 'create', name: st.name, visibility: st.visibility, password: st.password, maxPlayers: st.maxPlayers, arena: st.arena,
        settings: { teamSize: st.teamSize, timeLimit: st.timeLimit, scoreLimit: st.scoreLimit } });
      app.expectJoin(() => { submit.disabled = false; submit.textContent = 'Criar e entrar'; }, (msg) => { err.textContent = msg; });
    } catch (ex) {
      err.textContent = `Não foi possível conectar: ${ex.message}`;
      submit.disabled = false; submit.textContent = 'Criar e entrar';
    }
  } },
  h('div', { class: 'form-grid' },
    field('Nome da sala', h('input', { maxlength: '32', value: st.name, required: true, oninput: (e) => { st.name = e.target.value; } })),
    field('Visibilidade', select([['public', 'Pública (na lista)'], ['private', 'Privada (na lista, com senha)'], ['unlisted', 'Não listada (só código/link)']], st.visibility, { onchange: (e) => { st.visibility = e.target.value; updVis(); } })),
    pwdField,
    field('Máx. de participantes', select([2, 4, 6, 8, 10, 12, 16].map((n) => [n, String(n)]), st.maxPlayers, { onchange: (e) => { st.maxPlayers = +e.target.value; } })),
    field('Modo', select([[1, '1v1'], [2, '2v2'], [3, '3v3'], [4, '4v4']], st.teamSize, { onchange: (e) => { st.teamSize = +e.target.value; } })),
    field('Arena', select(BUILTIN_ARENAS.map((a) => [a.id, a.name]), st.arena, { onchange: (e) => { st.arena = e.target.value; } })),
    field('Tempo', select([[0, 'Sem limite'], [1, '1 min'], [3, '3 min'], [5, '5 min'], [10, '10 min']], st.timeLimit, { onchange: (e) => { st.timeLimit = +e.target.value; } })),
    field('Limite de gols', select([[0, 'Sem limite'], [1, '1'], [3, '3'], [5, '5'], [7, '7']], st.scoreLimit, { onchange: (e) => { st.scoreLimit = +e.target.value; } }))),
  h('p', { class: 'note' }, 'Arenas personalizadas podem ser enviadas depois, de dentro da sala.'),
  err,
  h('div', { class: 'btn-row end' }, h('button', { class: 'btn', type: 'button', onclick: () => app.openRooms() }, 'Cancelar'), submit));
  updVis();
  return h('section', { class: 'screen', 'aria-label': 'Criar sala' },
    h('div', { class: 'screen-head' }, h('h2', {}, 'Criar sala'), h('button', { class: 'btn small', onclick: () => app.goHome() }, '← Voltar')),
    form);
}

export function passwordScreen(app, code) {
  const err = h('div', { class: 'err', role: 'alert' });
  const inp = h('input', { type: 'password', maxlength: '32', autocomplete: 'current-password', 'aria-label': 'Senha da sala' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Entrar');
  const el = h('section', { class: 'screen narrow', 'aria-label': 'Senha' },
    h('h2', {}, `Sala ${code}`),
    h('form', { onsubmit: (e) => {
      e.preventDefault();
      btn.disabled = true;
      app.net.send({ t: 'join', code, password: inp.value, name: app.settings.get('nickname') });
      app.expectJoin(() => { btn.disabled = false; }, (msg) => { err.textContent = msg; btn.disabled = false; inp.select(); });
    } }, field('Senha', inp), err,
    h('div', { class: 'btn-row end' }, h('button', { class: 'btn', type: 'button', onclick: () => app.openRooms() }, 'Cancelar'), btn)));
  setTimeout(() => inp.focus(), 30);
  return el;
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => toast('Copiado!', 'ok'), () => toast(text));
  toast(text);
  return Promise.resolve();
}
