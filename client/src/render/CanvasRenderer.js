import { physicsConfig, CG_BALL, CG_PLAYER, CG_ALL } from '@shared/config/physicsConfig.js';

const TEAM_FILL = { red: '#e5484d', blue: '#3b82f6' };
const TEAM_DARK = { red: '#7a1f23', blue: '#15336b' };

/**
 * Renderizador Canvas 2D. O campo estático é desenhado uma vez num canvas
 * fora da tela (cache) e reaproveitado a cada quadro; os discos são
 * desenhados em coordenadas de mundo com escala para devicePixelRatio.
 */
export class CanvasRenderer {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    let ctx = null;
    try { ctx = canvas.getContext('2d', { alpha: false, desynchronized: true }); } catch { /* fallback */ }
    this.ctx = ctx || canvas.getContext('2d');
    this.dpr = 1;
    this.cssW = 1; this.cssH = 1;
    this.geo = null;
    this.cache = null;
    this.cacheKey = '';
    this.fps = 0;
    this._frames = 0; this._fpsT = performance.now();
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, this.settings.get('quality') === 'low' ? 1 : 2.5);
    this.dpr = dpr;
    this.cssW = Math.max(1, r.width); this.cssH = Math.max(1, r.height);
    const w = Math.round(this.cssW * dpr), hgt = Math.round(this.cssH * dpr);
    if (this.canvas.width !== w || this.canvas.height !== hgt) {
      this.canvas.width = w; this.canvas.height = hgt;
    }
  }

  setArena(geo) {
    this.geo = geo;
    this.cacheKey = '';
  }

  /** Aplica a transformação mundo→tela da câmera no contexto. */
  applyCamera(cam) {
    const s = cam.scale * this.dpr;
    this.ctx.setTransform(s, 0, 0, s, this.dpr * (this.cssW / 2 - cam.x * cam.scale), this.dpr * (this.cssH / 2 - cam.y * cam.scale));
  }

  _buildCache(cam) {
    const geo = this.geo;
    const q = this.settings.get('quality');
    const pxScale = Math.round(cam.scale * this.dpr * 20) / 20; // quantizado
    const key = `${pxScale}|${q}|${geo.def.id}|${geo.def.width}|${geo.def.height}|${geo.G}|${geo.D}|${geo.def.obstacles.length}|${this._geoVersion || 0}`;
    if (key === this.cacheKey && this.cache) return;
    this.cacheKey = key;
    const hw = geo.view.halfW + 20, hh = geo.view.halfH + 20;
    const c = this.cache || document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(hw * 2 * pxScale));
    c.height = Math.max(1, Math.ceil(hh * 2 * pxScale));
    const g = c.getContext('2d');
    g.setTransform(pxScale, 0, 0, pxScale, hw * pxScale, hh * pxScale);
    this._drawField(g, geo, pxScale, q);
    this.cache = c;
    this.cacheHW = hw; this.cacheHH = hh; this.cacheScale = pxScale;
  }

  /** Força reconstrução do cache (usado pelo editor). */
  invalidate() { this._geoVersion = (this._geoVersion || 0) + 1; this.cacheKey = ''; }

  _drawField(g, geo, pxScale, quality) {
    const { W, H, G, D, M } = geo;
    const col = geo.def.colors;
    const hw = geo.view.halfW + 20, hh = geo.view.halfH + 20;
    g.fillStyle = col.border;
    g.fillRect(-hw, -hh, hw * 2, hh * 2);
    // Área jogável externa (margem) levemente mais clara.
    g.fillStyle = shade(col.border, 0.06);
    g.fillRect(-W - M, -H - M, (W + M) * 2, (H + M) * 2);
    // Gramado com faixas.
    g.fillStyle = col.grass;
    g.fillRect(-W, -H, W * 2, H * 2);
    if (quality === 'high') {
      const stripes = Math.max(8, Math.round(W / 45) * 2);
      const sw = (W * 2) / stripes;
      g.fillStyle = col.grassAlt;
      for (let i = 0; i < stripes; i += 2) g.fillRect(-W + i * sw, -H, sw, H * 2);
    }
    const lw = 3;
    g.strokeStyle = col.lines;
    g.lineWidth = lw;
    g.lineJoin = 'round';
    g.strokeRect(-W, -H, W * 2, H * 2);
    g.beginPath(); g.moveTo(0, -H); g.lineTo(0, H); g.stroke();
    g.beginPath(); g.arc(0, 0, geo.kickoffRadius, 0, Math.PI * 2); g.stroke();
    g.fillStyle = col.lines;
    g.beginPath(); g.arc(0, 0, 4, 0, Math.PI * 2); g.fill();
    // Áreas semicirculares (decorativas).
    const ar = Math.min(G + 40, H - 10);
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(s * W, 0, ar, s < 0 ? -Math.PI / 2 : Math.PI / 2, s < 0 ? Math.PI / 2 : Math.PI * 1.5);
      g.stroke();
      g.beginPath(); g.arc(s * (W - ar * 0.62), 0, 2.5, 0, Math.PI * 2); g.fill();
    }
    // Redes.
    for (const s of [-1, 1]) {
      const x0 = s < 0 ? -W - D : W;
      g.save();
      g.beginPath(); g.rect(x0, -G, D, G * 2); g.clip();
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(x0, -G, D, G * 2);
      g.strokeStyle = hexA(col.net, 0.45);
      g.lineWidth = 1;
      const step = 9;
      for (let k = -G * 2 - D; k < G * 2 + D; k += step) {
        g.beginPath(); g.moveTo(x0, -G + k); g.lineTo(x0 + D, -G + k + D); g.stroke();
        g.beginPath(); g.moveTo(x0, -G + k + D); g.lineTo(x0 + D, -G + k); g.stroke();
      }
      g.restore();
      g.strokeStyle = col.net;
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(s * W, -G); g.lineTo(s * (W + D), -G); g.lineTo(s * (W + D), G); g.lineTo(s * W, G);
      g.stroke();
      // Linha do gol mais forte.
      g.strokeStyle = s < 0 ? '#ffb3b5' : '#b9d2ff';
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(s * W, -G); g.lineTo(s * W, G); g.stroke();
    }
    // Obstáculos.
    for (const o of geo.def.obstacles) {
      if (o.type === 'segment') {
        g.strokeStyle = o.mask === 'ball' ? hexA(col.lines, 0.85) : o.mask === 'player' ? 'rgba(255,255,255,0.35)' : '#f3f6f2';
        g.lineWidth = o.mask === 'all' ? 4 : 3;
        g.setLineDash(o.mask === 'player' ? [6, 6] : []);
        g.beginPath(); g.moveTo(o.a[0], o.a[1]); g.lineTo(o.b[0], o.b[1]); g.stroke();
        g.setLineDash([]);
      } else {
        g.fillStyle = o.mask === 'player' ? 'rgba(255,255,255,0.25)' : '#e8ece6';
        g.strokeStyle = '#1b2420'; g.lineWidth = 2;
        g.beginPath(); g.arc(o.p[0], o.p[1], o.r, 0, Math.PI * 2); g.fill(); g.stroke();
      }
    }
    // Traves.
    for (const st of geo.statics) {
      if (st.tag !== 'post') continue;
      g.fillStyle = '#ffffff';
      g.strokeStyle = '#1b1f24';
      g.lineWidth = 2;
      g.beginPath(); g.arc(st.x, st.y, st.r, 0, Math.PI * 2); g.fill(); g.stroke();
    }
  }

  clear() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0f1318';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Desenha o quadro completo. */
  draw(view, cam) {
    const ctx = this.ctx;
    this.clear();
    if (!this.geo) return;
    this._buildCache(cam);
    this.applyCamera(cam);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.cache, -this.cacheHW, -this.cacheHH, this.cacheHW * 2, this.cacheHH * 2);
    const s = cam.scale;
    const high = this.settings.get('quality') === 'high';
    const showNames = this.settings.get('showNames');
    const accent = this.settings.get('accent');

    if (high) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (const p of view.players) { ctx.beginPath(); ctx.arc(p.x + 2, p.y + 3, physicsConfig.player.radius, 0, Math.PI * 2); ctx.fill(); }
      if (view.ball) { ctx.beginPath(); ctx.arc(view.ball.x + 2, view.ball.y + 3, physicsConfig.ball.radius, 0, Math.PI * 2); ctx.fill(); }
    }

    const pr = physicsConfig.player.radius;
    for (const p of view.players) {
      if (p.local) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(p.x, p.y, pr + 5, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = TEAM_FILL[p.team] || '#888';
      ctx.beginPath(); ctx.arc(p.x, p.y, pr, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = p.kicking ? 3 : 2;
      ctx.strokeStyle = p.kicking ? '#ffffff' : TEAM_DARK[p.team] || '#222';
      ctx.stroke();
      // Número/rótulo no disco.
      const fs = Math.min(15, pr * 2 * s * 0.62) / s; // tamanho legível, nunca maior que o disco
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${fs.toFixed(2)}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p.label, p.x, p.y + 0.5);
    }

    if (view.ball) {
      const b = view.ball;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#151a20';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(b.x, b.y, physicsConfig.ball.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }

    if (showNames) {
      const fs = 12 / s;
      ctx.font = `600 ${fs}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const p of view.players) {
        const y = p.y + pr + 4 / s;
        ctx.lineWidth = 3 / s;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.strokeText(p.name, p.x, y);
        ctx.fillStyle = p.local ? accent : '#f2f5f7';
        ctx.fillText(p.name, p.x, y);
      }
    }

    if (this.settings.get('debug')) this._drawDebug(view, cam);

    this._frames++;
    const now = performance.now();
    if (now - this._fpsT >= 500) { this.fps = Math.round((this._frames * 1000) / (now - this._fpsT)); this._frames = 0; this._fpsT = now; }
    if (this.settings.get('showFps') || this.settings.get('debug')) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.font = '12px ui-monospace, monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(8, this.cssH - 26, 230, 18);
      ctx.fillStyle = '#cfe';
      ctx.fillText(`${this.fps} FPS${view.debugText ? ' · ' + view.debugText : ''}`, 12, this.cssH - 23);
    }
  }

  _drawDebug(view, cam) {
    const ctx = this.ctx;
    const geo = this.geo;
    const s = cam.scale;
    ctx.lineWidth = 1.5 / s;
    for (const sg of geo.segments) {
      ctx.strokeStyle = sg.mask === CG_ALL ? '#ff0' : sg.mask === CG_BALL ? '#0ff' : sg.mask === CG_PLAYER ? '#f0f' : '#fff';
      ctx.beginPath(); ctx.moveTo(sg.ax, sg.ay); ctx.lineTo(sg.bx, sg.by); ctx.stroke();
    }
    for (const st of geo.statics) {
      ctx.strokeStyle = '#ff0';
      ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2); ctx.stroke();
    }
    const kr = physicsConfig.kick.range;
    for (const p of view.players) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.setLineDash([4 / s, 4 / s]);
      ctx.beginPath(); ctx.arc(p.x, p.y, physicsConfig.player.radius + kr + physicsConfig.ball.radius, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      if (p.vx !== undefined) arrow(ctx, p.x, p.y, p.x + p.vx * 12, p.y + p.vy * 12, '#0f0', s);
    }
    if (view.ball && view.ballVel) arrow(ctx, view.ball.x, view.ball.y, view.ball.x + view.ballVel.vx * 12, view.ball.y + view.ballVel.vy * 12, '#f80', s);
    if (view.ghost) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath(); ctx.arc(view.ghost.x, view.ghost.y, physicsConfig.player.radius, 0, Math.PI * 2); ctx.stroke();
    }
  }
}

function arrow(ctx, x0, y0, x1, y1, color, s) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 / s;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + 255 * amt)));
  const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
  return `rgb(${r},${g},${b})`;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
