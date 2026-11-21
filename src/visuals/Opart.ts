import { binAtLerp, rgba, sampleGradient } from './palettes';
import type { Rgb } from './palettes';
import { EventScale, OnsetTracker } from './onset';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { TAU, clearFrame, damp, lighten, strokeGlow } from './util';

/**
 * Op-Art Halkalar: dışa akan eş merkezli, dalgalı (loblu) halkalar. Eski sürümde bas halkaların YARIÇAPINI ölçekliyordu (şekil ritimle
 * değişiyordu), akış hızı ham `level`le sıçrıyordu ve vuruşta faz birden `spacing·0.4` atlıyordu.
 *  - şekil/yön ritimle DEĞİŞMEZ: dalgalanma genliği sabit, yarıçap ölçeği yok; akış hızı YAVAŞ süzülmüş seviye + yumuşak vuruş dalgası,
 *  - ritim yalnız kalınlık/parlaklık: her halka kendi yarıçapına karşılık gelen frekansla (merkez bas, dış tiz; yumuşatılmış) kalınlaşır/parlar;
 *    vuruşta (bas veya spektral onset; şiddet müziğin kendi ortalamasına göre) merkezden dışa halkaların içinden geçen bir parlaklık dalgası,
 *  - yeni halka merkezde yumuşakça belirir (ani beliriş yok),
 *  - STİL: Çizgi (eski görünüm) veya Dolu Bantlar (Bridget Riley tarzı dolu, dönüşümlü bantlar; komşu halkaların farklı fazlı dalgalanması Moire
 *    etkisi yaratır).
 */

const SEGMENTS = 72;
const SPEC_N = 32;

interface Ring {
  r: number;
  k: number;
  e: number;
  wave: number;
}

export class Opart implements Visualizer {
  private ctx: CanvasRenderingContext2D;
  private phase = 0;
  private time = 0;
  private speed = 18;
  private sLevel = 0;
  private beatEnv = 0;
  private spec = new Float32Array(SPEC_N);
  private waves: { r: number; amp: number }[] = [];
  private onset = new OnsetTracker();
  private scale = new EventScale();

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  init(): void {}

  resize(): void {}

  dispose(): void {
    this.waves = [];
  }

  update(frame: AudioFrame, s: VisualizerSettingsView, w: number, h: number): void {
    const ctx = this.ctx;
    const dt = Math.min(frame.dt, 0.05);
    const o = s.opt;
    const filled = Math.round(o.style) === 1;
    // Dolu stilde halka çifti sayısı sabit kalsın: çift sayıda halka (dönüşümlü renkler dikişsiz sarılır)
    const rings = Math.round(o.rings) + (filled ? Math.round(o.rings) % 2 : 0);
    const lobes = Math.round(o.lobes);
    const px = Math.max(0.8, Math.min(w, h) / 700);
    this.time += dt;
    clearFrame(ctx, s.palette.bg, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const maxR = filled ? Math.hypot(w, h) * 0.51 : Math.min(w, h) * 0.75;
    const spacing = maxR / rings;
    const span = rings * spacing;

    // Yumuşatılmış ses
    this.sLevel += (frame.level - this.sLevel) * damp(dt, 1.2);
    for (let i = 0; i < SPEC_N; i++) {
      const raw = binAtLerp(frame.freq, i / (SPEC_N - 1));
      this.spec[i] += (raw - this.spec[i]) * damp(dt, raw > this.spec[i] ? 12 : 4);
    }

    // Vuruş: dışa yayılan parlaklık dalgası + yumuşak hız artışı (faz sıçraması yok)
    this.scale.tick(dt);
    if (this.onset.update(frame, dt, 2.0, 0.35) || frame.beat) {
      const pw = this.scale.rel(0.6 * frame.bass + 0.4 * frame.level);
      if (this.waves.length >= 3) this.waves.shift();
      this.waves.push({ r: 0, amp: 0.3 + 0.7 * pw });
      this.beatEnv = Math.max(this.beatEnv, 0.4 + 0.6 * pw);
    }
    this.beatEnv = Math.max(0, this.beatEnv - dt * 1.8);
    for (let k = this.waves.length - 1; k >= 0; k--) {
      this.waves[k].r += dt * maxR * 0.7;
      if (this.waves[k].r > maxR * 1.15) this.waves.splice(k, 1);
    }

    const target = (14 + Math.min(1, this.sLevel * 2) * 50 + this.beatEnv * 45) * px;
    this.speed += (target - this.speed) * damp(dt, 3);
    this.phase += dt * this.speed;

    const c0 = sampleGradient(s.palette.colors, 0.15);
    const c1 = sampleGradient(s.palette.colors, 0.6);
    const dark: Rgb = [c1[0] * 0.16, c1[1] * 0.16, c1[2] * 0.16];

    const list: Ring[] = [];
    for (let k = 0; k < rings; k++) {
      let r = (k * spacing + this.phase) % span;
      if (r < 0) r += span;
      if (r > maxR * 1.05) continue;
      const t = Math.min(1, r / maxR);
      const e = this.spec[Math.min(SPEC_N - 1, Math.floor(t * (SPEC_N - 1)))];
      let wave = 0;
      for (const wv of this.waves) {
        const d = (r - wv.r) / (maxR * 0.08);
        wave += wv.amp * Math.exp(-d * d);
      }
      list.push({ r, k, e: Math.min(1.2, e), wave: Math.min(1.3, wave) });
    }

    const outline = (ring: Ring): void => {
      ctx.beginPath();
      for (let i = 0; i <= SEGMENTS; i++) {
        const a = (i / SEGMENTS) * TAU;
        const rr = ring.r * (1 + 0.028 * o.wobble * Math.sin(a * lobes + this.time * 2 + ring.k));
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };

    if (filled) {
      // Dıştan içe dolu bantlar; yeni halka merkezde yumuşakça belirir (merkeze yakın renk farkı sönümlenir)
      list.sort((p, q) => q.r - p.r);
      if (list.length === 0) return;
      const outer = list[0];
      ctx.fillStyle = rgba(outer.k % 2 === 0 ? dark : c0, 1);
      ctx.fillRect(0, 0, w, h);
      for (const ring of list) {
        const even = ring.k % 2 === 0;
        const lit = (0.15 * ring.e + 0.5 * ring.wave) * o.pulse;
        const base = even ? c0 : dark;
        const col = lit > 0.01 ? lighten(base, Math.min(0.7, lit)) : base;
        const born = Math.min(1, ring.r / (spacing * 1.5));
        ctx.fillStyle = rgba(col, 0.15 + 0.85 * born);
        outline(ring);
        ctx.fill();
      }
      return;
    }

    for (const ring of list) {
      const color = ring.k % 2 === 0 ? c0 : c1;
      const fade = 1 - ring.r / (maxR * 1.05);
      const born = Math.min(1, ring.r / (spacing * 1.5));
      const react = (3.2 * ring.e + 2.5 * ring.wave) * o.pulse;
      outline(ring);
      strokeGlow(ctx, s.glow, color, (1.6 * px + react * px) , Math.min(1, (0.15 + fade * 0.7 + 0.2 * ring.e * o.pulse + 0.3 * ring.wave * o.pulse) * born));
    }
  }
}
