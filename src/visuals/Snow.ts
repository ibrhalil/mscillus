import { binAtLerp, rgba, sampleGradient } from './palettes';
import type { Rgb } from './palettes';
import { EventScale, OnsetTracker } from './onset';
import { TAU, damp, drawGlowDot, fadeTrail, lighten } from './util';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';

/**
 * Kar: derinlikli kar yağışı. Eski sürümde tüm taneler aynı (düz nokta), hız ham `level` ile sıçrıyor ve vuruşta tüm taneler yana
 * sarsılıyordu (hareket yönü ritimle bozuluyordu).
 *  - DERİNLİK: her tane z (0 uzak..1 yakın): yakın taneler büyük, hızlı, parlak, yumuşak haleli; uzaktakiler küçük/sönük/yavaş,
 *  - düşüş hızı YAVAŞ süzülmüş seviyeyle (ani hızlanma yok); rüzgâr yumuşatılmış orta frekanstan; hareket yönü ritimle değişmez,
 *  - ritim yalnız parlaklık: her tane x konumuna karşılık gelen frekans sütununda parlar (sol bas, sağ tiz); vuruşta (bas veya spektral
 *    onset; şiddet müziğin kendi ortalamasına göre) yukarıdan aşağı süpüren bir parlaklık kuşağı tanelerin üstünden geçer.
 * Sessizde kar yine yavaşça yağar (kar doğası gereği hep yağar), yalnız ışıma yok.
 */

const COLS = 32;
const LUT = 8;
const MAX_WAVES = 3;
const WAVE_SPEED = 0.85;

interface Flake {
  x: number;
  y: number;
  /** Derinlik: 0 uzak .. 1 yakın. */
  z: number;
  phase: number;
  t: number;
}

interface Wave {
  y: number;
  amp: number;
}

export class Snow implements Visualizer {
  private ctx: CanvasRenderingContext2D;
  private flakes: Flake[] = [];
  private time = 0;
  private wind = 0;
  private sLevel = 0;
  private sMid = 0;
  private cols = new Float32Array(COLS);
  private waves: Wave[] = [];
  private onset = new OnsetTracker();
  private scale = new EventScale();
  private lut: Rgb[] = [];

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  init(): void {}

  resize(): void {}

  dispose(): void {
    this.flakes = [];
    this.waves = [];
  }

  update(frame: AudioFrame, s: VisualizerSettingsView, w: number, h: number): void {
    const ctx = this.ctx;
    const dt = Math.min(frame.dt, 0.05);
    fadeTrail(ctx, s, 0.3, w, h);
    this.time += dt;
    const px = Math.max(0.8, Math.min(w, h) / 700);
    const o = s.opt;

    const target = Math.max(60, Math.floor(s.particleCount));
    while (this.flakes.length < target) {
      this.flakes.push({
        x: Math.random() * w,
        y: Math.random() * h,
        z: Math.pow(Math.random(), 1.6),
        phase: Math.random() * TAU,
        t: Math.floor(Math.random() * LUT),
      });
    }
    if (this.flakes.length > target) this.flakes.length = target;

    // Yumuşatılmış ses
    this.sLevel += (frame.level - this.sLevel) * damp(dt, 1.2);
    this.sMid += (frame.mid - this.sMid) * damp(dt, 1.5);
    for (let i = 0; i < COLS; i++) {
      const raw = binAtLerp(frame.freq, i / (COLS - 1));
      this.cols[i] += (raw - this.cols[i]) * damp(dt, raw > this.cols[i] ? 12 : 4);
    }
    const speedMul = 0.7 + Math.min(1, this.sLevel * 2) * 0.8;
    const targetWind = ((this.sMid - 0.3) * 120 + Math.sin(this.time * 0.4) * 30) * o.wind * px;
    this.wind += (targetWind - this.wind) * damp(dt, 1.0);

    // Vuruş: yukarıdan aşağı süpüren parlaklık kuşağı
    this.scale.tick(dt);
    if (this.onset.update(frame, dt, 2.0, 0.4) || frame.beat) {
      const pw = this.scale.rel(0.6 * frame.bass + 0.4 * frame.level);
      if (this.waves.length >= MAX_WAVES) this.waves.shift();
      this.waves.push({ y: -0.05 * h, amp: 0.3 + 0.7 * pw });
    }
    for (let k = this.waves.length - 1; k >= 0; k--) {
      this.waves[k].y += dt * WAVE_SPEED * h;
      if (this.waves[k].y > h * 1.1) this.waves.splice(k, 1);
    }
    const band = h * 0.08;

    // Palet renkleri (hafif ton farkı)
    for (let i = 0; i < LUT; i++) this.lut[i] = lighten(sampleGradient(s.palette.colors, 0.35 + (i / (LUT - 1)) * 0.3), 0.8);

    for (const f of this.flakes) {
      const zs = 0.35 + 0.65 * f.z;
      f.y += (14 + 44 * f.z) * px * o.fall * speedMul * dt;
      f.x += (Math.sin(this.time * 1.2 + f.phase) * 18 * o.sway * zs * px + this.wind * zs) * dt;
      if (f.y > h + 6) {
        f.y = -6;
        f.x = Math.random() * w;
      }
      if (f.x < -8) f.x = w + 6;
      if (f.x > w + 8) f.x = -6;

      // Ritim yalnız parlaklık: x sütununun frekansı + süpüren kuşak
      const col = this.cols[Math.min(COLS - 1, Math.max(0, Math.floor((f.x / w) * COLS)))];
      let wave = 0;
      for (const wv of this.waves) {
        const e = (f.y - wv.y) / band;
        wave += wv.amp * Math.exp(-e * e);
      }
      const glow = Math.min(1, col * 0.9 + wave * 0.9);
      const alpha = Math.min(1, (0.25 + 0.4 * f.z) + glow * 0.55);
      const r = (0.7 + 2.0 * f.z) * o.flakeSize * px * (1 + glow * 0.35);
      const color = this.lut[f.t];

      if (f.z > 0.75 || wave > 0.3) drawGlowDot(ctx, color, f.x, f.y, r * 3.2, alpha * 0.5);
      ctx.fillStyle = rgba(color, alpha);
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, TAU);
      ctx.fill();
    }
  }
}
