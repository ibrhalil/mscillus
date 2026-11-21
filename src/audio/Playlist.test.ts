import { describe, expect, it } from 'vitest';
import { seeded } from '../test/random';
import { Playlist } from './Playlist';

const list = (n: number, random?: () => number) => {
  const p = new Playlist<string>(random);
  p.set(Array.from({ length: n }, (_, i) => `t${i}`));
  return p;
};

describe('Playlist (sıralı)', () => {
  it('tekrar kapalıyken liste sonunda durur, elle "sonraki" başa sarar', () => {
    const p = list(3);
    expect([p.next(true), p.next(true), p.next(true)]).toEqual([1, 2, null]);
    expect(p.index).toBe(2);
    expect(p.next(false)).toBe(0);
  });

  it('tüm liste tekrarında başa sarar, tek parça tekrarında aynı parçada kalır', () => {
    const p = list(2);
    p.repeat = 'all';
    expect([p.next(true), p.next(true)]).toEqual([1, 0]);
    p.repeat = 'one';
    expect(p.next(true)).toBe(0);
    expect(p.next(false)).toBe(1); // elle sonraki tekrar kuralını yok sayar
  });

  it('önceki baştayken sona sarar', () => {
    const p = list(3);
    expect(p.prev()).toBe(2);
    expect(p.current).toBe('t2');
  });

  it('çalan parça çıkarılamaz; öncekiler çıkarılınca dizin kayar', () => {
    const p = list(4);
    p.jump(2);
    expect(p.remove(2)).toBe(false);
    expect(p.remove(0)).toBe(true);
    expect(p.index).toBe(1);
    expect(p.current).toBe('t2');
    expect(p.all).toEqual(['t1', 't2', 't3']);
  });

  it('boş listeye eklenince ilk parça seçilir', () => {
    const p = new Playlist<string>();
    expect(p.next(false)).toBeNull();
    p.add(['a', 'b']);
    expect(p.current).toBe('a');
  });
});

describe('Playlist (karışık)', () => {
  it('her parçayı bir kez çalmadan tekrar etmez ve aynı parçayı art arda seçmez', () => {
    const p = list(6, seeded(7));
    p.setShuffle(true);
    p.repeat = 'all';
    const seen = new Set([p.index]);
    let prev = p.index;
    for (let i = 0; i < 5; i++) {
      const n = p.next(true)!;
      expect(n).not.toBe(prev);
      seen.add(n);
      prev = n;
    }
    expect(seen.size).toBe(6);
  });

  it('tekrar kapalıyken tur bitince durur', () => {
    const p = list(3, seeded(1));
    p.setShuffle(true);
    expect(p.next(true)).not.toBeNull();
    expect(p.next(true)).not.toBeNull();
    expect(p.next(true)).toBeNull();
  });

  it('önceki, çalınma geçmişinden geri gider', () => {
    const p = list(5, seeded(3));
    p.setShuffle(true);
    const a = p.index;
    const b = p.next(false)!;
    p.next(false);
    expect(p.prev()).toBe(b);
    expect(p.prev()).toBe(a);
  });
});
