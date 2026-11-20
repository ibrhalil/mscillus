import { binAtLerp, rgba, sampleGradient } from './palettes';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { TAU, damp, fadeTrail, glowBlur } from './util';

/**
 * Şeritler: Lissajous tarzı akan şeritler (6 baş, her biri kuyruk bırakır). Yol HİÇ ritimle değişmez; ritim yalnız kalınlık ve parlaklık:
 * her şerit kendi frekans diliminden beslenir ve kuyruğun her noktası, doğduğu andaki müzik enerjisini TAŞIR — vuruş kuyruk boyunca
 * baştan sona akan bir şişkinlik olarak görünür (müziğin geçmişi şeridin üstünde okunur). Hız yavaş süzülmüş seviyeyle; sabit adımlı
 * örnekleme (60 Hz) olduğundan kuyruk süresi ekranın yenileme hızına bağlı değil.
 *
 * Düzeltilen hata: Spiro modunda frekans çarpanı `time·morph` ile zamanla değişiyordu → türevi `time·morph'` büyüyüp şerit hızı uzun
 * sürede sürekli artıyordu; artık yalnız sınırlı bir faz kayması var. Eski sürüm 660 segmentin her birinde shadowBlur çiziyordu (pahalı);
 * parıltı artık geniş-sönük ikinci geçiş.
 */

const RIBBONS = 6;
const STEP = 1 / 60;
/** Spiro eğrisi (eski Spirograf): tam sayı frekans oranları kapalı, simetrik desenler üretir. */
const SPIRO: [number, number][] = [
  [3, 2],
  [5, 4],
  [7, 3],
];

const pingPong = (x: number): number => 1 - Math.abs(2 * (x - Math.floor(x)) - 1);

interface Ribbon {
  xs: number[];
  ys: number[];
  /** Her noktanın doğduğu andaki kalınlık/parlaklık çarpanı (müziğin geçmişi). */
  ws: number[];
  as: number[];
  phase: number;
  f1: number;
  f2: number;
  ampX: number;
  ampY: number;
  width: number;
  band: number;
}

export class Ribbons implements Visualizer {
  private ctx: CanvasRenderingContext2D;
  private ribbons: Ribbon[] = [];
  private time = 0;
  private acc = 0;
  private hue = 0;
  private sLevel = 0;
  private sBeat = 0;
  private sBand = new Float32Array(RIBBONS);

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
    for (let i = 0; i < RIBBONS; i++) {
      this.ribbons.push({
        xs: [],
        ys: [],
        ws: [],
        as: [],
        phase: Math.random() * TAU,
        f1: 0.7 + Math.random() * 1.6,
        f2: 0.7 + Math.random() * 1.6,
        ampX: 0.22 + Math.random() * 0.2,
        ampY: 0.18 + Math.random() * 0.22,
        width: 1.5 + Math.random() * 2.5,
        band: i,
      });
    }
  }

  init(): void {}

  resize(): void {}

  dispose(): void {
    for (const r of this.ribbons) {
      r.xs.length = 0;
      r.ys.length = 0;
      r.ws.length = 0;
      r.as.length = 0;
    }
  }

  update(frame: AudioFrame, s: VisualizerSettingsView, w: number, h: number): void {
    const ctx = this.ctx;
    const dt = Math.min(frame.dt, 0.05);
    fadeTrail(ctx, s, 0.08, w, h);
    const o = s.opt;
    const heads = Math.round(o.heads);
    const trailLen = Math.round(o.length);
    const spiro = Math.round(o.curve) === 1;

    // Yumuşatılmış ses; hız yavaş süzülmüş seviyeden (ani hızlanma/yavaşlama yok)
    this.sLevel += (frame.level - this.sLevel) * damp(dt, 1.2);
    this.sBeat += (frame.beatPulse - this.sBeat) * damp(dt, 6);
    for (let i = 0; i < RIBBONS; i++) {
      const raw = binAtLerp(frame.freq, (i + 0.5) / RIBBONS);
      this.sBand[i] += (raw - this.sBand[i]) * damp(dt, raw > this.sBand[i] ? 12 : 4);
    }
    const speed = 0.3 + Math.min(1, this.sLevel * 2) * 0.9;
    this.hue += dt * 0.01;

    const cx = w / 2;
    const cy = h / 2;
    const px = Math.max(0.8, Math.min(w, h) / 700);

    // Sabit adımlı örnekleme: kuyruk uzunluğu (süre) yenileme hızına bağlı değil
    this.acc += dt;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.time += STEP * speed;
      const drift = spiro ? 0.8 * Math.sin(this.time * 0.05) : 0;
      for (let ri = 0; ri < heads; ri++) {
        const r = this.ribbons[ri];
        const f1 = spiro ? SPIRO[ri % 3][0] / Math.PI : r.f1;
        const f2 = spiro ? SPIRO[ri % 3][1] / Math.PI : r.f2;
        const ampX = spiro ? 0.33 : r.ampX;
        const ampY = spiro ? 0.33 : r.ampY;
        r.xs.push(cx + Math.sin(this.time * f1 * Math.PI + r.phase + drift) * ampX * w * 0.9);
        r.ys.push(cy + Math.sin(this.time * f2 * Math.PI + r.phase * 1.7) * ampY * h * 0.9);
        const b = this.sBand[r.band];
        r.ws.push(0.6 + b * 0.8 + this.sBeat * 0.45);
        r.as.push(0.25 + b * 0.6 + this.sBeat * 0.25);
        while (r.xs.length > trailLen) {
          r.xs.shift();
          r.ys.shift();
          r.ws.shift();
          r.as.shift();
        }
      }
    }

    const gk = s.glow ? Math.min(1.5, glowBlur(1)) : 0;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let ri = 0; ri < heads; ri++) {
      const r = this.ribbons[ri];
      const color = sampleGradient(s.palette.colors, pingPong(ri / (RIBBONS - 1) + this.hue));
      const n = r.xs.length;
      for (let pass = gk > 0 ? 0 : 1; pass < 2; pass++) {
        for (let j = 1; j < n; j++) {
          const fade = j / n;
          const lw = r.width * px * fade * r.ws[j];
          ctx.strokeStyle = rgba(color, r.as[j] * fade * fade * (pass === 0 ? 0.16 : 1));
          ctx.lineWidth = pass === 0 ? lw * (1 + 3 * gk) : lw;
          ctx.beginPath();
          ctx.moveTo(r.xs[j - 1], r.ys[j - 1]);
          ctx.lineTo(r.xs[j], r.ys[j]);
          ctx.stroke();
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
