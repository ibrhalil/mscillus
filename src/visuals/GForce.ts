import { rgba, sampleGradient } from './palettes';
import type { Rgb } from './palettes';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { TAU, damp, drawGlowDot, fadeTrail } from './util';

const LUT_N = 64;
const STYLE_DOT = 1;

/** 0..1..0 üçgen dalga: palet kayarken başa sarma sıçraması (renk atlaması) olmaz. */
const pingPong = (x: number): number => 1 - Math.abs(2 * (x - Math.floor(x)) - 1);

interface FlowParticle {
  x: number;
  y: number;
  /** Bir önceki konum: çizgi stili hareket yönünde kesintisiz iz çizer (nokta+solma hızlı giderken boşluk bırakıyordu). */
  px: number;
  py: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  t: number;
}

export class GForce implements Visualizer {
  private ctx: CanvasRenderingContext2D;
  private pool: FlowParticle[] = [];
  private flowTime = 0;
  private wander = 0;
  private hue = 0;
  private lifeMul = 1;
  // Yumuşatılmış ses (ham değerler hızı/akışı sıçratıyordu)
  private sBass = 0;
  private sMid = 0;
  private sTreble = 0;
  private sLevel = 0;
  private sBeat = 0;
  private lut: Rgb[] = [];
  private lutKey = '';

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  init(): void {}

  resize(): void {}

  dispose(): void {
    this.pool = [];
    this.flowTime = 0;
  }

  /** Akış açısı: üst üste binen sinüsler, `warp` ile bükülmüş (alan alanın kendisiyle çarpıtılır → organik, kıvrımlı akış). */
  private fieldAngle(x: number, y: number, warp: number): number {
    const t = this.flowTime;
    const wx = x + warp * 55 * Math.sin(y * 0.004 + t * 0.21);
    const wy = y + warp * 55 * Math.cos(x * 0.0035 - t * 0.17);
    return (
      Math.sin(wx * 0.0022 + t * 0.35) * 1.4 +
      Math.cos(wy * 0.0026 - t * 0.27) * 1.4 +
      Math.sin((wx + wy) * 0.0011 + t * 0.13) * 0.8
    );
  }

  private spawn(p: FlowParticle, w: number, h: number): void {
    p.x = p.px = Math.random() * w;
    p.y = p.py = Math.random() * h;
    p.vx = 0;
    p.vy = 0;
    p.life = 0;
    p.maxLife = (1.5 + Math.random() * 3) * this.lifeMul;
    p.t = Math.random();
  }

  update(frame: AudioFrame, s: VisualizerSettingsView, w: number, h: number): void {
    const ctx = this.ctx;
    const o = s.opt;
    const dt = frame.dt;
    fadeTrail(ctx, s, 0.14, w, h);
    this.lifeMul = o.life;
    const sc = o.scale;

    const ka = damp(dt, 4);
    this.sBass += (frame.bass - this.sBass) * ka;
    this.sMid += (frame.mid - this.sMid) * ka;
    this.sTreble += (frame.treble - this.sTreble) * ka;
    this.sLevel += (frame.level - this.sLevel) * damp(dt, 3);
    this.sBeat += (frame.beatPulse - this.sBeat) * damp(dt, 5);

    if (this.lutKey !== s.palette.id) {
      this.lutKey = s.palette.id;
      this.lut = Array.from({ length: LUT_N }, (_, i) => sampleGradient(s.palette.colors, i / (LUT_N - 1)));
    }

    const target = Math.max(20, Math.floor(s.particleCount));
    while (this.pool.length < target) {
      const p: FlowParticle = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, life: 0, maxLife: 1, t: 0 };
      this.spawn(p, w, h);
      this.pool.push(p);
    }
    if (this.pool.length > target) this.pool.length = target;

    // Akış zamanı ve hız yumuşatılmış sesle; renk kayması sesle birikir
    this.flowTime += dt * (0.18 + this.sMid * 1.4 + this.sBass * 0.5);
    this.wander += dt * (0.12 + this.sLevel * 0.3);
    this.hue += dt * (0.01 + this.sLevel * 0.08);
    const speed = 40 + this.sLevel * 240 + this.sBeat * 120;
    const ease = 1 - Math.pow(0.88, dt * 60);

    // Girdap merkezi ekranda yavaşça gezinir; şiddeti baslarla artar
    const cx = w * (0.5 + 0.18 * Math.sin(this.wander * 1.1));
    const cy = h * (0.5 + 0.16 * Math.cos(this.wander * 0.9));
    const swirl = o.swirl * (0.35 + this.sBass * 1.4);
    const swirlR = 0.4 * Math.min(w, h);
    const warp = o.warp;
    const mirror = Math.round(o.mirror);
    const dot = Math.round(o.style) === STYLE_DOT;

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const p of this.pool) {
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.spawn(p, w, h);
        continue;
      }
      const a = this.fieldAngle(p.x * sc, p.y * sc, warp);
      let fx = Math.cos(a);
      let fy = Math.sin(a);
      if (swirl > 0.001) {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const d = Math.hypot(dx, dy) + 1;
        const k = swirl / (1 + d / swirlR);
        fx += (-dy / d) * k;
        fy += (dx / d) * k;
      }
      const len = Math.hypot(fx, fy) || 1;
      p.vx += ((fx / len) * speed - p.vx) * ease;
      p.vy += ((fy / len) * speed - p.vy) * ease;
      p.px = p.x;
      p.py = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) {
        this.spawn(p, w, h);
        continue;
      }

      const band = p.t < 0.34 ? this.sBass : p.t < 0.67 ? this.sMid : this.sTreble;
      const fade = Math.sin((p.life / p.maxLife) * Math.PI);
      const color = this.lut[Math.min(LUT_N - 1, Math.floor(pingPong(p.t + this.hue) * (LUT_N - 1)))];
      const alpha = fade * (0.25 + band * 0.75 + this.sBeat * 0.2);
      const r = (1.2 + fade * 1.6 + this.sBass * 2.2) * o.size;

      // Çizim: gerçek konum + (isteğe bağlı) ayna kopyaları
      for (let c = 0; c < (mirror === 0 ? 1 : mirror === 1 ? 2 : 4); c++) {
        const fxm = c & 1 ? w : 0;
        const fym = c & 2 ? h : 0;
        const x1 = c & 1 ? fxm - p.px : p.px;
        const y1 = c & 2 ? fym - p.py : p.py;
        const x2 = c & 1 ? fxm - p.x : p.x;
        const y2 = c & 2 ? fym - p.y : p.y;
        if (dot) {
          ctx.fillStyle = rgba(color, alpha);
          ctx.beginPath();
          ctx.arc(x2, y2, r, 0, TAU);
          ctx.fill();
        } else {
          ctx.strokeStyle = rgba(color, alpha);
          ctx.lineWidth = r * 1.1;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
        if (s.glow) drawGlowDot(ctx, color, x2, y2, r * 3 + 2 + this.sBeat * 4, fade * (dot ? 0.5 : 0.35));
      }
    }

    ctx.globalCompositeOperation = 'source-over';
  }
}
