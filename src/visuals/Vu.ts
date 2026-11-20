import { rgba, sampleGradient } from './palettes';
import { TAU, clamp01, clearFrame, lighten, setGlow } from './util';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';

const GAUGES = 4;
const A0 = -Math.PI * 0.85;
const A1 = -Math.PI * 0.15;
const LABELS = ['BAS', 'ORTA', 'TİZ', 'SEVİYE'];
const PEAK_HOLD = 0.9;
const PEAK_FALL = 0.22;
/** Seviye göstergesi için dB aralığı: -34 dB (boş) … 0 dB (tam). */
const DB_RANGE = 34;

interface Needle {
  disp: number;
  vel: number;
}

export class Vu implements Visualizer {
  private ctx: CanvasRenderingContext2D;
  private needles: Needle[] = Array.from({ length: GAUGES }, () => ({ disp: A0, vel: 0 }));
  private peak = new Float32Array(GAUGES);
  private peakHold = new Float32Array(GAUGES);

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
    clearFrame(ctx, s.palette.bg, w, h);

    // Bas/orta/tiz zaten dB-eşlemeli analizör değerleridir; SEVİYE ise doğrusal RMS'tir → gerçek VU gibi dB ölçeğine çevrilir
    // (eskiden doğrusal çizildiği için RMS 0.05-0.3 aralığında kaldığından iğne neredeyse hiç kıpırdamıyordu).
    const level = frame.level > 1e-5 ? clamp01((20 * Math.log10(frame.level) + DB_RANGE) / DB_RANGE) : 0;
    const values = [frame.bass, frame.mid, frame.treble, level].map((v) => Math.min(1, v * 1.2 * o.gain));

    // Yerleşim: geniş ekranda 1×4, dar/dikey ekranda 2×2 (eskiden dar ekranda göstergeler küçülüyordu)
    const layout = Math.round(o.layout);
    const grid2 = layout === 2 || (layout === 0 && w / h < 1.3);
    const cols = grid2 ? 2 : 4;
    const rows = grid2 ? 2 : 1;
    const cellW = w / cols;
    const cellH = h / rows;
    const R = Math.min(cellW / 2.5, cellH * 0.38) * o.scale;
    const accent = sampleGradient(s.palette.colors, 0.2);
    const hot = sampleGradient(s.palette.colors, 0.85);
    const lampCol = lighten(sampleGradient(s.palette.colors, 0.45), 0.25);

    ctx.lineCap = 'round';
    for (let i = 0; i < GAUGES; i++) {
      const cx = cellW * ((i % cols) + 0.5);
      const cy = cellH * (Math.floor(i / cols) + 0.46);
      const v = values[i];

      // Kadran yüzü + ARKA IŞIK: seviye yükseldikçe yüz aydınlanır
      ctx.fillStyle = 'rgba(10,12,18,0.92)';
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.fill();
      if (o.lamp > 0) {
        const lamp = ctx.createRadialGradient(cx, cy - R * 0.15, 0, cx, cy - R * 0.15, R);
        lamp.addColorStop(0, rgba(lampCol, Math.min(0.55, (0.04 + 0.32 * v) * o.lamp)));
        lamp.addColorStop(1, rgba(lampCol, 0));
        ctx.fillStyle = lamp;
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, TAU);
        ctx.fill();
      }
      ctx.strokeStyle = rgba(accent, 0.35 + frame.beatPulse * 0.4);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.stroke();

