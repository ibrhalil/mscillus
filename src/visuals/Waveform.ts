import { rgba, sampleGradient } from './palettes';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { clearFrame, fadeFrame, glowBlur } from './util';

const STYLE_FILL = 1;
const STYLE_BARS = 2;
const COLOR_VERTICAL = 1;
const COLOR_SINGLE = 2;

const LAYERS = [
  { scale: 1, alpha: 0.95, lw: 2.5, glow: 18 },
  { scale: 0.7, alpha: 0.5, lw: 1.5, glow: 0 },
  { scale: 1.3, alpha: 0.3, lw: 1, glow: 0 },
];

export class Waveform implements Visualizer {
  private ctx: CanvasRenderingContext2D;
  /** Pencereden yeniden örneklenmiş, -1..1 aralığında dalga. */
  private samples = new Float32Array(0);
  /** CRT modu: her noktaya tiz enerjisiyle ölçeklenen rastgele titreşim. */
  private jitter = new Float32Array(0);
  private jitterAmp = 0;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  init(): void {}

  resize(): void {}

  dispose(): void {}

  /** İlk yükselen sıfır geçişinden başlayarak pencereyi `count` noktaya örnekler (osiloskop tetiklemesi). */
  private sample(wave: Uint8Array, windowFrac: number, trigger: boolean, count: number): void {
    const N = wave.length;
    const winLen = Math.max(64, Math.min(N, Math.floor(N * windowFrac)));
    let start = 0;
    if (trigger) {
      const limit = N - winLen;
      for (let i = 1; i < limit; i++) {
        if (wave[i - 1] < 128 && wave[i] >= 128) {
          start = i;
          break;
        }
      }
    }
    if (this.samples.length !== count) {
      this.samples = new Float32Array(count);
      this.jitter = new Float32Array(count);
    }
    const span = winLen - 1;
    for (let j = 0; j < count; j++) {
      const pos = start + (j / (count - 1)) * span;
      const i = Math.floor(pos);
      const f = pos - i;
      const a = wave[i];
      const b = wave[Math.min(N - 1, i + 1)];
      this.samples[j] = (a + (b - a) * f - 128) / 128;
    }
  }

  /** Örnekleri `scale` ile ölçekleyip yumuşak (veya düz) bir yol olarak kurar; `flip` aynalar. */
  private linePath(w: number, midY: number, amp: number, scale: number, smooth: boolean, flip: boolean): Path2D {
    const n = this.samples.length;
    const k = (flip ? -1 : 1) * amp * scale;
    const path = new Path2D();
    const x = (j: number) => (j / (n - 1)) * w;
    const j0 = this.jitterAmp;
    const y = (j: number) => midY + this.samples[j] * k + (j0 > 0 ? this.jitter[j] * j0 : 0);
    path.moveTo(0, y(0));
    if (smooth) {
      for (let j = 1; j < n - 1; j++) {
        path.quadraticCurveTo(x(j), y(j), (x(j) + x(j + 1)) / 2, (y(j) + y(j + 1)) / 2);
      }
      path.lineTo(x(n - 1), y(n - 1));
    } else {
      for (let j = 1; j < n; j++) path.lineTo(x(j), y(j));
    }
    return path;
  }

  update(frame: AudioFrame, s: VisualizerSettingsView, w: number, h: number): void {
    const ctx = this.ctx;
    const o = s.opt;
    if (o.persist > 0) fadeFrame(ctx, s.palette.bg, 1 - o.persist, w, h);
    else clearFrame(ctx, s.palette.bg, w, h);

    const style = Math.round(o.style);
    const colorMode = Math.round(o.colorMode);
    const midY = h / 2;
    const amp = h * 0.3 * o.amp;
    const smooth = o.smooth >= 0.5;
    const count = Math.max(32, Math.min(Math.floor(w / 3), frame.wave.length));
    this.sample(frame.wave, o.window, o.trigger >= 0.5, count);
    const crt = o.crt >= 0.5;
    this.jitterAmp = crt ? frame.treble * 7 : 0;
    if (crt) for (let j = 0; j < this.jitter.length; j++) this.jitter[j] = Math.random() - 0.5;

    if (o.grid >= 0.5) {
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < 10; i++) {
        const gx = Math.round((w * i) / 10) + 0.5;
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
      }
      for (let i = -3; i <= 3; i++) {
        const gy = Math.round(midY + (amp * i) / 3) + 0.5;
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
      }
      ctx.stroke();
    }
    if (o.centerLine >= 0.5) {
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(w, midY);
      ctx.stroke();
    }

