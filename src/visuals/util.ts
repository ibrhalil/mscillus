import { hexToRgb, rgba } from './palettes';
import type { Rgb } from './palettes';
import type { VisualizerSettingsView } from './types';

export const TAU = Math.PI * 2;

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Kare süresine bağlı yumuşak yaklaşma katsayısı (lerp faktörü), 0..1. */
export const damp = (dt: number, rate: number): number => Math.min(1, dt * rate);

export function hash1(n: number): number {
  const x = Math.sin(n) * 43758.5453;
  return x - Math.floor(x);
}

export function lighten(c: Rgb, amount: number): Rgb {
  return [
    Math.min(255, Math.round(c[0] + (255 - c[0]) * amount)),
    Math.min(255, Math.round(c[1] + (255 - c[1]) * amount)),
    Math.min(255, Math.round(c[2] + (255 - c[2]) * amount)),
  ];
}

/** Tuvali düz arka plan rengiyle tamamen boyar. */
export function clearFrame(ctx: CanvasRenderingContext2D, bgHex: string, w: number, h: number): void {
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, w, h);
}

/** Arka planı `alpha` kadar üzerine boyayarak önceki kareyi söndürür (iz efekti). */
export function fadeFrame(
  ctx: CanvasRenderingContext2D,
  bgHex: string,
  alpha: number,
  w: number,
  h: number,
): void {
  ctx.fillStyle = rgba(hexToRgb(bgHex), alpha);
  ctx.fillRect(0, 0, w, h);
}

/** `fadeFrame` + modun "İz Uzunluğu" seçeneği (varsa): `alpha` ne kadar küçükse iz o kadar uzun. */
export function fadeTrail(
  ctx: CanvasRenderingContext2D,
  s: VisualizerSettingsView,
  alpha: number,
  w: number,
  h: number,
): void {
  fadeFrame(ctx, s.palette.bg, clamp01(alpha / (s.opt.trail || 1)), w, h);
}

// Genel çözünürlük ölçeği (Performans → Çözünürlük, otomatik ölçekleme): RenderLoop ayarlar; kendi kalite ayarı olan
// WebGL modları (Solucan Deliği, Kaleydoskop) sınırlarını bununla birleştirir.
let renderScale = 1;

export function setRenderScale(scale: number): void {
  renderScale = scale;
}

/** Çizim tamponu piksel oranı: cihaz DPR'si (en çok 2) × genel çözünürlük ölçeği. */
export function pixelRatio(): number {
  return Math.min(2, window.devicePixelRatio || 1) * renderScale;
}

/** Parlama açıksa gölge bulanıklığı + rengini ayarlar, kapalıysa gölgeyi sıfırlar. */
// Parlama kalitesi (0 düşük, 1 orta, 2 yüksek): RenderLoop her karede ayarlar; yardımcılar buna göre ölçeklenir.
const GLOW_SCALE = [0.45, 0.75, 1] as const;
let glowLevel = 2;

export function setGlowQuality(level: number): void {
  glowLevel = Math.min(2, Math.max(0, Math.round(level)));
}

/** Gölge bulanıklığını (px) geçerli parlama kalitesine göre ölçekler. */
export const glowBlur = (px: number): number => px * GLOW_SCALE[glowLevel];

export function setGlow(ctx: CanvasRenderingContext2D, on: boolean, blur: number, color: string): void {
  if (on) {
    ctx.shadowBlur = glowBlur(blur);
    ctx.shadowColor = color;
  } else {
    ctx.shadowBlur = 0;
  }
}

/** Ekran dışı (offscreen) 2D tuval + context; context alınamazsa anlamlı hata verir. */
export function createOffscreen(label: string): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(`${label} offscreen context alınamadı`);
  return { canvas, ctx };
}

// --- Ucuz parlama --------------------------------------------------------------
// `shadowBlur` her çizim çağrısında ayrı bir bulanıklaştırma geçişi demektir; yüzlerce
// öğe çizen modlarda kasmanın asıl sebebi budur. Aşağıdaki yardımcılar gölge kullanmaz.

