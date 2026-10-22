import { Settings } from './core/Settings.js';
import { ArenaStore } from './core/ArenaStore.js';
import { GameLoop } from './core/GameLoop.js';
import { OfflineGame } from './core/OfflineGame.js';
import { OnlineGame } from './core/OnlineGame.js';
import { InputManager } from './input/InputManager.js';
import { AudioManager } from './audio/AudioManager.js';
import { CanvasRenderer } from './render/CanvasRenderer.js';
import { Camera2D } from './render/Camera2D.js';
import { HUD } from './ui/HUD.js';
import { Chat } from './ui/Chat.js';
import { h, toast, field } from './ui/dom.js';
import { homeScreen, offlineSetupScreen, howToScreen, settingsScreen, pauseScreen, resultsScreen } from './ui/Menu.js';
import { roomsScreen, createRoomScreen, passwordScreen } from './ui/RoomBrowser.js';
import { RoomLobby } from './ui/RoomLobby.js';
import { ArenaEditor } from './editor/ArenaEditor.js';
import { ClientSocket } from './network/ClientSocket.js';
import { getBuiltinArena } from '@shared/maps/arenas.js';

class App {
  constructor() {
    this.settings = new Settings();
    this.arenas = new ArenaStore();
    this.input = new InputManager(this.settings);
    this.audio = new AudioManager(this.settings);
    this.renderer = new CanvasRenderer(document.getElementById('game'), this.settings);
    this.camera = new Camera2D();
    this.hud = new HUD();
    this.chat = new Chat(this);
    this.net = new ClientSocket(this.settings);
    this.screensEl = document.getElementById('screens');
    this.session = null;
    this.lobby = null;
    this.currentScreen = null;
    this.fromEditor = null;

    this.loop = new GameLoop({ tick: () => this.session?.tick(), render: (a, dt) => this._render(a, dt), settings: this.settings });
    const onResize = () => { this.renderer.resize(); };
    window.addEventListener('resize', onResize);
    window.matchMedia?.(`(resolution: ${window.devicePixelRatio}dppx)`)?.addEventListener?.('change', onResize);
    this._applyAccent();
    this.settings.onChange((k) => {
      if (k === 'accent' || k === '*') this._applyAccent();
      if (k === 'quality' || k === '*') { this.renderer.resize(); this.renderer.invalidate(); }
    });
    this.input.onKey = (e, typing) => this._onKey(e, typing);
    this._wireNet();
  }

  _applyAccent() {
    const c = this.settings.get('accent');
    document.documentElement.style.setProperty('--accent', c);
    const n = parseInt(c.slice(1), 16);
    const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    document.documentElement.style.setProperty('--accent-ink', lum > 0.55 ? '#1b1600' : '#ffffff');
  }

