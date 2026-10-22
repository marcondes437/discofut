import { h } from './dom.js';
import { LIMITS } from '@shared/protocol/messages.js';

const MAX_LINES = 80;

/**
 * Chat da sala: sobreposição durante o jogo (Enter abre, Esc fecha) e log
 * espelhado no lobby. Todo texto é inserido com textContent.
 */
export class Chat {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('chat');
    this.log = document.getElementById('chat-log');
    this.form = document.getElementById('chat-form');
    this.input = document.getElementById('chat-input');
    this.lobbyLogs = new Set();
    this.lines = [];
    this.send = null; // (text) => void
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this._submit(this.input);
      this.close();
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.input.value = ''; this.close(); }
    });
    this.input.addEventListener('focus', () => { this.root.classList.add('focused'); this.app.input.releaseAll(); });
    this.input.addEventListener('blur', () => this.root.classList.remove('focused'));
  }

  _submit(inputEl) {
    const text = inputEl.value.trim().slice(0, LIMITS.chatLength);
    inputEl.value = '';
    if (text && this.send) this.send(text);
  }

  show(v) { this.root.hidden = !v; if (!v) this.close(); }
  isOpen() { return document.activeElement === this.input; }
  open() { if (!this.root.hidden) this.input.focus(); }
  close() { this.input.blur(); }

  clear() {
    this.lines = [];
    this.log.replaceChildren();
    for (const l of this.lobbyLogs) l.replaceChildren();
  }

  /** Cria um log + campo de texto para o painel do lobby. */
  createLobbyChat() {
    const log = h('div', { class: 'log', 'aria-live': 'polite' });
    for (const ln of this.lines) log.append(this._line(ln, false));
    const inp = h('input', { maxlength: String(LIMITS.chatLength), placeholder: 'Mensagem…', 'aria-label': 'Mensagem do chat da sala' });
    const form = h('form', { autocomplete: 'off', onsubmit: (e) => { e.preventDefault(); this._submit(inp); } }, inp, h('button', { class: 'btn small', type: 'submit', style: { margin: '4px' } }, 'Enviar'));
    const box = h('div', { class: 'lobby-chat' }, log, form);
    this.lobbyLogs.add(log);
    log.scrollTop = log.scrollHeight;
    return { box, log, dispose: () => this.lobbyLogs.delete(log) };
  }

  _line(ln, overlay) {
    if (ln.sys) return h('div', { class: overlay ? 'msg sys' : 'sys' }, ln.m);
    return h('div', { class: overlay ? 'msg' : '' }, h('span', { class: `who ${ln.team || 'spec'}` }, `${ln.name}:`), ln.m);
  }

  add(ln) {
    this.lines.push(ln);
    if (this.lines.length > MAX_LINES) this.lines.shift();
    this.log.append(this._line(ln, true));
    while (this.log.childElementCount > 12) this.log.firstElementChild.remove();
    this.log.scrollTop = this.log.scrollHeight;
    for (const l of this.lobbyLogs) {
      l.append(this._line(ln, false));
      while (l.childElementCount > MAX_LINES) l.firstElementChild.remove();
      l.scrollTop = l.scrollHeight;
    }
  }
}
