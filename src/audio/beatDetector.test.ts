import { describe, expect, it } from 'vitest';
import { BeatDetector } from './beatDetector';

/** `seconds` boyunca `hz` kare hızında, her `period` saniyede bir 60 ms'lik bas darbesi olan sinyali besler. */
function run(hz: number, seconds: number, period: number): number[] {
  const det = new BeatDetector();
  const dt = 1 / hz;
  const beats: number[] = [];
  for (let t = 0; t < seconds; t += dt) {
    const energy = t % period < 0.06 ? 0.6 : 0.2;
    if (det.update(energy, t, dt)) beats.push(t);
  }
  return beats;
}

describe('BeatDetector', () => {
  it('her darbeyi bir kez yakalar', () => {
    const beats = run(60, 10, 0.5);
    expect(beats.length).toBeGreaterThanOrEqual(19);
    expect(beats.length).toBeLessThanOrEqual(20);
  });

  it('60 Hz ve 144 Hz ekranda aynı sayıda vuruş bulur (zaman tabanlı pencere)', () => {
    expect(run(144, 10, 0.5).length).toBe(run(60, 10, 0.5).length);
    expect(run(240, 10, 0.5).length).toBe(run(60, 10, 0.5).length);
  });

  it('ilk 0,2 sn ortalama oluşmadan vuruş vermez', () => {
    expect(run(60, 3, 0.5)[0]).toBeGreaterThanOrEqual(0.2);
  });

  it('iki vuruş arasında en az 0,25 sn bırakır', () => {
    const beats = run(120, 5, 0.1);
    for (let i = 1; i < beats.length; i++) expect(beats[i] - beats[i - 1]).toBeGreaterThan(0.25);
  });

  it('sabit seste vuruş vermez', () => {
    const det = new BeatDetector();
    let count = 0;
    for (let t = 0; t < 5; t += 1 / 60) if (det.update(0.5, t, 1 / 60)) count++;
    expect(count).toBe(0);
  });

  it('vuruşta pulse 1 olur ve zamanla söner; reset sıfırlar', () => {
    const det = new BeatDetector();
    let t = 0;
    for (; t < 1; t += 1 / 60) det.update(0.2, t, 1 / 60);
    expect(det.update(0.8, t, 1 / 60)).toBe(true);
    expect(det.pulse).toBeGreaterThan(0.9);
    det.update(0.2, t + 0.25, 0.25);
    expect(det.pulse).toBeLessThan(0.5);
    det.reset();
    expect(det.pulse).toBe(0);
  });
});
