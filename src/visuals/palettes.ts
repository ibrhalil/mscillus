import type { Palette } from './types';

export const PALETTES: Record<string, Palette> = {
  neon: {
    id: 'neon',
    name: 'Neon',
    colors: ['#00f5d4', '#00bbf9', '#9b5de5', '#f15bb5', '#fee440'],
    bg: '#06070d',
  },
  sunset: {
    id: 'sunset',
    name: 'Gün Batımı',
    colors: ['#fee440', '#ff9e00', '#f15bb5', '#9e0059'],
    bg: '#120409',
  },
  ocean: {
    id: 'ocean',
    name: 'Okyanus',
    colors: ['#caf0f8', '#90e0ef', '#00b4d8', '#0077b6', '#023e8a'],
    bg: '#02080f',
  },
  rainbow: {
    id: 'rainbow',
    name: 'Gökkuşağı',
    colors: ['#ff0040', '#ff8a00', '#ffee00', '#00d26a', '#00b4d8', '#9b5de5'],
    bg: '#050608',
  },
  mono: {
    id: 'mono',
    name: 'Monokrom',
    colors: ['#ffffff', '#c8d6e5', '#8395a7', '#576574'],
    bg: '#050505',
  },
  vaporwave: {
    id: 'vaporwave',
    name: 'Vaporwave',
    colors: ['#ff71ce', '#b967ff', '#01cdfe', '#05ffa1', '#fffb96'],
    bg: '#0d0221',
  },
  cyberpunk: {
    id: 'cyberpunk',
    name: 'Siberpunk',
    colors: ['#fcee0a', '#ff003c', '#d300c5', '#00f0ff'],
    bg: '#07040e',
  },
  forest: {
    id: 'forest',
    name: 'Orman',
    colors: ['#d8f3dc', '#95d5b2', '#52b788', '#2d6a4f', '#1b4332'],
    bg: '#020a06',
  },
  ember: {
    id: 'ember',
    name: 'Kor',
    colors: ['#fff3b0', '#ffb703', '#fb8500', '#d62828', '#6a040f'],
    bg: '#0a0302',
  },
  pastel: {
    id: 'pastel',
    name: 'Pastel',
    colors: ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#bdb2ff'],
    bg: '#0b0b12',
  },
};

/** Kullanıcının ayarlar panelinde oluşturduğu palet (`paletteId === CUSTOM_PALETTE_ID`). */
export const CUSTOM_PALETTE_ID = 'custom';
export const CUSTOM_COLORS_MIN = 2;
export const CUSTOM_COLORS_MAX = 6;

export interface CustomPalette {
  colors: string[];
  bg: string;
}

export const DEFAULT_CUSTOM_PALETTE: CustomPalette = {
  colors: [...PALETTES.neon.colors],
  bg: PALETTES.neon.bg,
};

export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

const customPalettes = new WeakMap<CustomPalette, Palette>();

/**
 * Özel paletin `Palette` nesnesi. Modlar LUT'larını `palette.id` ile önbelleklediği için kimlik renkleri içerir:
 * bir renk değişince id de değişir ve modlar LUT'u yeniden kurar.
 */
export function resolvePalette(paletteId: string, custom: CustomPalette): Palette {
  if (paletteId !== CUSTOM_PALETTE_ID) return PALETTES[paletteId] ?? PALETTES.neon;
  let p = customPalettes.get(custom);
  if (!p) {
    p = { id: `custom:${custom.colors.join(',')}/${custom.bg}`, name: 'Özel', colors: custom.colors, bg: custom.bg };
    customPalettes.set(custom, p);
  }
  return p;
}

export type Rgb = [number, number, number];

// `sampleGradient` modların sıcak döngülerinde (her bar / kıvılcım için, her karede) çağrılır; hex'i her seferinde
// ayrıştırmak yerine sonucu önbellekler. Özel palet renk seçicisi çok sayıda farklı değer üretebildiği için sınırlı.
const rgbCache = new Map<string, Rgb>();

function rgbOf(hex: string): Rgb {
  let c = rgbCache.get(hex);
  if (!c) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h;
    const n = parseInt(full, 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    if (rgbCache.size >= 512) rgbCache.clear();
    rgbCache.set(hex, c);
  }
  return c;
}

export function hexToRgb(hex: string): Rgb {
  const c = rgbOf(hex);
  return [c[0], c[1], c[2]];
}

export function sampleGradient(colors: readonly string[], t: number): Rgb {
  const clamped = Math.min(0.999, Math.max(0, t));
  const scaled = clamped * (colors.length - 1);
  const i = Math.floor(scaled);
  const f = scaled - i;
  const a = rgbOf(colors[i]);
  const b = rgbOf(colors[Math.min(colors.length - 1, i + 1)]);
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

export function rgba(color: Rgb, alpha = 1): string {
  return `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
}

// Spektrum ekseni: bin 2'den kullanılabilir üst banda (%72) logaritmik ölçek.
const MIN_BIN = 2;
const usableBins = (len: number): number => Math.max(4, Math.floor(len * 0.72));

export function binAt(freq: Uint8Array, t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const idx = Math.floor(MIN_BIN * Math.pow(usableBins(freq.length) / MIN_BIN, clamped));
  return (freq[Math.min(idx, freq.length - 1)] ?? 0) / 255;
}

/** `binAt` gibi, ama komşu binler arasında doğrusal interpolasyon yapar (düşük frekansta bloklaşmayı önler). */
export function binAtLerp(freq: Uint8Array, t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const pos = MIN_BIN * Math.pow(usableBins(freq.length) / MIN_BIN, clamped);
  const i = Math.floor(pos);
  const last = freq.length - 1;
  const a = freq[Math.min(i, last)] ?? 0;
  const b = freq[Math.min(i + 1, last)] ?? 0;
  return (a + (b - a) * (pos - i)) / 255;
}

/** `hz` frekansının spektrum eksenindeki konumu (0..1; aralık dışı değerler olabilir). */
export function freqPosition(freqLen: number, sampleRate: number, hz: number): number {
  const bin = hz / (sampleRate / (freqLen * 2));
  return Math.log(bin / MIN_BIN) / Math.log(usableBins(freqLen) / MIN_BIN);
}

export function barValue(freq: Uint8Array, i: number, n: number): number {
  const ratio = usableBins(freq.length) / MIN_BIN;
  const b0 = Math.floor(MIN_BIN * Math.pow(ratio, i / n));
  const b1 = Math.max(b0 + 1, Math.floor(MIN_BIN * Math.pow(ratio, (i + 1) / n)));
  let max = 0;
  for (let b = b0; b < b1 && b < freq.length; b++) {
    if (freq[b] > max) max = freq[b];
  }
  return max / 255;
}
