import { h, field, select, toast, downloadText, pickFile } from '../ui/dom.js';
import { buildArenaGeometry } from '@shared/maps/arenaGeometry.js';
import { validateArena, ARENA_LIMITS } from '@shared/maps/arenaValidate.js';
import { BUILTIN_ARENAS, structuredCloneSafe } from '@shared/maps/arenas.js';
import { physicsConfig } from '@shared/config/physicsConfig.js';

const SNAP = 5;
const HANDLE_PX = 9;
const TEAM_COLORS = { red: '#e5484d', blue: '#3b82f6' };

/**
 * Editor básico de arenas: arrastar spawns, traves, cantos do campo e
 * obstáculos; criar segmentos/discos; validar; testar; salvar/importar JSON.
 */
export class ArenaEditor {
  constructor(app, def) {
    this.app = app;
    this.kind = 'editor';
    this.def = structuredCloneSafe(def || BUILTIN_ARENAS[0]);
    if (this.app.arenas.isBuiltin(this.def.id)) { this.def.id = 'custom'; this.def.name = `${this.def.name} (cópia)`; }
    this.tool = 'select';
    this.snap = true;
    this.selected = null;    // {kind:'obstacle', index}
    this.drag = null;
    this.preview = null;
    this.zoom = 1; this.panX = 0; this.panY = 0;
    this.errors = [];
    this._rebuild();
    this.panel = this._buildPanel();
    document.getElementById('app').append(this.panel);
    document.getElementById('app').classList.add('editor-active');
    app.renderer.resize();
    this._bind();
    this._validate();
  }

  destroy() {
    this.panel.remove();
    document.getElementById('app').classList.remove('editor-active');
    const c = this.app.renderer.canvas;
    c.removeEventListener('pointerdown', this._pd);
    window.removeEventListener('pointermove', this._pm);
    window.removeEventListener('pointerup', this._pu);
    c.removeEventListener('wheel', this._wh);
    window.removeEventListener('keydown', this._kd);
    this.app.renderer.resize();
    this.app.renderer.invalidate();
  }

  _rebuild() {
    try {
      this.geo = buildArenaGeometry(this.def);
      this.app.renderer.setArena(this.geo);
      this.app.renderer.invalidate();
    } catch { /* geometria inválida durante edição: mantém a anterior */ }
  }

  _changed() {
    this._rebuild();
    this._validate();
    this._syncFields();
  }

  _validate() {
    const r = validateArena(this.def);
    this.errors = r.ok ? [] : r.errors;
    if (this.errBox) {
      this.errBox.textContent = r.ok ? '✓ Arena válida' : r.errors.slice(0, 6).join('\n');
      this.errBox.style.color = r.ok ? 'var(--ok)' : '';
    }
    return r;
  }

  // ---------------------------------------------------------------- UI
  _num(key, get, set, min, max, step = 5) {
    const inp = h('input', { type: 'number', min: String(min), max: String(max), step: String(step), value: String(get()) });
    inp.addEventListener('change', () => {
      const v = Number(inp.value);
      if (!Number.isFinite(v)) { inp.value = String(get()); return; }
      set(Math.min(max, Math.max(min, v)));
      this._changed();
    });
    this.fields.push(() => { if (document.activeElement !== inp) inp.value = String(Math.round(get() * 100) / 100); });
    return field(key, inp);
  }

