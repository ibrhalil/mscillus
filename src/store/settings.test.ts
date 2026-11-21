import { describe, expect, it } from 'vitest';
import { CUSTOM_PALETTE_ID, DEFAULT_CUSTOM_PALETTE } from '../visuals/palettes';
import { DEFAULT_SETTINGS, modeOptionValues, sanitize, toView } from './settings';

describe('ayar temizleme (sanitize)', () => {
  it('boş / bozuk kayıt varsayılanları verir', () => {
    expect(sanitize(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitize('bozuk')).toEqual(DEFAULT_SETTINGS);
    expect(sanitize({})).toEqual(DEFAULT_SETTINGS);
  });

  it('sayıları aralığa sıkıştırır, geçersiz seçimleri varsayılana çevirir', () => {
    const s = sanitize({
      sensitivity: 99,
      smoothing: -1,
      fftSize: 3000,
      paletteId: 'yok',
      resolution: 'ultra',
      fpsCap: 45,
      autoCycleSec: 2,
      autoCycleScope: 'bazıları',
      micDeviceId: 42,
    });
    expect(s.sensitivity).toBe(3);
    expect(s.smoothing).toBe(0);
    expect(s.fftSize).toBe(DEFAULT_SETTINGS.fftSize);
    expect(s.paletteId).toBe(DEFAULT_SETTINGS.paletteId);
    expect(s.resolution).toBe('auto');
    expect(s.fpsCap).toBe(0);
    expect(s.autoCycleSec).toBe(10);
    expect(s.autoCycleScope).toBe('favorites');
    expect(s.micDeviceId).toBe('');
  });

  it('geçerli yeni alanları korur', () => {
    const s = sanitize({ resolution: 'low', fpsCap: 30, autoCycle: true, autoCycleScope: 'all', paletteId: CUSTOM_PALETTE_ID });
    expect(s).toMatchObject({ resolution: 'low', fpsCap: 30, autoCycle: true, autoCycleScope: 'all', paletteId: 'custom' });
  });

  it('favorilerden bilinmeyenleri ve tekrarları atar, sırayı korur', () => {
    expect(sanitize({ favorites: ['fire', 'yok', 'plasma', 'fire', 7] }).favorites).toEqual(['fire', 'plasma']);
  });

  it('mod seçeneklerinde bilinmeyenleri atar, değerleri sıkıştırır, varsayılana eşitleri saklamaz', () => {
    const s = sanitize({
      modeOptions: {
        yok: { a: 1 },
        bars: { gap: 99, height: 1, bilinmeyen: 3 },
      },
    });
    expect(s.modeOptions).toEqual({ bars: { gap: 0.8 } });
    expect(modeOptionValues(s, 'bars').gap).toBe(0.8);
  });

  it('özel paleti doğrular; geçerliyse aynı nesneyi korur', () => {
    const good = { colors: ['#112233', '#445566'], bg: '#000000' };
    expect(sanitize({ customPalette: good }).customPalette).toBe(good);
    for (const bad of [
      { colors: ['#112233'], bg: '#000000' },
      { colors: ['#112233', 'kırmızı'], bg: '#000000' },
      { colors: ['#112233', '#445566'], bg: 'siyah' },
      { colors: Array(7).fill('#112233'), bg: '#000000' },
    ]) {
      expect(sanitize({ customPalette: bad }).customPalette).toBe(DEFAULT_CUSTOM_PALETTE);
    }
  });
});

describe('toView', () => {
  it('aynı ayar nesnesi için önbellekten döner', () => {
    const s = sanitize({});
    expect(toView(s, 'bars')).toBe(toView(s, 'bars'));
  });

  it('özel palet seçiliyse onu kullanır', () => {
    const s = sanitize({ paletteId: CUSTOM_PALETTE_ID, customPalette: { colors: ['#ff0000', '#0000ff'], bg: '#101010' } });
    expect(toView(s, 'bars').palette.colors).toEqual(['#ff0000', '#0000ff']);
    expect(toView(s, 'bars').palette.bg).toBe('#101010');
  });
});
