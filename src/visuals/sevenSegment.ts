/** Yedi parçalı gösterge: parça sırası a(üst) b(sağ üst) c(sağ alt) d(alt) e(sol alt) f(sol üst) g(orta) → bit 0..6. */
const ORDER = 'abcdefg';

/** 0-9 rakamlarının yanan parçaları. */
const DIGIT_SEGMENTS = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'] as const;

/** Rakamın yanan parçalarının bit maskesi; boş (-1) veya geçersiz değer için 0 (hepsi sönük). */
export function digitMask(digit: number): number {
  const segments = DIGIT_SEGMENTS[digit];
  if (!segments) return 0;
  let mask = 0;
  for (const ch of segments) mask |= 1 << ORDER.indexOf(ch);
  return mask;
}

export interface ClockDigits {
  /** Saat, dakika ve (isteniyorsa) saniyenin rakamları, ikişer hane; 12 saatlik düzende baştaki sıfır boş (-1). */
  digits: number[];
  /** Yalnız 12 saatlik düzende anlamlı: öğleden sonra mı. */
  pm: boolean;
}

/** `date`in saat:dakika(:saniye) rakamları; 12 saatlik düzende 00 → 12, 13 → 1 ve tek haneli saatte baştaki sıfır boş. */
export function clockDigits(date: Date, twelveHour: boolean, withSeconds: boolean): ClockDigits {
  const h24 = date.getHours();
  const pm = h24 >= 12;
  const h = twelveHour ? h24 % 12 || 12 : h24;
  const digits = [Math.floor(h / 10), h % 10, Math.floor(date.getMinutes() / 10), date.getMinutes() % 10];
  if (twelveHour && digits[0] === 0) digits[0] = -1;
  if (withSeconds) digits.push(Math.floor(date.getSeconds() / 10), date.getSeconds() % 10);
  return { digits, pm };
}
