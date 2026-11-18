import { hexToRgb, rgba, sampleGradient } from './palettes';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: [number, number, number];
}

export class Particles implements Visualizer {
  readonly id = 'particles';
  readonly name = 'Parçacıklar';
  readonly renderer = 'canvas2d';

  private ctx: CanvasRenderingContext2D;
  private pool: Particle[] = [];
  private spawnAcc = 0;
  private primed = false;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  init(w: number, h: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    this.primed = true;
  }

  resize(w: number, h: number): void {
    if (!this.primed) {
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, w, h);
      this.primed = true;
    }
  }

  dispose(): void {
    this.pool = [];
    this.spawnAcc = 0;
    this.primed = false;
  }

  update(frame: AudioFrame, s: VisualizerSettingsView, w: number, h: number): void {
    const ctx = this.ctx;
    const bg = hexToRgb(s.palette.bg);
    const max = Math.max(20, Math.floor(s.particleCount));

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = rgba(bg, 0.22);
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;

    this.spawnAcc += frame.dt * (4 + frame.level * (max / 12));
    let toSpawn = Math.floor(this.spawnAcc);
    this.spawnAcc -= toSpawn;
    if (frame.beat) toSpawn += Math.floor(max / 10);

    if (this.pool.length < max * 1.4) {
      for (let i = 0; i < toSpawn; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = (40 + Math.random() * 220) * (1 + frame.bass * 1.2);
        this.pool.push({
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          maxLife: 0.8 + Math.random() * 1.4,
          size: 1.5 + Math.random() * 3 * (1 + frame.bass),
          color: sampleGradient(s.palette.colors, Math.random()),
        });
      }
    }

    ctx.globalCompositeOperation = 'lighter';
    const drag = Math.pow(0.985, frame.dt * 60);
    let write = 0;
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      p.life += frame.dt;
      if (p.life >= p.maxLife) continue;
      p.x += p.vx * frame.dt;
      p.y += p.vy * frame.dt;
      p.vx *= drag;
      p.vy *= drag;

      const alpha = 1 - p.life / p.maxLife;
      ctx.fillStyle = rgba(p.color, alpha * 0.9);
      if (s.glow) {
        ctx.shadowBlur = 10;
        ctx.shadowColor = rgba(p.color, alpha);
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.5 + alpha * 0.8), 0, Math.PI * 2);
      ctx.fill();

      this.pool[write++] = p;
    }
    this.pool.length = write;

    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0;
  }
}
