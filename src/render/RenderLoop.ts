import type * as THREE from 'three';
import type { AudioEngine } from '../audio/AudioEngine';
import type { AudioFrame } from '../audio/types';
import { createVisualizer, modeMeta } from '../visuals/registry';
import type { ModeId } from '../visuals/registry';
import { pixelRatio, setGlowQuality, setRenderScale } from '../visuals/util';
import type { RendererKind, Visualizer, VisualizerSettingsView } from '../visuals/types';
import { AutoScale } from './AutoScale';

export type Resolution = 'auto' | 'high' | 'medium' | 'low';

export interface PerfSettings {
  resolution: Resolution;
  /** 0 = sınırsız. */
  fpsCap: number;
}

const FIXED_SCALE: Record<Exclude<Resolution, 'auto'>, number> = { high: 1, medium: 0.75, low: 0.5 };

interface RenderLoopOptions {
  engine: AudioEngine;
  canvas2d: HTMLCanvasElement;
  canvasGL: HTMLCanvasElement;
  getSettings: (mode: ModeId) => VisualizerSettingsView;
  getPerf: () => PerfSettings;
  /** Saniyede iki kez: ölçülen FPS ve uygulanan çözünürlük ölçeği. */
  onFps?: (fps: number, scale: number) => void;
  /** Her çizilen karede (otomatik mod geçişi gibi ses verisine bakan işler için). */
  onFrame?: (frame: AudioFrame, realDt: number) => void;
  /** Mod çalışırken hata verdi ve durduruldu. */
  onModeError?: (id: ModeId, err: unknown) => void;
  onContextLost?: () => void;
}

interface ThreeBundle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

export class RenderLoop {
  private engine: AudioEngine;
  private canvas2d: HTMLCanvasElement;
  private canvasGL: HTMLCanvasElement;
  private ctx2d: CanvasRenderingContext2D;
  private three: ThreeBundle | null = null;
  private viz: Visualizer | null = null;
  private kind: RendererKind = 'canvas2d';
  private modeId: ModeId | null = null;
  private opts: RenderLoopOptions;
  private observer: ResizeObserver;
  private raf = 0;
  private lastT = 0;
  private capAnchor = 0;
  private elapsed = 0;
  private cssW = 1;
  private cssH = 1;
  private fpsCount = 0;
  private fpsTimer = 0;
  private modeToken = 0;
  private autoScale = new AutoScale();
  /** Otomatik çözünürlükte her modun en son basamağı (ağır modda her seferinde baştan düşürmesin). */
  private modeLevels = new Map<ModeId, number>();
  private appliedScale = 1;
  private contextLost = false;
  private prefetched = false;

  constructor(opts: RenderLoopOptions) {
    this.opts = opts;
    this.engine = opts.engine;
    this.canvas2d = opts.canvas2d;
    this.canvasGL = opts.canvasGL;

    const ctx = this.canvas2d.getContext('2d');
    if (!ctx) throw new Error('2D canvas context alınamadı');
    this.ctx2d = ctx;

    this.canvasGL.addEventListener('webglcontextlost', this.handleContextLost);
    this.canvasGL.addEventListener('webglcontextrestored', this.handleContextRestored);

    this.observer = new ResizeObserver(() => this.resize());
    const parent = this.canvas2d.parentElement;
    if (parent) this.observer.observe(parent);
    this.resize();
  }

