import { BeatDetector } from './beatDetector';
import type { AudioFrame, SourceType } from './types';

interface AudioContextWindow {
  webkitAudioContext?: typeof AudioContext;
}

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly analyser: AnalyserNode;
  private gainNode: GainNode;
  private currentNode: AudioNode | null = null;
  private stream: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private elementSource: MediaElementAudioSourceNode | null = null;
  private fileUrl: string | null = null;
  private beat = new BeatDetector();
  private freqBuf = new Uint8Array(1024);
  private waveBuf = new Uint8Array(2048);
  activeSource: SourceType | null = null;
  onEnded: (() => void) | null = null;

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
    this.allocBuffers();
  }

  private allocBuffers(): void {
    this.freqBuf = new Uint8Array(this.analyser.frequencyBinCount);
    this.waveBuf = new Uint8Array(this.analyser.fftSize);
  }

  private attach(node: AudioNode, toSpeakers: boolean): void {
    if (this.currentNode) this.currentNode.disconnect();
    this.analyser.disconnect();
    node.connect(this.gainNode);
    if (toSpeakers) this.analyser.connect(this.ctx.destination);
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
    this.analyser.disconnect();
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

  async startMic(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    await this.attachStream(stream, 'mic');
  }

  async startFile(file: File): Promise<void> {
    this.stopAll();
    if (!this.audioEl) {
      this.audioEl = new Audio();
      this.audioEl.crossOrigin = 'anonymous';
    }
    if (!this.elementSource) {
      this.elementSource = this.ctx.createMediaElementSource(this.audioEl);
    }
    if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
    this.fileUrl = URL.createObjectURL(file);
    this.audioEl.src = this.fileUrl;
    this.attach(this.elementSource, true);
    this.activeSource = 'file';
    await this.ctx.resume();
    await this.audioEl.play();
  }

  togglePlay(): void {
    const el = this.audioEl;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }

  get audioElement(): HTMLAudioElement | null {
    return this.audioEl;
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
