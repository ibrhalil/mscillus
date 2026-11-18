import { useRef, useState } from 'react';
import type { DragEvent, ChangeEvent } from 'react';
import type { SourceType } from '../audio/types';

interface Props {
  onPick: (source: SourceType, file?: File) => void | Promise<void>;
  error: string | null;
}

const CARDS: { id: SourceType; title: string; desc: string; hint: string }[] = [
  {
    id: 'tab',
    title: 'Tarayıcı Sekmesi',
    desc: 'YouTube, Spotify Web vb. sekmelerden ses yakalar',
    hint: 'Paylaş penceresinde "Sesi de paylaş" kutusunu işaretlemeyi unutmayın',
  },
  {
    id: 'system',
    title: 'Sistem Sesi',
    desc: 'Masaüstü uygulamalardan çalan tüm sesi yakalar',
    hint: 'macOS\'ta çalışmazsa BlackHole kurulumu gerekir (README\'ye bakın)',
  },
  {
    id: 'file',
    title: 'Yerel Dosya',
    desc: 'MP3 / FLAC / WAV / OGG dosyalarını görselleştirir',
    hint: 'Dosyayı bu ekrana sürükleyip bırakabilirsiniz',
  },
  {
    id: 'mic',
    title: 'Mikrofon',
    desc: 'Hoparlörden çalan müziği mikrofonla dinler',
    hint: 'Kulaklık kullanırken geri besleme olmaz',
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
    const file = e.dataTransfer.files[0];
    if (file) void onPick('file', file);
  };

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void onPick('file', file);
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
      <h1 className="picker__title">MSCILLUS</h1>
      <p className="picker__subtitle">Müzik ritimlerine göre görsel şölen — bir ses kaynağı seçin</p>

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
            <span className="card__title">{card.title}</span>
            <span className="card__desc">{card.desc}</span>
            <span className="card__hint">{card.hint}</span>
          </button>
        ))}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        hidden
        onChange={onFileChange}
      />

      <p className={`picker__drop ${dragging ? 'picker__drop--active' : ''}`}>
        Dosyayı buraya sürükleyip bırakın
      </p>

      {error && <div className="picker__error">{error}</div>}
    </div>
  );
}
