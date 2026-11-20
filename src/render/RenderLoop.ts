import type * as THREE from 'three';
import type { AudioEngine } from '../audio/AudioEngine';
import { createVisualizer, modeMeta } from '../visuals/registry';
import type { ModeId } from '../visuals/registry';
import { setGlowQuality } from '../visuals/util';
import type { RendererKind, Visualizer, VisualizerSettingsView } from '../visuals/types';

interface RenderLoopOptions {
  engine: AudioEngine;
  canvas2d: HTMLCanvasElement;
  canvasGL: HTMLCanvasElement;
  getSettings: (mode: ModeId) => VisualizerSettingsView;
  onFps?: (fps: number) => void;
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
  private getSettings: (mode: ModeId) => VisualizerSettingsView;
  private onFps?: (fps: number) => void;
  private observer: ResizeObserver;
  private raf = 0;
  private lastT = 0;
  private elapsed = 0;
  private cssW = 1;
  private cssH = 1;
  private fpsCount = 0;
  private fpsTimer = 0;
  private modeToken = 0;

  constructor(opts: RenderLoopOptions) {
    this.engine = opts.engine;
    this.canvas2d = opts.canvas2d;
    this.canvasGL = opts.canvasGL;
    this.getSettings = opts.getSettings;
    this.onFps = opts.onFps;

    const ctx = this.canvas2d.getContext('2d');
    if (!ctx) throw new Error('2D canvas context alınamadı');
    this.ctx2d = ctx;

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

  async setMode(id: ModeId): Promise<void> {
    const token = ++this.modeToken;
    const kind = modeMeta(id).renderer;
    if (kind === 'three' && !this.three) await this.createThree();
    if (token !== this.modeToken) return;

    this.viz?.dispose();
    this.viz = null;
    const viz = await createVisualizer(id, {
      ctx2d: this.ctx2d,
      scene: this.three?.scene ?? null,
      renderer: this.three?.renderer ?? null,
    });
    if (token !== this.modeToken) {
      viz.dispose();
      return;
    }
    this.viz = viz;
    this.kind = kind;
    this.modeId = id;

    const isThree = kind === 'three';
    this.canvasGL.style.display = isThree ? 'block' : 'none';
    this.canvas2d.style.display = isThree ? 'none' : 'block';
    this.ctx2d.shadowBlur = 0;
    this.ctx2d.globalAlpha = 1;
    this.ctx2d.globalCompositeOperation = 'source-over';
    this.ctx2d.fillStyle = this.getSettings(id).palette.bg;
    this.ctx2d.fillRect(0, 0, this.cssW, this.cssH);
    viz.init(this.cssW, this.cssH);
  }

  start(): void {
    if (this.raf) return;
    this.lastT = performance.now();
    const tick = (t: number) => {
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (t - this.lastT) / 1000);
      this.lastT = t;
      this.elapsed += dt;

      if (this.viz && this.modeId) {
        const s = this.getSettings(this.modeId);
        setGlowQuality(s.glowQuality);
        const frame = this.engine.getFrame(dt);
        frame.dt = dt * s.speed;
        this.viz.update(frame, s, this.cssW, this.cssH);

        if (this.kind === 'three' && this.three && !this.viz.manualRender) {
          const { renderer, scene, camera } = this.three;
          const p = frame.beatPulse;
          camera.position.x = Math.sin(this.elapsed * 43) * 0.3 * p;
          camera.position.y = Math.cos(this.elapsed * 31) * 0.3 * p;
          camera.lookAt(0, 0, -40);
          renderer.setClearColor(s.palette.bg);
          renderer.render(scene, camera);
        }
      }

      this.fpsCount++;
      this.fpsTimer += dt;
      if (this.fpsTimer >= 0.5) {
        this.onFps?.(Math.round(this.fpsCount / this.fpsTimer));
        this.fpsCount = 0;
        this.fpsTimer = 0;
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  dispose(): void {
    this.stop();
    this.observer.disconnect();
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
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    this.cssW = w;
    this.cssH = h;
    this.canvas2d.width = Math.round(w * dpr);
    this.canvas2d.height = Math.round(h * dpr);
    this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (this.three) {
      this.three.renderer.setPixelRatio(dpr);
      this.three.renderer.setSize(w, h, false);
      this.three.camera.aspect = w / h;
      this.three.camera.updateProjectionMatrix();
    }

    this.viz?.resize(w, h);
  }
}
