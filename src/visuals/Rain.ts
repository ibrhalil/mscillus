import { binAtLerp, rgba, sampleGradient } from './palettes';
import { EventScale, OnsetTracker } from './onset';
import { TAU, damp, fadeTrail, lighten } from './util';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';

/**
 * Yağmur: derinlikli yağış + zemin düzlemi. Eski sürümde damla sayısı ham `level` ile (damlalar ani belirip kayboluyordu), yağış eğimi ham
 * `mid` ile (yağmurun yönü ritimle değişiyordu) ve vuruşta tüm ekran çakıyordu (titreme).
 *  - DERİNLİK: her damla z (0 uzak..1 yakın): yakın damla uzun/kalın/hızlı/parlak; uzak damla zeminin daha yukarısında (ufka yakın) düşüp
 *    sıçrar → zemin perspektifi,
 *  - yoğunluk YAVAŞ süzülmüş seviyeyle ve damla başına yumuşak belirme (yok-ve-var sıçraması yok); eğim yalnız yavaş "rüzgâr" salınımı
 *    + çok yavaş süzülmüş orta frekans; hareket yönü ritimle değişmez,
 *  - ritim yalnız parlaklık/sıçrama: damla x konumundaki frekans sütunuyla parlar; vuruşta (bas veya spektral onset; şiddet müziğin kendi
 *    ortalamasına göre) zeminde, güçlü frekansların altında sıçrama halkaları patlar,
 *  - YAĞIŞ HIZI ritimle artar: süzülmüş seviye + vuruş dalgası (yumuşak ivmelenme; ani sıçrama yok),
 *  - GERÇEKÇİLİK: damla = sönük uzun kuyruk + parlak baş (hareket bulanıklığı), sıçramada küçük sekme damlacıkları, zeminde hafif sis,
 *  - ŞİMŞEK opsiyonel (varsayılan kapalı): güçlü vuruşta dallı şimşek + çift çakma + gökten ışıma.
 */

const MAX_DROPS = 640;
const MAX_SPLASH = 150;
const COLS = 32;
const ZB = 3;
const AB = 4;
/** Uzak damlanın zemin yüksekliği: h·(1 − HORIZON·(1 − z)). */
const HORIZON = 0.16;
const MAX_DROPLETS = 240;
const BOLT_COOLDOWN = 1.4;

interface Drop {
  x: number;
  y: number;
  z: number;
  len: number;
  speed: number;
  /** Bu çizim karesindeki kova (derinlik × alfa) ve çizim uzunluğu. */
  zb: number;
  ab: number;
  dx: number;
  dy: number;
}

interface Droplet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

interface Bolt {
  /** Ana yol ve dallar: [x0,y0,x1,y1,...] dizileri. */
  paths: number[][];
  age: number;
  pw: number;
}

interface Splash {
  x: number;
  y: number;
  r: number;
  alpha: number;
  z: number;
}

const groundY = (h: number, z: number): number => h * (1 - HORIZON * (1 - z)) - 2;

export class Rain implements Visualizer {
  private ctx: CanvasRenderingContext2D;
  private drops: Drop[] = [];
  private splashes: Splash[] = [];
  private flash = 0;
  private time = 0;
  private droplets: Droplet[] = [];
  private bolts: Bolt[] = [];
  private boltCool = 0;
  private rainSpeed = 1;
  private beatEnv = 0;
  private sLevel = 0;
  private sMid = 0;
  private cols = new Float32Array(COLS);
  private onset = new OnsetTracker();
  private scale = new EventScale();

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  init(): void {}

  resize(): void {}

  dispose(): void {
    this.drops = [];
    this.splashes = [];
    this.droplets = [];
    this.bolts = [];
  }

