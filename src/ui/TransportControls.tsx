import { useEffect, useRef, useState } from 'react';
import type { AudioEngine } from '../audio/AudioEngine';

interface Props {
  engine: AudioEngine;
  fileName: string;
}

function fmtTime(t: number): string {
  if (!Number.isFinite(t)) return '0:00';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function TransportControls({ engine, fileName }: Props) {
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const dragRef = useRef(false);

  useEffect(() => {
    const el = engine.audioElement;
    if (!el) return;
    const sync = () => {
      setPlaying(!el.paused);
      if (!dragRef.current) setPos(el.currentTime);
      if (Number.isFinite(el.duration)) setDuration(el.duration);
      setVolume(el.volume);
    };
    sync();
    const events: (keyof HTMLMediaElementEventMap)[] = [
      'timeupdate',
      'play',
      'pause',
      'ended',
      'volumechange',
      'loadedmetadata',
    ];
    events.forEach((ev) => el.addEventListener(ev, sync));
    return () => events.forEach((ev) => el.removeEventListener(ev, sync));
  }, [engine]);

  const seek = (t: number) => {
    const el = engine.audioElement;
    if (el) el.currentTime = t;
    setPos(t);
  };

  const changeVolume = (v: number) => {
    const el = engine.audioElement;
    if (el) el.volume = v;
    setVolume(v);
  };

  return (
    <div className="transport">
      <button type="button" className="btn btn--primary" onClick={() => engine.togglePlay()}>
        {playing ? 'Duraklat' : 'Oynat'}
      </button>
      <span className="transport__time">{fmtTime(pos)}</span>
      <input
        className="transport__seek"
        type="range"
        min={0}
        max={Math.max(0.1, duration)}
        step={0.1}
        value={pos}
        onPointerDown={() => {
          dragRef.current = true;
        }}
        onPointerUp={() => {
          dragRef.current = false;
        }}
        onChange={(e) => seek(Number(e.target.value))}
      />
      <span className="transport__time">{fmtTime(duration)}</span>
      <span className="transport__file" title={fileName}>
        {fileName}
      </span>
      <label className="transport__vol">
        Ses
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => changeVolume(Number(e.target.value))}
        />
      </label>
    </div>
  );
}
