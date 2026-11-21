import { describe, expect, it } from 'vitest';
import { clockDigits, digitMask } from './sevenSegment';

/** Bit maskesini "abcdefg" harflerine çevirir (okunaklı beklenti için). */
const letters = (mask: number): string => [...'abcdefg'].filter((_, i) => mask & (1 << i)).join('');

describe('yedi parçalı rakamlar', () => {
  it('0-9 klasik parça düzeniyle yanar', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => letters(digitMask(d)))).toEqual([
      'abcdef',
      'bc',
      'abdeg',
      'abcdg',
      'bcfg',
      'acdfg',
      'acdefg',
      'abc',
      'abcdefg',
      'abcdfg',
    ]);
  });

  it('boş (-1) ve geçersiz değer hiçbir parçayı yakmaz', () => {
    expect(digitMask(-1)).toBe(0);
    expect(digitMask(10)).toBe(0);
    expect(digitMask(NaN)).toBe(0);
  });
});

describe('saat rakamları', () => {
  const at = (h: number, m: number, s: number): Date => new Date(2026, 10, 21, h, m, s);

  it('24 saatlik: sıfır dolgulu, saniyeli veya saniyesiz', () => {
    expect(clockDigits(at(7, 5, 9), false, true).digits).toEqual([0, 7, 0, 5, 0, 9]);
    expect(clockDigits(at(23, 59, 58), false, false).digits).toEqual([2, 3, 5, 9]);
  });

  it('12 saatlik: gece yarısı 12, öğleden sonra 1-11, baştaki sıfır boş', () => {
    expect(clockDigits(at(0, 30, 0), true, false)).toEqual({ digits: [1, 2, 3, 0], pm: false });
    expect(clockDigits(at(12, 0, 0), true, false)).toEqual({ digits: [1, 2, 0, 0], pm: true });
    expect(clockDigits(at(13, 5, 0), true, false)).toEqual({ digits: [-1, 1, 0, 5], pm: true });
    expect(clockDigits(at(9, 41, 0), true, false)).toEqual({ digits: [-1, 9, 4, 1], pm: false });
    expect(clockDigits(at(22, 10, 0), true, false).digits).toEqual([1, 0, 1, 0]);
  });
});
