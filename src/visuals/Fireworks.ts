import { rgba, sampleGradient } from './palettes';
import { EventScale, OnsetTracker } from './onset';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { TAU, damp, drawGlowDot, fadeTrail, setGlow } from './util';

/**
 * Havai Fişek: roketler yükselir, patlar. Eski sürümde patlama "rastgele hızlı toz yumağı"ydı ve roket başlangıcı ile patlama arasında
 * ~2 sn fark olduğundan patlama ritimle eşleşmiyordu (şiddet patlama anındaki ham bas/beat'ten, vuruştan yaklaşık 2 sn sonra).
 *  - VURUŞ = PATLAMA: güçlü vuruş (müziğin kendi ortalamasına göre) havada en yüksek uçan roketi o anda patlatır; vuruş yeni roket de fırlatır
 *    (bas vermeyen müzik için spektral onset de sayılır). Zirveye ulaşan roket vuruş beklemeden küçük patlar,
 *  - patlama şiddeti vuruş şiddetiyle: kıvılcım sayısı, hız, yükseklik, çakma; sessizde roket yok (yalnız çalan müzikte seyrek taban akışı),
 *  - patlama artık NET kabuk: dar hız dağılımı (şakayık), halka (eğik elips) veya söğüt (uzun ömürlü, aşağı süzülen); iki tonlu iç halka,
 *    kıvılcımlar hız yönünde kısa çizgi (nokta yumağı değil).
 * Kıvılcım ömrü/yerçekimi/büyüklük seçenekleri korunur.
 */

const GRAVITY = 320;
/** Roketler daha çabuk çıkar (uçuş ~1.4 sn), kıvılcım yerçekimi ayrı. */
const ROCKET_GRAVITY = 600;
const MAX_ROCKETS = 6;
const MAX_SPARKS = 1100;

type Shell = 0 | 1 | 2; // 0 şakayık, 1 halka, 2 söğüt

interface Rocket {
  x: number;
  y: number;
  vx: number;
  vy: number;
  colorT: number;
  wob: number;
  /** Fırlatıldığı andaki vuruş şiddeti (0..1). */
  pw: number;
  y0: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  colorT: number;
  drag: number;
  grav: number;
}

interface Flash {
  x: number;
  y: number;
  colorT: number;
  age: number;
  pw: number;
}

export class Fireworks implements Visualizer {
  private ctx: CanvasRenderingContext2D;
  private rockets: Rocket[] = [];
  private sparks: Spark[] = [];
  private flashes: Flash[] = [];
  private time = 0;
  private sLevel = 0;
  private onset = new OnsetTracker();
  private scale = new EventScale();

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  init(): void {}

  resize(): void {}

  dispose(): void {
    this.rockets = [];
    this.sparks = [];
    this.flashes = [];
  }

  private launch(w: number, h: number, pw: number): void {
    // Güçlü vuruş daha yükseğe çıkar
    const targetY = h * (0.4 - 0.28 * pw + Math.random() * 0.08);
    const vy = -Math.sqrt(2 * ROCKET_GRAVITY * (h - targetY));
    this.rockets.push({
      x: w * (0.12 + Math.random() * 0.76),
      y: h,
      y0: h,
      vx: (Math.random() - 0.5) * 60,
      vy,
      colorT: Math.random(),
      wob: Math.random() * TAU,
      pw,
    });
  }

  private explode(rocket: Rocket, pw: number, burst: number, life: number, px: number): void {
    const r = Math.random();
    const shell: Shell = r < 0.55 ? 0 : r < 0.8 ? 1 : 2;
    const count = Math.floor((70 + 110 * pw) * burst * (shell === 2 ? 0.7 : 1));
    const speed0 = (170 + 90 * pw) * px * Math.sqrt(burst);
    const tilt = 0.35 + Math.random() * 0.5;
    const rot = Math.random() * TAU;
    for (let i = 0; i < count; i++) {
      if (this.sparks.length >= MAX_SPARKS) break;
      const angle = Math.random() * TAU;
      let speed = speed0 * (0.9 + Math.random() * 0.2);
      let colorT = (rocket.colorT + (Math.random() - 0.5) * 0.08 + 1) % 1;
      let maxLife = (0.9 + Math.random() * 0.5) * life;
      let drag = 0.985;
      let grav = 0.36;
      let vx: number;
      let vy: number;
      if (shell === 0) {
        // Şakayık: dar hız dağılımlı küre kabuğu; %35 iç halka farklı ton
        const inner = Math.random() < 0.35;
        if (inner) {
          speed *= 0.5;
          colorT = (colorT + 0.35) % 1;
        }
        vx = Math.cos(angle) * speed;
        vy = Math.sin(angle) * speed;
      } else if (shell === 1) {
        // Halka: eğik elips
        const a = (i / count) * TAU;
        const ex = Math.cos(a) * speed;
        const ey = Math.sin(a) * speed * tilt;
        vx = ex * Math.cos(rot) - ey * Math.sin(rot);
        vy = ex * Math.sin(rot) + ey * Math.cos(rot);
      } else {
        // Söğüt: uzun ömürlü, aşağı süzülen, altın tonlu
        speed *= 0.75;
        maxLife *= 2.1;
        drag = 0.978;
        grav = 0.55;
        colorT = (rocket.colorT * 0.3 + 0.1) % 1;
        vx = Math.cos(angle) * speed;
        vy = Math.sin(angle) * speed;
      }
      this.sparks.push({
        x: rocket.x,
        y: rocket.y,
        vx: vx + rocket.vx * 0.3,
        vy: vy + rocket.vy * 0.15,
        life: 0,
        maxLife,
        colorT,
        drag,
        grav,
      });
    }
    this.flashes.push({ x: rocket.x, y: rocket.y, colorT: rocket.colorT, age: 0, pw });
  }