  private async createThree(): Promise<void> {
    const THREE = await import('three');
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvasGL,
      antialias: true,
      powerPreference: 'high-performance',
    });
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 600);
    camera.position.z = 4;
    this.three = { renderer, scene: new THREE.Scene(), camera };
    this.resize();
  }

  /** Modu yükleyip etkinleştirir. Yüklenemezse hata fırlatır (bu sırada başka moda geçildiyse sessizce vazgeçer). */
  async setMode(id: ModeId): Promise<void> {
    const token = ++this.modeToken;
    if (this.modeId) this.modeLevels.set(this.modeId, this.autoScale.level);
    const kind = modeMeta(id).renderer;
    let viz: Visualizer | null = null;
    try {
      if (kind === 'three' && !this.three) await this.createThree();
      if (token !== this.modeToken) return;

      this.viz?.dispose();
      this.viz = null;
      this.modeId = null;
      viz = await createVisualizer(id, {
        ctx2d: this.ctx2d,
        scene: this.three?.scene ?? null,
        renderer: this.three?.renderer ?? null,
      });
      if (token !== this.modeToken) {
        viz.dispose();
        return;
      }

      const isThree = kind === 'three';
      this.canvasGL.style.display = isThree ? 'block' : 'none';
      this.canvas2d.style.display = isThree ? 'none' : 'block';
      this.ctx2d.shadowBlur = 0;
      this.ctx2d.globalAlpha = 1;
      this.ctx2d.globalCompositeOperation = 'source-over';
      this.ctx2d.fillStyle = this.opts.getSettings(id).palette.bg;
      this.ctx2d.fillRect(0, 0, this.cssW, this.cssH);
      viz.init(this.cssW, this.cssH);
      this.viz = viz;
      this.kind = kind;
      this.modeId = id;
      this.autoScale.reset(this.modeLevels.get(id) ?? 0);
    } catch (err) {
      if (token !== this.modeToken) return;
      if (viz && viz !== this.viz) {
        try {
          viz.dispose();
        } catch {
          // yarım kurulmuş mod
        }
      }
      throw err;
    }
  }

  start(): void {
    if (this.raf) return;
    this.lastT = performance.now();
    this.capAnchor = this.lastT;
    const tick = (t: number) => {
      this.raf = requestAnimationFrame(tick);
      const perf = this.opts.getPerf();
      if (perf.fpsCap > 0) {
        const interval = 1000 / perf.fpsCap;
        const since = t - this.capAnchor;
        // ~2 ms tolerans: tazeleme aralığı sınıra eşitse (60 Hz ekranda 60 sınırı) kare atlanmasın.
        if (since < interval - 2) return;
        const over = since - interval;
        this.capAnchor = over > 0 ? t - (over % interval) : t;
      }
      const realDt = (t - this.lastT) / 1000;
      this.lastT = t;
      const dt = Math.min(0.05, realDt);
      this.elapsed += dt;

      this.applyScale(perf, realDt);
      const frame = this.engine.getFrame(dt);
      if (this.viz && this.modeId && !(this.contextLost && this.kind === 'three')) {
        this.draw(this.viz, this.modeId, frame, dt);
      }
      this.opts.onFrame?.(frame, realDt);

      this.fpsCount++;
      this.fpsTimer += Math.min(1, realDt);
      if (this.fpsTimer >= 0.5) {
        this.opts.onFps?.(Math.round(this.fpsCount / this.fpsTimer), this.appliedScale);
        this.fpsCount = 0;
        this.fpsTimer = 0;
      }
    };
    this.raf = requestAnimationFrame(tick);
    this.prefetchThree();
  }

  private draw(viz: Visualizer, id: ModeId, frame: AudioFrame, dt: number): void {
    const s = this.opts.getSettings(id);
    setGlowQuality(s.glowQuality);
    frame.dt = dt * s.speed;
    try {
      viz.update(frame, s, this.cssW, this.cssH);
      if (this.kind === 'three' && this.three && !viz.manualRender) {
        const { renderer, scene, camera } = this.three;
        const p = frame.beatPulse;
        camera.position.x = Math.sin(this.elapsed * 43) * 0.3 * p;
        camera.position.y = Math.cos(this.elapsed * 31) * 0.3 * p;
        camera.lookAt(0, 0, -40);
        renderer.setClearColor(s.palette.bg);
        renderer.render(scene, camera);
      }
    } catch (err) {
      // Her karede aynı hatayı fırlatmasın: modu durdur, arayüze bildir.
      try {
        viz.dispose();
      } catch {
        // mod zaten bozuk
      }
      this.viz = null;
      this.modeId = null;
      this.opts.onModeError?.(id, err);
    }
  }

  /** Performans ayarına (veya otomatik ölçeğe) göre çizim çözünürlüğünü günceller. */
  private applyScale(perf: PerfSettings, realDt: number): void {
    let scale: number;
    if (perf.resolution === 'auto') {
      this.autoScale.tick(realDt, perf.fpsCap > 0 ? Math.min(60, perf.fpsCap) : 60);
      scale = this.autoScale.scale;
    } else {
      scale = FIXED_SCALE[perf.resolution];
    }
    if (scale === this.appliedScale) return;
    this.appliedScale = scale;
    setRenderScale(scale);
    this.resize();
  }

  /** İlk WebGL moduna geçerken beklenmesin diye three.js'i boşta önceden indirir. */
  private prefetchThree(): void {
    if (this.three || this.prefetched) return;
    this.prefetched = true;
    const load = () => void import('three').catch(() => {});
    if ('requestIdleCallback' in window) window.requestIdleCallback(load, { timeout: 5000 });
    else setTimeout(load, 3000);
  }

  private handleContextLost = (e: Event): void => {
    e.preventDefault(); // tarayıcı bağlamı geri verebilsin
    this.contextLost = true;
    this.opts.onContextLost?.();
  };

  private handleContextRestored = (): void => {
    this.contextLost = false;
    // three.js kendi GL durumunu bu olayda yeniden kurar; modun shader/doku/hedeflerini ondan sonra baştan oluştur.
    setTimeout(() => {
      const id = this.modeId;
      if (this.kind !== 'three' || !id) return;
      this.setMode(id).catch((err: unknown) => this.opts.onModeError?.(id, err));
    }, 0);
  };

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  dispose(): void {
    this.stop();
    this.observer.disconnect();
    this.canvasGL.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvasGL.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.viz?.dispose();
    this.viz = null;
    this.three?.renderer.dispose();
    this.three = null;
  }

  private resize(): void {
    const parent = this.canvas2d.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (!w || !h) return;
    const ratio = pixelRatio();

    this.cssW = w;
    this.cssH = h;
    const cw = Math.max(1, Math.round(w * ratio));
    const ch = Math.max(1, Math.round(h * ratio));
    if (this.canvas2d.width !== cw || this.canvas2d.height !== ch) {
      // Boyut değişimi tuvali temizler (şeffaf); iz bırakan modlarda boş kare görünmesin diye arka planla doldur.
      this.canvas2d.width = cw;
      this.canvas2d.height = ch;
      if (this.modeId) {
        this.ctx2d.fillStyle = this.opts.getSettings(this.modeId).palette.bg;
        this.ctx2d.fillRect(0, 0, cw, ch);
      }
    }
    this.ctx2d.setTransform(ratio, 0, 0, ratio, 0, 0);

    if (this.three) {
      this.three.renderer.setPixelRatio(ratio);
      this.three.renderer.setSize(w, h, false);
      this.three.camera.aspect = w / h;
      this.three.camera.updateProjectionMatrix();
    }

    this.viz?.resize(w, h);
  }
}
