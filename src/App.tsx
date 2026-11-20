import { useEffect, useRef, useState } from 'react';
import { AudioEngine } from './audio/AudioEngine';
import type { SourceType } from './audio/types';
import { RenderLoop } from './render/RenderLoop';
import { adjacentMode, favoriteForKey, MODES } from './visuals/registry';
import type { ModeId } from './visuals/registry';
import { toView, useSettings } from './store/settings';
import { SourcePicker } from './ui/SourcePicker';
import { ModeSwitcher } from './ui/ModeSwitcher';
import { ExitFullscreenIcon, FullscreenIcon, SettingsIcon } from './ui/icons';
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uiHidden, setUiHidden] = useState(false);
  const [idle, setIdle] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
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
      getSettings: (mode) => toView(settingsRef.current, mode),
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
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key =
        e.key.length === 1 ? (e.shiftKey ? e.key.toUpperCase() : e.key.toLowerCase()) : e.key;
      const favMode = favoriteForKey(settingsRef.current.favorites, key);
      if (favMode) {
        setModeId(favMode);
        return;
      }
      const mode = MODES.find((m) => m.key === key);
      if (mode) {
        setModeId(mode.id);
        return;
      }
      switch (key) {
        case ' ':
          e.preventDefault();
          engineRef.current?.togglePlay();
          break;
        case 's':
          setPanelOpen((v) => !v);
          break;
        case 'h':
          setUiHidden((v) => !v);
          break;
        case 'f':
          toggleFullscreen();
          break;
        case '/':
          e.preventDefault();
          setPickerOpen(true);
          break;
        case 'ArrowRight':
        case 'ArrowLeft':
          setModeId((cur) => adjacentMode(cur, key === 'ArrowRight' ? 1 : -1));
          break;
        case 'Escape':
          setPickerOpen(false);
          setPanelOpen(false);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Ayar paneli açıkken görsele (panel/üst çubuk/oynatıcı dışına) tıklamak paneli kapatır.
  useEffect(() => {
    if (!panelOpen) return;
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest('.panel, .topbar, .transport')) return;
      setPanelOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [panelOpen]);

  // Fare/klavye hareketsiz kalınca arayüz kendiliğinden silinir; görsel tam ekran kalır.
  useEffect(() => {
    if (source === null) return;
    let timer = 0;
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), 3500);
    };
    wake();
    window.addEventListener('pointermove', wake);
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, [source]);

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
    <div className={`stage ${idle && !pickerOpen && !panelOpen ? 'stage--idle' : ''}`}>
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
                <ModeSwitcher
                  active={modeId}
                  open={pickerOpen}
                  onChange={setModeId}
                  onOpenChange={setPickerOpen}
                />
                <div className="topbar__actions">
                  {settings.showFps && <span className="fps">{fps} FPS</span>}
                  <button
                    type="button"
                    className={`btn btn--ghost btn--icon ${panelOpen ? 'btn--active' : ''}`}
                    title="Ayarlar (S)"
                    aria-label="Ayarlar"
                    aria-pressed={panelOpen}
                    onClick={() => setPanelOpen((v) => !v)}
                  >
                    <SettingsIcon />
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--icon"
                    title={isFullscreen ? 'Tam ekrandan çık (F)' : 'Tam ekran (F)'}
                    aria-label={isFullscreen ? 'Tam ekrandan çık' : 'Tam ekran'}
                    onClick={toggleFullscreen}
                  >
                    {isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
                  </button>
                </div>
              </header>
              {source === 'file' && engineRef.current && (
                <TransportControls engine={engineRef.current} fileName={fileName} />
              )}
              {panelOpen && <SettingsPanel
                  modeId={modeId}
                  onClose={() => setPanelOpen(false)}
                  onChangeSource={() => {
                    setPanelOpen(false);
                    handleChangeSource();
                  }}
                />}
            </>
          )}
          {uiHidden && <div className="ui-hint">Arayüzü göstermek için H tuşuna basın</div>}
        </>
      )}
    </div>
  );
}
