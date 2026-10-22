/**
 * Gravação local (em memória) dos últimos segundos de jogo e reprodução curta
 * do último gol. Não há persistência em disco: o replay existe apenas durante
 * a sessão atual da página.
 */
export class ReplayBuffer {
  constructor(seconds = 8) {
    this.cap = seconds * 60;
    this.frames = new Array(this.cap);
    this.count = 0;
    this.meta = new Map();     // id → {name, label, team}
    this.lastGoal = null;      // {frames, meta, label}
    this.playing = null;       // {frames, meta, i}
  }

  clear() { this.count = 0; this.lastGoal = null; this.playing = null; }

  /** view: {ball:{x,y}, players:[{id,x,y,team,label,name,kicking}]} */
  record(view) {
    const ps = view.players;
    const arr = new Array(ps.length);
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      arr[i] = [p.id, p.x, p.y, p.kicking ? 1 : 0, p.team];
      const m = this.meta.get(p.id);
      if (!m || m.name !== p.name || m.label !== p.label) this.meta.set(p.id, { name: p.name, label: p.label });
    }
    this.frames[this.count % this.cap] = { b: view.ball ? [view.ball.x, view.ball.y] : null, p: arr };
    this.count++;
  }

  /** Congela os últimos `seconds` segundos (chamar logo após um gol). */
  captureGoal(label, seconds = 5, after = 0) {
    const n = Math.min(this.count, seconds * 60);
    const out = [];
    for (let i = this.count - n; i < this.count; i++) out.push(this.frames[i % this.cap]);
    this.lastGoal = { frames: out, meta: new Map(this.meta), label, pendingAfter: after };
  }

  /** Acrescenta quadros após o gol (para mostrar a bola na rede). */
  extend(view) {
    const g = this.lastGoal;
    if (!g || g.pendingAfter <= 0) return;
    this.record(view);
    g.frames.push(this.frames[(this.count - 1) % this.cap]);
    g.pendingAfter--;
  }

  hasReplay() { return !!(this.lastGoal && this.lastGoal.frames.length > 10); }

  start() {
    if (!this.hasReplay()) return false;
    this.playing = { frames: this.lastGoal.frames, meta: this.lastGoal.meta, i: 0 };
    return true;
  }

  stop() { this.playing = null; }

  /** Avança um tick; retorna a view do quadro atual ou null ao terminar. */
  step() {
    const pl = this.playing;
    if (!pl) return null;
    if (pl.i >= pl.frames.length) { this.playing = null; return null; }
    const f = pl.frames[pl.i++];
    return {
      ball: f.b ? { x: f.b[0], y: f.b[1] } : null,
      players: f.p.map(([id, x, y, k, team]) => {
        const m = pl.meta.get(id) || { name: '?', label: '' };
        return { id, x, y, kicking: !!k, team, name: m.name, label: m.label, local: false };
      }),
    };
  }
}
