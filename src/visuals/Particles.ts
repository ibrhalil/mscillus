import { binAtLerp, rgba, sampleGradient } from './palettes';
import type { Rgb } from './palettes';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { TAU, clamp01, drawGlowDot, fadeFrame } from './util';

const EMIT_RING = 1;
const EMIT_BOTTOM = 2;
const EMIT_SPECTRUM = 3;
const EMIT_FOUNTAIN = 4;
const COLOR_SPEED = 1;
const COLOR_AGE = 2;
const COLOR_SINGLE = 3;
const SHAPE_STREAK = 1;
const LUT_SIZE = 64;
const MAX_SPEED = 420;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  /** Renk tohumu (0..1): doğduğu yere/rastgele göre; paletten LUT ile okunur. */
  t: number;
}

export class Particles implements Visualizer {
  private ctx: CanvasRenderingContext2D;
  private pool: Particle[] = [];
  private spawnAcc = 0;
  private lut: Rgb[] = [];
  private lutKey = '';

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  init(): void {}

  resize(): void {}

  dispose(): void {
    this.pool = [];
    this.spawnAcc = 0;
  }

  private buildLut(s: VisualizerSettingsView): void {
    this.lutKey = s.palette.id;
    this.lut = Array.from({ length: LUT_SIZE }, (_, i) => sampleGradient(s.palette.colors, i / (LUT_SIZE - 1)));
  }

  private colorAt(t: number): Rgb {
    return this.lut[Math.min(LUT_SIZE - 1, (clamp01(t) * LUT_SIZE) | 0)];
  }

