import { barValue, rgba, sampleGradient } from './palettes';
import { EventScale, OnsetTracker } from './onset';
import { TAU, damp, fadeTrail, lighten, setGlow } from './util';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';

/**
 * Audio Pong: spektrum çubukları üzerinde zıplayan toplar. Görünüm aynı; müzikle bağı artık doğrudan:
 *  - çubuklar yumuşatılmış (titremez); YÜKSELEN çubuk topu havaya fırlatır, zıplama gücü çarptığı çubuğun KENDİ enerjisinden gelir (rastgele değil),
 *  - sessizlikte toplar çubukların üstünde durur (yerçekimiyle zıplamaya devam etmez), müzik başlayınca çubuklar onları kaldırır,
 *  - vuruş (bas veya spektral onset) tepede, en güçlü çubuğun üstünden yeni top bırakır; vuruş şiddeti müziğin ortalamasına göredir,
 *  - toplar ömürlüdür: solarak kaybolur, yeni vuruşlar yenisini getirir (hep dolu kalıp vuruşla bağı kopmaz); son top silinmez,
 *  - top en son çarptığı çubuğun rengini alır.
 * Ritim yalnız zıplama yüksekliğini ve yeni top çıkışını etkiler; yerçekimi/hareket şekli sabit.
 */

const GRAVITY = 900;
const BALL_R = 5;
/** Bu hızın altındaki zıplama "durma" sayılır (top çubuğun üstünde dinlenir). */
const REST_V = 90;
const MAX_RISE = 450;

interface Ball {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  /** Son çarpılan çubuğun palet konumu (0..1). */
  t: number;
}

export class Pong implements Visualizer {
  private ctx: CanvasRenderingContext2D;
  private balls: Ball[] = [];
  private flashes: number[] = [];
  private sE: number[] = [];
  private heights: number[] = [];
  private prevH: number[] = [];
  private onset = new OnsetTracker();
  private scale = new EventScale();
  private sBeat = 0;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  init(): void {}

  resize(): void {}

  dispose(): void {
    this.balls = [];
    this.flashes = [];
    this.sE = [];
    this.heights = [];
    this.prevH = [];
  }

  private newBall(x: number, vx: number): Ball {
    return { x, y: 20, px: x, py: 20, vx, vy: 0, age: 0, life: 9 + Math.random() * 7, t: 0.4 };
  }

