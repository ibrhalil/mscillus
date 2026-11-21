import { describe, expect, it } from 'vitest';
import { AUTO_STEPS, AutoScale } from './AutoScale';

/** `seconds` boyunca, FPS'i o anki basamağa bağlı bir fonksiyonla belirlenen kareler besler. */
function feed(a: AutoScale, seconds: number, fpsAt: (level: number) => number, target = 60): void {
  for (let t = 0; t < seconds; ) {
    const dt = 1 / fpsAt(a.level);
    a.tick(dt, target);
    t += dt;
  }
}

describe('AutoScale', () => {
  it('hedefte kalırsa tam çözünürlükte kalır', () => {
    const a = new AutoScale();
    feed(a, 30, () => 60);
    expect(a.scale).toBe(1);
  });

  it('çözünürlük darboğazında hedefe ulaşana kadar küçültür ve orada kalır', () => {
    const a = new AutoScale();
    // her basamak FPS kazandırır: 0→38, 1→46, 2→50 (hâlâ düşük), 3→60
    const fps = [38, 46, 50, 60, 60];
    feed(a, 60, (l) => fps[l]);
    expect(a.level).toBe(3);
  });

  it('hedefe yakın (tolerans bandında) FPS için küçültmez', () => {
    const a = new AutoScale();
    feed(a, 30, () => 55);
    expect(a.level).toBe(0);
  });

  it('küçültme FPS kazandırmıyorsa (tarayıcı 30 FPS sınırı) geri alır', () => {
    const a = new AutoScale();
    feed(a, 20, () => 30);
    expect(a.level).toBe(0);
  });

  it('yük kalkınca geri büyütür', () => {
    const a = new AutoScale();
    const heavy = [30, 40, 50, 60, 60];
    feed(a, 40, (l) => heavy[l]);
    expect(a.level).toBeGreaterThan(0);
    feed(a, 60, () => 60);
    expect(a.level).toBe(0);
  });

  it('büyütünce yeniden düşüyorsa salınmaz (büyütme beklemesi uzar)', () => {
    const a = new AutoScale();
    const fps = [40, 58, 60, 60, 60]; // basamak 1 sınırda, 0 ağır
    let changes = 0;
    let last = a.level;
    for (let t = 0; t < 120; ) {
      const dt = 1 / fps[a.level];
      a.tick(dt, 60);
      if (a.level !== last) {
        changes++;
        last = a.level;
      }
      t += dt;
    }
    expect(a.level).toBeGreaterThan(0);
    expect(changes).toBeLessThan(12);
  });

  it('mod değişiminde hatırlanan basamaktan başlar', () => {
    const a = new AutoScale();
    a.reset(2);
    expect(a.scale).toBe(AUTO_STEPS[2]);
    a.reset(99);
    expect(a.level).toBe(AUTO_STEPS.length - 1);
  });
});
