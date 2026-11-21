import { binAtLerp, rgba, sampleGradient } from './palettes';
import type { Rgb } from './palettes';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { clockDigits, digitMask } from './sevenSegment';
import { Bloom, clamp01, clearFrame, damp, drawGlowDot, lighten } from './util';

/**
 * Neon Saat: yedi parçalı, cam tüp görünümlü renkli dijital saat.
 *  - Her rakam kendi renginde (palet boyunca) ve KENDİ parıltı davranışında: nefes alan / vuruşla atan / arızalı tüp gibi titreyen /
 *    kendi frekans bandına (soldan sağa bas→tiz) bağlı. "Her rakam farklı" ayarında dördü birlikte görünür.
 *  - Rakam değişince yeni yanan parçalar çakılır (kısa aşırı parlama), sönenler tüp gibi yavaşça söner; iki nokta her saniye çakar.
 *  - Tüp = sönük cam gövde + yanınca hale / parıltı / gövde / beyaza çalan sıcak çekirdek. Arka plan her karede silindiği için
 *    sabit maliyetli `Bloom` kullanılır (iz bırakan modlarda kullanılamaz, bkz. util).
 */

/** Parçaların uç noktaları: rakam hücresi x 0..1, y 0..2; sıra a(üst) b c d(alt) e f g(orta). Hepsi 1 uzunluğunda. */
const SEGMENTS: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 1, 0],
  [1, 0, 1, 1],
  [1, 1, 1, 2],
  [0, 2, 1, 2],
  [0, 1, 0, 2],
  [0, 0, 0, 1],
  [0, 1, 1, 1],
];

/** Tüp kalınlığı ve komşu parçalar arasındaki boşluk (parça uçlarının içeri çekilmesi), rakam genişliğine oranla. */
const TUBE = 0.17;
const INSET = 0.16;
/** Rakamlar arası boşluk: çift içinde, ve iki nokta ile rakam arası. */
const PAIR_GAP = 0.42;
const COLON_GAP = 0.5;

/**
 * Tüp katmanları dıştan içe: [kalınlık çarpanı, alfa, beyaza çekme]. İlk `HALO_LAYERS` tanesi toplamsal hale (çok ve ince
 * basamaklı: tek geniş kapsül sert bir kenar bırakıyordu); parıltı kapalıyken yalnız gövde ve çekirdek çizilir.
 */
const LAYERS: readonly (readonly [number, number, number])[] = [
  [5.2, 0.022, 0],
  [3.9, 0.03, 0],
  [2.9, 0.045, 0],
  [2.1, 0.075, 0],
  [1.5, 0.13, 0],
  [1.0, 0.62, 0.12],
  [0.36, 1, 0.8],
];
const HALO_LAYERS = 5;

/** Rakam parıltı davranışları (0 = nefes alma, `glow()`'un varsayılan dalı). */
const BEAT = 1;
const FLICKER = 2;
const BANDS = 3;
const KINDS = 4;

const COLOR_SINGLE = 2;
const COLOR_FLOWING = 1;

const pingPong = (x: number): number => 1 - Math.abs(2 * (x - Math.floor(x)) - 1);

interface Digit {
  mask: number;
  /** Parça parlaklığı: yanınca hızla yükselir, sönünce yavaşça iner (tüpün sönme izi). */
  lit: Float32Array;
  /** Yeni yanan parçanın çakma parlaması; hızla söner. */
  strike: Float32Array;
  /** Rakamın kendi frekans bandı (yumuşatılmış). */
  band: number;
  /** Arızalı tüp: sonraki titremeye kalan süre, süren titremeden kalan süre, anlık açık/kapalı ve değişime kalan süre. */
  flickerNext: number;
  flickerLeft: number;
  flickerOn: boolean;
  flickerToggle: number;
}

function newDigit(mask: number): Digit {
  const lit = new Float32Array(7);
  for (let k = 0; k < 7; k++) lit[k] = (mask >> k) & 1;
  return {
    mask,
    lit,
    strike: new Float32Array(7),
    band: 0,
    flickerNext: 1 + Math.random() * 4,
    flickerLeft: 0,
    flickerOn: true,
    flickerToggle: 0,
  };
}

export class NeonClock implements Visualizer {
  private ctx: CanvasRenderingContext2D;
  private bloom = new Bloom();
  private digits: Digit[] = [];
  private time = 0;
  private sLevel = 0;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  init(): void {}

  resize(): void {}

  dispose(): void {
    this.digits = [];
  }