  update(frame: AudioFrame, s: VisualizerSettingsView, w: number, h: number): void {
    const ctx = this.ctx;
    const dt = Math.min(frame.dt, 0.05);
    fadeTrail(ctx, s, 0.35, w, h);
    const o = s.opt;
    const ballR = BALL_R * o.ballSize;

    const n = s.barCount;
    if (this.flashes.length !== n) {
      this.flashes = new Array(n).fill(0);
      this.sE = new Array(n).fill(0);
      this.heights = new Array(n).fill(2);
      this.prevH = new Array(n).fill(2);
    }
    const bw = w / n;
    this.sBeat += (frame.beatPulse - this.sBeat) * damp(dt, 5);

    // Yumuşatılmış çubuklar: hızlı yükselme, yavaş düşüş
    let loudest = 0;
    let loudestV = -1;
    for (let i = 0; i < n; i++) {
      const raw = barValue(frame.freq, i, n);
      this.sE[i] += (raw - this.sE[i]) * damp(dt, raw > this.sE[i] ? 16 : 6);
      if (this.sE[i] > loudestV) {
        loudestV = this.sE[i];
        loudest = i;
      }
      this.prevH[i] = this.heights[i];
      this.heights[i] = Math.max(2, this.sE[i] * h * 0.5);
    }

    for (let i = 0; i < n; i++) {
      const bh = this.heights[i];
      const color = sampleGradient(s.palette.colors, n > 1 ? i / (n - 1) : 0);
      ctx.fillStyle = rgba(color, 0.55 + this.sBeat * 0.15);
      ctx.fillRect(i * bw, h - bh, bw - 2, bh);
      this.flashes[i] = Math.max(0, this.flashes[i] - dt * 4);
      const edge = this.flashes[i];
      ctx.fillStyle = rgba(lighten(color, edge > 0 ? 0.7 : 0.3), 0.7 + edge * 0.3);
      ctx.fillRect(i * bw, h - bh, bw - 2, 2.5);
    }

    // Vuruş: bas vuruşu veya spektral onset; şiddet müziğin kendi ortalamasına göre
    this.scale.tick(dt);
    const hit = this.onset.update(frame, dt, 2.0, 0.35) || frame.beat;
    if (this.balls.length === 0) this.balls.push(this.newBall(w * (0.3 + Math.random() * 0.4), 160));
    if (hit && loudestV > 0.05) {
      const pw = this.scale.rel(0.6 * frame.bass + 0.4 * frame.level);
      if (this.balls.length < Math.round(o.balls)) {
        const x = (loudest + 0.5 + (Math.random() - 0.5) * 1.5) * bw;
        const dir = Math.random() < 0.5 ? -1 : 1;
        this.balls.push(this.newBall(Math.min(w - ballR, Math.max(ballR, x)), dir * (110 + 260 * pw)));
      }
    }
    if (this.balls.length > Math.round(o.balls)) this.balls.length = Math.round(o.balls);

    for (let bi = this.balls.length - 1; bi >= 0; bi--) {
      const ball = this.balls[bi];
      ball.age += dt;
      // Ömrü dolan top solarak çıkar (son top kalır)
      const fade = Math.min(1, ball.age / 0.3, (ball.life - ball.age) / 1.5);
      if (fade <= 0 && this.balls.length > 1) {
        this.balls.splice(bi, 1);
        continue;
      }
      const a = Math.max(0.05, fade);

      ball.px = ball.x;
      ball.py = ball.y;
      ball.vy += GRAVITY * o.gravity * dt;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      if (ball.x < ballR) {
        ball.x = ballR;
        ball.vx = Math.abs(ball.vx);
      }
      if (ball.x > w - ballR) {
        ball.x = w - ballR;
        ball.vx = -Math.abs(ball.vx);
      }
      if (ball.y < ballR) {
        ball.y = ballR;
        ball.vy = Math.abs(ball.vy);
      }

      const idx = Math.min(n - 1, Math.max(0, Math.floor(ball.x / bw)));
      const top = h - this.heights[idx] - 4;
      if (ball.y + ballR >= top && ball.vy >= 0) {
        // Çubuğun yükselme hızı topa eklenir; zıplama gücü çubuğun enerjisinden
        const rise = Math.min(MAX_RISE, Math.max(0, (this.heights[idx] - this.prevH[idx]) / Math.max(dt, 0.001)));
        const kick = 40 + 480 * this.sE[idx] * o.bounce + this.sBeat * 90 + rise * 0.55;
        if (kick < REST_V) {
          // Sessiz: top çubuğun üstünde durur, çubuk yükselirse yumuşakça taşınır
          ball.y = Math.max(top - ballR, ball.y - 1400 * dt);
          ball.vy = 0;
          ball.vx *= Math.pow(0.9, dt * 60);
        } else {
          ball.y = top - ballR;
          ball.vy = -kick;
          if (Math.abs(ball.vx) < 90) ball.vx = (ball.vx < 0 ? -1 : 1) * (90 + Math.random() * 60);
          ball.vx += (Math.random() - 0.5) * 50;
          ball.vx = Math.max(-420, Math.min(420, ball.vx));
          ball.t = n > 1 ? idx / (n - 1) : 0;
          this.flashes[idx] = 1;
        }
      }

      const bc = lighten(sampleGradient(s.palette.colors, ball.t), 0.55);
      
      ctx.strokeStyle = rgba(bc, 0.35 * a);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ball.px, ball.py);
      ctx.lineTo(ball.x, ball.y);
      ctx.stroke();
      ctx.fillStyle = rgba(bc, 0.95 * a);
      setGlow(ctx, s.glow, 12, rgba(bc, 0.9 * a));
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ballR, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}
