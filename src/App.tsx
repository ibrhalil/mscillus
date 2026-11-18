import { useEffect, useRef, useState } from 'react';
import { AudioEngine } from './audio/AudioEngine';
import type { SourceType } from './audio/types';
import { RenderLoop } from './render/RenderLoop';
import { MODES } from './visuals/registry';
import type { ModeId } from './visuals/types';
import { toView, useSettings } from './store/settings';
import { SourcePicker } from './ui/SourcePicker';
import { ModeSwitcher } from './ui/ModeSwitcher';
import { SettingsPanel } from './ui/SettingsPanel';
import { TransportControls } from './ui/TransportControls';

function friendlyError(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === 'NotAllowedError')
      return 'İzin verilmedi. Paylaşım penceresinde ses paylaşımını işaretlediğinizden emin olun.';
    if (e.name === 'NotFoundError') return 'Ses aygıtı bulunamadı.';
    if (e.name === 'AbortError') return 'Paylaşım penceresi kapatıldı, işlem iptal edildi.';
  }
  if (e instanceof Error && e.message) return e.message;
  return 'Beklenmeyen bir hata oluştu.';
}

export default function App() {
  const { settings } = useSettings();
  const [source, setSource] = useState<SourceType | null>(null);
  const [fileName, setFileName] = useState('');
  const [modeId, setModeId] = useState<ModeId>('bars');
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [uiHidden, setUiHidden] = useState(false);
  const [fps, setFps] = useState(0);

  const engineRef = useRef<AudioEngine | null>(null);
  const loopRef = useRef<RenderLoop | null>(null);
  const canvas2dRef = useRef<HTMLCanvasElement>(null);
  const canvasGLRef = useRef<HTMLCanvasElement>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const modeRef = useRef(modeId);
  modeRef.current = modeId;

  const startLoop = (engine: AudioEngine) => {
    if (loopRef.current) {
      loopRef.current.start();
      return;
    }
    const c2d = canvas2dRef.current;
    const cgl = canvasGLRef.current;
    if (!c2d || !cgl) return;
    const loop = new RenderLoop({
      engine,
      canvas2d: c2d,
      canvasGL: cgl,
      getSettings: () => toView(settingsRef.current),
      onFps: setFps,
    });
    loop.setMode(modeRef.current).then(() => loop.start());
    loopRef.current = loop;
  };

  const handlePick = async (type: SourceType, file?: File) => {
    setError(null);
    if (!engineRef.current) engineRef.current = new AudioEngine();
    const engine = engineRef.current;
    engine.onEnded = () => handleChangeSource();
    try {
      if (type === 'file') {
        if (!file) return;
        await engine.startFile(file);
        setFileName(file.name);
      } else if (type === 'tab') {
        await engine.startTab();
      } else if (type === 'system') {
        await engine.startSystem();
      } else {
        await engine.startMic();
      }
      setSource(type);
      startLoop(engine);
    } catch (e) {
      setError(friendlyError(e));
    }
  };

  const handleChangeSource = () => {
    loopRef.current?.stop();
    engineRef.current?.stopAll();
    setSource(null);
    setError(null);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setSensitivity(settings.sensitivity);
    engine.setSmoothing(settings.smoothing);
    if (engine.analyser.fftSize !== settings.fftSize) engine.setFftSize(settings.fftSize);
  }, [settings]);

  useEffect(() => {
    void loopRef.current?.setMode(modeId);
  }, [modeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;
      const modeIndex = MODES.findIndex((m) => m.key === e.key);
      if (modeIndex >= 0) {
        setModeId(MODES[modeIndex].id);
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        engineRef.current?.togglePlay();
      } else if (e.key === 's' || e.key === 'S') {
        setPanelOpen((v) => !v);
      } else if (e.key === 'h' || e.key === 'H') {
        setUiHidden((v) => !v);
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (e.key === 'Escape') {
        setPanelOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(
    () => () => {
      loopRef.current?.dispose();
      loopRef.current = null;
      engineRef.current?.dispose();
      engineRef.current = null;
    },
    [],
  );

  return (
    <div className="stage">
      <canvas ref={canvas2dRef} className="stage__canvas" />
      <canvas ref={canvasGLRef} className="stage__canvas" style={{ display: 'none' }} />

      {source === null ? (
        <SourcePicker onPick={handlePick} error={error} />
      ) : (
        <>
          {!uiHidden && (
            <>
              <header className="topbar">
                <div className="topbar__brand">MSCILLUS</div>
                <ModeSwitcher active={modeId} onChange={setModeId} />
                <div className="topbar__actions">
                  {settings.showFps && <span className="fps">{fps} FPS</span>}
                  <button type="button" className="btn btn--ghost" onClick={() => setPanelOpen((v) => !v)}>
                    Ayarlar (S)
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={handleChangeSource}>
                    Kaynak Değiştir
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={toggleFullscreen}>
                    Tam Ekran (F)
                  </button>
                </div>
              </header>
              {source === 'file' && engineRef.current && (
                <TransportControls engine={engineRef.current} fileName={fileName} />
              )}
              {panelOpen && <SettingsPanel onClose={() => setPanelOpen(false)} />}
            </>
          )}
          {uiHidden && <div className="ui-hint">Arayüzü göstermek için H tuşuna basın</div>}
        </>
      )}
    </div>
  );
}
