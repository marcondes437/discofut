import { IN_UP, IN_DOWN, IN_LEFT, IN_RIGHT, IN_KICK } from '@shared/config/physicsConfig.js';

// Perfis fixos para 2 jogadores no mesmo teclado.
export const LOCAL_PROFILES = Object.freeze({
  p1: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], kick: ['Space', 'KeyX', 'ShiftLeft', 'ControlLeft'] },
  p2: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], kick: ['Numpad0', 'Period', 'Slash', 'ShiftRight', 'ControlRight', 'Enter', 'NumpadEnter'] },
});

/**
 * Lê o teclado por eventos (independente do frame de renderização) e expõe
 * amostras de bits por tick. Pressões rápidas de chute (keydown+keyup entre
 * dois ticks) ficam "travadas" até serem consumidas, então nunca se perdem.
 */
export class InputManager {
  constructor(settings) {
    this.settings = settings;
    this.held = new Set();
    this.latched = new Set();      // códigos pressionados ainda não amostrados
    this.enabled = false;          // jogo em foco (bloqueia rolagem etc.)
    this.onKey = null;             // callback para atalhos (Esc, Enter, F3...)
    this._down = (e) => this._handle(e, true);
    this._up = (e) => this._handle(e, false);
    this._blur = () => this.releaseAll();
    this._vis = () => { if (document.hidden) this.releaseAll(); };
    window.addEventListener('keydown', this._down, { capture: true });
    window.addEventListener('keyup', this._up, { capture: true });
    window.addEventListener('blur', this._blur);
    document.addEventListener('visibilitychange', this._vis);
  }

  destroy() {
    window.removeEventListener('keydown', this._down, { capture: true });
    window.removeEventListener('keyup', this._up, { capture: true });
    window.removeEventListener('blur', this._blur);
    document.removeEventListener('visibilitychange', this._vis);
  }

  releaseAll() { this.held.clear(); this.latched.clear(); }

  _isTyping(e) {
    const t = e.target;
    if (!t || !(t instanceof HTMLElement)) return false;
    return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
  }

  _allGameCodes() {
    const set = new Set();
    for (const list of Object.values(this.settings.get('keys'))) for (const c of list) set.add(c);
    for (const p of Object.values(LOCAL_PROFILES)) for (const list of Object.values(p)) for (const c of list) set.add(c);
    return set;
  }

  _handle(e, down) {
    if (this._isTyping(e)) {
      // Controles de jogo ignorados enquanto o chat/inputs têm foco.
      if (down && this.onKey) this.onKey(e, true);
      return;
    }
    if (down && this.onKey && this.onKey(e, false) === true) return; // atalho consumido
    if (!this.enabled) return;
    const code = e.code;
    if (this._allGameCodes().has(code)) {
      e.preventDefault(); // evita rolagem da página com setas/espaço
      if (down) {
        if (!e.repeat) this.latched.add(code);
        this.held.add(code);
      } else this.held.delete(code);
    }
  }

  _active(codes) {
    for (const c of codes) if (this.held.has(c) || this.latched.has(c)) return true;
    return false;
  }

  /** Bits de entrada para o perfil ('main' usa os atalhos remapeáveis). */
  sample(profile = 'main') {
    const k = profile === 'main' ? this.settings.get('keys') : LOCAL_PROFILES[profile];
    let bits = 0;
    if (this._active(k.up)) bits |= IN_UP;
    if (this._active(k.down)) bits |= IN_DOWN;
    if (this._active(k.left)) bits |= IN_LEFT;
    if (this._active(k.right)) bits |= IN_RIGHT;
    if (this._active(k.kick)) bits |= IN_KICK;
    // Cancela direções opostas.
    if ((bits & (IN_UP | IN_DOWN)) === (IN_UP | IN_DOWN)) bits &= ~(IN_UP | IN_DOWN);
    if ((bits & (IN_LEFT | IN_RIGHT)) === (IN_LEFT | IN_RIGHT)) bits &= ~(IN_LEFT | IN_RIGHT);
    return bits;
  }

  /** Chamar uma vez por tick após amostrar todos os perfis. */
  endTick() { this.latched.clear(); }
}
