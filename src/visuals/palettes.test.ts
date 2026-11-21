import { describe, expect, it } from 'vitest';
import {
  binAt,
  binAtLerp,
  CUSTOM_PALETTE_ID,
  freqPosition,
  hexToRgb,
  PALETTES,
  resolvePalette,
  sampleGradient,
} from './palettes';
import type { CustomPalette } from './palettes';

describe('renk yardımcıları', () => {
  it('hex ayrıştırır (#rgb ve #rrggbb); dönen dizi önbelleği bozmaz', () => {
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]);
    expect(hexToRgb('#0f0')).toEqual([0, 255, 0]);
    const a = hexToRgb('#123456');
    a[0] = 0;
    expect(hexToRgb('#123456')).toEqual([0x12, 0x34, 0x56]);
  });

  it('gradyanı uçlarda ve ortada doğru örnekler', () => {
    const colors = ['#000000', '#ffffff'];
    expect(sampleGradient(colors, 0)).toEqual([0, 0, 0]);
    expect(sampleGradient(colors, 0.5)).toEqual([128, 128, 128]);
    expect(sampleGradient(colors, 1)[0]).toBeGreaterThan(250);
    expect(sampleGradient(colors, -3)).toEqual([0, 0, 0]);
  });

  it('tüm hazır paletler geçerli', () => {
    for (const p of Object.values(PALETTES)) {
      expect(p.colors.length, p.id).toBeGreaterThanOrEqual(2);
      for (const c of [...p.colors, p.bg]) expect(c, p.id).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('resolvePalette', () => {
  const custom: CustomPalette = { colors: ['#ff0000', '#00ff00'], bg: '#000000' };

  it('hazır paleti döndürür, bilinmeyende Neon’a düşer', () => {
    expect(resolvePalette('ocean', custom)).toBe(PALETTES.ocean);
    expect(resolvePalette('yok', custom)).toBe(PALETTES.neon);
  });

  it('özel paletin kimliği renklerle değişir (modların LUT önbelleği yenilensin) ve nesne başına sabittir', () => {
    const a = resolvePalette(CUSTOM_PALETTE_ID, custom);
    expect(a.colors).toBe(custom.colors);
    expect(resolvePalette(CUSTOM_PALETTE_ID, custom)).toBe(a);
    const b = resolvePalette(CUSTOM_PALETTE_ID, { ...custom, colors: ['#ff0000', '#0000ff'] });
    expect(b.id).not.toBe(a.id);
  });
});

describe('spektrum ekseni', () => {
  const freq = new Uint8Array(1024).map((_, i) => i % 256);

  it('binAt / binAtLerp 0..1 aralığında', () => {
    for (let t = -0.5; t <= 1.5; t += 0.05) {
      for (const v of [binAt(freq, t), binAtLerp(freq, t)]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('freqPosition frekansla artar', () => {
    const p = [100, 1000, 10000].map((hz) => freqPosition(1024, 48000, hz));
    expect(p[0]).toBeLessThan(p[1]);
    expect(p[1]).toBeLessThan(p[2]);
  });
});
