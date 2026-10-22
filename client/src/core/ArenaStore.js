import { BUILTIN_ARENAS, structuredCloneSafe } from '@shared/maps/arenas.js';
import { validateArena } from '@shared/maps/arenaValidate.js';

const KEY = 'discofut.arenas.v1';

/** Arenas embutidas + arenas personalizadas salvas no navegador. */
export class ArenaStore {
  constructor() { this.custom = this._load(); }

  _load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      return raw.map((a) => validateArena(a)).filter((r) => r.ok).map((r) => r.arena);
    } catch { return []; }
  }

  _persist() {
    try { localStorage.setItem(KEY, JSON.stringify(this.custom)); return true; } catch { return false; }
  }

  all() {
    return [
      ...BUILTIN_ARENAS.map((a) => ({ id: a.id, name: a.name, builtin: true })),
      ...this.custom.map((a) => ({ id: a.id, name: `${a.name} (sua)`, builtin: false })),
    ];
  }

  get(id) {
    const b = BUILTIN_ARENAS.find((a) => a.id === id);
    if (b) return structuredCloneSafe(b);
    const c = this.custom.find((a) => a.id === id);
    return c ? structuredCloneSafe(c) : structuredCloneSafe(BUILTIN_ARENAS[0]);
  }

  isBuiltin(id) { return BUILTIN_ARENAS.some((a) => a.id === id); }

  /** Salva (validando). Retorna {ok, arena} ou {ok:false, errors}. */
  save(def) {
    const r = validateArena(def);
    if (!r.ok) return r;
    let a = r.arena;
    if (!a.id || a.id === 'custom' || this.isBuiltin(a.id)) a = { ...a, id: `u-${Date.now().toString(36)}` };
    const i = this.custom.findIndex((x) => x.id === a.id);
    if (i >= 0) this.custom[i] = a; else this.custom.push(a);
    if (this.custom.length > 30) this.custom.shift();
    if (!this._persist()) return { ok: false, errors: ['Não foi possível salvar no navegador (armazenamento cheio ou bloqueado).'] };
    return { ok: true, arena: a };
  }

  remove(id) {
    this.custom = this.custom.filter((a) => a.id !== id);
    this._persist();
  }
}