  /** Orta nokta kaydırmalı şimşek yolu: uçlar arasında rastgele kırılan çizgi. */
  private bolt(x0: number, y0: number, x1: number, y1: number, jag: number): number[] {
    let pts = [x0, y0, x1, y1];
    for (let lv = 0; lv < 6; lv++) {
      const next: number[] = [pts[0], pts[1]];
      for (let i = 0; i < pts.length - 2; i += 2) {
        const ax = pts[i];
        const ay = pts[i + 1];
        const bx = pts[i + 2];
        const by = pts[i + 3];
        const k = jag / Math.pow(1.7, lv);
        next.push((ax + bx) / 2 + (Math.random() - 0.5) * k, (ay + by) / 2 + (Math.random() - 0.5) * k * 0.3, bx, by);
      }
      pts = next;
    }
    return pts;
  }

  private spawnBolt(w: number, h: number, pw: number): void {
    const x0 = w * (0.15 + Math.random() * 0.7);
    const x1 = x0 + (Math.random() - 0.5) * w * 0.25;
    const yEnd = h * (0.78 + Math.random() * 0.1);
    const main = this.bolt(x0, -5, x1, yEnd, w * 0.16);
    const paths = [main];
    const nb = 1 + Math.floor(Math.random() * 3);
    for (let b = 0; b < nb; b++) {
      const idx = 2 * Math.floor((0.2 + Math.random() * 0.5) * (main.length / 2));
      const sx = main[idx];
      const sy = main[idx + 1];
      paths.push(this.bolt(sx, sy, sx + (Math.random() - 0.5) * w * 0.28, sy + h * (0.12 + Math.random() * 0.2), w * 0.08));
    }
    this.bolts.push({ paths, age: 0, pw });
    if (this.bolts.length > 2) this.bolts.shift();
  }

