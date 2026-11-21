import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { AudioEngine } from './audio/AudioEngine';
import { audioFiles, trackTitle } from './audio/files';
import type { AudioFrame, SourceType } from './audio/types';
import { isChunkLoadError, isReloading, rememberedMode, rememberMode, reloadOnce } from './chunkReload';
import { AutoCycleTimer, cyclePool, ModeShuffler } from './render/AutoCycle';
import { RenderLoop } from './render/RenderLoop';
import { adjacentMode, favoriteForKey, MODES, modeMeta } from './visuals/registry';
import type { ModeId } from './visuals/registry';
import { toView, useSettings } from './store/settings';
import { SourcePicker } from './ui/SourcePicker';
import { ModeSwitcher } from './ui/ModeSwitcher';
import { AutoCycleIcon, ExitFullscreenIcon, FullscreenIcon, SettingsIcon } from './ui/icons';
import { SettingsPanel } from './ui/SettingsPanel';
import type { PanelTab } from './ui/SettingsPanel';
import { Toast } from './ui/Toast';
import type { ToastMessage } from './ui/Toast';
import { TransportControls } from './ui/TransportControls';
import { useWakeLock } from './ui/useWakeLock';

const INFO_TOAST_MS = 1600;
const ERROR_TOAST_MS = 5000;
/** Otomatik geçişte karartmanın sürmesi (ms); mod bu sürenin sonunda, ekran karanlıkken değişir. */
const FADE_MS = 260;

/** Mod değişikliğinin kaynağı: mod çubuğundan tıklanan değişiklik için ad bildirimi gösterilmez (zaten görünüyor). */
type ModeChange = 'ui' | 'key' | 'auto';

function friendlyError(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === 'NotAllowedError')
      return 'İzin verilmedi. Paylaşım penceresinde ses paylaşımını işaretlediğinizden emin olun.';
    if (e.name === 'NotFoundError') return 'Ses aygıtı bulunamadı.';
    if (e.name === 'AbortError') return 'Paylaşım penceresi kapatıldı, işlem iptal edildi.';
    if (e.name === 'NotSupportedError') return 'Bu dosya biçimi tarayıcıda çalınamıyor.';
  }
  if (e instanceof Error && e.message) return e.message;
  return 'Beklenmeyen bir hata oluştu.';
}

/** Sekme oturumunda son kullanılan mod (yenilemeden sonra aynı modla açılır). */
function initialMode(): ModeId {
  const id = rememberedMode();
  return MODES.find((m) => m.id === id)?.id ?? 'bars';
}

