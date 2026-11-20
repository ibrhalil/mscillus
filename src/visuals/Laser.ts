import { binAtLerp, rgba, sampleGradient } from './palettes';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { TAU, damp, fadeTrail, strokeGlow } from './util';

/**
 * Lazer: yerden yelpaze gibi açılan ışınlar. Tarama hareketi ve yelpaze açıklığı ritimle DEĞİŞMEZ (eskiden açıklık bant/vuruşla
 * açılıp kapanıyordu). Ritim yalnız parlaklık/kalınlık ve ışın boyunca akan ışık atımları:
 *  - 4 kaynak, spektrumun 4 diliminden (bas → tiz) beslenir; her kaynak KENDİ dilimindeki ani yükselişte (per-bant onset, dilim ortalamasına
 *    göre) ışınları boyunca kaynaktan uca koşan bir ışık atımı yollar → bas kaynağı vuruşta, tiz kaynağı hi-hat'te atım gönderir,
 *  - atım şiddeti o dilimin kendi ortalamasına göre; kaynak tabanı atımda çakar,
 *  - tarama hızı YAVAŞ süzülmüş seviyeyle (ani hızlanma yok). Eski tam ekran vuruş çakması kaldırıldı (titreme yapıyordu).
 */

const EMITTERS = 4;
const PULSE_SPEED = 1.7;

interface Pulse {
  p: number;
  amp: number;
}

interface Emitter {
  xFrac: number;
  phase: number;
  speed: number;
  t: number;
  /** Spektrum dilimi (0..1 merkezi). */
  band: number;
  sBand: number;
  prev: number;
  /** Dilimin ani yükseliş ortalaması (vuruş eşiği için). */
  avgRise: number;
  cool: number;
  flash: number;
  pulses: Pulse[];
}

const pingPong = (x: number): number => 1 - Math.abs(2 * (x - Math.floor(x)) - 1);

export class Laser implements Visualizer {
  private ctx: CanvasRenderingContext2D;
  private emitters: Emitter[] = [];
  private time = 0;
  private hue = 0;
  private sLevel = 0;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
    for (let i = 0; i < EMITTERS; i++) {
      this.emitters.push({
        xFrac: 0.12 + (i / (EMITTERS - 1)) * 0.76,
        phase: Math.random() * TAU,
        speed: 0.4 + Math.random() * 0.8,
        t: i / EMITTERS,
        band: (i + 0.5) / EMITTERS,
        sBand: 0,
        prev: 0,
        avgRise: 0.02,
        cool: 0,
        flash: 0,
        pulses: [],
      });
    }
  }

  init(): void {}

  resize(): void {}

  dispose(): void {
    this.time = 0;
    for (const e of this.emitters) e.pulses.length = 0;
  }

  update(frame: AudioFrame, s: VisualizerSettingsView, w: number, h: number): void {
    const ctx = this.ctx;
    const dt = Math.min(frame.dt, 0.05);
    fadeTrail(ctx, s, 0.28, w, h);
    const o = s.opt;
    const beams = Math.round(o.beams);
    const px = Math.max(0.8, Math.min(w, h) / 700);

    // Tarama hızı yavaş süzülmüş seviyeyle
    this.sLevel += (frame.level - this.sLevel) * damp(dt, 1.2);
    this.time += dt * (0.5 + Math.min(1, this.sLevel * 2) * 0.9);
    this.hue += dt * 0.01;
    const len = h * 1.5;

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const e of this.emitters) {
      // Dilim enerjisi (yumuşatılmış) ve dilim başına vuruş: ani yükseliş, dilimin kendi ortalamasına göre
      const raw = binAtLerp(frame.freq, e.band);
      const rise = Math.max(0, raw - e.prev);
      e.prev += (raw - e.prev) * damp(dt, 14);
      e.sBand += (raw - e.sBand) * damp(dt, raw > e.sBand ? 12 : 4);
      e.avgRise += (rise - e.avgRise) * damp(dt, 1.2);
      e.cool -= dt;
      if (e.cool <= 0 && rise > 0.03 && rise > e.avgRise * 2.2 + 0.01 && raw > 0.12) {
        e.cool = 0.28;
        const pw = Math.min(1, (rise - e.avgRise) / (e.avgRise * 4 + 0.05));
        e.pulses.push({ p: 0, amp: 0.45 + 0.55 * pw });
        e.flash = Math.max(e.flash, 0.4 + 0.6 * pw);
        if (e.pulses.length > 4) e.pulses.shift();
      }
      e.flash = Math.max(0, e.flash - dt * 3);
      for (let k = e.pulses.length - 1; k >= 0; k--) {
        e.pulses[k].p += dt * PULSE_SPEED;
        if (e.pulses[k].p > 1.15) e.pulses.splice(k, 1);
      }

      const x = e.xFrac * w;
      const band = e.sBand;
      const base = -Math.PI / 2 + Math.sin(this.time * e.speed + e.phase) * 0.95 * o.sweep;

      for (let b = 0; b < beams; b++) {
        const angle = base + (b - (beams - 1) / 2) * 0.16 * o.spread;
        const color = sampleGradient(s.palette.colors, pingPong(e.t + b * 0.07 + this.hue));
        const x2 = x + Math.cos(angle) * len;
        const y2 = h + Math.sin(angle) * len;

        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.lineTo(x2, y2);
        const lw = (1.5 + band * 2.2) * px;
        strokeGlow(ctx, s.glow, color, lw, 0.35 + band * 0.5);

        // Işın boyunca koşan ışık atımları (kaynaktan uca); yalnız parlaklık/kalınlık, yol sabit
        if (e.pulses.length > 0) {
          const g = ctx.createLinearGradient(x, h, x2, y2);
          g.addColorStop(0, rgba(color, 0));
          for (const pl of e.pulses) {
            const a = pl.amp * Math.max(0, 1 - pl.p * 0.6);
            const c0 = Math.max(0, Math.min(1, pl.p - 0.07));
            const c1 = Math.max(0, Math.min(1, pl.p));
            const c2 = Math.max(0, Math.min(1, pl.p + 0.07));
            g.addColorStop(c0, rgba(color, 0));
            g.addColorStop(c1, rgba(color, a));
            g.addColorStop(c2, rgba(color, 0));
          }
          g.addColorStop(1, rgba(color, 0));
          ctx.strokeStyle = g;
          ctx.lineWidth = lw * 2.4;
          ctx.stroke();
        }
      }

      const glowColor = sampleGradient(s.palette.colors, pingPong(e.t + this.hue));
      const rad = (24 + band * 40 + e.flash * 34) * px;
      const grad = ctx.createRadialGradient(x, h, 0, x, h, rad);
      grad.addColorStop(0, rgba(glowColor, 0.4 + band * 0.4 + e.flash * 0.3));
      grad.addColorStop(1, rgba(glowColor, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, h, rad, 0, TAU);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0;
  }
}