  update(frame: AudioFrame, s: VisualizerSettingsView, w: number, h: number): void {
    const ctx = this.ctx;
    const dt = Math.min(frame.dt, 0.05);
    fadeTrail(ctx, s, 0.16, w, h);
    const o = s.opt;
    const px = Math.max(0.8, Math.min(w, h) / 700);

    this.time += dt;
    this.sLevel += (frame.level - this.sLevel) * damp(dt, 1.5);
    this.scale.tick(dt);

    // Vuruş: spektral onset veya bas vuruşu; şiddet müziğin kendi ortalamasına göre
    const hit = this.onset.update(frame, dt, 2.0, 0.18) || frame.beat;
    if (hit) {
      const pw = this.scale.rel(0.6 * frame.bass + 0.4 * frame.level);
      // Güçlü vuruş: havadaki en yüksek (zirveye en yakın) roketi AN patlat
      if (pw > 0.5) {
        let best = -1;
        let bestUp = 0.35;
        for (let i = 0; i < this.rockets.length; i++) {
          const rk = this.rockets[i];
          const up = (rk.y0 - rk.y) / (rk.y0 * 0.7);
          if (up > bestUp) {
            bestUp = up;
            best = i;
          }
        }
        if (best >= 0) {
          this.explode(this.rockets[best], pw, o.burst, o.life, px);
          this.rockets.splice(best, 1);
        }
      }
      if (this.rockets.length < MAX_ROCKETS && Math.random() < Math.min(1, o.rate)) {
        this.launch(w, h, pw);
        if (pw > 0.5 && o.rate > 1 && Math.random() < o.rate - 1 && this.rockets.length < MAX_ROCKETS) this.launch(w, h, pw);
      }
    }
    // Müzik çalarken (sessizde değil) seyrek taban akışı: ritmi zayıf parçalarda da boş kalmaz
    const act = Math.min(1, Math.max(0, (this.sLevel - 0.03) / 0.08));
    if (act > 0 && this.rockets.length < MAX_ROCKETS && Math.random() < dt * 0.5 * o.rate * act) this.launch(w, h, 0.3);

    ctx.globalCompositeOperation = 'lighter';
    let rWrite = 0;
    for (let i = 0; i < this.rockets.length; i++) {
      const rocket = this.rockets[i];
      rocket.vy += ROCKET_GRAVITY * dt;
      rocket.x += (rocket.vx + Math.sin(this.time * 9 + rocket.wob) * 26) * dt;
      rocket.y += rocket.vy * dt;

      const color = sampleGradient(s.palette.colors, rocket.colorT);
      ctx.strokeStyle = rgba(color, 0.9);
      ctx.lineWidth = 2 * px;
      setGlow(ctx, s.glow, 12, rgba(color, 0.9));
      ctx.beginPath();
      ctx.moveTo(rocket.x - rocket.vx * 0.02, rocket.y - rocket.vy * 0.03);
      ctx.lineTo(rocket.x, rocket.y);
      ctx.stroke();

      if (rocket.vy >= -24) {
        // Zirveye ulaştı, vuruş gelmedi: küçük patlama
        this.explode(rocket, rocket.pw * 0.8, o.burst, o.life, px);
      } else {
        this.rockets[rWrite++] = rocket;
      }
    }
    this.rockets.length = rWrite;
    ctx.shadowBlur = 0;

    let sWrite = 0;
    ctx.lineCap = 'round';
    for (let i = 0; i < this.sparks.length; i++) {
      const spark = this.sparks[i];
      spark.life += dt;
      if (spark.life >= spark.maxLife) continue;
      const drag = Math.pow(spark.drag, dt * 60);
      spark.vy += GRAVITY * spark.grav * o.gravity * dt;
      spark.vx *= drag;
      spark.vy *= drag;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;

      const fade = 1 - spark.life / spark.maxLife;
      const twinkle = 0.65 + 0.35 * Math.sin(spark.life * 28 + i);
      const color = sampleGradient(s.palette.colors, spark.colorT);
      ctx.strokeStyle = rgba(color, fade * fade * twinkle);
      ctx.lineWidth = (0.9 + fade * 1.7) * px;
      ctx.beginPath();
      ctx.moveTo(spark.x - spark.vx * 0.03, spark.y - spark.vy * 0.03);
      ctx.lineTo(spark.x, spark.y);
      ctx.stroke();
      this.sparks[sWrite++] = spark;
    }
    this.sparks.length = sWrite;

    // Patlama çakması: vuruş şiddetiyle, kısa ömürlü yumuşak hale
    let fWrite = 0;
    for (let i = 0; i < this.flashes.length; i++) {
      const f = this.flashes[i];
      f.age += dt;
      if (f.age > 0.3) continue;
      const k = 1 - f.age / 0.3;
      drawGlowDot(ctx, sampleGradient(s.palette.colors, f.colorT), f.x, f.y, (60 + 90 * f.pw) * px * (1 + (1 - k) * 0.6), k * (0.5 + 0.4 * f.pw));
      this.flashes[fWrite++] = f;
    }
    this.flashes.length = fWrite;

    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0;
  }
}
