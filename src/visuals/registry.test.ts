import { describe, expect, it } from 'vitest';
import { adjacentMode, FAVORITE_KEYS, favoriteForKey, favoriteKey, keyLabel, MODES, modeMeta } from './registry';
import type { ModeId } from './registry';

/** App'in kendi kısayolları (bkz. App.tsx klavye işleyicisi); mod harfleri bunlarla çakışmamalı. */
const RESERVED = ['s', 'h', 'f', '/', ' ', ...FAVORITE_KEYS];

describe('mod kaydı', () => {
  it('kimlikler ve kısayol harfleri benzersiz', () => {
    expect(new Set(MODES.map((m) => m.id)).size).toBe(MODES.length);
    const keys = MODES.map((m) => m.key);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes).toEqual([]);
  });

  it('kısayollar tek harf ve uygulama kısayollarıyla çakışmıyor', () => {
    for (const m of MODES) {
      expect(m.key, m.id).toMatch(/^[a-zA-Z]$/);
      expect(RESERVED, `${m.id} → ${m.key}`).not.toContain(m.key);
    }
  });

  it('her seçeneğin varsayılanı aralığında, kimliği mod içinde benzersiz', () => {
    for (const m of MODES) {
      const ids = m.options.map((o) => o.id);
      expect(new Set(ids).size, m.id).toBe(ids.length);
      for (const o of m.options) {
        const where = `${m.id}.${o.id}`;
        expect(o.min, where).toBeLessThanOrEqual(o.max);
        expect(o.default, where).toBeGreaterThanOrEqual(o.min);
        expect(o.default, where).toBeLessThanOrEqual(o.max);
        if (o.kind === 'select') expect(o.choices?.length, where).toBe(o.max + 1);
      }
    }
  });

  it('komşu mod listenin iki ucunda sarar', () => {
    const first = MODES[0].id;
    const last = MODES[MODES.length - 1].id;
    expect(adjacentMode(last, 1)).toBe(first);
    expect(adjacentMode(first, -1)).toBe(last);
  });

  it('kısayol etiketi Shift harfini ⇧ ile gösterir', () => {
    expect(keyLabel('F')).toBe('⇧F');
    expect(keyLabel('m')).toBe('M');
  });
});

describe('favori rakam kısayolları', () => {
  const favs = ['plasma', 'tunnel'] as ModeId[];

  it('eklenme sırasıyla 1, 2… atanır', () => {
    expect(favoriteKey(favs, 'plasma')).toBe('1');
    expect(favoriteKey(favs, 'tunnel')).toBe('2');
    expect(favoriteKey(favs, 'fire')).toBeNull();
    expect(favoriteForKey(favs, '2')).toBe('tunnel');
    expect(favoriteForKey(favs, '3')).toBeUndefined();
  });

  it('yalnız ilk 10 favori rakam alır (10. favori = 0)', () => {
    const many = MODES.slice(0, 12).map((m) => m.id);
    expect(favoriteKey(many, many[9])).toBe('0');
    expect(favoriteKey(many, many[10])).toBeNull();
  });
});

describe('palet kullanımı (Renkler sekmesi)', () => {
  const defaults = (id: ModeId): Record<string, number> =>
    Object.fromEntries(modeMeta(id).options.map((o) => [o.id, o.default]));
  /** Seçeneklerin indeksini ad üzerinden bulur (indeks sırası değişirse test bunu yakalar). */
  const index = (id: ModeId, option: string, choice: string): number => {
    const def = modeMeta(id).options.find((o) => o.id === option);
    const i = def?.choices?.indexOf(choice) ?? -1;
    expect(i, `${id}.${option} → ${choice}`).toBeGreaterThanOrEqual(0);
    return i;
  };

  it('varsayılan ayarlarda çoğu mod paleti kullanır', () => {
    const without = MODES.filter((m) => !m.usesPalette(defaults(m.id))).map((m) => m.id);
    expect(without).toEqual(['fire']);
  });

  it('Ateş: yalnız "Palette" alev renginde', () => {
    const v = defaults('fire');
    for (const c of ['Fire', 'Blue Flame']) expect(modeMeta('fire').usesPalette({ ...v, colors: index('fire', 'colors', c) }), c).toBe(false);
    expect(modeMeta('fire').usesPalette({ ...v, colors: index('fire', 'colors', 'Palette') })).toBe(true);
  });

  it('Su Dalgası: sade dalga her zaman, gerçekçi suda yalnız "Palette" su rengi', () => {
    const v = defaults('water');
    const plain = index('water', 'style', 'Plain Waves');
    const real = index('water', 'style', 'Realistic Water');
    expect(modeMeta('water').usesPalette({ ...v, style: plain, colors: index('water', 'colors', 'Ocean') })).toBe(true);
    expect(modeMeta('water').usesPalette({ ...v, style: real, colors: index('water', 'colors', 'Ocean') })).toBe(false);
    expect(modeMeta('water').usesPalette({ ...v, style: real, colors: index('water', 'colors', 'Night Lake') })).toBe(false);
    expect(modeMeta('water').usesPalette({ ...v, style: real, colors: index('water', 'colors', 'Palette') })).toBe(true);
  });

  it('Kağıt Yırtma: "Paper Tones" paleti kullanmaz', () => {
    const v = defaults('papertear');
    expect(modeMeta('papertear').usesPalette({ ...v, colors: index('papertear', 'colors', 'Palette') })).toBe(true);
    expect(modeMeta('papertear').usesPalette({ ...v, colors: index('papertear', 'colors', 'Paper Tones') })).toBe(false);
  });
});
