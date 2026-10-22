// Sons sintetizados com Web Audio (nenhum arquivo externo). Falhas de áudio
// nunca interrompem o jogo: todas as chamadas são protegidas.

export class AudioManager {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.last = new Map(); // limita repetição por tipo
    this._unlock = () => this.unlock();
    window.addEventListener('pointerdown', this._unlock, { once: false });
    window.addEventListener('keydown', this._unlock, { once: false });
    settings.onChange((k) => { if (k === 'volume' || k === 'muted' || k === '*') this._applyVolume(); });
  }

  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this._applyVolume();
        const len = this.ctx.sampleRate * 1.5;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        let seed = 12345;
        for (let i = 0; i < len; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[i] = (seed / 0x3fffffff) - 1; }
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      if (this.ctx.state === 'running') {
        window.removeEventListener('pointerdown', this._unlock);
        window.removeEventListener('keydown', this._unlock);
      }
    } catch { this.ctx = null; }
  }

  _applyVolume() {
    if (!this.master) return;
    const v = this.settings.get('muted') ? 0 : this.settings.get('volume');
    try { this.master.gain.setTargetAtTime(v * 0.6, this.ctx.currentTime, 0.02); } catch { /* ignora */ }
  }

  _ok(type, minGapMs) {
    if (!this.ctx || this.ctx.state !== 'running' || this.settings.get('muted')) return false;
    const now = performance.now();
    const l = this.last.get(type) || 0;
    if (now - l < minGapMs) return false;
    this.last.set(type, now);
    return true;
  }

  _tone(freq, dur, { type = 'sine', gain = 0.3, attack = 0.004, slide = 0, delay = 0 } = {}) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  _noise(dur, { gain = 0.3, freq = 1200, q = 1, type = 'bandpass', attack = 0.003, delay = 0 } = {}) {
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  play(name, intensity = 1) {
    try {
      switch (name) {
        case 'kick':
          if (!this._ok(name, 40)) return;
          this._tone(150, 0.09, { type: 'sine', gain: 0.55, slide: -90 });
          this._noise(0.05, { gain: 0.25, freq: 2400, q: 0.8 });
          break;
        case 'bounce': {
          if (!this._ok(name, 60)) return;
          const g = Math.min(0.35, 0.05 + intensity * 0.05);
          this._noise(0.04, { gain: g, freq: 900, q: 2 });
          break;
        }
        case 'post':
          if (!this._ok(name, 80)) return;
          this._tone(880, 0.25, { type: 'triangle', gain: 0.25 });
          this._tone(1320, 0.18, { type: 'sine', gain: 0.12 });
          break;
        case 'touch':
          if (!this._ok(name, 70)) return;
          this._tone(220, 0.05, { type: 'sine', gain: Math.min(0.3, 0.06 + intensity * 0.04), slide: -60 });
          break;
        case 'goal':
          if (!this._ok(name, 500)) return;
          this._noise(1.6, { gain: 0.32, freq: 700, q: 0.4, attack: 0.25 });
          [523, 659, 784, 1047].forEach((f, i) => this._tone(f, 0.35, { type: 'triangle', gain: 0.18, delay: i * 0.09 }));
          break;
        case 'whistle':
          if (!this._ok(name, 300)) return;
          this._tone(2600, 0.22, { type: 'sine', gain: 0.2 });
          this._tone(2750, 0.22, { type: 'sine', gain: 0.12, delay: 0.02 });
          break;
        case 'whistleLong':
          if (!this._ok(name, 300)) return;
          for (let i = 0; i < 3; i++) this._tone(2600, i === 2 ? 0.6 : 0.18, { type: 'sine', gain: 0.2, delay: i * 0.28 });
          break;
        case 'count':
          if (!this._ok(name, 200)) return;
          this._tone(intensity === 0 ? 990 : 660, 0.14, { type: 'square', gain: 0.08 });
          break;
        case 'join':
          if (!this._ok(name, 150)) return;
          this._tone(520, 0.08, { gain: 0.15 }); this._tone(780, 0.1, { gain: 0.15, delay: 0.07 });
          break;
        case 'leave':
          if (!this._ok(name, 150)) return;
          this._tone(780, 0.08, { gain: 0.13 }); this._tone(470, 0.12, { gain: 0.13, delay: 0.07 });
          break;
        case 'chat':
          if (!this._ok(name, 120)) return;
          this._tone(1200, 0.05, { gain: 0.08 });
          break;
        case 'ui':
          if (!this._ok(name, 50)) return;
          this._tone(700, 0.04, { type: 'triangle', gain: 0.09 });
          break;
        default: break;
      }
    } catch { /* áudio é opcional */ }
  }

  /** Converte eventos da partida em sons. */
  playEvents(events) {
    for (const e of events) {
      switch (e.type) {
        case 'kick': this.play('kick'); break;
        case 'impact':
          if (e.kind === 'post') this.play('post');
          else if (e.kind === 'wall' || e.kind === 'net') this.play('bounce', e.speed);
          else if (e.kind === 'ball-player') this.play('touch', e.speed);
          break;
        case 'goal': this.play('goal'); break;
        case 'whistle': this.play('whistle'); break;
        case 'end': this.play('whistleLong'); break;
        case 'count': this.play('count', e.n === 1 ? 0 : 1); break;
        default: break;
      }
    }
  }
}
