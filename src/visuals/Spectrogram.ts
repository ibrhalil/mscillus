import { binAtLerp, freqPosition, hexToRgb, sampleGradient } from './palettes';
import type { Rgb } from './palettes';
import { createOffscreen, lighten } from './util';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';

/** Kaydırma hızı (CSS px/sn); "Animasyon Hızı" ayarı `frame.dt` üzerinden bunu ölçekler. */
const SCROLL_PX_PER_SEC = 150;
const MAX_COLS_PER_FRAME = 48;
const GRID_HZ: [number, string][] = [
  [100, '100 Hz'],
  [1000, '1 kHz'],
  [10000, '10 kHz'],
];

export class Spectrogram implements Visualizer {
  private ctx: CanvasRenderingContext2D;
  private off: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private column: ImageData | null = null;
  private lut = new Uint8Array(256 * 3);
  private lutKey = '';
  private bg: Rgb = [0, 0, 0];
  private pending = 0;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
    ({ canvas: this.off, ctx: this.offCtx } = createOffscreen('Spektrogram'));
  }

  init(w: number, h: number): void {
    this.resize(w, h);
  }

  resize(w: number, h: number): void {
    this.off.width = Math.max(2, Math.round(w));
    this.off.height = Math.max(2, Math.round(h));
    this.column = this.offCtx.createImageData(1, this.off.height);
    this.offCtx.fillStyle = '#000';
    this.offCtx.fillRect(0, 0, this.off.width, this.off.height);
    this.lutKey = '';
  }

  dispose(): void {
    this.column = null;
  }

  private buildLut(s: VisualizerSettingsView): void {
    this.lutKey = `${s.palette.id}:${s.opt.contrast}`;
    this.bg = hexToRgb(s.palette.bg);
    const gamma = 0.85 * s.opt.contrast;
    for (let i = 0; i < 256; i++) {
      const c = sampleGradient(s.palette.colors, i / 255);
      const b = Math.pow(i / 255, gamma);
      this.lut[i * 3] = (c[0] * b) | 0;
      this.lut[i * 3 + 1] = (c[1] * b) | 0;
      this.lut[i * 3 + 2] = (c[2] * b) | 0;
    }
  }

  /** Güncel spektrumu tek piksellik dikey sütuna (ImageData) yazar. */
  private fillColumn(freq: Uint8Array): ImageData {
    const col = this.column as ImageData;
    const h = col.height;
    const d = col.data;
    const { lut, bg } = this;
    for (let y = 0; y < h; y++) {
      const v = binAtLerp(freq, 1 - (y + 0.5) / h);
      const o = y * 4;
      if (v < 0.03) {
        d[o] = bg[0];
        d[o + 1] = bg[1];
        d[o + 2] = bg[2];
      } else {
        const li = ((v * 255) | 0) * 3;
        d[o] = lut[li];
        d[o + 1] = lut[li + 1];
        d[o + 2] = lut[li + 2];
      }
      d[o + 3] = 255;
    }
    return col;
  }

  update(frame: AudioFrame, s: VisualizerSettingsView, w: number, h: number): void {
    if (this.off.width !== Math.round(w) || this.off.height !== Math.round(h)) this.resize(w, h);
    if (this.lutKey !== `${s.palette.id}:${s.opt.contrast}`) this.buildLut(s);

    const off = this.offCtx;
    const width = this.off.width;

    // Kesirli kaydırmayı biriktir: kare hızından bağımsız, sabit px/sn akış.
    this.pending += SCROLL_PX_PER_SEC * frame.dt;
    const cols = Math.min(MAX_COLS_PER_FRAME, Math.floor(this.pending));
    this.pending -= Math.floor(this.pending);

    if (cols > 0) {
      off.drawImage(this.off, -cols, 0);
      const col = this.fillColumn(frame.freq);
      for (let i = 0; i < cols; i++) off.putImageData(col, width - cols + i, 0);

      if (frame.beat && s.opt.beatLine >= 0.5) {
        const c = lighten(sampleGradient(s.palette.colors, 0.5), 0.6);
        off.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},0.5)`;
        off.fillRect(width - cols, 0, 1, this.off.height);
      }
    }

    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(this.off, 0, 0, w, h);
    if (s.opt.grid >= 0.5) this.drawGrid(frame, w, h);
  }

  /** Logaritmik frekans eksenine ince çizgiler + etiketler (görselin üstüne, kaydırmadan bağımsız). */
  private drawGrid(frame: AudioFrame, w: number, h: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 1;
    for (const [hz, label] of GRID_HZ) {
      const t = freqPosition(frame.freq.length, frame.sampleRate, hz);
      if (t <= 0.02 || t >= 0.98) continue;
      const y = Math.round((1 - t) * h) + 0.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText(label, 10, y - 3);
    }
    ctx.restore();
  }
}