  private spawnDrop(w: number, h: number): Drop {
    const z = Math.pow(Math.random(), 1.3);
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      z,
      len: 8 + Math.random() * 14,
      speed: 520 + 560 * z + Math.random() * 120,
      zb: 0,
      ab: 0,
      dx: 0,
      dy: 0,
    };
  }

  update(frame: AudioFrame, s: VisualizerSettingsView, w: number, h: number): void {
    const ctx = this.ctx;
    const dt = Math.min(frame.dt, 0.05);
    fadeTrail(ctx, s, 0.4, w, h);
    const o = s.opt;
    const lenMul = o.length;
    const px = Math.max(0.8, Math.min(w, h) / 700);
    this.time += dt;

    // Yumuşatılmış ses
    this.sLevel += (frame.level - this.sLevel) * damp(dt, 0.8);
    this.sMid += (frame.mid - this.sMid) * damp(dt, 0.6);
    for (let i = 0; i < COLS; i++) {
      const raw = binAtLerp(frame.freq, i / (COLS - 1));
      this.cols[i] += (raw - this.cols[i]) * damp(dt, raw > this.cols[i] ? 12 : 4);
    }

    // Yağış hızı ritimle: süzülmüş seviye + vuruş dalgası (yumuşak ivmelenme)
    this.beatEnv = Math.max(0, this.beatEnv - dt * 1.6);
    const speedTarget = 0.85 + 0.5 * Math.min(1, this.sLevel * 2) + 0.55 * this.beatEnv;
    this.rainSpeed += (speedTarget - this.rainSpeed) * damp(dt, 3);

    while (this.drops.length < MAX_DROPS) this.drops.push(this.spawnDrop(w, h));
    // Damla sayısı havuzun ilk N'i; kenarlarda 12 damlalık yumuşak geçiş (ani belirme/kaybolma yok)
    const count = Math.min(MAX_DROPS, (90 + Math.min(1, this.sLevel * 2) * 360) * o.density);
    // Eğim: yavaş rüzgâr salınımı + çok yavaş orta frekans (yön ritimle sıçramaz)
    const slant = (0.14 + 0.07 * Math.sin(this.time * 0.17) + this.sMid * 0.12) * o.slant;
    const accent = sampleGradient(s.palette.colors, 0.5);
    const dropColor = lighten(accent, 0.55);

    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      const v = d.speed * this.rainSpeed;
      d.y += v * dt;
      d.x += v * slant * dt;
      if (d.y > groundY(h, d.z)) {
        if (i < count && d.z > 0.3 && o.splash >= 0.5 && this.splashes.length < MAX_SPLASH && Math.random() < 0.6) {
          this.splashes.push({ x: d.x, y: groundY(h, d.z), r: 1, alpha: 0.35 + 0.25 * d.z, z: d.z });
          if (d.z > 0.55 && this.droplets.length < MAX_DROPLETS - 3 && Math.random() < 0.55) {
            for (let n = 0; n < 3; n++) {
              this.droplets.push({
                x: d.x,
                y: groundY(h, d.z),
                vx: (Math.random() - 0.5) * 110 * px,
                vy: -(70 + Math.random() * 110) * px * (0.6 + 0.4 * d.z),
                life: 0.28 + Math.random() * 0.2,
              });
            }
          }
        }
        d.y = -d.len * lenMul * px - Math.random() * 60;
        d.x = Math.random() * w;
      }
      if (d.x > w + 10) d.x = -8;
      const vis = Math.min(1, Math.max(0, (count - i) / 12));
      const col = this.cols[Math.min(COLS - 1, Math.max(0, Math.floor((d.x / w) * COLS)))];
      const alpha = vis * (0.18 + 0.32 * d.z) * (0.75 + col * 1.1);
      d.zb = Math.min(ZB - 1, Math.floor(d.z * ZB));
      d.ab = alpha <= 0.02 ? -1 : Math.min(AB - 1, Math.floor(alpha / 0.25));
      const len = d.len * (0.5 + d.z) * lenMul * px;
      d.dx = len * slant;
      d.dy = len;
    }

    // Zeminde hafif sis (ufuk çizgisine yakın, uzak damlaların battığı yer)
    const hy = h * (1 - HORIZON - 0.06);
    const haze = ctx.createLinearGradient(0, hy, 0, h);
    haze.addColorStop(0, rgba(accent, 0));
    haze.addColorStop(0.45, rgba(accent, 0.05 + 0.04 * Math.min(1, this.sLevel * 2)));
    haze.addColorStop(1, rgba(accent, 0.02));
    ctx.fillStyle = haze;
    ctx.fillRect(0, hy, w, h - hy);

    // Kova başına tek çizim (derinlik × alfa): ~420 ayrı stroke yerine 12
    ctx.lineCap = 'round';
    for (let zb = 0; zb < ZB; zb++) {
      for (let ab = 0; ab < AB; ab++) {
        ctx.beginPath();
        let any = false;
        for (const d of this.drops) {
          if (d.zb !== zb || d.ab !== ab) continue;
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x - d.dx, d.y - d.dy);
          any = true;
        }
        if (!any) continue;
        // Sönük uzun kuyruk, ardından yalnız baş kısmı parlak (hareket bulanıklığı)
        const a0 = (ab + 0.5) * 0.25;
        ctx.strokeStyle = rgba(dropColor, a0 * 0.55);
        ctx.lineWidth = (0.6 + 0.45 * zb) * px;
        ctx.stroke();
        ctx.beginPath();
        for (const d of this.drops) {
          if (d.zb !== zb || d.ab !== ab) continue;
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x - d.dx * 0.35, d.y - d.dy * 0.35);
        }
        ctx.strokeStyle = rgba(lighten(dropColor, 0.3), Math.min(1, a0 * 1.25));
        ctx.lineWidth = (0.8 + 0.6 * zb) * px;
        ctx.stroke();
      }
    }

    // Vuruş: zeminde güçlü frekansların altında sıçrama halkaları
    this.scale.tick(dt);
    if (this.onset.update(frame, dt, 2.0, 0.3) || frame.beat) {
      const pw = this.scale.rel(0.6 * frame.bass + 0.4 * frame.level);
      if (o.splash >= 0.5) {
        const k = Math.round(4 + 14 * pw);
        for (let n = 0; n < k && this.splashes.length < MAX_SPLASH + 40; n++) {
          // 3 adaydan en enerjili sütun
          let best = 0;
          let bestV = -1;
          for (let c = 0; c < 3; c++) {
            const ci = Math.floor(Math.random() * COLS);
            if (this.cols[ci] > bestV) {
              bestV = this.cols[ci];
              best = ci;
            }
          }
          const z = 0.3 + Math.random() * 0.7;
          this.splashes.push({ x: ((best + Math.random()) / COLS) * w, y: groundY(h, z), r: 1, alpha: 0.45 + 0.4 * pw, z });
        }
      }
      this.beatEnv = Math.max(this.beatEnv, 0.4 + 0.6 * pw);
      if (o.lightning >= 0.5 && pw > 0.7 && this.boltCool <= 0) {
        this.spawnBolt(w, h, pw);
        this.flash = 0.6 + 0.4 * pw;
        this.boltCool = BOLT_COOLDOWN;
      }
    }
    this.boltCool -= dt;

    let write = 0;
    for (let i = 0; i < this.splashes.length; i++) {
      const sp = this.splashes[i];
      sp.r += 90 * (0.5 + 0.5 * sp.z) * px * dt;
      sp.alpha -= 2.4 * dt;
      if (sp.alpha <= 0) continue;
      ctx.strokeStyle = rgba(accent, sp.alpha);
      ctx.lineWidth = Math.max(1, px * (0.6 + 0.8 * sp.z));
      ctx.beginPath();
      ctx.ellipse(sp.x, sp.y, sp.r, sp.r * 0.3, 0, Math.PI, TAU);
      ctx.stroke();
      this.splashes[write++] = sp;
    }
    this.splashes.length = write;

    // Sıçrama damlacıkları (balistik)
    let dw = 0;
    ctx.fillStyle = rgba(dropColor, 0.55);
    for (let i = 0; i < this.droplets.length; i++) {
      const dp = this.droplets[i];
      dp.life -= dt;
      if (dp.life <= 0) continue;
      dp.vy += 700 * px * dt;
      dp.x += dp.vx * dt;
      dp.y += dp.vy * dt;
      ctx.globalAlpha = Math.min(1, dp.life * 4);
      ctx.fillRect(dp.x, dp.y, Math.max(1, px * 1.2), Math.max(1, px * 1.2));
      this.droplets[dw++] = dp;
    }
    ctx.globalAlpha = 1;
    this.droplets.length = dw;

    // Şimşek (opsiyonel): dallı yol, çift çakma, parlak çekirdek + sönük hale
    let bw = 0;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    for (let i = 0; i < this.bolts.length; i++) {
      const bt = this.bolts[i];
      bt.age += dt;
      if (bt.age > 0.4) continue;
      const strike = bt.age < 0.09 ? 1 : bt.age < 0.17 ? 0.3 : 0.85;
      const a = strike * Math.pow(1 - bt.age / 0.4, 1.5) * (0.6 + 0.4 * bt.pw);
      for (let pi = 0; pi < bt.paths.length; pi++) {
        const pts = bt.paths[pi];
        const k = pi === 0 ? 1 : 0.55;
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (let q = 2; q < pts.length; q += 2) ctx.lineTo(pts[q], pts[q + 1]);
        ctx.strokeStyle = rgba(accent, a * 0.18 * k);
        ctx.lineWidth = 9 * px * k;
        ctx.stroke();
        ctx.strokeStyle = rgba(lighten(accent, 0.75), a * 0.55 * k);
        ctx.lineWidth = 3 * px * k;
        ctx.stroke();
        ctx.strokeStyle = rgba([255, 255, 255], a * k);
        ctx.lineWidth = 1.3 * px * k;
        ctx.stroke();
      }
      this.bolts[bw++] = bt;
    }
    this.bolts.length = bw;
    ctx.globalCompositeOperation = 'source-over';

    // Gökten inen yumuşak ışıma (yalnız şimşekle)
    this.flash = Math.max(0, this.flash - dt * 3.2);
    if (this.flash > 0.01) {
      const g = ctx.createLinearGradient(0, 0, 0, h * 0.8);
      g.addColorStop(0, rgba(lighten(accent, 0.7), this.flash * 0.3));
      g.addColorStop(1, rgba(lighten(accent, 0.7), 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h * 0.8);
    }
  }
}
