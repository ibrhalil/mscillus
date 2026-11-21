import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, ReactNode } from 'react';
import { audioFiles } from '../audio/files';
import type { SourceType } from '../audio/types';
import { PickerBackdrop } from './PickerBackdrop';

interface Props {
  onPick: (source: SourceType, files?: File[]) => void | Promise<void>;
  error: string | null;
}

const ICON = {
  width: 28,
  height: 28,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const ICONS: Record<SourceType, ReactNode> = {
  tab: (
    <svg {...ICON}>
      <rect x="3" y="4" width="18" height="14" rx="2.5" />
      <path d="M3 8.5h18" />
      <path d="M9.5 12.5v2.5M12 11v5.5M14.5 12.5v2.5" />
    </svg>
  ),
  system: (
    <svg {...ICON}>
      <rect x="2.5" y="4" width="19" height="12.5" rx="2" />
      <path d="M8 20.5h8M12 16.5v4" />
      <path d="M8.5 10.5c1-1.4 2-1.4 3 0s2 1.4 3 0" />
    </svg>
  ),
  file: (
    <svg {...ICON}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M10.5 17.5v-5.2l4-1v5.2" />
      <circle cx="9.3" cy="17.6" r="1.3" />
      <circle cx="13.3" cy="16.6" r="1.3" />
    </svg>
  ),
  mic: (
    <svg {...ICON}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7" />
    </svg>
  ),
};

const CARDS: { id: SourceType; title: string; desc: string; hint: string; badge?: string }[] = [
  {
    id: 'tab',
    title: 'Tarayıcı Sekmesi',
    desc: 'YouTube, Spotify Web gibi bir sekmeden ses yakalar',
    hint: 'Paylaşım penceresinde "Sesi de paylaş" kutusunu işaretleyin',
    badge: 'Önerilen',
  },
  {
    id: 'system',
    title: 'Sistem Sesi',
    desc: 'Masaüstü uygulamalarından çalan tüm sesi yakalar',
    hint: "macOS'ta çalışmazsa BlackHole gerekir (README'ye bakın)",
  },
  {
    id: 'file',
    title: 'Yerel Dosya',
    desc: 'MP3 · FLAC · WAV · OGG dosyalarını görselleştirir',
    hint: 'Birden çok dosya seçerseniz çalma listesi olur',
  },
  {
    id: 'mic',
    title: 'Mikrofon',
    desc: 'Hoparlörden çalan müziği mikrofonla dinler',
    hint: 'Giriş aygıtı (örn. BlackHole) ayarlar panelinden seçilir',
  },
];

export function SourcePicker({ onPick, error }: Props) {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const pickFile = () => inputRef.current?.click();

  const endDrag = () => {
    dragDepth.current = 0;
    setDragging(false);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    endDrag();
    const files = audioFiles(e.dataTransfer.files);
    // Ses olarak tanınmayan tek dosya da denensin; çalınamazsa anlamlı hata gösterilir.
    if (files.length > 0) void onPick('file', files);
    else if (e.dataTransfer.files[0]) void onPick('file', [e.dataTransfer.files[0]]);
  };

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) void onPick('file', files);
    e.target.value = '';
  };

  return (
    <div
      className={`picker ${dragging ? 'picker--drag' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <PickerBackdrop />

      <div className="picker__inner">
        <header className="picker__hero">
          <div className="eq" aria-hidden="true">
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} style={{ animationDelay: `${(i * 0.13).toFixed(2)}s` }} />
            ))}
          </div>
          <h1 className="picker__title">MSCILLUS</h1>
          <p className="picker__subtitle">
            Müziği <em>görün</em>. Ritme göre nefes alan görseller — başlamak için bir ses kaynağı seçin.
          </p>
        </header>

        <div className="picker__cards">
          {CARDS.map((card) => (
            <button
              key={card.id}
              type="button"
              className="card"
              onClick={() => {
                if (card.id === 'file') pickFile();
                else void onPick(card.id);
              }}
            >
              <span className="card__icon">{ICONS[card.id]}</span>
              <span className="card__body">
                <span className="card__title">
                  {card.title}
                  {card.badge && <span className="card__badge">{card.badge}</span>}
                </span>
                <span className="card__desc">{card.desc}</span>
                <span className="card__hint">{card.hint}</span>
              </span>
              <span className="card__arrow" aria-hidden="true">
                →
              </span>
            </button>
          ))}
        </div>

        <input ref={inputRef} type="file" accept="audio/*" multiple hidden onChange={onFileChange} />

        <button type="button" className="picker__drop" onClick={pickFile}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
          </svg>
          Ya da ses dosyalarını buraya sürükleyip bırakın
        </button>

        {error && (
          <div className="picker__error" role="alert">
            {error}
          </div>
        )}

        <footer className="picker__foot">
          <span>
            <kbd className="kbd">/</kbd> mod seçici
          </span>
          <span>
            <kbd className="kbd">H</kbd> arayüzü gizle
          </span>
          <span>
            <kbd className="kbd">F</kbd> tam ekran
          </span>
        </footer>
      </div>

      {dragging && (
        <div className="picker__overlay" aria-hidden="true">
          <div className="picker__overlay-inner">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
            </svg>
            Müzik dosyalarını bırakın
          </div>
        </div>
      )}
    </div>
  );
}