  private spawn(
    emitter: number,
    frame: AudioFrame,
    s: VisualizerSettingsView,
    w: number,
    h: number,
  ): void {
    const o = s.opt;
    const cx = w / 2;
    const cy = h / 2;
    const bass = frame.bass;
    const base = {
      life: 0,
      maxLife: (0.8 + Math.random() * 1.4) * o.life,
      size: (1.5 + Math.random() * 3 * (1 + bass)) * o.size,
      t: Math.random(),
    };

    if (emitter === EMIT_SPECTRUM) {
      // Frekans bandının enerjisi kadar olasılıkla, o bandın üstünden yukarı fışkırır; renk = frekans
      const t = Math.random();
      const v = binAtLerp(frame.freq, t);
      if (Math.random() > v * 1.15) return;
      this.pool.push({
        ...base,
        x: t * w,
        y: h + 4,
        vx: (Math.random() - 0.5) * 70,
        vy: -(90 + v * 520) * o.power,
        t,
      });
      return;
    }

    if (emitter === EMIT_FOUNTAIN) {
      // Alttan, tek noktadan yukarı fışkıran sütun (eski Magma / Köpük Fıskiyesi)
      const spread = 1 + frame.level * 1.5;
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.66 * spread;
      const speed = (180 + Math.random() * 520 * (0.6 + bass)) * o.power;
      this.pool.push({
        ...base,
        x: cx + (Math.random() - 0.5) * 46,
        y: h * 0.94,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
      });
      return;
    }

    if (emitter === EMIT_BOTTOM) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.1;
      const speed = (120 + Math.random() * 320) * (1 + bass) * o.power;
      this.pool.push({ ...base, x: Math.random() * w, y: h + 4, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
      return;
    }

    const angle = Math.random() * TAU;
    const speed = (40 + Math.random() * 220) * (1 + bass * 1.2) * o.power;
    if (emitter === EMIT_RING) {
      const r = Math.min(w, h) * 0.14 * (1 + bass * 0.3);
      this.pool.push({
        ...base,
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
        vx: Math.cos(angle) * speed * 0.7 - Math.sin(angle) * speed * 0.3,
        vy: Math.sin(angle) * speed * 0.7 + Math.cos(angle) * speed * 0.3,
      });
      return;
    }
    this.pool.push({ ...base, x: cx, y: cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
  }

  update(frame: AudioFrame, s: VisualizerSettingsView, w: number, h: number): void {
    const ctx = this.ctx;
    const o = s.opt;
    if (this.lutKey !== s.palette.id) this.buildLut(s);
    const max = Math.max(20, Math.floor(s.particleCount));
    const emitter = Math.round(o.emitter);
    const colorMode = Math.round(o.colorMode);
    const streak = Math.round(o.shape) === SHAPE_STREAK;
    const dt = frame.dt;

    ctx.globalCompositeOperation = 'source-over';
    fadeFrame(ctx, s.palette.bg, clamp01(0.22 / o.trail), w, h);

    // Doğuş: sürekli (seviyeye göre) + vuruşta toplu patlama
    this.spawnAcc += dt * (4 + frame.level * (max / 12));
    let toSpawn = Math.floor(this.spawnAcc);
    this.spawnAcc -= toSpawn;
    if (frame.beat) toSpawn += Math.floor((max / 10) * o.burst);
    // Spektrum emitöründe denemelerin çoğu elenir; deneme sayısını artır
    if (emitter === EMIT_SPECTRUM) toSpawn *= 3;

    if (this.pool.length < max * 1.5) {
      for (let i = 0; i < toSpawn; i++) this.spawn(emitter, frame, s, w, h);
    }

    const cx = w / 2;
    const cy = h / 2;
    const drag = Math.pow(0.985, dt * 60);
    const bounce = o.bounce >= 0.5;
    const gravity = (o.gravity + (emitter === EMIT_FOUNTAIN ? 1 : 0)) * 500;
    const twinkle = o.twinkle >= 0.5;
    const swirl = o.swirl * 220;

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    if (emitter === EMIT_FOUNTAIN && o.source >= 0.5) {
      const accent = sampleGradient(s.palette.colors, 0.05);
      const rad = 70 + frame.bass * 90;
      const g = ctx.createRadialGradient(cx, h * 0.94, 0, cx, h * 0.94, rad);
      g.addColorStop(0, rgba(accent, 0.35 + frame.beatPulse * 0.3));
      g.addColorStop(1, rgba(accent, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, h * 0.94, rad, 0, TAU);
      ctx.fill();
    }
    let write = 0;
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      p.life += dt;
      if (p.life >= p.maxLife) continue;

      if (gravity !== 0) p.vy += gravity * dt;
      if (swirl !== 0) {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const d = Math.hypot(dx, dy) + 1;
        p.vx += (-dy / d) * swirl * dt;
        p.vy += (dx / d) * swirl * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= drag;
      p.vy *= drag;

      if (bounce) {
        if (p.x < 0 || p.x > w) {
          p.vx *= -0.8;
          p.x = Math.min(w, Math.max(0, p.x));
        }
        if (p.y < 0 || p.y > h) {
          p.vy *= -0.8;
          p.y = Math.min(h, Math.max(0, p.y));
        }
      }

      const age = p.life / p.maxLife;
      const alpha = (1 - age) * (twinkle ? 0.6 + 0.4 * Math.sin(p.life * 26 + p.t * 15) : 1);
      const color = this.colorAt(
        colorMode === COLOR_SPEED
          ? Math.hypot(p.vx, p.vy) / MAX_SPEED
          : colorMode === COLOR_AGE
            ? age
            : colorMode === COLOR_SINGLE
              ? 0.5
              : p.t,
      );
      const r = p.size * (0.5 + alpha * 0.8);

      if (s.glow) drawGlowDot(ctx, color, p.x, p.y, r * 3 + 3, alpha * 0.55);
      if (streak) {
        ctx.strokeStyle = rgba(color, alpha * 0.9);
        ctx.lineWidth = Math.max(1, r * 0.8);
        ctx.beginPath();
        ctx.moveTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      } else {
        ctx.fillStyle = rgba(color, alpha * 0.9);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, TAU);
        ctx.fill();
      }

      this.pool[write++] = p;
    }
    this.pool.length = write;

    ctx.globalCompositeOperation = 'source-over';
  }
}
