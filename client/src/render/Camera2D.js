/**
 * Câmera 2D superior. Enquadra o campo inteiro quando possível; em campos
 * grandes ou com zoom aumentado, segue o foco (bola) respeitando os limites.
 */
export class Camera2D {
  constructor() {
    this.x = 0; this.y = 0;
    this.scale = 1;           // pixels CSS por unidade do mundo
    this.viewW = 1; this.viewH = 1;
    this.follow = false;
    this._init = false;
  }

  update(cssW, cssH, view, focus, zoom = 1, dt = 1 / 60) {
    this.viewW = cssW; this.viewH = cssH;
    const fit = Math.min(cssW / (2 * view.halfW), cssH / (2 * view.halfH));
    const minReadable = Math.min(0.78, Math.max(fit, 0.45));
    let s = fit;
    this.follow = false;
    if (fit < minReadable) { s = minReadable; this.follow = true; }
    s *= zoom;
    if (zoom > 1.01) this.follow = true;
    this.scale = s;

    let tx = 0, ty = 0;
    if (this.follow && focus) { tx = focus.x; ty = focus.y; }
    const visW = cssW / (2 * s), visH = cssH / (2 * s);
    tx = visW >= view.halfW ? 0 : Math.max(-view.halfW + visW, Math.min(view.halfW - visW, tx));
    ty = visH >= view.halfH ? 0 : Math.max(-view.halfH + visH, Math.min(view.halfH - visH, ty));
    if (!this._init) { this.x = tx; this.y = ty; this._init = true; return; }
    const k = 1 - Math.exp(-dt * 7);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
  }

  snap() { this._init = false; }

  worldToScreen(x, y) {
    return { x: this.viewW / 2 + (x - this.x) * this.scale, y: this.viewH / 2 + (y - this.y) * this.scale };
  }

  screenToWorld(x, y) {
    return { x: (x - this.viewW / 2) / this.scale + this.x, y: (y - this.viewH / 2) / this.scale + this.y };
  }
}
