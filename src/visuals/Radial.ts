import { binAt, rgba, sampleGradient, hexToRgb } from './palettes';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';

export class Radial implements Visualizer {
  readonly id = 'radial';
  readonly name = 'Dairesel';
  readonly renderer = 'canvas2d';

  private ctx: CanvasRenderingContext2D;
  private rotation = 0;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  init(): void {}

  resize(): void {}

  dispose(): void {}

  update(frame: AudioFrame, s: VisualizerSettingsView, w: number, h: number): void {
    const ctx = this.ctx;
    const bg = hexToRgb(s.palette.bg);
    ctx.fillStyle = rgba(bg, 0.35);
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const base = Math.min(w, h) * 0.16;
    const r0 = base * (1 + frame.bass * 0.55 + frame.beatPulse * 0.25);
    const n = s.barCount;
    const maxLen = Math.min(w, h) * 0.32;

    this.rotation += s.rotationSpeed * (0.4 + frame.level * 2) * frame.dt * 2;

    ctx.lineCap = 'round';
    const half = Math.max(1, n / 2);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const mirror = i <= half ? i / half : (n - i) / half;
      const v = binAt(frame.freq, mirror);
      const angle = t * Math.PI * 2 + this.rotation;
      const len = base * 0.3 + v * maxLen;
      const color = sampleGradient(s.palette.colors, t);

      ctx.strokeStyle = rgba(color, 0.85);
      ctx.lineWidth = 1.5 + v * 3;
      if (s.glow) {
        ctx.shadowBlur = 12;
        ctx.shadowColor = rgba(color, 0.9);
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * r0, cy + Math.sin(angle) * r0);
      ctx.lineTo(cx + Math.cos(angle) * (r0 + len), cy + Math.sin(angle) * (r0 + len));
      ctx.stroke();
    }

    const accent = sampleGradient(s.palette.colors, 0.1);
    ctx.shadowBlur = s.glow ? 16 + frame.beatPulse * 30 : 0;
    ctx.shadowColor = rgba(accent, 0.9);
    ctx.strokeStyle = rgba(accent, 0.5 + frame.beatPulse * 0.5);
    ctx.lineWidth = 1.5 + frame.beatPulse * 4;
    ctx.beginPath();
    ctx.arc(cx, cy, r0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = rgba(accent, 0.7 + frame.beatPulse * 0.3);
    ctx.beginPath();
    ctx.arc(cx, cy, r0 * 0.06 * (1 + frame.beatPulse), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}
