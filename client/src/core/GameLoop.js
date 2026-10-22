import { TICK_DT } from '@shared/config/physicsConfig.js';

const MAX_TICKS_PER_FRAME = 8;

/**
 * Laço principal: simulação com timestep fixo (1/60 s) e acumulador limitado;
 * renderização interpolada via requestAnimationFrame, com limite opcional de FPS.
 */
export class GameLoop {
  constructor({ tick, render, settings }) {
    this.tickFn = tick;
    this.renderFn = render;
    this.settings = settings;
    this.acc = 0;
    this.last = 0;
    this.lastRender = 0;
    this.running = false;
    this._raf = 0;
    this._frame = (t) => this.frame(t);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this._raf = requestAnimationFrame(this._frame);
  }

  stop() { this.running = false; cancelAnimationFrame(this._raf); }

  resetAccumulator() { this.acc = 0; this.last = performance.now(); }

  frame(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._frame);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = 0.25; // aba minimizada/travada: limita o acumulado
    if (dt < 0) dt = 0;
    this.acc += dt;
    let n = 0;
    while (this.acc >= TICK_DT && n < MAX_TICKS_PER_FRAME) {
      this.tickFn();
      this.acc -= TICK_DT;
      n++;
    }
    if (n === MAX_TICKS_PER_FRAME) this.acc = 0;
    const cap = this.settings.get('fpsCap');
    if (cap > 0 && now - this.lastRender < 1000 / cap - 2) return;
    const frameDt = this.lastRender ? (now - this.lastRender) / 1000 : dt;
    this.lastRender = now;
    this.renderFn(this.acc / TICK_DT, Math.min(frameDt, 0.25));
  }
}
