import { MatchController } from '@shared/game/MatchController.js';
import { BotManager } from '@shared/ai/BotController.js';
import { ReplayBuffer } from '../replay/ReplayBuffer.js';

/**
 * Partida local (sem servidor): treino solo, amistoso contra bots,
 * 2 jogadores no mesmo teclado, ou modo demonstração (fundo do menu).
 */
export class OfflineGame {
  /**
   * @param {any} app
   * @param {{mode:'training'|'bots'|'local2p'|'demo', arena:any, teamSize?:number, difficulty?:string,
   *          myTeam?:'red'|'blue', timeLimit?:number, scoreLimit?:number, overtime?:string, kickMode?:string,
   *          botsDifficultyRed?:string}} opts
   */
  constructor(app, opts) {
    this.app = app;
    this.opts = opts;
    this.kind = 'offline';
    this.demo = opts.mode === 'demo';
    this.menuOpen = false;
    this.replay = new ReplayBuffer(8);
    this.replayView = null;
    this.endTimer = 0;
    this._build();
  }

  _build() {
    const o = this.opts;
    const training = o.mode === 'training';
    const settings = training
      ? { timeLimit: 0, scoreLimit: 0, allowEmptyTeams: true, countdown: false, teamSize: 4, kickMode: o.kickMode || 'press' }
      : {
        timeLimit: o.timeLimit ?? 3, scoreLimit: o.scoreLimit ?? 3, overtime: o.overtime || 'golden',
        kickMode: o.kickMode || 'press', teamSize: o.teamSize || 1, countdown: !this.demo,
      };
    if (this.demo) { settings.timeLimit = 0; settings.scoreLimit = 0; }
    this.match = new MatchController({ arena: o.arena, settings });
    this.bots = new BotManager();
    this.humans = [];
    const nick = this.app.settings.get('nickname') || 'Você';
    let id = 1;
    const size = training ? 1 : Math.max(1, Math.min(4, o.teamSize || 1));
    const counts = { red: 0, blue: 0 };
    const addBot = (team, diff) => {
      counts[team]++;
      this.match.addPlayer(id, { name: `Bot ${team === 'red' ? 'V' : 'A'}${counts[team]}`, team, isBot: true });
      this.bots.add(id++, diff);
    };
    if (o.mode === 'local2p') {
      this.match.addPlayer(id, { name: nick, team: 'red' }); this.humans.push({ id: id++, profile: 'p1' }); counts.red++;
      this.match.addPlayer(id, { name: 'Jogador 2', team: 'blue' }); this.humans.push({ id: id++, profile: 'p2' }); counts.blue++;
    } else if (!this.demo) {
      const team = training ? 'red' : (o.myTeam || 'red');
      this.match.addPlayer(id, { name: nick, team }); this.humans.push({ id: id++, profile: 'main' }); counts[team]++;
    }
    if (o.mode === 'bots' || o.mode === 'local2p' || this.demo) {
      for (const team of ['red', 'blue']) {
        while (counts[team] < size) addBot(team, this.demo ? 'medium' : (o.difficulty || 'medium'));
      }
    }
    this._labels();
    this.localIds = new Set(this.humans.map((x) => x.id));
    this.app.renderer.setArena(this.match.geo);
    this.app.camera.snap();
    this.match.start();
    this.replay.clear();
  }

  _labels() {
    this.labels = new Map();
    for (const team of ['red', 'blue']) this.match.teamPlayers(team).forEach((p, i) => this.labels.set(p.id, String(i + 1)));
  }

  nameOf = (id) => this.match.players.get(id)?.name ?? '?';

  restart() {
    this.endTimer = 0;
    this.replay.clear();
    this.replayView = null;
    this.match.start();
    this.app.hud.hideBanner();
  }

  setMenuOpen(v) {
    this.menuOpen = v;
    if (!this.demo) this.match.setPaused(v);
  }

  startReplay() {
    if (!this.replay.start()) return false;
    this.app.hud.flash('Replay', this.replay.lastGoal.label || '', '', 1200);
    document.getElementById('replay-badge').hidden = false;
    return true;
  }

  stopReplay() {
    this.replay.stop();
    this.replayView = null;
    document.getElementById('replay-badge').hidden = true;
  }

  tick() {
    if (this.replay.playing) {
      this.replayView = this.replay.step();
      if (!this.replayView) {
        this.stopReplay();
        if (this.onReplayEnd) this.onReplayEnd();
      }
      return;
    }
    if (this.menuOpen) return;
    const input = this.app.input;
    for (const hmn of this.humans) this.match.setInput(hmn.id, input.sample(hmn.profile));
    input.endTick();
    this.bots.apply(this.match);
    const events = this.match.tick();
    if (this.demo) {
      // Demonstração infinita no fundo do menu.
      if (this.match.phase === 'ended') this.match.start();
      return;
    }
    if (events.length) {
      this.app.audio.playEvents(events);
      this.app.hud.handleEvents(events, this.nameOf);
    }
    const view = this._view(1);
    this.replay.record(view);
    this.replay.extend(view);
    for (const e of events) {
      if (e.type === 'goal') {
        const label = e.scorer != null ? `${e.ownGoal ? 'Gol contra de ' : ''}${this.nameOf(e.scorer)}` : '';
        this.replay.captureGoal(label, 5, 70);
      }
      if (e.type === 'end') this.endTimer = 150;
    }
    if (this.endTimer > 0 && --this.endTimer === 0 && this.onEnd) this.onEnd(this.results());
  }

  results() {
    const m = this.match;
    return { winner: m.winner, score: { ...m.score }, stats: m.statsTable(), clockTicks: m.clockTicks };
  }

  _view(alpha) {
    const m = this.match;
    const lerp = (a, b) => a + (b - a) * alpha;
    const players = [];
    for (const p of m.players.values()) {
      const b = p.body;
      if (!b) continue;
      players.push({
        id: p.id, x: lerp(b.px, b.x), y: lerp(b.py, b.y), vx: b.vx, vy: b.vy, team: p.team,
        label: this.labels.get(p.id) || '', name: p.name, kicking: p.kicking,
        local: this.localIds.has(p.id) && this.humans.length === 1, bot: p.isBot,
      });
    }
    const b = m.ball;
    return { ball: { x: lerp(b.px, b.x), y: lerp(b.py, b.y) }, ballVel: { vx: b.vx, vy: b.vy }, players };
  }

  render(alpha, dt) {
    const app = this.app;
    const view = this.replayView || this._view(alpha);
    if (this.labelsDirty) { this._labels(); this.labelsDirty = false; }
    const focus = view.ball || { x: 0, y: 0 };
    app.camera.update(app.renderer.cssW, app.renderer.cssH, this.match.geo.view, focus, this.demo ? 1 : app.settings.get('zoom'), dt);
    if (app.settings.get('debug')) view.debugText = `tick ${this.match.tickCount} · ${this.match.phase}`;
    app.renderer.draw(view, app.camera);
    if (!this.demo) {
      const m = this.match;
      app.hud.update({
        score: m.score, clockTicks: m.clockTicks, timeLimit: m.settings.timeLimit, overtime: m.overtime,
        phase: m.phase, paused: m.paused && !this.menuOpen ? true : m.paused, kickoffTeam: m.kickoffTeam,
        extraStatus: this.opts.mode === 'training' ? 'Treino' : '',
      });
    }
  }

  destroy() {
    this.stopReplay();
  }
}
