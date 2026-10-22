import { fmtClock } from './dom.js';

const PHASE_TEXT = {
  lobby: 'Partida parada',
  waiting: 'Aguardando jogadores nos dois times…',
  countdown: 'Preparar…',
  kickoff: 'Saída de bola',
  playing: '',
  goal: '',
  ended: 'Partida encerrada',
};

/** Placar, cronômetro, status, rede e banners centrais. */
export class HUD {
  constructor() {
    this.root = document.getElementById('hud');
    this.red = document.getElementById('hud-red');
    this.blue = document.getElementById('hud-blue');
    this.clock = document.getElementById('hud-clock');
    this.status = document.getElementById('hud-status');
    this.net = document.getElementById('hud-net');
    this.banner = document.getElementById('center-banner');
    this._bannerTimer = 0;
    this._last = {};
  }

  show(v) { this.root.hidden = !v; if (!v) this.hideBanner(); }

  update(s) {
    const L = this._last;
    if (L.r !== s.score.red) { this.red.textContent = String(s.score.red); L.r = s.score.red; }
    if (L.b !== s.score.blue) { this.blue.textContent = String(s.score.blue); L.b = s.score.blue; }
    let clockText = fmtClock(s.clockTicks);
    if (s.timeLimit > 0 && !s.overtime) clockText = fmtClock(Math.max(0, s.timeLimit * 3600 - s.clockTicks));
    if (s.overtime) clockText = `+${fmtClock(s.clockTicks - s.timeLimit * 3600)}`;
    if (L.c !== clockText) { this.clock.textContent = clockText; L.c = clockText; }
    if (L.ot !== s.overtime) { this.clock.classList.toggle('overtime', !!s.overtime); L.ot = s.overtime; }
    let st = s.paused ? 'PAUSADO' : (PHASE_TEXT[s.phase] ?? '');
    if (s.overtime && s.phase === 'playing') st = 'Gol de ouro';
    if (s.phase === 'kickoff' && s.kickoffTeam) st = `Saída: ${s.kickoffTeam === 'red' ? 'Vermelho' : 'Azul'}`;
    if (s.extraStatus) st = st ? `${st} · ${s.extraStatus}` : s.extraStatus;
    if (L.st !== st) { this.status.textContent = st; L.st = st; }
  }

  setNet(html) {
    // Conteúdo gerado internamente (números), não vem de usuários.
    if (this._lastNet === html) return;
    this._lastNet = html;
    this.net.innerHTML = html;
  }

  flash(big, small = '', cls = '', ms = 1800) {
    clearTimeout(this._bannerTimer);
    const b = this.banner;
    b.className = `show ${cls}`;
    b.replaceChildren();
    const d1 = document.createElement('div'); d1.className = 'big'; d1.textContent = big;
    b.append(d1);
    if (small) { const d2 = document.createElement('div'); d2.className = 'small'; d2.textContent = small; b.append(d2); }
    if (ms > 0) this._bannerTimer = setTimeout(() => this.hideBanner(), ms);
  }

  hideBanner() { clearTimeout(this._bannerTimer); this.banner.className = ''; }

  /** Reage a eventos de partida (comum a offline/online). nameOf(id) → nome. */
  handleEvents(events, nameOf) {
    for (const e of events) {
      if (e.type === 'goal') {
        const team = e.team === 'red' ? 'Vermelho' : 'Azul';
        let small = '';
        if (e.scorer != null) {
          small = e.ownGoal ? `Gol contra de ${nameOf(e.scorer)}` : `${nameOf(e.scorer)}${e.assist != null ? ` (assist. ${nameOf(e.assist)})` : ''}`;
        }
        this.flash('GOL!', `${team} · ${small}`.replace(/ · $/, ''), e.team, 2400);
      } else if (e.type === 'count') this.flash(String(e.n), '', '', 900);
      else if (e.type === 'whistle') this.hideBanner();
      else if (e.type === 'overtime') this.flash('Gol de ouro', 'Empate no tempo — próximo gol vence', '', 2200);
      else if (e.type === 'end') {
        const w = e.winner === 'draw' ? 'Empate' : `Vitória do ${e.winner === 'red' ? 'Vermelho' : 'Azul'}`;
        this.flash(w, `${e.score.red} × ${e.score.blue}`, e.winner === 'draw' ? '' : e.winner, 2600);
      }
    }
  }
}