const glowSprites = new Map<number, HTMLCanvasElement>();
const SPRITE_SIZE = 64;

function glowSprite(color: Rgb): HTMLCanvasElement {
  // Renk 4 bit/kanala indirgenir: sınırlı sayıda sprite, görsel fark yok.
  const key = ((color[0] >> 4) << 8) | ((color[1] >> 4) << 4) | (color[2] >> 4);
  let sprite = glowSprites.get(key);
  if (sprite) return sprite;
  const { canvas, ctx } = createOffscreen('Parlama sprite');
  canvas.width = canvas.height = SPRITE_SIZE;
  const c = SPRITE_SIZE / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, rgba(color, 0.85));
  g.addColorStop(0.3, rgba(color, 0.32));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  glowSprites.set(key, canvas);
  return canvas;
}

/** (x, y) çevresine `radius` yarıçaplı yumuşak ışık halesi çizer; önceden üretilmiş sprite ile `drawImage`. */
export function drawGlowDot(
  ctx: CanvasRenderingContext2D,
  color: Rgb,
  x: number,
  y: number,
  radius: number,
  alpha = 1,
): void {
  const prev = ctx.globalAlpha;
  const k = GLOW_SCALE[glowLevel];
  const r = radius * (0.6 + 0.4 * k);
  ctx.globalAlpha = prev * clamp01(alpha * (0.5 + 0.5 * k));
  ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = prev;
}

/**
 * Geçerli yolu önce geniş ve silik (hale), sonra asıl çizgi olarak vurur; gölgesiz sahte parlama.
 * Parlama kapalıysa yalnızca asıl çizgi çizilir.
 */
export function strokeGlow(
  ctx: CanvasRenderingContext2D,
  on: boolean,
  color: Rgb,
  width: number,
  alpha: number,
): void {
  if (on) {
    if (glowLevel === 2) {
      ctx.strokeStyle = rgba(color, alpha * 0.07);
      ctx.lineWidth = width * 7 + 4;
      ctx.stroke();
    }
    if (glowLevel > 0) {
      ctx.strokeStyle = rgba(color, alpha * 0.2);
      ctx.lineWidth = width * 3.5 + 2;
      ctx.stroke();
    }
  }
  ctx.strokeStyle = rgba(color, alpha);
  ctx.lineWidth = width;
  ctx.stroke();
}

/**
 * Sabit maliyetli bloom: tuvali küçültüp (bilinear) üzerine toplamsal olarak geri çizer.
 * YALNIZCA her karede arka planı sıfırlayan modlarda kullanın; iz (fade) bırakan modlarda
 * bloom bir sonraki karede yeniden örneklenip geri besleme oluşturur.
 */
export class Bloom {
  private mid = createOffscreen('Bloom');
  private small = createOffscreen('Bloom');

  apply(ctx: CanvasRenderingContext2D, w: number, h: number, strength = 0.55): void {
    const src = ctx.canvas;
    const mw = Math.max(32, Math.round(w / 3));
    const mh = Math.max(32, Math.round(h / 3));
    const sw = Math.max(16, Math.round(mw / 3));
    const sh = Math.max(16, Math.round(mh / 3));
    if (this.mid.canvas.width !== mw || this.mid.canvas.height !== mh) {
      this.mid.canvas.width = mw;
      this.mid.canvas.height = mh;
      this.small.canvas.width = sw;
      this.small.canvas.height = sh;
    }
    this.mid.ctx.imageSmoothingQuality = 'high';
    this.small.ctx.imageSmoothingQuality = 'high';
    this.mid.ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, mw, mh);
    this.small.ctx.drawImage(this.mid.canvas, 0, 0, mw, mh, 0, 0, sw, sh);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = strength * (0.5 + 0.5 * GLOW_SCALE[glowLevel]);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.small.canvas, 0, 0, w, h);
    ctx.restore();
  }
}
