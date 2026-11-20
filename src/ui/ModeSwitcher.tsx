import { useEffect, useMemo, useRef, useState } from 'react';
import { adjacentMode, CATEGORIES, favoriteKey, keyLabel, MODES, modeMeta } from '../visuals/registry';
import type { ModeId, ModeMeta } from '../visuals/registry';
import { useSettings } from '../store/settings';
import { StarIcon } from './icons';

interface Props {
  active: ModeId;
  open: boolean;
  onChange: (id: ModeId) => void;
  onOpenChange: (open: boolean) => void;
}

const norm = (s: string) => s.toLocaleLowerCase('tr');

export function ModeSwitcher({ active, open, onChange, onOpenChange }: Props) {
  const { settings, toggleFavorite } = useSettings();
  const current = modeMeta(active);
  const isFav = settings.favorites.includes(active);
  const index = MODES.findIndex((m) => m.id === active);
  const step = (d: number) => onChange(adjacentMode(active, d));

  return (
    <div className="modebar">
      <button type="button" className="btn btn--ghost btn--icon" aria-label="Önceki mod" onClick={() => step(-1)}>
        ‹
      </button>
      <button
        type="button"
        className={`modebar__current ${open ? 'modebar__current--open' : ''}`}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <span className="modebar__name">{current.name}</span>
        <kbd className="kbd">{keyLabel(current.key)}</kbd>
        {favoriteKey(settings.favorites, active) && (
          <kbd className="kbd kbd--fav">{favoriteKey(settings.favorites, active)}</kbd>
        )}
        <span className="modebar__count">
          {index + 1}/{MODES.length}
        </span>
      </button>
      <button
        type="button"
        className={`btn btn--ghost btn--icon btn--star ${isFav ? 'btn--star-on' : ''}`}
        title={isFav ? 'Favorilerden çıkar' : 'Favorilere ekle'}
        aria-label={isFav ? 'Favorilerden çıkar' : 'Favorilere ekle'}
        aria-pressed={isFav}
        onClick={() => toggleFavorite(active)}
      >
        <StarIcon filled={isFav} />
      </button>
      <button type="button" className="btn btn--ghost btn--icon" aria-label="Sonraki mod" onClick={() => step(1)}>
        ›
      </button>
      {open && (
        <ModePicker
          active={active}
          onPick={(id) => {
            onChange(id);
            onOpenChange(false);
          }}
          onClose={() => onOpenChange(false)}
        />
      )}
    </div>
  );
}

function ModePicker({
  active,
  onPick,
  onClose,
}: {
  active: ModeId;
  onPick: (id: ModeId) => void;
  onClose: () => void;
}) {
  const { settings, toggleFavorite } = useSettings();
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const favorites = settings.favorites;

  // Favoriler en üstte (eklenme sırasıyla); modlar kendi kategorilerinde de görünmeye devam eder.
  const groups = useMemo(() => {
    const q = norm(query.trim());
    const matches = (m: ModeMeta) => !q || norm(m.name).includes(q) || norm(m.key) === q;
    const favModes = favorites.map((id) => modeMeta(id)).filter(matches);
    return [
      { id: 'favorites', name: '★ Favoriler', modes: favModes },
      ...CATEGORIES.map((c) => ({ ...c, modes: MODES.filter((m) => m.category === c.id && matches(m)) })),
    ].filter((g) => g.modes.length > 0);
  }, [query, favorites]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [onClose]);

  return (
    <div className="picker-pop" ref={ref} role="dialog" aria-label="Görsel mod seç">
      <input
        className="picker-pop__search"
        type="search"
        placeholder="Mod ara…  (Enter: ilk sonuç, Esc: kapat)"
        value={query}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          else if (e.key === 'Enter' && groups[0]) onPick(groups[0].modes[0].id);
        }}
      />
      <div className="picker-pop__scroll">
        {groups.map((g) => (
          <section key={g.id} className="picker-pop__group">
            <h3>{g.name}</h3>
            <div className="picker-pop__grid">
              {g.modes.map((m) => {
                const fav = favorites.includes(m.id);
                return (
                  <div key={m.id} className={`tile ${m.id === active ? 'tile--active' : ''}`}>
                    <button type="button" className="tile__main" onClick={() => onPick(m.id)}>
                      <span className="tile__name">{m.name}</span>
                      <kbd className="kbd">{keyLabel(m.key)}</kbd>
                      {favoriteKey(favorites, m.id) && <kbd className="kbd kbd--fav">{favoriteKey(favorites, m.id)}</kbd>}
                    </button>
                    <button
                      type="button"
                      className={`tile__star ${fav ? 'tile__star--on' : ''}`}
                      title={fav ? 'Favorilerden çıkar' : 'Favorilere ekle'}
                      aria-label={fav ? 'Favorilerden çıkar' : 'Favorilere ekle'}
                      aria-pressed={fav}
                      onClick={() => toggleFavorite(m.id)}
                    >
                      <StarIcon filled={fav} />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {groups.length === 0 && <p className="picker-pop__empty">Eşleşen mod yok.</p>}
      </div>
    </div>
  );
}