export default function App() {
  const { settings, update } = useSettings();
  const [source, setSource] = useState<SourceType | null>(null);
  const [modeId, setModeId] = useState<ModeId>(initialMode);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>('mode');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uiHidden, setUiHidden] = useState(false);
  const [idle, setIdle] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fps, setFps] = useState({ fps: 0, scale: 1 });
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [fading, setFading] = useState(false);

  const engineRef = useRef<AudioEngine | null>(null);
  const loopRef = useRef<RenderLoop | null>(null);
  const canvas2dRef = useRef<HTMLCanvasElement>(null);
  const canvasGLRef = useRef<HTMLCanvasElement>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const modeRef = useRef(modeId);
  modeRef.current = modeId;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  // Panel / mod seçici açıkken veya geçiş sürerken otomatik geçiş bekler.
  const cyclePausedRef = useRef(false);
  cyclePausedRef.current = panelOpen || pickerOpen || fading;
  const changeRef = useRef<ModeChange>('ui');
  const cycleTimer = useRef(new AutoCycleTimer());
  const shuffler = useRef(new ModeShuffler());
  const toastTimer = useRef(0);
  const toastSeq = useRef(0);
  const fadeTimers = useRef<number[]>([]);

  useWakeLock(source !== null);

  const showToast = (text: string, kind: ToastMessage['kind'] = 'info') => {
    const duration = kind === 'error' ? ERROR_TOAST_MS : INFO_TOAST_MS;
    window.clearTimeout(toastTimer.current);
    setToast({ id: ++toastSeq.current, text, kind, duration });
    toastTimer.current = window.setTimeout(() => setToast(null), duration);
  };

  const selectMode = (next: ModeId | ((cur: ModeId) => ModeId), how: ModeChange) => {
    changeRef.current = how;
    setModeId(next);
  };

  /** Mod parçası yüklenemedi / mod kurulamadı. Yeni sürüm yayınlandıysa sayfa bir kez yenilenir. */
  const handleModeError = (id: ModeId, err: unknown) => {
    if (isReloading() || (isChunkLoadError(err) && reloadOnce())) return;
    console.error(err);
    showToast(`"${modeMeta(id).name}" modu açılamadı: ${friendlyError(err)}`, 'error');
  };

  const advanceAuto = () => {
    const s = settingsRef.current;
    const pool = cyclePool(s.autoCycleScope, s.favorites);
    const next = shuffler.current.next(modeRef.current, pool, s.autoCycleShuffle);
    if (next === modeRef.current) return;
    setFading(true);
    fadeTimers.current.push(
      window.setTimeout(() => {
        selectMode(next, 'auto');
        fadeTimers.current.push(window.setTimeout(() => setFading(false), FADE_MS + 60));
      }, FADE_MS),
    );
  };

  const onFrame = (frame: AudioFrame, realDt: number) => {
    const s = settingsRef.current;
    if (!s.autoCycle || cyclePausedRef.current) {
      cycleTimer.current.reset();
      return;
    }
    // Sekme gizliyken geçen süre sayılmasın (rAF durur, dönüşte tek büyük adım gelir).
    if (cycleTimer.current.tick(Math.min(realDt, 0.25), s.autoCycleSec, frame.beat, s.autoCycleOnBeat)) advanceAuto();
  };

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
      getPerf: () => settingsRef.current,
      onFps: (value, scale) => {
        if (settingsRef.current.showFps) setFps({ fps: value, scale });
      },
      onFrame,
      onModeError: (id, err) => {
        console.error(err);
        showToast(`"${modeMeta(id).name}" modu bir hata nedeniyle durduruldu.`, 'error');
      },
      onContextLost: () => showToast('Grafik bağlamı kayboldu; yeniden kuruluyor…', 'error'),
    });
    loopRef.current = loop;
    const id = modeRef.current;
    loop
      .setMode(id)
      .catch((err: unknown) => handleModeError(id, err))
      .finally(() => loop.start());
  };

  const handleChangeSource = () => {
    loopRef.current?.stop();
    engineRef.current?.stopAll();
    setSource(null);
    setError(null);
  };

  const handlePick = async (type: SourceType, files?: File[]) => {
    setError(null);
    if (!engineRef.current) engineRef.current = new AudioEngine();
    const engine = engineRef.current;
    engine.onEnded = () => handleChangeSource();
    engine.onTrackError = (name) => showToast(`Çalınamadı: ${trackTitle(name)} — sıradakine geçildi.`, 'error');
    try {
      if (type === 'file') {
        if (!files?.length) return;
        await engine.startFiles(files);
      } else if (type === 'tab') {
        await engine.startTab();
      } else if (type === 'system') {
        await engine.startSystem();
      } else {
        await engine.startMic(settingsRef.current.micDeviceId);
      }
      setSource(type);
      startLoop(engine);
    } catch (e) {
      // Çalışırken (ekrana dosya bırakınca) önceki kaynak durdurulduysa kaynak ekranına dön.
      if (sourceRef.current !== null && engine.activeSource === null) handleChangeSource();
      setError(friendlyError(e));
    }
  };

  const handleMicDevice = async (deviceId: string) => {
    update({ micDeviceId: deviceId });
    const engine = engineRef.current;
    if (!engine || sourceRef.current !== 'mic') return;
    try {
      await engine.startMic(deviceId);
    } catch (e) {
      showToast(friendlyError(e), 'error');
    }
  };

  const toggleAutoCycle = () => {
    const on = !settings.autoCycle;
    update({ autoCycle: on });
    if (!on) {
      showToast('Otomatik mod geçişi kapalı');
      return;
    }
    const favs = settings.autoCycleScope === 'favorites' && settings.favorites.length >= 2;
    showToast(`Otomatik mod geçişi açık · ${favs ? 'favoriler' : 'tüm modlar'}, ${settings.autoCycleSec} sn`);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };

  // Görselleştirme sırasında ekrana bırakılan ses dosyaları: dosya kaynağında listeye eklenir, değilse kaynak olur.
  const onStageDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (source !== null && e.dataTransfer.types.includes('Files')) e.preventDefault();
  };

  const onStageDrop = (e: DragEvent<HTMLDivElement>) => {
    if (source === null) return;
    e.preventDefault();
    const files = audioFiles(e.dataTransfer.files);
    if (files.length === 0) {
      showToast('Bırakılanlar arasında ses dosyası yok.', 'error');
      return;
    }
    const engine = engineRef.current;
    if (source === 'file' && engine) {
      engine.addFiles(files);
      showToast(
        files.length === 1 ? `Listeye eklendi: ${trackTitle(files[0].name)}` : `${files.length} parça listeye eklendi`,
      );
    } else {
      void handlePick('file', files);
    }
  };

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setSensitivity(settings.sensitivity);
    engine.setSmoothing(settings.smoothing);
    if (engine.analyser.fftSize !== settings.fftSize) engine.setFftSize(settings.fftSize);
  }, [settings]);

  useEffect(() => {
    rememberMode(modeId);
    cycleTimer.current.reset();
    loopRef.current?.setMode(modeId).catch((err: unknown) => handleModeError(modeId, err));
    if (changeRef.current !== 'ui' && sourceRef.current !== null && settingsRef.current.modeToast) {
      showToast(modeMeta(modeId).name);
    }
    changeRef.current = 'ui';
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
        selectMode(favMode, 'key');
        return;
      }
      const mode = MODES.find((m) => m.key === key);
      if (mode) {
        selectMode(mode.id, 'key');
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
        case 'ArrowLeft': {
          const forward = key === 'ArrowRight';
          if (e.shiftKey) {
            const engine = engineRef.current;
            if (engine && sourceRef.current === 'file') void (forward ? engine.nextTrack() : engine.prevTrack());
            break;
          }
          selectMode((cur) => adjacentMode(cur, forward ? 1 : -1), 'key');
          break;
        }
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
      window.clearTimeout(toastTimer.current);
      fadeTimers.current.forEach((t) => window.clearTimeout(t));
      loopRef.current?.dispose();
      loopRef.current = null;
      engineRef.current?.dispose();
      engineRef.current = null;
    },
    [],
  );

  return (
    <div
      className={`stage ${idle && !pickerOpen && !panelOpen ? 'stage--idle' : ''} ${panelOpen ? 'stage--panel' : ''}`}
      onDragOver={onStageDragOver}
      onDrop={onStageDrop}
    >
      <canvas ref={canvas2dRef} className="stage__canvas" />
      <canvas ref={canvasGLRef} className="stage__canvas" style={{ display: 'none' }} />
      <div className={`stage__fade ${fading ? 'stage__fade--on' : ''}`} aria-hidden="true" />

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
                  onChange={(id) => selectMode(id, 'ui')}
                  onOpenChange={setPickerOpen}
                />
                <div className="topbar__actions">
                  {settings.showFps && (
                    <span className="fps" title={fps.scale < 1 ? 'Çizim çözünürlüğü (otomatik / performans ayarı)' : undefined}>
                      {fps.fps} FPS{fps.scale < 1 && ` · %${Math.round(fps.scale * 100)}`}
                    </span>
                  )}
                  <button
                    type="button"
                    className={`btn btn--ghost btn--icon ${settings.autoCycle ? 'btn--active' : ''}`}
                    title={settings.autoCycle ? 'Otomatik mod geçişi: açık' : 'Otomatik mod geçişi: kapalı'}
                    aria-label="Otomatik mod geçişi"
                    aria-pressed={settings.autoCycle}
                    onClick={toggleAutoCycle}
                  >
                    <AutoCycleIcon />
                  </button>
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
              {source === 'file' && engineRef.current && <TransportControls engine={engineRef.current} />}
              {panelOpen && <SettingsPanel
                  modeId={modeId}
                  source={source}
                  tab={panelTab}
                  onTabChange={setPanelTab}
                  onClose={() => setPanelOpen(false)}
                  onChangeSource={() => {
                    setPanelOpen(false);
                    handleChangeSource();
                  }}
                  onMicDevice={(id) => void handleMicDevice(id)}
                />}
            </>
          )}
          {uiHidden && <div className="ui-hint">Arayüzü göstermek için H tuşuna basın</div>}
        </>
      )}
      <Toast toast={toast} />
    </div>
  );
}
