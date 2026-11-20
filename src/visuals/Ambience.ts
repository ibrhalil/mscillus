import { rgba, sampleGradient } from './palettes';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { damp, fadeTrail, strokeGlow } from './util';

const POINTS = 96;

/** 0..1..0 üçgen dalga: palet kayarken başa sarma sıçraması (renk atlaması) olmaz. */
const pingPong = (x: number): number => 1 - Math.abs(2 * (x - Math.floor(x)) - 1);

export class Ambience implements Visualizer {
  private ctx: CanvasRenderingContext2D;
  private time = 0;
  private hueShift = 0;
  // Yumuşatılmış ses: dalgalar ham değerlerle titremesin
  private sBass = 0;
  private sMid = 0;
  private sTreble = 0;
  private sLevel = 0;
  private sBeat = 0;
  private ys = new Float32Array(POINTS + 1);

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  init(): void {}

  resize(): void {}

  dispose(): void {}

  update(frame: AudioFrame, s: VisualizerSettingsView, w: number, h: number): void {
    const ctx = this.ctx;
    const o = s.opt;
    const dt = frame.dt;
    fadeTrail(ctx, s, 0.18, w, h);
    const layers = Math.round(o.layers);

    this.sBass += (frame.bass - this.sBass) * damp(dt, 4);
    this.sMid += (frame.mid - this.sMid) * damp(dt, 4);
    this.sTreble += (frame.treble - this.sTreble) * damp(dt, 4);
    this.sLevel += (frame.level - this.sLevel) * damp(dt, 3);
    this.sBeat += (frame.beatPulse - this.sBeat) * damp(dt, 5);
    const bands = [this.sBass, this.sMid, this.sTreble];

    this.time += dt * (0.15 + this.sLevel * 0.7);
    this.hueShift += dt * 0.02;

    const baseY = h * o.base;
    const freq = o.flow;
    const ys = this.ys;

    for (let l = 0; l < layers; l++) {
      const lt = l / layers;
      // Her katman kendi frekans bandına tepki verir (ön: bas, orta: orta, arka: tiz)
      const band = bands[l % 3];
      const color = sampleGradient(s.palette.colors, pingPong(lt + this.hueShift));
      const amp = h * 0.16 * o.height * (1 + band * 1.6) * (1 - lt * 0.35);
      const speed = 0.5 + l * 0.35;
      const yOff = l * h * 0.06;

      for (let i = 0; i <= POINTS; i++) {
        const t = i / POINTS;
        const env = Math.sin(Math.PI * t);
        const wave =
          Math.sin(t * 4.2 * freq * Math.PI + this.time * speed * 2 + l * 1.7) * 0.55 +
          Math.sin(t * 7.3 * freq * Math.PI - this.time * speed * 3.1 + l * 0.6) * 0.3 +
          Math.sin(t * 2.1 * freq * Math.PI + this.time * speed) * 0.35;
        ys[i] = baseY + yOff - wave * amp * env - this.sBeat * h * 0.025;
      }

      // Perde dolgusu: tepeden aşağı sönen gradyan (gölge yok; büyük dolguda shadowBlur çok pahalıydı)
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i <= POINTS; i++) ctx.lineTo((i / POINTS) * w, ys[i]);
      ctx.lineTo(w, h);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, baseY - amp - yOff, 0, h);
      grad.addColorStop(0, rgba(color, Math.min(1, (0.42 + this.sBeat * 0.2 + band * 0.25) * o.fill)));
      grad.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = grad;
      ctx.fill();

      // Tepe ışık çizgisi: parlama (hale) burada, ucuz şekilde
      if (o.crest >= 0.5) {
        ctx.beginPath();
        ctx.moveTo(0, ys[0]);
        for (let i = 1; i <= POINTS; i++) ctx.lineTo((i / POINTS) * w, ys[i]);
        ctx.lineJoin = 'round';
        strokeGlow(ctx, s.glow, color, 1.6 + band * 1.5, 0.55 + band * 0.4);
      }
    }
  }
}