    // Çizgi/dolgu rengi: yatay gradyan, dikey gradyan veya tek renk
    const colors = s.palette.colors;
    let paint: string | CanvasGradient;
    if (colorMode === COLOR_SINGLE) {
      paint = rgba(sampleGradient(colors, 0.5), 1);
    } else {
      const grad =
        colorMode === COLOR_VERTICAL
          ? ctx.createLinearGradient(0, midY + amp, 0, midY - amp)
          : ctx.createLinearGradient(0, 0, w, 0);
      colors.forEach((c, i) => grad.addColorStop(i / (colors.length - 1), c));
      paint = grad;
    }
    const accent = sampleGradient(colors, 0.5);
    const pulse = 1 + frame.beatPulse * 0.6;
    const glowColor = rgba(accent, 1);

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (style === STYLE_BARS) {
      this.drawBars(ctx, s, paint, glowColor, w, midY, amp, frame.beatPulse);
    } else {
      const layers = LAYERS.slice(0, Math.max(1, Math.round(o.layers)));
      // Dış katmanlar önce, ana çizgi en üstte
      for (let li = layers.length - 1; li >= 0; li--) {
        const layer = layers[li];
        const path = this.linePath(w, midY, amp, layer.scale, smooth, false);

        if (style === STYLE_FILL && li === 0) {
          const fill = new Path2D(path);
          fill.lineTo(w, midY);
          fill.lineTo(0, midY);
          fill.closePath();
          ctx.globalAlpha = 0.22;
          ctx.fillStyle = paint;
          ctx.fill(fill);
        }

        ctx.globalAlpha = layer.alpha;
        ctx.strokeStyle = paint;
        ctx.lineWidth = layer.lw * o.thickness * pulse;
        if (s.glow && layer.glow > 0) {
          ctx.shadowBlur = glowBlur(layer.glow + frame.beatPulse * 20);
          ctx.shadowColor = glowColor;
        }
        ctx.stroke(path);
        ctx.shadowBlur = 0;

        if (o.mirror >= 0.5 && li === 0) {
          ctx.globalAlpha = 0.3;
          ctx.stroke(this.linePath(w, midY, amp, layer.scale, smooth, true));
        }
      }
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    if (crt) this.drawCrtOverlay(ctx, w, h, frame.beatPulse, accent);
  }

  /** Tarama çizgileri, kenar karartma ve vuruşta çerçeve parlaması (eski CRT Osiloskop). */
  private drawCrtOverlay(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    beatPulse: number,
    accent: [number, number, number],
  ): void {
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.72);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
    if (beatPulse > 0.08) {
      ctx.strokeStyle = rgba(accent, beatPulse * 0.4);
      ctx.lineWidth = 3;
      ctx.strokeRect(6, 6, w - 12, h - 12);
    }
  }

  /** Orta çizgiden simetrik, genliğe göre uzayan dikey çubuklar (tek yol, tek dolgu). */
  private drawBars(
    ctx: CanvasRenderingContext2D,
    s: VisualizerSettingsView,
    paint: string | CanvasGradient,
    glowColor: string,
    w: number,
    midY: number,
    amp: number,
    beatPulse: number,
  ): void {
    const o = s.opt;
    const n = this.samples.length;
    const count = Math.max(16, Math.min(200, Math.floor(w / (6 * o.thickness + 2))));
    const slot = w / count;
    const barW = Math.max(1.5, slot * 0.6);
    ctx.beginPath();
    for (let b = 0; b < count; b++) {
      const v = Math.abs(this.samples[Math.min(n - 1, Math.round((b / (count - 1)) * (n - 1)))]);
      const half = Math.max(1.5, v * amp * (1 + beatPulse * 0.4));
      ctx.roundRect(b * slot + (slot - barW) / 2, midY - half, barW, half * 2, barW / 2);
    }
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = paint;
    if (s.glow) {
      ctx.shadowBlur = glowBlur(14 + beatPulse * 16);
      ctx.shadowColor = glowColor;
    }
    ctx.fill();
  }
}
