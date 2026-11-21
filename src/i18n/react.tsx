import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { getLanguagePref, getLocale, subscribeLocale, t } from './index';
import type { LanguagePref, Locale, MessageKey } from './index';

/**
 * Geçerli dil; değişince bileşen yeniden çizilir. Yerelleştirilmiş metin gösteren her bileşen bunu çağırır
 * (`t` / `phrase` ise modül düzeyinde olduğundan React dışı kodda da doğrudan kullanılır).
 */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale);
}

/** Kullanıcının dil tercihi ('auto' dahil); `useLocale` ile aynı şekilde abone olur. */
export function useLanguagePref(): LanguagePref {
  return useSyncExternalStore(subscribeLocale, getLanguagePref);
}

const TAGS = /<(em|strong)>(.*?)<\/\1>/g;

/** `t` gibi, ama metindeki `<em>…</em>` / `<strong>…</strong>` işaretlerini öğeye çevirir (HTML basılmaz). */
export function tNodes(key: MessageKey, params?: Parameters<typeof t>[1]): ReactNode {
  const text = t(key, params);
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TAGS)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(m[1] === 'em' ? <em key={at}>{m[2]}</em> : <strong key={at}>{m[2]}</strong>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
