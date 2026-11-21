import { describe, expect, it } from 'vitest';
import { seeded } from '../test/random';
import { MODES } from '../visuals/registry';
import type { ModeId } from '../visuals/registry';
import { AutoCycleTimer, cyclePool, ModeShuffler } from './AutoCycle';

function firstTrigger(timer: AutoCycleTimer, interval: number, waitBeat: boolean, beatAt = Infinity): number {
  for (let t = 0; t < 60; t += 0.1) {
    if (timer.tick(0.1, interval, Math.abs(t - beatAt) < 0.05, waitBeat)) return t;
  }
  return Infinity;
}

describe('AutoCycleTimer', () => {
  it('süre dolunca tetikler', () => {
    expect(firstTrigger(new AutoCycleTimer(), 10, false)).toBeCloseTo(10, 0);
  });

  it('vuruş beklerken ilk vuruşta tetikler', () => {
    expect(firstTrigger(new AutoCycleTimer(), 10, true, 11.5)).toBeCloseTo(11.5, 1);
  });

  it('vuruş gelmezse en fazla 4 sn bekler', () => {
    expect(firstTrigger(new AutoCycleTimer(), 10, true)).toBeCloseTo(14, 0);
  });
});

describe('cyclePool', () => {
  const favs = ['plasma', 'tunnel', 'fire'] as ModeId[];

  it('favori seçiliyse yalnız favoriler', () => {
    expect(cyclePool('favorites', favs)).toEqual(favs);
  });

  it('2 favoriden azsa veya "tüm modlar" seçiliyse tüm modlar', () => {
    expect(cyclePool('favorites', ['plasma'] as ModeId[])).toHaveLength(MODES.length);
    expect(cyclePool('all', favs)).toHaveLength(MODES.length);
  });
});

describe('ModeShuffler', () => {
  const pool = ['bars', 'radial', 'wave', 'plasma'] as ModeId[];

  it('sıralı geçişte havuzda bir sonrakine geçer ve başa sarar', () => {
    const s = new ModeShuffler();
    expect(s.next('radial', pool, false)).toBe('wave');
    expect(s.next('plasma', pool, false)).toBe('bars');
    expect(s.next('fire', pool, false)).toBe('bars'); // havuz dışındaysa baştan
  });

  it('karışık geçişte havuzun hepsini göstermeden tekrar etmez, aynı modu art arda seçmez', () => {
    const s = new ModeShuffler(seeded(11));
    let cur: ModeId = 'bars';
    const seen: ModeId[] = [];
    for (let i = 0; i < 3; i++) {
      const next = s.next(cur, pool, true);
      expect(next).not.toBe(cur);
      seen.push(next);
      cur = next;
    }
    expect(new Set(seen).size).toBe(3);
    expect(seen).not.toContain('bars');
  });
});
