import { BeatDetector } from './beatDetector';
import { trackTitle } from './files';
import { Playlist } from './Playlist';
import type { RepeatMode } from './Playlist';
import type { AudioFrame, SourceType } from './types';

interface AudioContextWindow {
  webkitAudioContext?: typeof AudioContext;
}

/** Dosya kaynağının çalma listesi durumu; her değişimde yeni nesne (`useSyncExternalStore` anlık görüntüsü). */
export interface TrackState {
  names: readonly string[];
  index: number;
  repeat: RepeatMode;
  shuffle: boolean;
}

const MIC_CONSTRAINTS = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
const REPEAT_ORDER: readonly RepeatMode[] = ['off', 'all', 'one'];
const MEDIA_ACTIONS: readonly MediaSessionAction[] = [
  'play',
  'pause',
  'previoustrack',
  'nexttrack',
  'seekto',
  'seekbackward',
  'seekforward',
];

const hasMediaSession = (): boolean => 'mediaSession' in navigator;

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly analyser: AnalyserNode;
  /** Hassasiyet: yalnızca analiz koluna uygulanır (duyulan sesi değiştirmez). */
  private gainNode: GainNode;
  /** Dosya ses seviyesi: yalnızca hoparlör koluna uygulanır (görselin tepkisini değiştirmez). */
  private outputGain: GainNode;
  private currentNode: AudioNode | null = null;
  private stream: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private elementSource: MediaElementAudioSourceNode | null = null;
  private fileUrl: string | null = null;
  private loadedFile: File | null = null;
  private playlist = new Playlist<File>();
  private trackState: TrackState = { names: [], index: -1, repeat: 'off', shuffle: false };
  private trackListeners = new Set<() => void>();
  private errorStreak = 0;
  private beat = new BeatDetector();
  private freqBuf = new Uint8Array(1024);
  private waveBuf = new Uint8Array(2048);
  activeSource: SourceType | null = null;
  /** Paylaşılan sekme / ekran / mikrofon akışı tarayıcıdan durdurulunca çağrılır. */
  onEnded: (() => void) | null = null;
  /** Listedeki bir dosya çalınamayınca çağrılır (sıradaki parçaya kendiliğinden geçilir). */
  onTrackError: ((name: string) => void) | null = null;

  constructor() {
    const AC: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as AudioContextWindow).webkitAudioContext!;
    this.ctx = new AC();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = 1.2;
    this.gainNode.connect(this.analyser);
    this.outputGain = this.ctx.createGain();
    this.outputGain.connect(this.ctx.destination);
    this.allocBuffers();
  }

  private allocBuffers(): void {
    this.freqBuf = new Uint8Array(this.analyser.frequencyBinCount);
    this.waveBuf = new Uint8Array(this.analyser.fftSize);
  }

  /**
   * Kaynağı analiz koluna (hassasiyet → analyser) ve gerekiyorsa ayrı bir hoparlör koluna (ses seviyesi → çıkış) bağlar.
   * Sekme/sistem/mikrofon hoparlöre bağlanmaz: sekme sesi zaten duyulur, mikrofonda geri besleme olurdu.
   */
  private attach(node: AudioNode, toSpeakers: boolean): void {
    if (this.currentNode) this.currentNode.disconnect();
    node.connect(this.gainNode);
    if (toSpeakers) node.connect(this.outputGain);
    this.currentNode = node;
    this.beat.reset();
  }

  private stopStream(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  private wireEnded(stream: MediaStream): void {
    for (const track of stream.getTracks()) {
      track.onended = () => {
        if (this.stream !== stream) return;
        this.onEnded?.();
      };
    }
  }

  stopAll(): void {
    this.stopStream();
    this.audioEl?.pause();
    if (this.currentNode) {
      this.currentNode.disconnect();
      this.currentNode = null;
    }
    if (this.activeSource === 'file') this.clearMediaSession();
    this.activeSource = null;
  }

  private async captureDisplay(errorHint: string): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error(errorHint);
    }
    return stream;
  }

  private async attachStream(stream: MediaStream, source: SourceType): Promise<void> {
    this.stopAll();
    this.stream = stream;
    this.wireEnded(stream);
    this.attach(this.ctx.createMediaStreamSource(stream), false);
    this.activeSource = source;
    await this.ctx.resume();
  }

  async startTab(): Promise<void> {
    const stream = await this.captureDisplay(
      'Paylaşılan sekmeden ses gelmedi. Paylaşım penceresinde "Sesi de paylaş" kutusunu işaretlemelisiniz.',
    );
    await this.attachStream(stream, 'tab');
  }

  async startSystem(): Promise<void> {
    const stream = await this.captureDisplay(
      'Sistem sesi yakalanamadı. Windows\'ta "Tüm Ekran" paylaşırken "Sesi de paylaş" kutusunu işaretleyin. macOS\'ta Chrome tüm ekran sesini desteklemeyebilir — README\'deki BlackHole rehberine bakın.',
    );
    await this.attachStream(stream, 'system');
  }

  /**
   * Mikrofonu (veya BlackHole gibi bir giriş aygıtını) başlatır. Kayıtlı aygıt artık yoksa varsayılana düşer.
   * Gerçekte açılan aygıtın kimliğini döndürür.
   */
  async startMic(deviceId = ''): Promise<string> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { ...MIC_CONSTRAINTS, deviceId: { exact: deviceId } } : MIC_CONSTRAINTS,
      });
    } catch (e) {
      const name = (e as { name?: string } | null)?.name;
      if (!deviceId || (name !== 'OverconstrainedError' && name !== 'NotFoundError')) throw e;
      stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
    }
    await this.attachStream(stream, 'mic');
    return stream.getAudioTracks()[0]?.getSettings().deviceId ?? '';
  }

  /** Ses giriş aygıtları; etiketler yalnızca mikrofon izni verildikten sonra dolu gelir. */
  static async listInputs(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput');
  }

  private ensureAudioElement(): HTMLAudioElement {
    if (this.audioEl) return this.audioEl;
    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.addEventListener('ended', () => void this.advance(true));
    el.addEventListener('error', () => this.handleTrackError());
    el.addEventListener('playing', () => {
      this.errorStreak = 0;
    });
    el.addEventListener('loadedmetadata', () => this.updatePositionState());
    el.addEventListener('seeked', () => this.updatePositionState());
    el.addEventListener('play', () => this.setPlaybackState('playing'));
    el.addEventListener('pause', () => this.setPlaybackState('paused'));
    this.audioEl = el;
    // MediaElementAudioSourceNode bir element için yalnızca bir kez oluşturulabilir.
    this.elementSource = this.ctx.createMediaElementSource(el);
    return el;
  }

  /** Dosya(lar)ı yeni bir çalma listesi olarak başlatır. */
  async startFiles(files: readonly File[]): Promise<void> {
    this.stopAll();
    this.ensureAudioElement();
    this.playlist.set(files);
    this.errorStreak = 0;
    this.attach(this.elementSource!, true);
    this.activeSource = 'file';
    this.setupMediaSession();
    await this.ctx.resume();
    try {
      await this.loadCurrent();
    } catch (e) {
      // Tek dosyaysa hata kaynak ekranında gösterilir; listede başka parça varsa 'error' olayı sıradakine geçer.
      if (this.playlist.length <= 1) {
        this.stopAll();
        throw e;
      }
    }
  }

  private async loadCurrent(): Promise<void> {
    const el = this.audioEl;
    const file = this.playlist.current;
    if (!el || !file) return;
    if (file !== this.loadedFile) {
      if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
      this.fileUrl = URL.createObjectURL(file);
      this.loadedFile = file;
      el.src = this.fileUrl;
    } else {
      el.currentTime = 0;
    }
    this.emitTracks();
    this.updateMetadata();
    await el.play();
  }

  /** Parça bitince (`auto`) veya elle sıradakine geçer. Liste bittiyse oynatıcı sonda duraklamış kalır. */
  private async advance(auto: boolean): Promise<void> {
    if (this.activeSource !== 'file') return;
    if (this.playlist.next(auto) === null) {
      this.emitTracks();
      return;
    }
    await this.loadCurrent().catch(() => {});
  }

  private handleTrackError(): void {
    if (this.activeSource !== 'file' || this.playlist.length <= 1) return;
    this.onTrackError?.(this.playlist.current?.name ?? '');
    // Listenin tamamı art arda hata verdiyse dur (sonsuz atlama döngüsü olmasın).
    if (++this.errorStreak >= this.playlist.length) return;
    void this.advance(this.playlist.repeat !== 'one');
  }

  togglePlay(): void {
    const el = this.audioEl;
    if (!el || this.activeSource !== 'file') return;
    if (el.paused) void el.play();
    else el.pause();
  }

  nextTrack(): Promise<void> {
    return this.advance(false);
  }

  /** İlk 3 saniyeden sonra parçayı başa sarar, değilse önceki parçaya geçer. */
  async prevTrack(): Promise<void> {
    const el = this.audioEl;
    if (this.activeSource !== 'file' || !el) return;
    if (el.currentTime > 3) {
      el.currentTime = 0;
      return;
    }
    if (this.playlist.prev() === null) return;
    await this.loadCurrent().catch(() => {});
  }

  async playTrack(i: number): Promise<void> {
    if (this.activeSource !== 'file' || this.playlist.jump(i) === null) return;
    await this.loadCurrent().catch(() => {});
  }

  addFiles(files: readonly File[]): void {
    this.playlist.add(files);
    this.emitTracks();
    this.updateMetadata();
  }

  removeTrack(i: number): void {
    if (this.playlist.remove(i)) this.emitTracks();
  }

  cycleRepeat(): void {
    const i = REPEAT_ORDER.indexOf(this.playlist.repeat);
    this.playlist.repeat = REPEAT_ORDER[(i + 1) % REPEAT_ORDER.length];
    this.emitTracks();
  }

  toggleShuffle(): void {
    this.playlist.setShuffle(!this.playlist.shuffle);
    this.emitTracks();
  }

  seekBy(sec: number): void {
    const el = this.audioEl;
    if (!el || !Number.isFinite(el.duration)) return;
    el.currentTime = Math.min(el.duration, Math.max(0, el.currentTime + sec));
  }

  get volume(): number {
    return this.outputGain.gain.value;
  }

  setVolume(v: number): void {
    this.outputGain.gain.value = v;
  }

  get audioElement(): HTMLAudioElement | null {
    return this.audioEl;
  }

  subscribeTracks = (listener: () => void): (() => void) => {
    this.trackListeners.add(listener);
    return () => this.trackListeners.delete(listener);
  };

  getTrackState = (): TrackState => this.trackState;

  private emitTracks(): void {
    this.trackState = {
      names: this.playlist.all.map((f) => f.name),
      index: this.playlist.index,
      repeat: this.playlist.repeat,
      shuffle: this.playlist.shuffle,
    };
    this.trackListeners.forEach((fn) => fn());
  }

  // --- Media Session: klavyedeki medya tuşları ve işletim sistemi medya kontrolleri ------------------------------

  private setupMediaSession(): void {
    if (!hasMediaSession()) return;
    const handlers: Record<string, MediaSessionActionHandler> = {
      play: () => void this.audioEl?.play(),
      pause: () => this.audioEl?.pause(),
      previoustrack: () => void this.prevTrack(),
      nexttrack: () => void this.nextTrack(),
      seekto: (d) => {
        if (this.audioEl && d.seekTime !== undefined) this.audioEl.currentTime = d.seekTime;
      },
      seekbackward: (d) => this.seekBy(-(d.seekOffset ?? 10)),
      seekforward: (d) => this.seekBy(d.seekOffset ?? 10),
    };
    for (const action of MEDIA_ACTIONS) {
      try {
        navigator.mediaSession.setActionHandler(action, handlers[action]);
      } catch {
        // tarayıcı bu eylemi desteklemiyor
      }
    }
  }

  private clearMediaSession(): void {
    if (!hasMediaSession()) return;
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
    for (const action of MEDIA_ACTIONS) {
      try {
        navigator.mediaSession.setActionHandler(action, null);
      } catch {
        // desteklenmeyen eylem
      }
    }
  }

  private updateMetadata(): void {
    const file = this.playlist.current;
    if (!hasMediaSession() || !file || typeof MediaMetadata === 'undefined') return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: trackTitle(file.name),
      artist: 'Mscillus',
      album: this.playlist.length > 1 ? `${this.playlist.index + 1} / ${this.playlist.length}` : '',
    });
  }

  private setPlaybackState(state: MediaSessionPlaybackState): void {
    if (hasMediaSession() && this.activeSource === 'file') navigator.mediaSession.playbackState = state;
  }

  private updatePositionState(): void {
    const el = this.audioEl;
    if (!el || !hasMediaSession() || this.activeSource !== 'file') return;
    if (!Number.isFinite(el.duration) || el.duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: el.duration,
        position: Math.min(el.currentTime, el.duration),
        playbackRate: el.playbackRate,
      });
    } catch {
      // geçersiz konum (yükleme sırasında) — yok say
    }
  }

  getFrame(dt: number): AudioFrame {
    this.analyser.getByteFrequencyData(this.freqBuf);
    this.analyser.getByteTimeDomainData(this.waveBuf);
    const { bass, mid, treble, level } = this.computeBands();
    const time = this.ctx.currentTime;
    const beat = this.beat.update(bass, time, dt);
    return {
      freq: this.freqBuf,
      wave: this.waveBuf,
      bass,
      mid,
      treble,
      level,
      beat,
      beatPulse: this.beat.pulse,
      dt,
      sampleRate: this.ctx.sampleRate,
      time,
    };
  }

  private computeBands(): { bass: number; mid: number; treble: number; level: number } {
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    const limit = (hz: number) =>
      Math.max(1, Math.min(this.freqBuf.length - 1, Math.round(hz / binHz)));
    const avg = (from: number, to: number) => {
      let sum = 0;
      for (let i = from; i <= to; i++) sum += this.freqBuf[i];
      return sum / ((to - from + 1) * 255);
    };
    const bass = avg(1, limit(250));
    const mid = avg(limit(250) + 1, limit(2000));
    const treble = avg(limit(2000) + 1, limit(9000));

    let sq = 0;
    for (let i = 0; i < this.waveBuf.length; i++) {
      const v = (this.waveBuf[i] - 128) / 128;
      sq += v * v;
    }
    return { bass, mid, treble, level: Math.sqrt(sq / this.waveBuf.length) };
  }

  setSensitivity(v: number): void {
    this.gainNode.gain.value = v;
  }

  setSmoothing(v: number): void {
    this.analyser.smoothingTimeConstant = v;
  }

  setFftSize(n: number): void {
    this.analyser.fftSize = n;
    this.allocBuffers();
  }

  dispose(): void {
    this.stopAll();
    if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
    void this.ctx.close();
  }
}
