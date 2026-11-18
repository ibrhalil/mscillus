import { barValue, rgba, sampleGradient } from './palettes';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';

export class SpectrumBars implements Visualizer {
  readonly id = 'bars';
  readonly name = 'Spektrum Barları';
  readonly renderer = 'canvas2d';

  private ctx: CanvasRenderingContext2D;
  private peaks: number[] = [];

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  init(): void {}

  resize(): void {}

  dispose(): void {}

  update(frame: AudioFrame, s: VisualizerSettingsView, w: number, h: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = s.palette.bg;
    ctx.fillRect(0, 0, w, h);

    const n = s.barCount;
    if (this.peaks.length !== n) this.peaks = new Array(n).fill(0);

    const gap = Math.max(2, (w / n) * 0.2);
    const barW = (w - gap * (n + 1)) / n;
    const baseY = h - Math.max(24, h * 0.06);
    const maxH = baseY - h * 0.1;

    for (let i = 0; i < n; i++) {
      const v = barValue(frame.freq, i, n);
      const color = sampleGradient(s.palette.colors, n > 1 ? i / (n - 1) : 0);
      const barH = Math.max(2, v * maxH);
      const x = gap + i * (barW + gap);
      const y = baseY - barH;

      const grad = ctx.createLinearGradient(0, baseY, 0, y);
      grad.addColorStop(0, rgba(color, 0.55));
      grad.addColorStop(1, rgba(color, 1));
      ctx.fillStyle = grad;
      if (s.glow) {
        ctx.shadowBlur = 18;
        ctx.shadowColor = rgba(color, 0.9);
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, Math.min(4, barW / 2));
      ctx.fill();

      this.peaks[i] = Math.max(this.peaks[i] - frame.dt * 0.45, v);
      const peakY = baseY - this.peaks[i] * maxH;
      ctx.fillStyle = rgba(color, 0.9);
      ctx.shadowBlur = 0;
      ctx.fillRect(x, peakY - 2, barW, 2);
    }
    ctx.shadowBlur = 0;
  }
}