      // Ölçek: ana yay + KIRMIZI BÖLGE (8-10)
      ctx.strokeStyle = rgba(accent, 0.25);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.75, A0, A0 + ((A1 - A0) * 8) / 10);
      ctx.stroke();
      ctx.strokeStyle = rgba(hot, 0.8);
      ctx.lineWidth = Math.max(2, R * 0.04);
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.75, A0 + ((A1 - A0) * 8) / 10, A1);
      ctx.stroke();

      for (let k = 0; k <= 10; k++) {
        const a = A0 + ((A1 - A0) * k) / 10;
        const r1 = R * 0.72;
        const r2 = R * (k % 5 === 0 ? 0.86 : 0.8);
        const c = k >= 8 ? hot : lighten(accent, 0.3);
        ctx.strokeStyle = rgba(c, k >= 8 ? 0.9 : 0.55);
        ctx.lineWidth = k % 5 === 0 ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.stroke();
      }

      if (o.numbers >= 0.5 && R > 40) {
        ctx.font = `${Math.max(8, R * 0.09)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let k = 0; k <= 10; k += 2) {
          const a = A0 + ((A1 - A0) * k) / 10;
          ctx.fillStyle = rgba(k >= 8 ? hot : lighten(accent, 0.3), 0.7);
          ctx.fillText(String(k), cx + Math.cos(a) * R * 0.6, cy + Math.sin(a) * R * 0.6);
        }
        ctx.textBaseline = 'alphabetic';
      }

      // İğne: yay-sönüm, ζ≈0.65 (eskiden ζ≈0.3 → ~%37 aşma); gerçek VU ~%10 aşar
      const needle = this.needles[i];
      const target = A0 + (A1 - A0) * v;
      const stiffness = 220 * o.stiff;
      const damping = 2 * 0.65 * Math.sqrt(stiffness);
      needle.vel += ((target - needle.disp) * stiffness - needle.vel * damping) * dt;
      needle.disp += needle.vel * dt;
      const disp = Math.max(A0 - 0.05, Math.min(A1 + 0.05, needle.disp));

      // Tepe tutma işareti: yükselince tutulur, sonra yavaşça düşer
      if (v >= this.peak[i]) {
        this.peak[i] = v;
        this.peakHold[i] = PEAK_HOLD;
      } else if (this.peakHold[i] > 0) {
        this.peakHold[i] -= dt;
      } else {
        this.peak[i] = Math.max(v, this.peak[i] - PEAK_FALL * dt);
      }
      if (o.peak >= 0.5 && this.peak[i] > 0.02) {
        const pa = A0 + (A1 - A0) * this.peak[i];
        ctx.strokeStyle = rgba(hot, 0.9);
        ctx.lineWidth = Math.max(2, R * 0.03);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(pa) * R * 0.7, cy + Math.sin(pa) * R * 0.7);
        ctx.lineTo(cx + Math.cos(pa) * R * 0.9, cy + Math.sin(pa) * R * 0.9);
        ctx.stroke();
      }

      // İğne gölgesi + iğne
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx + 2, cy + 3);
      ctx.lineTo(cx + 2 + Math.cos(disp) * R * 0.88, cy + 3 + Math.sin(disp) * R * 0.88);
      ctx.stroke();

      ctx.strokeStyle = rgba(lighten(accent, 0.65), 0.95);
      ctx.lineWidth = 2.5;
      setGlow(ctx, s.glow, 8, rgba(accent, 0.8));
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(disp) * R * 0.88, cy + Math.sin(disp) * R * 0.88);
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.fillStyle = rgba(lighten(accent, 0.5), 0.95);
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.06, 0, TAU);
      ctx.fill();

      // Cam parlaması
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      ctx.beginPath();
      ctx.ellipse(cx, cy - R * 0.4, R * 0.82, R * 0.42, 0, 0, TAU);
      ctx.fill();

      if (o.led >= 0.5) {
        const led = Math.min(1, v * 1.4 + frame.beatPulse * 0.4);
        ctx.fillStyle = rgba(hot, led);
        ctx.beginPath();
        ctx.arc(cx, cy - R * 0.5, R * 0.05, 0, TAU);
        ctx.fill();
      }

      if (o.labels >= 0.5) {
        ctx.fillStyle = rgba(lighten(accent, 0.3), 0.7);
        ctx.font = `${Math.max(9, R * 0.14)}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(LABELS[i], cx, cy + R * 0.65);
      }
    }
    ctx.textAlign = 'start';
  }
}