  start() {
    this.loop.start();
    const code = new URLSearchParams(location.search).get('sala');
    if (code) this._joinLinkScreen(code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8));
    else this.goHome();
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* opcional */ });
    }
  }

  _render(alpha, dt) {
    if (this.session) this.session.render(alpha, dt);
    else this.renderer.clear();
  }

  // ------------------------------------------------------------ screens
  show(el, { dim = true } = {}) {
    this._disposeScreen();
    this.screensEl.replaceChildren(el);
    this.screensEl.classList.toggle('dim', dim);
    this.currentScreen = el;
    this.input.enabled = false;
    this.input.releaseAll();
    setTimeout(() => {
      if (!el.isConnected || el.contains(document.activeElement)) return;
      const f = el.querySelector('input:not([type=hidden]):not([type=range]):not([type=checkbox]), button.primary, button');
      f?.focus({ preventScroll: true });
    }, 20);
  }

  hideScreens() {
    this._disposeScreen();
    this.screensEl.replaceChildren();
    this.screensEl.classList.remove('dim');
    this.currentScreen = null;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.();
  }

  _disposeScreen() {
    if (this.currentScreen?._dispose) this.currentScreen._dispose();
  }

  _setSession(s) {
    if (this.session) this.session.destroy();
    this.session = s;
  }

  _startDemo() {
    if (this.session?.demo) return;
    const arena = getBuiltinArena('classic');
    this._setSession(new OfflineGame(this, { mode: 'demo', arena, teamSize: 2 }));
  }

  goHome() {
    this.fromEditor = null;
    if (this.session?.kind === 'online') this._leaveOnline(true);
    if (this.lobby) { this.lobby.dispose(); this.lobby = null; }
    this.hud.show(false);
    this.chat.show(false);
    this.hud.setNet('');
    this._startDemo();
    this.show(homeScreen(this));
  }

  openOfflineSetup() { this._startDemo(); this.hud.show(false); this.show(offlineSetupScreen(this)); }
  openHowTo() { this.show(howToScreen(this)); }
  openSettings(back) { this.show(settingsScreen(this, back || (() => this.goHome()))); }
  openRooms() { this._startDemo(); this.show(roomsScreen(this)); }
  openCreateRoom() { this._startDemo(); this.show(createRoomScreen(this)); }

  openEditor(def) {
    this.hideScreens();
    this.hud.show(false);
    this.chat.show(false);
    this._setSession(new ArenaEditor(this, def));
  }

  async probeServer() {
    try {
      const custom = this.settings.get('serverUrl') || new URLSearchParams(location.search).get('server');
      let url = '/healthz';
      if (custom) url = custom.replace(/^ws/, 'http').replace(/\/ws\/?$/, '') + '/healthz';
      else if (location.protocol === 'file:') return false;
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      clearTimeout(t);
      return r.ok;
    } catch { return false; }
  }

  // ------------------------------------------------------------ offline
  startOffline(opts, { fromEditor = null } = {}) {
    this.hideScreens();
    if (this.lobby) { this.lobby.dispose(); this.lobby = null; }
    const g = new OfflineGame(this, opts);
    this._setSession(g);
    this.fromEditor = fromEditor;
    this.hud.show(true);
    this.chat.show(false);
    this.hud.setNet('<span class="good">OFFLINE</span>');
    this.input.enabled = true;
    g.onEnd = (res) => this._showResults(g, res);
    if (fromEditor) toast('Testando a arena. Esc → "Voltar ao editor".', 'info', 4000);
  }

  _showResults(g, res) {
    this.input.enabled = false;
    this.show(resultsScreen(this, res, {
      onAgain: () => { this.hideScreens(); this.input.enabled = true; g.restart(); },
      onReplay: g.replay.hasReplay() ? () => {
        this.hideScreens();
        g.onReplayEnd = () => { g.onReplayEnd = null; this._showResults(g, res); };
        g.startReplay();
      } : null,
      onExit: () => (this.fromEditor ? this.openEditor(this.fromEditor) : this.goHome()),
    }));
  }

  showPause() {
    const g = this.session;
    if (!g || g.kind !== 'offline' || g.demo) return;
    g.setMenuOpen(true);
    const el = pauseScreen(this, g);
    if (this.fromEditor) {
      const back = h('button', { class: 'btn', onclick: () => this.openEditor(this.fromEditor) }, 'Voltar ao editor');
      el.querySelector('div').prepend(back);
    }
    this.show(el);
  }

  closePause() {
    this.hideScreens();
    if (this.session?.kind === 'offline') {
      this.session.setMenuOpen(false);
      this.input.enabled = true;
    }
  }

  // ------------------------------------------------------------- online
  _wireNet() {
    const net = this.net;
    net.on('joined', (m) => {
      if (this.session?.kind === 'online') return; // reconexão tratada pela sessão
      this._enterOnline(m);
    });
    // Reconectou mas a sala não existe mais (ex.: servidor reiniciado).
    net.on('welcome', () => {
      if (this.session?.kind !== 'online') return;
      clearTimeout(this._lostRoomTimer);
      const g = this.session;
      const offJoined = net.on('joined', () => { clearTimeout(this._lostRoomTimer); offJoined(); });
      this._lostRoomTimer = setTimeout(() => {
        offJoined();
        if (this.session !== g) return;
        toast('A sala não existe mais no servidor (ele pode ter reiniciado).', 'error', 6000);
        this._leaveOnline(false);
        this.goHome();
      }, 2000);
    });
    net.on('chat', (m) => {
      this.chat.add(m);
      if (!m.sys) this.audio.play('chat');
    });
    net.on('kicked', (m) => {
      toast(m.reason || 'Você foi removido da sala.', 'error', 6000);
      this._leaveOnline(false);
      this.goHome();
    });
    net.on('err', (m) => {
      if (this._joinWait && ['join', 'password', 'create', 'rooms'].includes(m.code)) return;
      toast(m.msg || 'Erro.', 'error');
    });
    net.on('state', (s) => {
      if (this.session?.kind !== 'online') return;
      if (s === 'reconnecting') toast('Conexão perdida — tentando reconectar…', 'error');
      if (s === 'open') toast('Reconectado.', 'ok');
      if (s === 'closed') {
        toast('Sem conexão com o servidor. Você pode treinar offline.', 'error', 6000);
        this._leaveOnline(false);
        this.goHome();
      }
      if (this.lobby && this.session.room) this.lobby.update(this.session.room);
    });
  }

  async ensureConnected() {
    await this.net.connect();
    this.net.send({ t: 'name', name: this.settings.get('nickname') });
  }

  /** Aguarda "joined" ou erro após um pedido de criação/entrada. */
  expectJoin(onDone, onError) {
    this._joinWait?.cancel();
    const offs = [];
    const finish = () => { for (const o of offs) o(); clearTimeout(timer); this._joinWait = null; };
    const timer = setTimeout(() => { finish(); onDone?.(); onError?.('O servidor não respondeu a tempo.'); }, 8000);
    offs.push(this.net.on('joined', () => { finish(); onDone?.(); }));
    offs.push(this.net.on('err', (m) => {
      if (!['join', 'password', 'create', 'rooms'].includes(m.code)) return;
      finish(); onDone?.();
      if (m.code === 'password' && !(this.currentScreen?.getAttribute('aria-label') === 'Senha')) { this.show(passwordScreen(this, this._pendingCode)); return; }
      onError?.(m.msg);
      if (!onError) toast(m.msg, 'error');
    }));
    this._joinWait = { cancel: finish };
  }

  async joinRoom(code, locked) {
    if (!code) return;
    this._pendingCode = code;
    try { await this.ensureConnected(); } catch (e) { toast(`Servidor indisponível: ${e.message}`, 'error'); return; }
    if (locked) { this.show(passwordScreen(this, code)); return; }
    this.net.send({ t: 'join', code, name: this.settings.get('nickname') });
    this.expectJoin(null, (msg) => toast(msg, 'error', 5000));
  }

  _joinLinkScreen(code) {
    this._startDemo();
    const nick = h('input', { maxlength: '20', value: this.settings.get('nickname'), placeholder: 'Seu apelido', 'aria-label': 'Apelido' });
    const err = h('div', { class: 'err', role: 'alert' });
    this.show(h('section', { class: 'screen narrow', 'aria-label': 'Entrar pelo link' },
      h('h2', {}, `Convite para a sala ${code}`),
      h('form', { onsubmit: (e) => {
        e.preventDefault();
        const v = nick.value.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
        if (!v) { err.textContent = 'Escolha um apelido.'; return; }
        this.settings.set('nickname', v);
        this.joinRoom(code, null);
      } }, field('Apelido', nick), err,
      h('div', { class: 'btn-row end' },
        h('button', { class: 'btn', type: 'button', onclick: () => { history.replaceState(null, '', location.pathname); this.goHome(); } }, 'Ir ao menu'),
        h('button', { class: 'btn primary', type: 'submit' }, 'Entrar na sala')))));
  }

  _enterOnline(joined) {
    this.hideScreens();
    if (this.lobby) { this.lobby.dispose(); this.lobby = null; }
    this.chat.clear();
    const g = new OnlineGame(this, this.net, joined);
    this._setSession(g);
    this.lobby = new RoomLobby(this, g);
    let lastPhase = joined.room.phase;
    g.onRoom = (room) => {
      this.lobby.update(room);
      if (lastPhase === 'lobby' && room.phase !== 'lobby') this.hideLobby();
      if (lastPhase !== 'lobby' && room.phase === 'lobby') this.showLobby();
      lastPhase = room.phase;
    };
    g.onEvent = (e) => { if (e.type === 'end') setTimeout(() => { if (this.session === g && g.room?.phase === 'ended') this.showLobby(); }, 3000); };
    this.chat.send = (m) => this.net.send({ t: 'chat', m });
    this.chat.show(true);
    this.hud.show(true);
    this.lobby.update(g.room);
    const u = new URL(location.href);
    u.searchParams.set('sala', g.room.code);
    history.replaceState(null, '', u);
    this.audio.play('join');
    if (g.room.phase === 'lobby') this.showLobby(); else this.hideLobby();
  }

  showLobby() {
    if (!this.lobby) return;
    this.show(this.lobby.el);
    this.lobby.update(this.session?.room);
  }

  hideLobby() {
    this.hideScreens();
    if (this.session?.kind === 'online') this.input.enabled = true;
  }

  leaveRoom() {
    this.net.send({ t: 'leave' });
    this._leaveOnline(false);
    this.audio.play('leave');
    this.goHome();
  }

  _leaveOnline(sendLeave) {
    if (sendLeave) this.net.send({ t: 'leave' });
    if (this.lobby) { this.lobby.dispose(); this.lobby = null; }
    if (this.session?.kind === 'online') this._setSession(null);
    this.chat.show(false);
    this.chat.send = null;
    const u = new URL(location.href);
    if (u.searchParams.has('sala')) { u.searchParams.delete('sala'); history.replaceState(null, '', u); }
  }

  // ------------------------------------------------------------ teclado
  _onKey(e, typing) {
    if (e.code === 'F3') { e.preventDefault(); this.settings.set('debug', !this.settings.get('debug')); return true; }
    if (typing) return false;
    const g = this.session;
    if (!g) return false;
    if (g.replay?.playing) { e.preventDefault(); g.stopReplay(); if (g.onReplayEnd) g.onReplayEnd(); return true; }
    if (g.kind === 'offline' && !g.demo) {
      if (e.code === 'Escape') {
        e.preventDefault();
        if (this.currentScreen) { if (this.currentScreen.getAttribute('aria-label') === 'Pausa') this.closePause(); }
        else this.showPause();
        return true;
      }
      return false;
    }
    if (g.kind === 'online') {
      if (e.code === 'Escape') {
        e.preventDefault();
        if (this.currentScreen === this.lobby?.el) { if (g.room?.phase !== 'lobby') this.hideLobby(); }
        else if (this.currentScreen) this.showLobby();
        else this.showLobby();
        return true;
      }
      if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !this.currentScreen) {
        e.preventDefault();
        this.input.releaseAll();
        this.chat.open();
        return true;
      }
    }
    return false;
  }
}

const app = new App();
window.__discofut = app; // útil para depuração no console
app.start();
