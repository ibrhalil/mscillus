import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ChangeEvent } from 'react';
import type { AudioEngine, TrackState } from '../audio/AudioEngine';
import { audioFiles, trackTitle } from '../audio/files';
import { t } from '../i18n';
import type { MessageKey } from '../i18n';
import { useLocale } from '../i18n/react';
import { ListIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, RepeatIcon, ShuffleIcon, VolumeIcon } from './icons';

interface Props {
  engine: AudioEngine;
}

const REPEAT_LABEL = {
  off: 'transport.repeatOff',
  all: 'transport.repeatAll',
  one: 'transport.repeatOne',
} as const satisfies Record<string, MessageKey>;

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function TransportControls({ engine }: Props) {
  useLocale();
  const tracks = useSyncExternalStore(engine.subscribeTracks, engine.getTrackState);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(engine.volume);
  const [listOpen, setListOpen] = useState(false);
  const dragRef = useRef(false);
  const unmutedVolume = useRef(engine.volume || 1);

  useEffect(() => {
    const el = engine.audioElement;
    if (!el) return;
    const sync = () => {
      setPlaying(!el.paused);
      if (!dragRef.current) setPos(el.currentTime);
      setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    };
    sync();
    const events: (keyof HTMLMediaElementEventMap)[] = [
      'timeupdate',
      'play',
      'pause',
      'ended',
      'loadedmetadata',
      'durationchange',
      'emptied',
    ];
    events.forEach((ev) => el.addEventListener(ev, sync));
    return () => events.forEach((ev) => el.removeEventListener(ev, sync));
  }, [engine]);

  const seek = (time: number) => {
    const el = engine.audioElement;
    if (el) el.currentTime = time;
    setPos(time);
  };

  const changeVolume = (v: number) => {
    engine.setVolume(v);
    setVolume(v);
    if (v > 0) unmutedVolume.current = v;
  };

  const name = tracks.names[tracks.index] ?? '';
  const multi = tracks.names.length > 1;

  return (
    <div className="transport">
      <div className="transport__group">
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          title={`${t('transport.prev')} (⇧←)`}
          aria-label={t('transport.prev')}
          onClick={() => void engine.prevTrack()}
        >
          <PrevIcon />
        </button>
        <button
          type="button"
          className="btn btn--primary btn--icon transport__play"
          title={`${playing ? t('transport.pause') : t('transport.play')} (Space)`}
          aria-label={playing ? t('transport.pause') : t('transport.play')}
          onClick={() => engine.togglePlay()}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          title={`${t('transport.next')} (⇧→)`}
          aria-label={t('transport.next')}
          onClick={() => void engine.nextTrack()}
        >
          <NextIcon />
        </button>
      </div>

      <span className="transport__time">{fmtTime(pos)}</span>
      <input
        className="transport__seek"
        type="range"
        min={0}
        max={Math.max(0.1, duration)}
        step={0.1}
        value={pos}
        aria-label={t('transport.position')}
        onPointerDown={() => {
          dragRef.current = true;
        }}
        onPointerUp={() => {
          dragRef.current = false;
        }}
        onChange={(e) => seek(Number(e.target.value))}
      />
      <span className="transport__time">{fmtTime(duration)}</span>

      <span className="transport__file" title={name}>
        {trackTitle(name)}
        {multi && (
          <span className="transport__count">
            {tracks.index + 1}/{tracks.names.length}
          </span>
        )}
      </span>

      <div className="transport__group">
        <button
          type="button"
          className={`btn btn--ghost btn--icon ${tracks.repeat !== 'off' ? 'btn--active' : ''}`}
          title={t(REPEAT_LABEL[tracks.repeat])}
          aria-label={t(REPEAT_LABEL[tracks.repeat])}
          onClick={() => engine.cycleRepeat()}
        >
          <RepeatIcon one={tracks.repeat === 'one'} />
        </button>
        <button
          type="button"
          className={`btn btn--ghost btn--icon ${tracks.shuffle ? 'btn--active' : ''}`}
          title={tracks.shuffle ? t('transport.shuffleOn') : t('transport.shuffleOff')}
          aria-label={t('transport.shuffle')}
          aria-pressed={tracks.shuffle}
          onClick={() => engine.toggleShuffle()}
        >
          <ShuffleIcon />
        </button>
        <PlaylistButton engine={engine} tracks={tracks} open={listOpen} onOpenChange={setListOpen} />
      </div>

      <div className="transport__vol">
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          title={volume > 0 ? t('transport.mute') : t('transport.unmute')}
          aria-label={volume > 0 ? t('transport.mute') : t('transport.unmute')}
          onClick={() => changeVolume(volume > 0 ? 0 : unmutedVolume.current)}
        >
          <VolumeIcon muted={volume === 0} />
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          aria-label={t('transport.volume')}
          onChange={(e) => changeVolume(Number(e.target.value))}
        />
      </div>
    </div>
  );
}

function PlaylistButton({
  engine,
  tracks,
  open,
  onOpenChange,
}: {
  engine: AudioEngine;
  tracks: TrackState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open, onOpenChange]);

  const onFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? audioFiles(e.target.files) : [];
    if (files.length > 0) engine.addFiles(files);
    e.target.value = '';
  };

  return (
    <div className="transport__list" ref={ref}>
      <button
        type="button"
        className={`btn btn--ghost btn--icon ${open ? 'btn--active' : ''}`}
        title={t('playlist.title')}
        aria-label={t('playlist.title')}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <ListIcon />
      </button>
      {open && (
        <div className="playlist" role="dialog" aria-label={t('playlist.title')}>
          <div className="playlist__head">
            <span>{t('playlist.head', { n: tracks.names.length })}</span>
            <button type="button" className="btn btn--ghost" onClick={() => inputRef.current?.click()}>
              {t('playlist.add')}
            </button>
            <input ref={inputRef} type="file" accept="audio/*" multiple hidden onChange={onFiles} />
          </div>
          <ol className="playlist__items">
            {tracks.names.map((n, i) => (
              <li key={`${i}:${n}`} className={`playlist__item ${i === tracks.index ? 'playlist__item--on' : ''}`}>
                <button type="button" className="playlist__play" onClick={() => void engine.playTrack(i)}>
                  <span className="playlist__no">{i === tracks.index ? '▶' : i + 1}</span>
                  <span className="playlist__name" title={n}>
                    {trackTitle(n)}
                  </span>
                </button>
                {i !== tracks.index && (
                  <button
                    type="button"
                    className="playlist__remove"
                    title={t('playlist.remove')}
                    aria-label={t('playlist.removeTrack', { title: trackTitle(n) })}
                    onClick={() => engine.removeTrack(i)}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ol>
          <p className="playlist__hint">{t('playlist.hint')}</p>
        </div>
      )}
    </div>
  );
}