  _buildPanel() {
    const d = () => this.def;
    this.fields = [];
    const toolBtn = (id, label, key) => {
      const b = h('button', { class: 'btn small', type: 'button', 'aria-pressed': String(this.tool === id), title: `Atalho: ${key}`, onclick: () => this.setTool(id) }, label);
      b.dataset.tool = id;
      return b;
    };
    this.toolsEl = h('div', { class: 'tools', role: 'group', 'aria-label': 'Ferramentas' },
      toolBtn('select', 'Mover (V)', 'V'), toolBtn('segment', 'Segmento (S)', 'S'), toolBtn('disc', 'Disco (D)', 'D'), toolBtn('erase', 'Apagar (E)', 'E'));
    const nameInp = h('input', { maxlength: '40', value: this.def.name, oninput: (e) => { this.def.name = e.target.value; this._validate(); } });
    this.fields.push(() => { if (document.activeElement !== nameInp) nameInp.value = this.def.name; });
    const color = (key, label) => {
      const inp = h('input', { type: 'color', value: this.def.colors[key], oninput: (e) => { this.def.colors[key] = e.target.value; this._changed(); } });
      this.fields.push(() => { inp.value = this.def.colors[key]; });
      return field(label, inp);
    };
    this.propsBox = h('div', {});
    this.errBox = h('div', { class: 'err', role: 'status', style: { whiteSpace: 'pre-line' } });
    const saved = () => this.app.arenas.all().filter((a) => !a.builtin);
    const loadSel = h('select', { 'aria-label': 'Carregar arena' });
    const fillLoad = () => {
      loadSel.replaceChildren(h('option', { value: '' }, 'Carregar…'),
        h('optgroup', { label: 'Modelos' }, BUILTIN_ARENAS.map((a) => h('option', { value: `b:${a.id}` }, a.name))),
        h('optgroup', { label: 'Salvas neste navegador' }, saved().map((a) => h('option', { value: `c:${a.id}` }, a.name))));
    };
    fillLoad();
    loadSel.addEventListener('change', () => {
      const v = loadSel.value;
      loadSel.value = '';
      if (!v) return;
      const def = this.app.arenas.get(v.slice(2));
      if (v.startsWith('b:')) { def.id = 'custom'; def.name = `${def.name} (cópia)`; }
      this.def = def; this.selected = null; this.zoom = 1; this.panX = 0; this.panY = 0;
      this._changed(); this._renderProps();
    });
    const snapChk = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: this.snap, onchange: (e) => { this.snap = e.target.checked; } }), `Alinhar à grade (${SNAP})`);

    const panel = h('aside', { id: 'editor-panel', 'aria-label': 'Editor de arenas' },
      h('div', { class: 'screen-head', style: { marginBottom: 0 } }, h('h2', {}, 'Editor de arenas'), h('button', { class: 'btn small', onclick: () => this.app.goHome() }, '← Sair')),
      this.toolsEl, snapChk,
      h('p', { class: 'hint' }, 'Arraste os discos numerados (spawns), as traves (largura do gol), o fundo do gol (profundidade), o canto do campo (tamanho) e o círculo central. Roda do mouse: zoom; arraste no vazio: mover a vista.'),
      field('Nome', nameInp),
      h('div', { class: 'form-grid' },
        this._num('Largura', () => d().width, (v) => { d().width = v; }, ...ARENA_LIMITS.width, 10),
        this._num('Altura', () => d().height, (v) => { d().height = v; }, ...ARENA_LIMITS.height, 10),
        this._num('Largura do gol', () => d().goal.width, (v) => { d().goal.width = v; }, 60, 1000),
        this._num('Profundidade do gol', () => d().goal.depth, (v) => { d().goal.depth = v; }, ...ARENA_LIMITS.goalDepth),
        this._num('Margem externa', () => d().margin, (v) => { d().margin = v; }, ...ARENA_LIMITS.margin),
        this._num('Círculo central', () => d().kickoffRadius, (v) => { d().kickoffRadius = v; }, 30, 600),
        color('grass', 'Grama'), color('grassAlt', 'Faixas'), color('lines', 'Linhas'), color('border', 'Borda')),
      h('div', { class: 'btn-row', style: { marginTop: 0 } },
        h('button', { class: 'btn small', onclick: () => this._addSpawn() }, '+ Spawn (par)'),
        h('button', { class: 'btn small', onclick: () => this._removeSpawn() }, '− Spawn (par)')),
      this.propsBox,
      this.errBox,
      h('div', { class: 'btn-row', style: { marginTop: 0 } },
        h('button', { class: 'btn primary', onclick: () => this._test() }, '▶ Testar'),
        h('button', { class: 'btn', onclick: () => { const r = this.app.arenas.save(this.def); if (r.ok) { this.def.id = r.arena.id; toast('Arena salva neste navegador.', 'ok'); fillLoad(); } else toast(r.errors.slice(0, 3).join(' '), 'error', 6000); } }, 'Salvar'),
        h('button', { class: 'btn', onclick: () => this._export() }, 'Exportar JSON'),
        h('button', { class: 'btn', onclick: () => this._import() }, 'Importar JSON')),
      h('div', { class: 'btn-row', style: { marginTop: 0 } }, loadSel,
        h('button', { class: 'btn small danger', onclick: () => {
          if (this.app.arenas.isBuiltin(this.def.id) || !saved().some((a) => a.id === this.def.id)) { toast('Esta arena não está salva.', 'error'); return; }
          this.app.arenas.remove(this.def.id); fillLoad(); toast('Arena removida.', 'ok');
        } }, 'Excluir salva')),
      h('p', { class: 'hint' }, 'Formato próprio "discofut-arena" v1. Arquivos importados são validados (tamanho, geometria, spawns, gols e obstáculos) antes do uso.'),
    );
    this._renderProps();
    return panel;
  }

  _syncFields() { for (const f of this.fields) f(); }

  setTool(t) {
    this.tool = t;
    this.preview = null;
    for (const b of this.toolsEl.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.tool === t));
  }

  _renderProps() {
    const box = this.propsBox;
    box.replaceChildren();
    const sel = this.selected;
    if (!sel) { box.append(h('p', { class: 'hint' }, `Obstáculos: ${this.def.obstacles.length}/${ARENA_LIMITS.maxObstacles}. Selecione um para editar.`)); return; }
    const o = this.def.obstacles[sel.index];
    if (!o) { this.selected = null; this._renderProps(); return; }
    const mask = select([['all', 'Bola e jogadores'], ['ball', 'Só bola'], ['player', 'Só jogadores']], o.mask, { onchange: (e) => { o.mask = e.target.value; this._changed(); } });
    const bounce = h('input', { type: 'number', min: '0', max: '2', step: '0.1', value: String(o.bounce ?? 1), onchange: (e) => { o.bounce = Math.min(2, Math.max(0, Number(e.target.value) || 0)); this._changed(); } });
    const grid = h('div', { class: 'form-grid' }, field('Colide com', mask), field('Elasticidade', bounce));
    if (o.type === 'disc') {
      grid.append(field('Raio', h('input', { type: 'number', min: '2', max: '150', value: String(o.r), onchange: (e) => { o.r = Math.min(150, Math.max(2, Number(e.target.value) || 10)); this._changed(); } })));
    }
    box.append(h('h3', {}, o.type === 'disc' ? 'Disco selecionado' : 'Segmento selecionado'), grid,
      h('button', { class: 'btn small danger', onclick: () => this._deleteSelected() }, 'Apagar obstáculo (Del)'));
  }

  _deleteSelected() {
    if (!this.selected) return;
    this.def.obstacles.splice(this.selected.index, 1);
    this.selected = null;
    this._changed(); this._renderProps();
  }

  _addSpawn() {
    const s = this.def.spawns;
    if (s.red.length >= ARENA_LIMITS.maxSpawnsPerTeam) { toast('Máximo de 8 spawns por time.', 'error'); return; }
    const W = this.def.width / 2, H = this.def.height / 2;
    const i = s.red.length;
    const p = [-Math.min(W - 40, this.def.kickoffRadius + 60 + i * 30), ((i % 3) - 1) * Math.min(H - 40, 80)];
    s.red.push(p); s.blue.push([-p[0], p[1]]);
    this._changed();
  }

  _removeSpawn() {
    const s = this.def.spawns;
    if (s.red.length <= 1) { toast('Cada time precisa de ao menos um spawn.', 'error'); return; }
    s.red.pop(); s.blue.pop();
    this._changed();
  }

  _export() {
    const r = this._validate();
    if (!r.ok) { toast('Corrija os erros antes de exportar.', 'error'); return; }
    const name = (r.arena.name || 'arena').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'arena';
    downloadText(`${name}.discofut.json`, JSON.stringify(r.arena, null, 2));
  }

  async _import() {
    const f = await pickFile();
    if (!f) return;
    if (f.error) { toast(f.error, 'error'); return; }
    const r = validateArena(f.text);
    if (!r.ok) { toast(`Arquivo inválido: ${r.errors.slice(0, 3).join(' ')}`, 'error', 7000); return; }
    this.def = r.arena;
    this.selected = null;
    this._changed(); this._renderProps();
    toast(`Arena "${r.arena.name}" importada.`, 'ok');
  }

  _test() {
    const r = this._validate();
    if (!r.ok) { toast('A arena tem erros: corrija antes de testar.', 'error'); return; }
    const def = r.arena;
    this.app.startOffline({ mode: 'bots', arena: def, teamSize: Math.min(2, def.spawns.red.length), difficulty: 'medium', myTeam: 'red', timeLimit: 2, scoreLimit: 0, overtime: 'draw', kickMode: 'press' }, { fromEditor: this.def });
  }

  // ----------------------------------------------------------- pointer
  _bind() {
    const c = this.app.renderer.canvas;
    this._pd = (e) => this._down(e);
    this._pm = (e) => this._move(e);
    this._pu = (e) => this._up(e);
    this._wh = (e) => { e.preventDefault(); this.zoom = Math.min(4, Math.max(0.3, this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))); };
    this._kd = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); this._deleteSelected(); }
      else if (e.code === 'KeyV') this.setTool('select');
      else if (e.code === 'KeyS') this.setTool('segment');
      else if (e.code === 'KeyD') this.setTool('disc');
      else if (e.code === 'KeyE') this.setTool('erase');
    };
    c.addEventListener('pointerdown', this._pd);
    window.addEventListener('pointermove', this._pm);
    window.addEventListener('pointerup', this._pu);
    c.addEventListener('wheel', this._wh, { passive: false });
    window.addEventListener('keydown', this._kd);
  }

  _world(e) {
    const r = this.app.renderer.canvas.getBoundingClientRect();
    return this.app.camera.screenToWorld(e.clientX - r.left, e.clientY - r.top);
  }

  _snap(v) { return this.snap ? Math.round(v / SNAP) * SNAP : Math.round(v * 10) / 10; }

  /** Lista de alças arrastáveis em coordenadas de mundo. */
  _handles() {
    const d = this.def;
    const W = d.width / 2, H = d.height / 2, G = d.goal.width / 2;
    const hs = [
      { kind: 'corner', x: W, y: H },
      { kind: 'post', x: W, y: -G },
      { kind: 'depth', x: W + d.goal.depth, y: 0 },
      { kind: 'kickoff', x: 0, y: -d.kickoffRadius },
    ];
    for (const team of ['red', 'blue']) d.spawns[team].forEach((p, i) => hs.push({ kind: 'spawn', team, index: i, x: p[0], y: p[1], r: physicsConfig.player.radius }));
    d.obstacles.forEach((o, i) => {
      if (o.type === 'segment') { hs.push({ kind: 'segA', index: i, x: o.a[0], y: o.a[1] }); hs.push({ kind: 'segB', index: i, x: o.b[0], y: o.b[1] }); }
      else { hs.push({ kind: 'discR', index: i, x: o.p[0] + o.r, y: o.p[1] }); hs.push({ kind: 'disc', index: i, x: o.p[0], y: o.p[1], r: o.r }); }
    });
    return hs;
  }

  _hit(w) {
    const tol = HANDLE_PX / this.app.camera.scale;
    let best = null, bd = Infinity;
    for (const hd of this._handles()) {
      const d = Math.hypot(hd.x - w.x, hd.y - w.y) - (hd.r || 0);
      if (d < tol && d < bd) { bd = d; best = hd; }
    }
    if (best) return best;
    // Segmentos pelo corpo.
    this.def.obstacles.forEach((o, i) => {
      if (o.type !== 'segment' || best) return;
      const dx = o.b[0] - o.a[0], dy = o.b[1] - o.a[1];
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((w.x - o.a[0]) * dx + (w.y - o.a[1]) * dy) / l2));
      if (Math.hypot(o.a[0] + dx * t - w.x, o.a[1] + dy * t - w.y) < tol) best = { kind: 'segBody', index: i, x: w.x, y: w.y };
    });
    return best;
  }

  _down(e) {
    if (e.button !== 0) return;
    const w = this._world(e);
    const hit = this._hit(w);
    if (this.tool === 'erase') {
      if (hit && hit.index !== undefined && hit.kind !== 'spawn') { this.selected = { index: hit.index }; this._deleteSelected(); }
      return;
    }
    if (this.tool === 'segment') {
      if (this.def.obstacles.length >= ARENA_LIMITS.maxObstacles) { toast('Limite de obstáculos atingido.', 'error'); return; }
      this.preview = { a: [this._snap(w.x), this._snap(w.y)], b: [this._snap(w.x), this._snap(w.y)] };
      this.drag = { kind: 'newSeg' };
      return;
    }
    if (this.tool === 'disc') {
      if (this.def.obstacles.length >= ARENA_LIMITS.maxObstacles) { toast('Limite de obstáculos atingido.', 'error'); return; }
      this.def.obstacles.push({ type: 'disc', p: [this._snap(w.x), this._snap(w.y)], r: 14, mask: 'all', bounce: 0.9 });
      this.selected = { index: this.def.obstacles.length - 1 };
      this._changed(); this._renderProps();
      return;
    }
    if (hit) {
      this.drag = { ...hit, startX: w.x, startY: w.y, orig: structuredCloneSafe(hit.index !== undefined && hit.kind !== 'spawn' ? this.def.obstacles[hit.index] : null) };
      if (hit.index !== undefined && hit.kind !== 'spawn') { this.selected = { index: hit.index }; this._renderProps(); }
    } else {
      this.selected = null; this._renderProps();
      this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: this.panX, py: this.panY };
    }
  }

  _move(e) {
    const dr = this.drag;
    if (!dr) return;
    const w = this._world(e);
    const d = this.def;
    const sx = this._snap(w.x), sy = this._snap(w.y);
    switch (dr.kind) {
      case 'pan': {
        const s = this.app.camera.scale;
        this.panX = dr.px - (e.clientX - dr.sx) / s; this.panY = dr.py - (e.clientY - dr.sy) / s;
        return;
      }
      case 'newSeg': this.preview.b = [sx, sy]; return;
      case 'corner':
        d.width = Math.min(ARENA_LIMITS.width[1], Math.max(ARENA_LIMITS.width[0], Math.abs(sx) * 2));
        d.height = Math.min(ARENA_LIMITS.height[1], Math.max(ARENA_LIMITS.height[0], Math.abs(sy) * 2));
        break;
      case 'post': d.goal.width = Math.max(40, Math.abs(sy) * 2); break;
      case 'depth': d.goal.depth = Math.min(ARENA_LIMITS.goalDepth[1], Math.max(ARENA_LIMITS.goalDepth[0], sx - d.width / 2)); break;
      case 'kickoff': d.kickoffRadius = Math.max(30, Math.abs(sy)); break;
      case 'spawn': d.spawns[dr.team][dr.index] = [sx, sy]; break;
      case 'segA': d.obstacles[dr.index].a = [sx, sy]; break;
      case 'segB': d.obstacles[dr.index].b = [sx, sy]; break;
      case 'segBody': {
        const o = d.obstacles[dr.index];
        const dx = this._snap(w.x - dr.startX), dy = this._snap(w.y - dr.startY);
        o.a = [dr.orig.a[0] + dx, dr.orig.a[1] + dy]; o.b = [dr.orig.b[0] + dx, dr.orig.b[1] + dy];
        break;
      }
      case 'disc': d.obstacles[dr.index].p = [sx, sy]; break;
      case 'discR': { const o = d.obstacles[dr.index]; o.r = Math.max(2, Math.min(150, Math.round(Math.hypot(w.x - o.p[0], w.y - o.p[1])))); break; }
      default: return;
    }
    this._changed();
  }

  _up() {
    const dr = this.drag;
    this.drag = null;
    if (dr?.kind === 'newSeg' && this.preview) {
      const { a, b } = this.preview;
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) >= 4) {
        this.def.obstacles.push({ type: 'segment', a, b, mask: 'all', bounce: 1 });
        this.selected = { index: this.def.obstacles.length - 1 };
        this._changed(); this._renderProps();
      }
      this.preview = null;
    }
    if (dr?.kind === 'discR' || dr?.kind === 'disc') this._renderProps();
  }

  tick() { /* editor não simula */ }

  render(alpha, dt) {
    const app = this.app;
    const r = app.renderer;
    const cam = app.camera;
    const v = this.geo.view;
    const fit = Math.min(r.cssW / (2 * (v.halfW + 20)), r.cssH / (2 * (v.halfH + 20)));
    cam.viewW = r.cssW; cam.viewH = r.cssH;
    cam.scale = fit * this.zoom; cam.x = this.panX; cam.y = this.panY;
    r.draw({ ball: null, players: [] }, cam);
    const ctx = r.ctx;
    r.applyCamera(cam);
    const s = cam.scale;
    const d = this.def;
    // Spawns.
    ctx.font = `800 ${(12 / s).toFixed(2)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const team of ['red', 'blue']) {
      d.spawns[team].forEach((p, i) => {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = TEAM_COLORS[team];
        ctx.beginPath(); ctx.arc(p[0], p[1], physicsConfig.player.radius, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 / s; ctx.setLineDash([3 / s, 3 / s]); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#fff'; ctx.fillText(String(i + 1), p[0], p[1]);
      });
    }
    // Obstáculo selecionado.
    if (this.selected) {
      const o = d.obstacles[this.selected.index];
      if (o) {
        ctx.strokeStyle = app.settings.get('accent'); ctx.lineWidth = 3 / s;
        ctx.beginPath();
        if (o.type === 'segment') { ctx.moveTo(o.a[0], o.a[1]); ctx.lineTo(o.b[0], o.b[1]); } else ctx.arc(o.p[0], o.p[1], o.r + 3 / s, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (this.preview) {
      ctx.strokeStyle = app.settings.get('accent'); ctx.lineWidth = 3 / s; ctx.setLineDash([6 / s, 4 / s]);
      ctx.beginPath(); ctx.moveTo(this.preview.a[0], this.preview.a[1]); ctx.lineTo(this.preview.b[0], this.preview.b[1]); ctx.stroke();
      ctx.setLineDash([]);
    }
    // Alças.
    const hsz = 7 / s;
    for (const hd of this._handles()) {
      if (hd.kind === 'spawn' || hd.kind === 'disc') continue;
      ctx.fillStyle = hd.kind === 'segA' || hd.kind === 'segB' || hd.kind === 'discR' ? '#ffffff' : app.settings.get('accent');
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5 / s;
      ctx.fillRect(hd.x - hsz / 2, hd.y - hsz / 2, hsz, hsz);
      ctx.strokeRect(hd.x - hsz / 2, hd.y - hsz / 2, hsz, hsz);
    }
    if (this.errors.length) {
      ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
      ctx.fillStyle = 'rgba(239,93,93,0.9)';
      ctx.font = '600 13px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(`⚠ ${this.errors.length} problema(s) — veja o painel`, 12, 12);
    }
  }
}
