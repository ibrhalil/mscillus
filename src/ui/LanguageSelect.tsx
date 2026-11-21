import { LOCALES, setLanguagePref, t } from '../i18n';
import type { LanguagePref } from '../i18n';
import { useLanguagePref, useLocale } from '../i18n/react';

const isPref = (v: string): v is LanguagePref => v === 'auto' || LOCALES.some((l) => l.id === v);

/** Dil seçici: "Otomatik" tarayıcı dilini izler; diller kendi adlarıyla listelenir (okunamayan bir dilden çıkılabilsin). */
export function LanguageSelect({ className }: { className?: string }) {
  useLocale();
  const pref = useLanguagePref();
  return (
    <select
      className={className}
      value={pref}
      aria-label={t('lang.label')}
      onChange={(e) => {
        if (isPref(e.target.value)) setLanguagePref(e.target.value);
      }}
    >
      <option value="auto">{t('lang.auto')}</option>
      {LOCALES.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </select>
  );
}
