import { sampleGradient } from './palettes';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';

export class Waveform implements Visualizer {
  readonly id = 'wave';
  readonly name = 'Dalga Formu';
  readonly renderer = 'canvas2d';

  private ctx: CanvasRenderingContext2D;

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

    const midY = h / 2;
    const amp = h * 0.3;
    const N = frame.wave.length;

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    const grad = ctx.createLinearGradient(0, 0, w, 0);
    s.palette.colors.forEach((c, i) => {
      grad.addColorStop(i / (s.palette.colors.length - 1), c);
    });

    const layers = [
      { scale: 1, alpha: 0.95, lw: 2.5, glow: 18 },
      { scale: 0.7, alpha: 0.5, lw: 1.5, glow: 0 },
      { scale: 1.3, alpha: 0.3, lw: 1, glow: 0 },
    ];

    for (const layer of layers) {
      ctx.globalAlpha = layer.alpha;
      ctx.strokeStyle = grad;
      ctx.lineWidth = layer.lw * (1 + frame.beatPulse * 0.6);
      ctx.lineJoin = 'round';
      if (s.glow && layer.glow > 0) {
        const accent = sampleGradient(s.palette.colors, 0.5);
        ctx.shadowBlur = layer.glow + frame.beatPulse * 20;
        ctx.shadowColor = `rgb(${accent[0]},${accent[1]},${accent[2]})`;
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.beginPath();
      const stride = Math.max(1, Math.floor(N / (w / 2)));
      for (let i = 0; i < N; i += stride) {
        const x = (i / (N - 1)) * w;
        const y = midY + ((frame.wave[i] - 128) / 128) * amp * layer.scale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
}
