import { barValue, rgba, sampleGradient } from './palettes';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { Bloom, TAU, clamp01, clearFrame, damp, hash1, lighten } from './util';

/** Saldırı anlık değil ama hızlı; bırakma `fall` ile yerçekimi gibi (birim/sn²). */
const ATTACK_RATE = 38;
const FALL_ACCEL = 2.4;
const PEAK_HOLD = 0.28;
const PEAK_FALL = 0.55;

const STYLE_LED = 1;
const STYLE_NEEDLE = 2;
const STYLE_CITY = 3;
const COLOR_FREQ = 0;
const COLOR_LEVEL = 1;
const COLOR_FLOW = 2;

export class SpectrumBars implements Visualizer {
  private ctx: CanvasRenderingContext2D;
  private level = new Float32Array(0);
  private fallV = new Float32Array(0);
  private peak = new Float32Array(0);
  private hold = new Float32Array(0);
  private bloom = new Bloom();

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  init(): void {}

  resize(): void {}

  dispose(): void {}

  private ensure(n: number): void {
    if (this.level.length === n) return;
    this.level = new Float32Array(n);
    this.fallV = new Float32Array(n);
    this.peak = new Float32Array(n);
    this.hold = new Float32Array(n);
  }

  /** Gece şehri: yarı saydam gövde, parlak çatı çizgisi ve spektruma göre yanıp sönen pencereler. */
  private drawBuilding(
    ctx: CanvasRenderingContext2D,
    frame: AudioFrame,
    x: number,
    top: number,
    bw: number,
    bh: number,
    i: number,
    color: [number, number, number],
    alpha: number,
  ): void {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = rgba(color, 0.26);
    ctx.fillRect(x, top, bw, bh);
    ctx.fillStyle = rgba(lighten(color, 0.3), 0.85);
    ctx.fillRect(x, top, bw, 2);
    const cols = Math.min(4, Math.floor((bw - 6) / 7));
    const rows = Math.floor((bh - 8) / 10);
    ctx.fillStyle = rgba(lighten(color, 0.55), 0.3 + frame.mid * 0.55 + frame.beatPulse * 0.25);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const hv = hash1(i * 131.7 + r * 17.3 + c * 7.7);
        if (hv > 0.42 + 0.16 * Math.sin(frame.time * 1.5 + hv * 40)) continue;
        ctx.fillRect(x + 4 + c * 7, top + 5 + r * 10, 3, 4);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawMoon(ctx: CanvasRenderingContext2D, s: VisualizerSettingsView, w: number, h: number): void {
    const accent = sampleGradient(s.palette.colors, 0.2);
    const mx = w * 0.26;
    const my = h * 0.2;
    const r = Math.min(w, h) * 0.05;
    const g = ctx.createRadialGradient(mx, my, 0, mx, my, r * 3);
    g.addColorStop(0, rgba(lighten(accent, 0.8), 0.9));
    g.addColorStop(0.4, rgba(accent, 0.25));
    g.addColorStop(1, rgba(accent, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(mx, my, r * 3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = rgba(lighten(accent, 0.75), 0.9);
    ctx.beginPath();
    ctx.arc(mx, my, r, 0, TAU);
    ctx.fill();
  }

  update(frame: AudioFrame, s: VisualizerSettingsView, w: number, h: number): void {
    const ctx = this.ctx;
    clearFrame(ctx, s.palette.bg, w, h);

    const n = s.barCount;
    this.ensure(n);
    const o = s.opt;
    const style = Math.round(o.style);
    const colorMode = Math.round(o.colorMode);
    const center = Math.round(o.align) === 1;
    const isMirror = o.mirror >= 0.5;
    const showPeaks = o.peaks >= 0.5;
    const showReflection = o.reflection >= 0.5 && !center;
    const ledCount = Math.round(o.ledCount);
    const dirs = center ? [1, -1] : [1];

    const gap = Math.max(1.5, (w / n) * o.gap);
    const barW = (w - gap * (n + 1)) / n;
    const baseY = center ? h / 2 : showReflection ? h * 0.74 : h - Math.max(24, h * 0.06);
    const room = center ? h / 2 - h * 0.08 : baseY - h * 0.1;
    const maxH = Math.min(room * o.height, center ? h / 2 - 4 : baseY - 4);
    const half = n / 2;
    const dt = frame.dt;
    const singleT = 0.35;

    if (style === STYLE_CITY && o.moon >= 0.5) this.drawMoon(ctx, s, w, h);

    if (o.baseline >= 0.5) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(gap, Math.round(baseY), w - gap * 2, 1);
    }

    for (let i = 0; i < n; i++) {
      // Simetrik modda bas ortada, tiz kenarlarda.
      const k = isMirror ? Math.min(half - 1, Math.floor(Math.abs(i - (n - 1) / 2))) : i;
      const span = isMirror ? half : n;
      const v = barValue(frame.freq, k, span);

      // Hızlı yükselme, yerçekimli düşüş
      let lv = this.level[i];
      if (v >= lv) {
        lv += (v - lv) * damp(dt, ATTACK_RATE);
        this.fallV[i] = 0;
      } else {
        this.fallV[i] += FALL_ACCEL * o.fall * dt;
        lv = Math.max(v, lv - this.fallV[i] * dt);
      }
      this.level[i] = lv;

      // Tepe çubuğu: kısa bekleme + düşüş
      if (lv >= this.peak[i]) {
        this.peak[i] = lv;
        this.hold[i] = PEAK_HOLD;
      } else if (this.hold[i] > 0) {
        this.hold[i] -= dt;
      } else {
        this.peak[i] = Math.max(lv, this.peak[i] - dt * PEAK_FALL * o.fall);
      }

      const freqT = span > 1 ? k / (span - 1) : 0;
      const t =
        colorMode === COLOR_LEVEL
          ? lv
          : colorMode === COLOR_FLOW
            ? (freqT + frame.time * 0.06) % 1
            : colorMode === COLOR_FREQ
              ? freqT
              : singleT;
      const color = sampleGradient(s.palette.colors, t);

      const barH = Math.max(2, lv * maxH);
      const x = gap + i * (barW + gap);
      const needleW = Math.max(2, barW * 0.22);
      const drawW = style === STYLE_NEEDLE ? needleW : barW;
      const drawX = x + (barW - drawW) / 2;

      for (const dir of dirs) {
        const yTip = baseY - dir * barH;
        if (style === STYLE_CITY) {
          this.drawBuilding(ctx, frame, x, dir > 0 ? yTip : baseY, barW, barH, i, color, o.alpha);
          continue;
        }
        const grad = ctx.createLinearGradient(0, baseY, 0, yTip);
        grad.addColorStop(0, rgba(color, 0.5));
        grad.addColorStop(1, rgba(color, 1));
        ctx.fillStyle = grad;
        ctx.globalAlpha = o.alpha;

        ctx.beginPath();
        if (style === STYLE_LED) {
          const step = maxH / ledCount;
          const segH = Math.max(2, step - 2);
          const lit = Math.min(ledCount, Math.ceil(barH / step));
          for (let seg = 0; seg < lit; seg++) {
            const top = dir > 0 ? baseY - (seg + 1) * step + 2 : baseY + seg * step;
            ctx.rect(x, top, barW, segH);
          }
        } else if (style === STYLE_NEEDLE) {
          ctx.rect(drawX, dir > 0 ? yTip : baseY, drawW, barH);
          ctx.moveTo(x + barW / 2 + needleW * 1.3, yTip);
          ctx.arc(x + barW / 2, yTip, Math.max(2.5, needleW * 1.3), 0, TAU);
        } else {
          const r = Math.min(barW / 2, barH / 2) * o.radius;
          ctx.roundRect(x, dir > 0 ? yTip : baseY, barW, barH, r);
        }
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      if (showReflection) {
        const refH = Math.min(barH * 0.55, h - baseY - 6);
        if (refH > 1) {
          const rg = ctx.createLinearGradient(0, baseY + 2, 0, baseY + 2 + refH);
          rg.addColorStop(0, rgba(color, 0.32 * o.alpha));
          rg.addColorStop(1, rgba(color, 0));
          ctx.fillStyle = rg;
          ctx.fillRect(drawX, baseY + 2, drawW, refH);
        }
      }

      if (showPeaks) {
        ctx.fillStyle = rgba(color, clamp01(0.55 + this.peak[i]));
        for (const dir of dirs) {
          const peakY = baseY - dir * this.peak[i] * maxH;
          ctx.fillRect(x, dir > 0 ? peakY - 3 : peakY + 1, barW, 2);
        }
      }
    }

    // Gölge yerine kare başına tek, sabit maliyetli bloom (bar sayısından bağımsız)
    if (s.glow) this.bloom.apply(ctx, w, h, (0.3 + frame.beatPulse * 0.15) * o.glowPower);
  }
}