  update(frame: AudioFrame, s: VisualizerSettingsView, w: number, h: number): void {
    const ctx = this.ctx;
    const o = s.opt;
    const dt = frame.dt;
    this.time += dt;
    this.sLevel += (frame.level - this.sLevel) * damp(dt, 3);

    const twelve = Math.round(o.format) === 1;
    const now = new Date();
    const { digits: values, pm } = clockDigits(now, twelve, o.seconds >= 0.5);
    const n = values.length;
    // Rakam sayısı değişince (saniye aç/kapat) durum baştan kurulur; çakma efekti yalnız o andan sonraki değişimlerde.
    if (this.digits.length !== n) this.digits = values.map((v) => newDigit(digitMask(v)));

    const react = o.react;
    const style = Math.round(o.glowStyle);
    const intensity: number[] = [];
    for (let i = 0; i < n; i++) {
      const d = this.digits[i];
      const mask = digitMask(values[i]);
      const added = mask & ~d.mask;
      d.mask = mask;
      for (let k = 0; k < 7; k++) {
        const on = (mask >> k) & 1;
        if ((added >> k) & 1) d.strike[k] = 1;
        d.lit[k] += (on - d.lit[k]) * damp(dt, on ? 40 : 9);
        d.strike[k] = Math.max(0, d.strike[k] - dt * 3.2);
      }
      // Soldan sağa bas → tiz; bantlar ham değerle titremesin diye yumuşatılır
      const raw = clamp01((binAtLerp(frame.freq, n > 1 ? i / (n - 1) : 0) - 0.1) * 1.7);
      d.band += (raw - d.band) * damp(dt, raw > d.band ? 14 : 4);
      intensity.push(this.glow(style === 0 ? i % KINDS : style - 1, d, i, frame, react, dt));
    }

    // --- Yerleşim (birim: rakam genişliği) ---
    const pairs = n / 2;
    const unitsW = n + pairs * PAIR_GAP + (pairs - 1) * 2 * COLON_GAP;
    const u = Math.min((w * 0.8) / (unitsW + TUBE), (h * 0.5) / (2 + TUBE)) * o.size;
    const x0 = (w - unitsW * u) / 2;
    const y0 = h / 2 - u - (twelve ? u * 0.12 : 0);
    const tw = TUBE * u;

    const colors = s.palette.colors;
    const colorMode = Math.round(o.colorMode);
    /** `pos`: rakam sırası (iki nokta için iki rakamın ortası, ör. 1.5). */
    const colorAt = (pos: number): Rgb => {
      if (colorMode === COLOR_SINGLE) return sampleGradient(colors, 0);
      const t = n > 1 ? pos / (n - 1) : 0;
      return sampleGradient(colors, colorMode === COLOR_FLOWING ? pingPong(t * 0.8 + this.time * 0.04) : t);
    };

    clearFrame(ctx, s.palette.bg, w, h);
    ctx.save();
    ctx.lineCap = 'round';

    // Dizilimi (x konumları) ve renkleri bir kez hesapla
    const xs: number[] = [];
    const colonX: number[] = [];
    let x = x0;
    for (let p = 0; p < pairs; p++) {
      xs.push(x);
      x += (1 + PAIR_GAP) * u;
      xs.push(x);
      x += u;
      if (p < pairs - 1) {
        colonX.push(x + COLON_GAP * u);
        x += 2 * COLON_GAP * u;
      }
    }
    const digitColor = values.map((_, i) => colorAt(i));

    // Duvara vuran ışık: yanan parçalarla orantılı yumuşak hale (parıltı açıkken)
    if (s.glow) {
      for (let i = 0; i < n; i++) {
        const d = this.digits[i];
        let lit = 0;
        for (let k = 0; k < 7; k++) lit += d.lit[k];
        drawGlowDot(ctx, digitColor[i], xs[i] + u / 2, y0 + u, u * 2.1, (0.05 + 0.13 * intensity[i]) * (lit / 7));
      }
    }

    // Katman sırası önemli: önce tüm hale, sonra gövde, en son çekirdek (komşunun halesi çekirdeği örtmesin)
    const first = !s.glow ? HALO_LAYERS : s.glowQuality === 0 ? 3 : s.glowQuality === 1 ? 1 : 0;
    // Sönük cam tüpler
    ctx.lineWidth = tw;
    for (let i = 0; i < n; i++) {
      ctx.strokeStyle = rgba(digitColor[i], 1);
      ctx.globalAlpha = 0.07 + 0.03 * intensity[i];
      ctx.beginPath();
      for (const seg of SEGMENTS) this.segmentPath(ctx, seg, xs[i], y0, u);
      ctx.stroke();
    }
    const colonY = [y0 + 0.62 * u, y0 + 1.38 * u];
    // İki nokta saniye başında çakar, saniye boyunca söner; müzikle hafifçe nabız atar
    const colonLevel = (0.4 + 0.6 * Math.pow(1 - now.getMilliseconds() / 1000, 2.2)) * (0.9 + 0.3 * this.sLevel * react);

    for (let l = first; l < LAYERS.length; l++) {
      const [width, alpha, white] = LAYERS[l];
      ctx.globalCompositeOperation = l < HALO_LAYERS ? 'lighter' : 'source-over';
      ctx.lineWidth = tw * width;
      for (let i = 0; i < n; i++) {
        const d = this.digits[i];
        const I = intensity[i];
        // Hale yoğunlukla genişler/daralır: parlak rakamın ışıması daha geniş
        if (l < HALO_LAYERS) ctx.lineWidth = tw * width * (0.75 + 0.4 * I);
        for (let k = 0; k < 7; k++) {
          const lit = d.lit[k];
          if (lit < 0.02) continue;
          const st = d.strike[k];
          // Çakma anında tüp beyaza doğru da parlar
          ctx.strokeStyle = rgba(lighten(digitColor[i], Math.min(1, white + 0.3 * st)), 1);
          ctx.globalAlpha = clamp01(alpha * lit * I * (1 + 0.8 * st));
          ctx.beginPath();
          this.segmentPath(ctx, SEGMENTS[k], xs[i], y0, u);
          ctx.stroke();
        }
      }
      ctx.lineWidth = tw * width;
      for (let c = 0; c < colonX.length; c++) {
        ctx.strokeStyle = rgba(lighten(colorAt(c * 2 + 1.5), white), 1);
        ctx.globalAlpha = clamp01(alpha * colonLevel);
        for (const cy of colonY) {
          ctx.beginPath();
          ctx.moveTo(colonX[c], cy);
          ctx.lineTo(colonX[c], cy + 0.001 * u);
          ctx.stroke();
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    if (twelve) {
      ctx.font = `600 ${u * 0.3}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillStyle = rgba(lighten(digitColor[n - 1], 0.6), 0.9);
      ctx.fillText(pm ? 'PM' : 'AM', x0 + unitsW * u + tw / 2, y0 + 2 * u + tw * 1.4);
    }
    ctx.restore();

    if (s.glow) {
      let avg = 0;
      for (const v of intensity) avg += v;
      this.bloom.apply(ctx, w, h, 0.3 + 0.25 * clamp01(avg / n - 0.4));
    }
  }

  /** Parçanın (uçları içeri çekilmiş) çizgisini geçerli yola ekler. */
  private segmentPath(
    ctx: CanvasRenderingContext2D,
    seg: readonly [number, number, number, number],
    ox: number,
    oy: number,
    u: number,
  ): void {
    const [ax, ay, bx, by] = seg;
    const dx = bx - ax;
    const dy = by - ay;
    ctx.moveTo(ox + (ax + dx * INSET) * u, oy + (ay + dy * INSET) * u);
    ctx.lineTo(ox + (bx - dx * INSET) * u, oy + (by - dy * INSET) * u);
  }

  /** Rakamın o anki parıltı çarpanı (≈0.15..1.6); davranışa göre nefes, vuruş, arıza veya kendi frekans bandı. */
  private glow(kind: number, d: Digit, i: number, frame: AudioFrame, react: number, dt: number): number {
    let v: number;
    switch (kind) {
      case BEAT:
        v = 0.62 + 0.06 * Math.sin(this.time * 1.4 + i) + 0.65 * frame.beatPulse * react;
        break;
      case FLICKER: {
        // Arızalı neon tüp: arada bir kısa süre hızlı aç-kapa, sonra yine sakin yanar
        d.flickerNext -= dt;
        if (d.flickerLeft <= 0 && d.flickerNext <= 0) {
          d.flickerLeft = 0.2 + Math.random() * 0.5;
          d.flickerNext = 2.5 + Math.random() * 6;
        }
        if (d.flickerLeft > 0) {
          d.flickerLeft -= dt;
          d.flickerToggle -= dt;
          if (d.flickerToggle <= 0) {
            d.flickerOn = !d.flickerOn;
            d.flickerToggle = 0.03 + Math.random() * 0.07;
          }
        } else {
          d.flickerOn = true;
        }
        v = (0.92 + 0.06 * Math.sin(this.time * 9 + i)) * (d.flickerOn ? 1 : 0.2) + 0.25 * d.band * react;
        break;
      }
      case BANDS:
        v = 0.6 + 0.9 * d.band * react + 0.05 * Math.sin(this.time * 3 + i * 2);
        break;
      default:
        v = 0.8 + 0.2 * Math.sin(this.time * (1.2 + 0.17 * i) + i * 1.9) + 0.25 * d.band * react;
    }
    return Math.min(1.6, Math.max(0.15, v));
  }
}
