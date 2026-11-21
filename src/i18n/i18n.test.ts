import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SHARED_OPTIONS, formatOption } from '../visuals/options';
import { DEFAULT_CUSTOM_PALETTE, PALETTES, resolvePalette } from '../visuals/palettes';
import { CATEGORIES, MODES } from '../visuals/registry';
import { en } from './en';
import { CATALOGS, DEFAULT_LOCALE, LOCALES, detectLocale, getLanguagePref, getLocale, phrase, setLanguagePref, subscribeLocale, t } from './index';
import { tNodes } from './react';

afterEach(() => {
  vi.unstubAllGlobals();
  setLanguagePref('en');
});

describe('dil algılama', () => {
  it('tarayıcının ilk desteklenen dilini seçer', () => {
    expect(detectLocale(['tr-TR'])).toBe('tr');
    expect(detectLocale(['en-US', 'tr'])).toBe('en');
    expect(detectLocale(['de-DE', 'tr', 'en'])).toBe('tr');
    expect(detectLocale(['TR'])).toBe('tr');
    expect(detectLocale(['tr_TR'])).toBe('tr');
  });

  it('hiçbiri desteklenmiyorsa veya liste boşsa varsayılan dil', () => {
    expect(detectLocale(['fr-FR', 'de'])).toBe(DEFAULT_LOCALE);
    expect(detectLocale([])).toBe(DEFAULT_LOCALE);
    expect(DEFAULT_LOCALE).toBe('en');
  });

  it('"trx" gibi yalnızca tr ile başlayan etiketler Türkçe sayılmaz', () => {
    expect(detectLocale(['trx'])).toBe(DEFAULT_LOCALE);
  });
});

describe('dil tercihi', () => {
  it('seçilen dil metinleri değiştirir ve abonelere haber verir', () => {
    setLanguagePref('en');
    expect(t('lang.label')).toBe('Language');
    const listener = vi.fn();
    const unsubscribe = subscribeLocale(listener);
    setLanguagePref('tr');
    expect(listener).toHaveBeenCalledTimes(1);
    expect([getLocale(), t('lang.label')]).toEqual(['tr', 'Dil']);
    setLanguagePref('tr');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setLanguagePref('en');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('tercih saklanır; "auto" kaydı siler', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    setLanguagePref('tr');
    expect(store.get('mscillus.lang')).toBe('tr');
    expect(getLanguagePref()).toBe('tr');
    setLanguagePref('auto');
    expect(store.has('mscillus.lang')).toBe(false);
    expect(getLanguagePref()).toBe('auto');
  });

  it('depolama kapalıyken (istisna) tercih yine de oturumda geçerli', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('kapalı');
      },
      setItem: () => {
        throw new Error('kapalı');
      },
      removeItem: () => {
        throw new Error('kapalı');
      },
    });
    setLanguagePref('tr');
    expect(getLocale()).toBe('tr');
  });
});

describe('t / phrase', () => {
  it('yer tutucuları doldurur, eksik parametreyi olduğu gibi bırakır', () => {
    setLanguagePref('en');
    expect(t('toast.addedMany', { n: 3 })).toBe('3 tracks added to playlist');
    expect(t('toast.addedMany')).toBe('{n} tracks added to playlist');
    expect(t('toast.addedMany', {})).toBe('{n} tracks added to playlist');
  });

  it('phrase İngilizce kaynak metni çevirir; çevirisi olmayanı aynen döndürür', () => {
    setLanguagePref('tr');
    expect(phrase('Spectrum Bars')).toBe('Spektrum Barları');
    expect(phrase('no such phrase')).toBe('no such phrase');
    setLanguagePref('en');
    expect(phrase('Spectrum Bars')).toBe('Spectrum Bars');
  });

  it('seçenek değer metni geçerli dilde biçimlenir', () => {
    setLanguagePref('en');
    expect(formatOption(SHARED_OPTIONS.glow, 0)).toBe('Off');
    setLanguagePref('tr');
    expect(formatOption(SHARED_OPTIONS.glow, 0)).toBe('Kapalı');
  });

  it('tNodes <em>/<strong> işaretlerini öğeye çevirir', () => {
    setLanguagePref('en');
    expect(renderToStaticMarkup(createElement('p', null, tNodes('picker.subtitle')))).toContain('<em>See</em> the music');
    setLanguagePref('tr');
    const html = renderToStaticMarkup(createElement('p', null, tNodes('panel.scope.mode', { name: 'Plazma' })));
    expect(html).toContain('<strong>Plazma</strong>');
    expect(html).not.toContain('{name}');
  });
});

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const tags = (s: string): string[] => [...s.matchAll(/<\/?(em|strong)>/g)].map((m) => m[0]);

describe('katalog bütünlüğü', () => {
  const keys = Object.keys(en);

  it.each(LOCALES.map((l) => l.id))('%s: tüm anahtarlar var, fazladan anahtar yok, boş metin yok', (id) => {
    const messages = CATALOGS[id].messages;
    expect(Object.keys(messages).sort()).toEqual([...keys].sort());
    for (const k of keys) expect(messages[k as keyof typeof en].trim(), `${id}:${k}`).not.toBe('');
  });

  it.each(LOCALES.map((l) => l.id))('%s: yer tutucular ve işaretler İngilizce ile aynı', (id) => {
    const messages = CATALOGS[id].messages;
    for (const k of keys) {
      const key = k as keyof typeof en;
      expect(placeholders(messages[key]), `${id}:${k}`).toEqual(placeholders(en[key]));
      expect(tags(messages[key]), `${id}:${k}`).toEqual(tags(en[key]));
    }
  });
});

/** Tanım dosyalarında İngilizce kaynak metin olarak yazılan, ekranda `phrase()` ile gösterilen tüm metinler. */
function sourcePhrases(): Set<string> {
  const out = new Set<string>();
  for (const c of CATEGORIES) out.add(c.name);
  for (const p of Object.values(PALETTES)) out.add(p.name);
  out.add(resolvePalette('custom', DEFAULT_CUSTOM_PALETTE).name);
  for (const m of MODES) {
    out.add(m.name);
    for (const o of m.options) {
      out.add(o.label);
      o.choices?.forEach((c) => out.add(c));
    }
  }
  return out;
}

describe('mod / seçenek / palet adı çevirileri', () => {
  const sources = sourcePhrases();

  it('kaynak metinlerde Türkçe harf kalmamış (İngilizce kaynak)', () => {
    const turkish = [...sources].filter((s) => /[ğüşıöçĞÜŞİÖÇ]/.test(s));
    expect(turkish).toEqual([]);
  });

  it.each(LOCALES.filter((l) => l.id !== DEFAULT_LOCALE).map((l) => l.id))(
    '%s: her kaynak metnin çevirisi var ve kullanılmayan (eski) çeviri yok',
    (id) => {
      const table = CATALOGS[id].phrases;
      expect([...sources].filter((s) => !(s in table))).toEqual([]);
      expect(Object.keys(table).filter((s) => !sources.has(s))).toEqual([]);
      for (const [src, tr] of Object.entries(table)) expect(tr.trim(), `${id}:${src}`).not.toBe('');
    },
  );
});
