import { binAtLerp, rgba, sampleGradient } from './palettes';
import { EventScale, OnsetTracker } from './onset';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { damp, drawGlowDot, fadeTrail, lighten } from './util';

/**
 * Matris: GÖRÜNÜM ESKİ SÜRÜMLE AYNI (kullanıcı: "önceki görsel gösterim daha güzeldi, sadece etkileşimi yoktu"): fadeTrail ile yumuşakça sönen iz,
 * parlak kafa + glow sprite, sabit harfler. Yalnız MÜZİK ETKİLEŞİMİ eklendi:
 *  - Her sütun x konumuna göre soldan sağa bir frekansa bağlı (eskiden sıra numarasıyla i % 8): o frekansın (yumuşatılmış) enerjisi izin
 *    parlaklığını, kafanın parlaklığını ve sütunun akış hızını (yumuşak) belirler.
 *  - Genel yağış hızı yumuşatılmış ses seviyesiyle (eskiden ham seviye + vuruş, sıçrıyordu).
 *  - Vuruşta (müziğin ortalamasına göre şiddetle) tepeden YENİ akışlar başlar: şiddetli vuruş çok sütunda, en enerjik frekanslar öncelikli.
 */

interface Column {
  y: number;
  prevY: number;
  speed: number;
  t: number;
  /** Frekans enerjisi (yumuşatılmış). */
  e: number;
}

function glyph(mode: number): string {
  if (mode === 1) return String(Math.floor(Math.random() * 10));
  if (mode === 2) return Math.random() < 0.5 ? '0' : '1';
  const r = Math.random();
  if (r < 0.5) return String.fromCharCode(0x30a1 + Math.floor(Math.random() * 96));
  if (r < 0.8) return String(Math.floor(Math.random() * 10));
  return String.fromCharCode(33 + Math.floor(Math.random() * 60));
}

export class Matrix implements Visualizer {
  private ctx: CanvasRenderingContext2D;
  private cols: Column[] = [];
  private lastW = 0;
  private lastFont = 0;
  private specS = new Float32Array(64);
  private onset = new OnsetTracker();
  private scale = new EventScale();
  private spd = 1;
  private sSlow = 0;
  private sLevel = 0;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  init(): void {}

  resize(): void {
    this.lastW = 0;
    this.lastFont = 0;
  }

  dispose(): void {
    this.cols = [];
  }

  update(frame: AudioFrame, s: VisualizerSettingsView, w: number, h: number): void {
    const ctx = this.ctx;
    const dt = frame.dt;
    const font = Math.round(s.opt.fontSize);
    const glyphMode = Math.round(s.opt.glyphs);
    fadeTrail(ctx, s, 0.12, w, h);

    if (this.lastW !== w || this.lastFont !== font) {
      this.lastW = w;
      this.lastFont = font;
      const n = Math.ceil(w / font);
      this.cols = [];
      for (let i = 0; i < n; i++) {
        this.cols.push({
          y: Math.random() * -40,
          prevY: Math.random() * -40,
          speed: 4 + Math.random() * 11,
          t: i / n,
          e: 0,
        });
      }
    }

    ctx.font = `${font}px monospace`;
    ctx.textBaseline = 'top';
    const rows = h / font;

    // Yumuşatılmış ses
    this.sLevel += (frame.level - this.sLevel) * damp(dt, 3);
    this.sSlow += (frame.level - this.sSlow) * damp(dt, 0.8);
    for (let i = 0; i < 64; i++) {
      const raw = binAtLerp(frame.freq, i / 63);
      const cur = this.specS[i];
      this.specS[i] = cur + (raw - cur) * damp(dt, raw > cur ? 12 : 4);
    }
    // Genel yağış hızı: yumuşatılmış seviye (ani sıçrama yok)
    const target = 1 + 1.4 * Math.min(1, this.sSlow * 3);
    this.spd += (target - this.spd) * damp(dt, 1.2);

    // Her sütunun frekans enerjisi (soldan sağa); yumuşatılmış
    const react = s.opt.react;
    for (const col of this.cols) {
      const raw = Math.min(1.2, Math.max(0, (this.specS[Math.min(63, Math.floor(col.t * 63))] - 0.1) * 1.7 * react));
      col.e += (raw - col.e) * damp(dt, raw > col.e ? 8 : 3);
    }

    // Vuruş: tepeden yeni akışlar (şiddete göre kaç sütun; enerjik frekanslar öncelikli)
    const hit = this.onset.update(frame, dt, 1.8, 0.4);
    this.scale.tick(dt);
    if ((frame.beat || hit) && s.opt.burst >= 0.5) {
      const e = frame.beat ? frame.bass + 0.3 * Math.min(1, this.sLevel * 2) : 0.3 * Math.min(1, this.onset.ratio / 4) + 0.3 * frame.bass;
      const pw = this.scale.rel(e);
      const k = Math.round(3 + 18 * pw);
      for (let n = 0; n < k; n++) {
        // 3 rastgele sütundan en enerjik olanı (kafası aşağıda kalmış, yani yeni akış başlatılabilir)
        let best: Column | null = null;
        for (let c = 0; c < 3; c++) {
          const cand = this.cols[Math.floor(Math.random() * this.cols.length)];
          if (cand && cand.y > rows * 0.25 && (!best || cand.e > best.e)) best = cand;
        }
        if (best) {
          best.y = -Math.random() * 4;
          best.prevY = best.y;
        }
      }
    }

    for (let i = 0; i < this.cols.length; i++) {
      const col = this.cols[i];
      col.prevY = col.y;
      // Sütun hızı: kendi frekansı yüksekse biraz hızlanır (yumuşak)
      col.y += col.speed * this.spd * (0.8 + 0.5 * col.e) * dt;
      if (col.prevY > rows + 8) {
        col.y = -Math.random() * 20;
        col.prevY = col.y;
        col.speed = 4 + Math.random() * 11;
        continue;
      }

      const band = col.e;
      const color = sampleGradient(s.palette.colors, col.t);
      const head = lighten(color, 0.7);
      const x = i * font;
      const startRow = Math.max(0, Math.ceil(col.prevY));
      const endRow = Math.floor(col.y);

      for (let row = startRow; row <= endRow && row <= rows; row++) {
        const isHead = row === endRow;
        ctx.fillStyle = rgba(isHead ? head : color, isHead ? 0.95 : 0.35 + band * 0.5);
        // Gölge yerine sprite hale (gölge sıfırlanmadığı için tüm iz harflerine de uygulanıyordu)
        if (s.glow && isHead) drawGlowDot(ctx, color, x + font / 2, row * font + font / 2, font * 1.5, 0.55 + 0.35 * Math.min(1, band));
        ctx.fillText(glyph(glyphMode), x, row * font);
      }
    }
  }
}
