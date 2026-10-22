// Configurações do jogador, persistidas em localStorage.

const KEY = 'discofut.settings.v1';

export const DEFAULT_KEYS = Object.freeze({
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  kick: ['Space', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'KeyX'],
});

export const ACCENTS = ['#f5c542', '#4cc38a', '#f08bd1', '#5ec8f2', '#ff8a4c', '#c9a7ff'];

export const DEFAULTS = Object.freeze({
  nickname: '',
  volume: 0.7,
  muted: false,
  zoom: 1,
  quality: 'high',     // 'high' | 'low'
  fpsCap: 0,           // 0 = sincronizado com o monitor, 60, 30
  keys: DEFAULT_KEYS,
  accent: '#f5c542',
  showNames: true,
  showFps: false,
  debug: false,
  prediction: true,
  serverUrl: '',       // vazio = mesmo endereço da página
  lastArena: 'classic',
});

function clone(o) { return JSON.parse(JSON.stringify(o)); }

export class Settings {
  constructor() {
    this.data = clone(DEFAULTS);
    this.listeners = new Set();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this._merge(JSON.parse(raw));
    } catch { /* localStorage indisponível: usa padrões */ }
  }

  _merge(o) {
    if (!o || typeof o !== 'object') return;
    const d = this.data;
    if (typeof o.nickname === 'string') d.nickname = o.nickname.slice(0, 20);
    if (Number.isFinite(o.volume)) d.volume = Math.min(1, Math.max(0, o.volume));
    if (typeof o.muted === 'boolean') d.muted = o.muted;
    if (Number.isFinite(o.zoom)) d.zoom = Math.min(2, Math.max(0.6, o.zoom));
    if (o.quality === 'low' || o.quality === 'high') d.quality = o.quality;
    if ([0, 30, 60].includes(o.fpsCap)) d.fpsCap = o.fpsCap;
    if (o.keys && typeof o.keys === 'object') {
      const k = clone(DEFAULT_KEYS);
      for (const a of Object.keys(k)) {
        if (Array.isArray(o.keys[a]) && o.keys[a].every((c) => typeof c === 'string') && o.keys[a].length > 0) k[a] = o.keys[a].slice(0, 6);
      }
      d.keys = k;
    }
    if (typeof o.accent === 'string' && /^#[0-9a-f]{6}$/i.test(o.accent)) d.accent = o.accent;
    for (const b of ['showNames', 'showFps', 'debug', 'prediction']) if (typeof o[b] === 'boolean') d[b] = o[b];
    if (typeof o.serverUrl === 'string') d.serverUrl = o.serverUrl.slice(0, 200);
    if (typeof o.lastArena === 'string') d.lastArena = o.lastArena.slice(0, 40);
  }

  get(k) { return this.data[k]; }

  set(k, v) {
    this.data[k] = v;
    this.save();
    for (const fn of this.listeners) fn(k, v);
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignora */ }
  }

  reset() {
    this.data = clone(DEFAULTS);
    this.save();
    for (const fn of this.listeners) fn('*', null);
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}
