import { en } from './en';
import type { MessageKey } from './en';
import { tr, trPhrases } from './tr';

export type { MessageKey } from './en';

/** Desteklenen arayüz dilleri. Yeni dil: `locales`e katalog ekle + `LOCALES`e kaydet (eksik çeviriyi test yakalar). */
export type Locale = 'en' | 'tr';
/** Kullanıcının tercihi: 'auto' tarayıcı dilini izler. */
export type LanguagePref = 'auto' | Locale;

/** `name` her dilin kendi adıdır (dil seçicide hangi dilde olursa olsun okunabilsin). */
export const LOCALES: readonly { id: Locale; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'tr', name: 'Türkçe' },
];

/** Tarayıcı dili desteklenenlerden hiçbiri değilse kullanılan dil. */
export const DEFAULT_LOCALE: Locale = 'en';

export interface Catalog {
  messages: Readonly<Record<MessageKey, string>>;
  /** İngilizce kaynak metin → çeviri (mod / seçenek / kategori / palet adları). Boşsa metin olduğu gibi gösterilir. */
  phrases: Readonly<Record<string, string>>;
}

export const CATALOGS: Readonly<Record<Locale, Catalog>> = {
  en: { messages: en, phrases: {} },
  tr: { messages: tr, phrases: trPhrases },
};

const PREF_KEY = 'mscillus.lang';

const isLocale = (v: unknown): v is Locale => LOCALES.some((l) => l.id === v);

/**
 * Tarayıcının dil listesinden (tercih sırasıyla) desteklenen ilk dili seçer: `['de-DE', 'tr']` → 'tr'.
 * Hiçbiri desteklenmiyorsa `DEFAULT_LOCALE`.
 */
export function detectLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const primary = tag.toLowerCase().split(/[-_]/)[0];
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

function browserLanguages(): string[] {
  if (typeof navigator === 'undefined') return [];
  if (navigator.languages?.length) return [...navigator.languages];
  return navigator.language ? [navigator.language] : [];
}

function readPref(): LanguagePref {
  try {
    const v = localStorage.getItem(PREF_KEY);
    return isLocale(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

const resolve = (p: LanguagePref): Locale => (p === 'auto' ? detectLocale(browserLanguages()) : p);

let pref: LanguagePref = readPref();
let locale: Locale = resolve(pref);
const listeners = new Set<() => void>();

export const getLocale = (): Locale => locale;
export const getLanguagePref = (): LanguagePref => pref;

export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

type Params = Readonly<Record<string, string | number>>;

const fill = (template: string, params: Params): string =>
  template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));

/** Arayüz metni: geçerli dildeki karşılık (yoksa İngilizce), `{ad}` yer tutucuları `params` ile doldurulur. */
export function t(key: MessageKey, params?: Params): string {
  const template = CATALOGS[locale].messages[key] ?? en[key];
  return params ? fill(template, params) : template;
}

/** Tanım dosyalarındaki İngilizce kaynak metnin (mod, seçenek, palet adı…) geçerli dildeki karşılığı. */
export function phrase(source: string): string {
  return CATALOGS[locale].phrases[source] ?? source;
}

/** `<html lang>`, sekme başlığı ve açıklama meta'sı geçerli dile uyar. */
function applyToDocument(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.title = t('doc.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('doc.description'));
}

/** Tercih veya tarayıcı dili değişti: dili yeniden çözer, belgeyi günceller, aboneleri (dil seçici dahil) uyarır. */
function refresh(): void {
  const next = resolve(pref);
  if (next !== locale) {
    locale = next;
    applyToDocument();
  }
  listeners.forEach((fn) => fn());
}

/** Dil tercihini değiştirir ve saklar ('auto' kaydı siler, böylece tarayıcı dili tekrar izlenir). */
export function setLanguagePref(next: LanguagePref): void {
  if (next === pref) return;
  pref = next;
  try {
    if (next === 'auto') localStorage.removeItem(PREF_KEY);
    else localStorage.setItem(PREF_KEY, next);
  } catch {
    // depolama kapalı: tercih yalnızca bu oturumda geçerli
  }
  refresh();
}

applyToDocument();
// Tarayıcının dil ayarı değişirse (yalnızca "otomatik" iken) arayüz de izler.
if (typeof window !== 'undefined') window.addEventListener('languagechange', () => pref === 'auto' && refresh());
