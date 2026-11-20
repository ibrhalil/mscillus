import { binAtLerp, rgba, sampleGradient } from './palettes';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { TAU, clamp01, damp, drawGlowDot, fadeFrame, glowBlur, strokeGlow } from './util';

const ATTACK_RATE = 30;
const FALL_RATE = 1.8;
const STYLE_BARS = 1;
const STYLE_WAVE = 2;
const STYLE_DOTS = 3;
const MAX_RIPPLES = 22;
const EXTEND_IN = 1;
const EXTEND_BOTH = 2;
const COLOR_FLOW = 1;
const COLOR_SINGLE = 2;

/** 0..1..0 üçgen dalga: renk dairede dikişsiz (başlangıç = bitiş) kalır. */
const pingPong = (x: number): number => 1 - Math.abs(2 * (x - Math.floor(x)) - 1);

export class Radial implements Visualizer {
  private ctx: CanvasRenderingContext2D;
  private rotation = 0;
  private level = new Float32Array(0);
  private ripples: { r: number; alpha: number; t: number }[] = [];
  private rippleHue = 0;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  init(): void {}

  resize(): void {}

  dispose(): void {
    this.ripples = [];
  }

  update(frame: AudioFrame, s: VisualizerSettingsView, w: number, h: number): void {
    const ctx = this.ctx;
    const o = s.opt;
    fadeFrame(ctx, s.palette.bg, clamp01(0.35 / o.trail), w, h);

    const style = Math.round(o.style);
    const extend = Math.round(o.extend);
    const colorMode = Math.round(o.colorMode);
    const isMirror = o.mirror >= 0.5;
    const dt = frame.dt;
    const n = s.barCount;
    if (this.level.length !== n) this.level = new Float32Array(n);

    const cx = w / 2;
    const cy = h / 2;
    const minDim = Math.min(w, h);
    const base = minDim * 0.16 * o.radius;
    const r0 = base * (1 + (frame.bass * 0.55 + frame.beatPulse * 0.25) * o.pulse);
    const maxLen = minDim * 0.32 * o.length;

    this.rotation += s.rotationSpeed * (0.4 + frame.level * 2) * dt * 2 * (o.reverse >= 0.5 ? -1 : 1);

    // Spektrumu ışınlara dağıt; hızlı yükselme, doğrusal düşüş
    const half = Math.max(1, n / 2);
    for (let i = 0; i < n; i++) {
      const m = isMirror ? (i <= half ? i / half : (n - i) / half) : i / n;
      const v = binAtLerp(frame.freq, m);
      const lv = this.level[i];
      this.level[i] = v >= lv ? lv + (v - lv) * damp(dt, ATTACK_RATE) : Math.max(v, lv - FALL_RATE * o.fall * dt);
    }

    const colorAt = (t: number): [number, number, number] => {
      if (colorMode === COLOR_SINGLE) return sampleGradient(s.palette.colors, 0.4);
      const shift = colorMode === COLOR_FLOW ? frame.time * 0.05 : 0;
      return sampleGradient(s.palette.colors, pingPong(t + shift));
    };

    if (o.ripples >= 0.5) this.drawRipples(ctx, s, frame, cx, cy, r0);
    if (style === STYLE_WAVE) this.drawWave(ctx, s, frame, cx, cy, r0, maxLen, n, extend);
    else if (style === STYLE_DOTS) this.drawDots(ctx, s, frame, cx, cy, r0, maxLen, n, colorAt);
    else this.drawRays(ctx, s, cx, cy, r0, maxLen, n, style === STYLE_BARS, extend, colorAt);
    if (o.scope >= 0.5) this.drawScope(ctx, s, frame, cx, cy, r0);

    const accent = sampleGradient(s.palette.colors, 0.1);
    if (o.ring >= 0.5) {
      ctx.shadowBlur = s.glow ? glowBlur(16 + frame.beatPulse * 30) : 0;
      ctx.shadowColor = rgba(accent, 0.9);
      ctx.strokeStyle = rgba(accent, 0.5 + frame.beatPulse * 0.5);
      ctx.lineWidth = 1.5 + frame.beatPulse * 4;
      ctx.beginPath();
      ctx.arc(cx, cy, r0, 0, TAU);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    if (o.dot >= 0.5) {
      ctx.fillStyle = rgba(accent, 0.7 + frame.beatPulse * 0.3);
      ctx.beginPath();
      ctx.arc(cx, cy, r0 * 0.06 * (1 + frame.beatPulse), 0, TAU);
      ctx.fill();
    }
  }

  /** Spektrum seviyesine göre halka çevresinde, dışa itilen parlak noktalar (eski AVS Noktalar). */
  private drawDots(
    ctx: CanvasRenderingContext2D,
    s: VisualizerSettingsView,
    frame: AudioFrame,
    cx: number,
    cy: number,
    r0: number,
    maxLen: number,
    n: number,
    colorAt: (t: number) => [number, number, number],
  ): void {
    const o = s.opt;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const v = this.level[i];
      const a = (i / n) * TAU + this.rotation;
      const r = r0 + r0 * 0.1 + v * maxLen;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      const dr = (1.5 + v * 5.5 + frame.bass * 1.2) * o.thickness;
      const color = colorAt(i / n);
      if (s.glow) drawGlowDot(ctx, color, x, y, dr * 3 + 3, 0.35 + v * 0.45);
      ctx.fillStyle = rgba(color, 0.25 + v * 0.75);
      ctx.beginPath();
      ctx.arc(x, y, dr, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Zaman alanı dalga biçimini iç halka olarak çizer (eski AVS Halka). */
  private drawScope(
    ctx: CanvasRenderingContext2D,
    s: VisualizerSettingsView,
    frame: AudioFrame,
    cx: number,
    cy: number,
    r0: number,
  ): void {
    const o = s.opt;
    const POINTS = 200;
    const N = frame.wave.length;
    const baseR = r0 * 0.55 * (1 + frame.bass * 0.15);
    const conic = ctx.createConicGradient(this.rotation, cx, cy);
    const colorMode = Math.round(o.colorMode);
    const shift = colorMode === COLOR_FLOW ? frame.time * 0.05 : 0;
    for (let j = 0; j <= 24; j++) {
      const p = j / 24;
      const c = colorMode === COLOR_SINGLE ? sampleGradient(s.palette.colors, 0.4) : sampleGradient(s.palette.colors, pingPong(p + shift));
      conic.addColorStop(p, rgba(c, 1));
    }
    ctx.lineJoin = 'round';
    ctx.strokeStyle = conic;
    ctx.beginPath();
    for (let i = 0; i <= POINTS; i++) {
      const t = i / POINTS;
      const dev = (frame.wave[Math.min(N - 1, Math.floor(t * N))] - 128) / 128;
      const r = baseR + dev * r0 * 0.3;
      const a = t * TAU + this.rotation;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    if (s.glow) {
      ctx.globalAlpha = 0.2;
      ctx.lineWidth = (2 + frame.bass * 3) * o.thickness * 3.5 + 2;
      ctx.stroke();
    }
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = (1.5 + frame.bass * 2.5) * o.thickness;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Vuruşta merkezden yayılan, sönen halkalar (eski AVS Dalgalar). */
  private drawRipples(
    ctx: CanvasRenderingContext2D,
    s: VisualizerSettingsView,
    frame: AudioFrame,
    cx: number,
    cy: number,
    r0: number,
  ): void {
    if (frame.beat) {
      this.rippleHue = (this.rippleHue + 0.18) % 1;
      this.ripples.push({ r: r0 * 0.7, alpha: 0.95, t: this.rippleHue });
      if (this.ripples.length > MAX_RIPPLES) this.ripples.shift();
    }
    let write = 0;
    for (let i = 0; i < this.ripples.length; i++) {
      const rp = this.ripples[i];
      rp.r += frame.dt * (170 + frame.level * 520);
      rp.alpha -= frame.dt * 0.7;
      if (rp.alpha <= 0) continue;
      ctx.beginPath();
      ctx.arc(cx, cy, rp.r, 0, TAU);
      strokeGlow(ctx, s.glow, sampleGradient(s.palette.colors, rp.t), (2 + rp.alpha * 4.5) * s.opt.thickness, rp.alpha);
      this.ripples[write++] = rp;
    }
    this.ripples.length = write;
  }

  private drawRays(
    ctx: CanvasRenderingContext2D,
    s: VisualizerSettingsView,
    cx: number,
    cy: number,
    r0: number,
    maxLen: number,
    n: number,
    thick: boolean,
    extend: number,
    colorAt: (t: number) => [number, number, number],
  ): void {
    const o = s.opt;
    const minInner = r0 * 0.12;
    // Çubuk stilinde genişlik halka çevresine göre ölçeklenir; ışında ince çizgi + seviye
    const slot = (TAU * r0) / n;
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const v = this.level[i];
      const angle = t * TAU + this.rotation;
      const len = r0 * 0.25 + v * maxLen;
      let from = r0;
      let to = r0 + len;
      if (extend === EXTEND_IN) to = Math.max(minInner, r0 - len * 0.85);
      else if (extend === EXTEND_BOTH) {
        from = Math.max(minInner, r0 - len * 0.5);
        to = r0 + len * 0.5;
      }
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const width = (thick ? Math.max(2.5, slot * 0.62) * (0.6 + v * 0.5) : 1.5 + v * 3) * o.thickness;

      ctx.beginPath();
      ctx.moveTo(cx + cos * from, cy + sin * from);
      ctx.lineTo(cx + cos * to, cy + sin * to);
      strokeGlow(ctx, s.glow, colorAt(t), width, 0.85);
    }
  }

  /** Seviyeleri kapalı, yumuşatılmış bir eğri olarak çizer (konik gradyan ile dikişsiz renk). */
  private drawWave(
    ctx: CanvasRenderingContext2D,
    s: VisualizerSettingsView,
    frame: AudioFrame,
    cx: number,
    cy: number,
    r0: number,
    maxLen: number,
    n: number,
    extend: number,
  ): void {
    const o = s.opt;
    const dir = extend === EXTEND_IN ? -1 : 1;
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + this.rotation;
      const r = Math.max(r0 * 0.12, r0 + dir * (this.level[i] * maxLen + r0 * 0.05));
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }

    const path = new Path2D();
    const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const start = mid(pts[n - 1], pts[0]);
    path.moveTo(start[0], start[1]);
    for (let i = 0; i < n; i++) {
      const m = mid(pts[i], pts[(i + 1) % n]);
      path.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
    }
    path.closePath();

    const colorMode = Math.round(o.colorMode);
    const conic = ctx.createConicGradient(this.rotation, cx, cy);
    const shift = colorMode === COLOR_FLOW ? frame.time * 0.05 : 0;
    const K = 24;
    for (let j = 0; j <= K; j++) {
      const p = j / K;
      const c = colorMode === COLOR_SINGLE ? sampleGradient(s.palette.colors, 0.4) : sampleGradient(s.palette.colors, pingPong(p + shift));
      conic.addColorStop(p, rgba(c, 1));
    }

    if (o.fill >= 0.5) {
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = conic;
      ctx.fill(path);
      ctx.globalAlpha = 1;
    }
    ctx.lineJoin = 'round';
    ctx.strokeStyle = conic;
    if (s.glow) {
      ctx.globalAlpha = 0.2;
      ctx.lineWidth = (2 + frame.bass * 3) * o.thickness * 3.5 + 2;
      ctx.stroke(path);
    }
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = (2 + frame.bass * 3) * o.thickness;
    ctx.stroke(path);
    ctx.globalAlpha = 1;
  }
}
