import { binAtLerp, rgba, sampleGradient } from './palettes';
import { EventScale, OnsetTracker } from './onset';
import { damp, fadeTrail, lighten } from './util';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';

/**
 * Şimşek (yıldırım): yüksek hızlı kamera çekimlerindeki gibi YAVAŞ ÇEKİM oluşum. Bulut yok; yıldırım ekranın en tepesinden başlar.
 *  1) ÖNCÜ ÇİZGİ (stepped leader): sönük ince bir kanal yukarıdan aşağı SIÇRAMALARLA ilerler (adım–duraksama–adım); ucu en parlak, arkası soluk
 *     bir iz bırakır. İlerledikçe yan dallar (alt dallar dahil) kendi kendine büyür; kimi dallar yarıda söner. Varsayılanda bir yıldırım ~0.9 sn'de iner ("Yavaş Çekim" ayarı 0.6; 1 → ~1.5 sn, 2.5 → ~3.5 sn).
 *  2) DÖNÜŞ ÇAKMASI (return stroke): öncü yere değdiği an tüm kanal zeminden yukarı doğru, bir parlaklık cephesi tırmanarak AYDINLANIR;
 *     dallar kavşaklarından dışa doğru parlar.
 *  3) SÖNÜM: kanal yavaşça söner; 1-2 kez yeniden parlar (sürekli akım titreşimi), dallar ana kanaldan önce söner.
 *  İLK TEMAS ANI: ana kanalın ucu bir yere değdiği an (yer olmak zorunda değil: kısa ve uzun yıldırımlar, bitiş yüksekliği rastgele, güçlü olaylar daha uzun)
 *  TÜM DAL İLERLEMELERİ KESİLİR — o ana kadar büyümüş kısımlar kalır, kalanlar hiç belirmez; dönüş çakması temas noktasından yukarı tırmanır.
 * Müzik: öncü çizgiler vuruşlarla ve çalan müzikte seyrek taban olasılığıyla yeni doğar; GÜÇLÜ vuruş (müziğin kendi ortalamasına göre) inmekte olan
 * öncüyü anında yere ulaştırır → dönüş çakması vuruşla aynı ana düşer. Konum en enerjili frekans sütunu (sol bas, sağ tiz). Sessizde yeni yıldırım yok.
 */

const COLS = 32;
const MAX_BOLTS = 3;
const CH = 4;
const RETURN_T = 0.16;
const RUSH = 9;

interface Path {
  pts: number[];
  /** Noktanın öncü çizgi ile ulaşılma zamanı (yıldırım saati). */
  tg: number[];
  /** Dönüş çakmasının noktayı aydınlattığı zaman (öncü yere değmezse Infinity). */
  lt: number[];
  /** Parlaklık çarpanı (ana kanal 1, dallar daha az) ve sönüm hızı çarpanı. */
  k: number;
  decayMul: number;
  /** Başlangıç → uç genişlik oranı. */
  taper: [number, number];
}

interface Bolt {
  paths: Path[];
  clock: number;
  /** Ana kanalın yere (veya bitiş noktasına) ulaştığı an. */
  tl: number;
  /** Dönüş çakmasının temas noktasından tepeye tırmanma süresi (kısa yıldırımda kısa). */
  rt: number;
  pw: number;
  tau: number;
  restrikes: number[];
  rush: boolean;
  endY: number;
}

function displace(x0: number, y0: number, x1: number, y1: number, iterations: number): number[] {
  let pts = [x0, y0, x1, y1];
  let offset = Math.hypot(x1 - x0, y1 - y0) * 0.16;
  for (let it = 0; it < iterations; it++) {
    const next: number[] = [pts[0], pts[1]];
    for (let i = 2; i < pts.length; i += 2) {
      const ax = pts[i - 2];
      const ay = pts[i - 1];
      const bx = pts[i];
      const by = pts[i + 1];
      const d = Math.hypot(bx - ax, by - ay) || 1;
      const mx = (ax + bx) / 2 - ((by - ay) / d) * (Math.random() - 0.5) * 2 * offset;
      const my = (ay + by) / 2 + ((bx - ax) / d) * (Math.random() - 0.5) * 2 * offset;
      next.push(mx, my, bx, by);
    }
    pts = next;
    offset *= 0.52;
  }
  return pts;
}

/** Sıçramalı ilerleme: 2-6 noktalık adımlar, adım başına kısa atılım + duraksama. t0'dan başlar, toplam süre dönen `end`'dir. */
function stepTimes(n: number, t0: number, speed: number): { tg: number[]; end: number } {
  const tg: number[] = new Array(n);
  let t = t0;
  let i = 0;
  while (i < n) {
    const len = 2 + Math.floor(Math.random() * 5);
    const dtStep = (0.05 + Math.random() * 0.07) * speed;
    for (let j = 0; j < len && i < n; j++, i++) tg[i] = t + dtStep * 0.25 * (j / len);
    t += dtStep;
  }
  return { tg, end: t };
}

const pulse = (t: number, c: number, wd: number): number => Math.exp(-(((t - c) / wd) ** 2));

export class Lightning implements Visualizer {
  private ctx: CanvasRenderingContext2D;
  private bolts: Bolt[] = [];
  private cols = new Float32Array(COLS);
  private sLevel = 0;
  private cool = 0;
  private flash = 0;
  private onset = new OnsetTracker();
  private scale = new EventScale();

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  init(): void {}

  resize(): void {}

  dispose(): void {
    this.bolts = [];
  }

  private pickX(w: number): number {
    let best = Math.floor(Math.random() * COLS);
    let bestV = this.cols[best];
    for (let c = 0; c < 2; c++) {
      const ci = Math.floor(Math.random() * COLS);
      if (this.cols[ci] > bestV) {
        bestV = this.cols[ci];
        best = ci;
      }
    }
    return w * Math.min(0.92, Math.max(0.08, (best + Math.random()) / COLS));
  }

  /** Yeni yıldırım ağacı: ana kanal tepeden başlar; dallar ana kanalın ilerlemesiyle birlikte (kavşak zamanından) büyür. */
  private spawn(w: number, h: number, pw: number): void {
    const x0 = this.pickX(w);
    // Temas yüksekliği: kısa ve uzun yıldırımlar; güçlü olay daha uzuna eğilimli
    const reach = Math.min(1, 0.7 * Math.random() + 0.3 * pw);
    const endY = h * (0.22 + 0.74 * reach);
    const len01 = endY / h;
    const x1 = x0 + (Math.random() - 0.5) * w * 0.28 * (0.4 + 0.6 * len01);
    const mainPts = displace(x0, -4, x1, endY, 6);
    const n = mainPts.length / 2;
    // Kısa yıldırım daha çabuk iner (iniş hızı uzunlukla orantılı)
    const m = stepTimes(n, 0, 0.35 + 0.65 * len01);
    const tl = m.tg[n - 1] + 0.05;
    const rt = RETURN_T * (0.4 + 0.6 * len01);
    const lt = (y: number): number => tl + (Math.max(0, endY - y) / endY) * rt;
    const main: Path = {
      pts: mainPts,
      tg: m.tg,
      lt: Array.from({ length: n }, (_, i) => lt(mainPts[i * 2 + 1])),
      k: 1,
      decayMul: 1,
      taper: [1, 0.45],
    };
    const paths: Path[] = [main];

    const addBranch = (parent: Path, idx: number, ang: number, len: number, iters: number, k: number, decayMul: number, lifeFrac: number): Path => {
      const sx = parent.pts[idx * 2];
      const sy = parent.pts[idx * 2 + 1];
      const pts = displace(sx, sy, sx + Math.cos(ang) * len, sy + Math.sin(ang) * len, iters);
      const bn = pts.length / 2;
      const t0 = parent.tg[idx] + 0.02;
      const st = stepTimes(bn, t0, 1.1);
      // Dallar kendi hızında büyür; ilk temas anında (tl) ilerlemeleri KESİLİR (belirme koşulu `tg <= min(saat, tl)`)
      const tg = st.tg;
      const litBase = parent.lt[idx];
      const keep = Math.max(3, Math.round(bn * lifeFrac));
      const p: Path = {
        pts: pts.slice(0, keep * 2),
        tg: tg.slice(0, keep),
        lt: Array.from({ length: keep }, (_, j) => litBase + 0.012 * j),
        k,
        decayMul,
        taper: [0.7, 0.3],
      };
      paths.push(p);
      return p;
    };

    const nb = 2 + Math.round(5 * pw);
    for (let b = 0; b < nb; b++) {
      const idx = 6 + Math.floor(Math.random() * Math.max(1, n - 12));
      const side = Math.random() < 0.5 ? -1 : 1;
      const ang = Math.PI / 2 + side * (0.35 + Math.random() * 0.8);
      const sy0 = main.pts[idx * 2 + 1];
      // Dal temas noktasının altına sarkmasın
      const len = Math.min(
        h * (0.07 + Math.random() * 0.2) * (0.6 + 0.7 * pw) * (0.4 + 0.6 * len01),
        (endY - sy0) / Math.max(0.3, Math.sin(ang)),
      );
      const br = addBranch(main, idx, ang, len, 4, 0.55, 0.7, Math.random() < 0.3 ? 0.55 : 1);
      // Alt dal
      if (pw > 0.45 && Math.random() < 0.55) {
        const bi = 4 + Math.floor(Math.random() * Math.max(1, br.pts.length / 2 - 7));
        const a2 = ang + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.7);
        addBranch(br, Math.min(bi, br.pts.length / 2 - 1), a2, len * 0.5, 3, 0.4, 0.55, 1);
      }
    }
    // Güçlüde alta doğru ikinci ana kol (çatallanan gövde)
    if (pw > 0.55) {
      const idx = Math.floor(n * (0.45 + Math.random() * 0.2));
      const side = Math.random() < 0.5 ? -1 : 1;
      addBranch(main, idx, Math.PI / 2 + side * 0.35, (endY - main.pts[idx * 2 + 1]) * 0.9, 5, 0.75, 0.85, 1);
    }

    const tau = 0.38 * (0.7 + 0.8 * pw);
    const restrikes: number[] = [];
    const nr = pw > 0.6 ? 2 : 1;
    for (let r = 0; r < nr; r++) restrikes.push(tl + rt + 0.2 + Math.random() * 0.5 + r * 0.25);
    this.bolts.push({ paths, clock: 0, tl, rt, pw, tau, restrikes, rush: false, endY });
    if (this.bolts.length > MAX_BOLTS) this.bolts.shift();
  }

  update(frame: AudioFrame, s: VisualizerSettingsView, w: number, h: number): void {
    const ctx = this.ctx;
    const dt = Math.min(frame.dt, 0.05);
    fadeTrail(ctx, s, 0.3, w, h);
    const o = s.opt;
    const px = Math.max(0.8, Math.min(w, h) / 700);
    const slowK = 1 / Math.max(0.15, o.slow);

    this.sLevel += (frame.level - this.sLevel) * damp(dt, 1.5);
    for (let i = 0; i < COLS; i++) {
      const raw = binAtLerp(frame.freq, i / (COLS - 1));
      this.cols[i] += (raw - this.cols[i]) * damp(dt, raw > this.cols[i] ? 12 : 4);
    }

    // Tetik: vuruş/onset → yeni öncü çizgi; güçlü vuruş → inmekte olan öncüyü yere ulaştırır (dönüş çakması vuruşla aynı an)
    this.scale.tick(dt);
    this.cool -= dt;
    const hit = this.onset.update(frame, dt, 2.0, 0.25) || frame.beat;
    const e = 0.6 * frame.bass + 0.4 * frame.level;
    const growing = (): number => this.bolts.filter((b) => b.clock < b.tl).length;
    if (hit) {
      const pw = this.scale.rel(e);
      if (pw > 0.55) {
        let best: Bolt | null = null;
        for (const b of this.bolts) {
          if (!b.rush && b.clock < b.tl && b.clock / b.tl > 0.3 && (!best || b.clock > best.clock)) best = b;
        }
        if (best) best.rush = true;
      }
      if (this.cool <= 0 && growing() < 2 && Math.random() < Math.min(1, o.rate)) {
        this.spawn(w, h, pw);
        this.cool = 0.5;
      }
    } else if (this.cool <= 0 && growing() < 1 && this.sLevel > 0.06 && Math.random() < dt * 0.3 * o.rate) {
      // Ritmi zayıf parçalarda seyrek taban: yavaşça inen bir öncü
      this.spawn(w, h, 0.35 + Math.random() * 0.3);
      this.cool = 0.5;
    }

    const accent = sampleGradient(s.palette.colors, 0.15);
    const core = lighten(accent, 0.75);

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    let write = 0;
    let skyFlash = 0;
    for (let bi = 0; bi < this.bolts.length; bi++) {
      const bolt = this.bolts[bi];
      const prev = bolt.clock;
      bolt.clock += dt * slowK * (bolt.rush && bolt.clock < bolt.tl ? RUSH : 1);
      // Hızlandırma öncü ucunu tam yere değdiği ana oturtur (dönüş çakması o karede başlar)
      if (bolt.rush && prev < bolt.tl && bolt.clock > bolt.tl) bolt.clock = bolt.tl;
      const c = bolt.clock;
      const endT = bolt.tl + bolt.rt + 6 * bolt.tau + 0.4;
      if (c > endT) continue;

      const pwK = 0.55 + 0.45 * bolt.pw;
      const widthBase = o.thickness * px * (0.6 + 0.6 * bolt.pw);
      const leaderFade = Math.exp(-Math.max(0, c - bolt.tl) / 0.6);
      // İlk temastan sonra hiçbir yeni nokta belirmez
      const reveal = Math.min(c, bolt.tl);

      for (const path of bolt.paths) {
        const n = path.pts.length / 2;
        let r = 0;
        while (r < n && path.tg[r] <= reveal) r++;
        if (r < 2) continue;
        for (let st = 0; st < r - 1; st += CH) {
          const en = Math.min(r - 1, st + CH);
          // Parlaklık: öncü (uç en parlak, arkası soluk iz) ve dönüş çakması + sönüm + yeniden parlamalar
          const age = c - path.tg[en];
          let b = (0.16 + 0.6 * Math.exp(-age / 0.1)) * leaderFade;
          const since = c - path.lt[en];
          if (since >= 0) {
            let lit = Math.exp(-since / (bolt.tau * path.decayMul));
            for (const tr of bolt.restrikes) lit += 0.7 * pulse(c, tr, 0.05) * Math.exp(-(tr - bolt.tl) / (bolt.tau * 6));
            b = Math.max(b, Math.min(1.4, lit));
          }
          b *= path.k * pwK;
          if (b < 0.02) continue;
          const f = st / Math.max(1, n - 1);
          const wd = widthBase * (path.taper[0] + (path.taper[1] - path.taper[0]) * f);
          ctx.beginPath();
          ctx.moveTo(path.pts[st * 2], path.pts[st * 2 + 1]);
          for (let q = st + 1; q <= en; q++) ctx.lineTo(path.pts[q * 2], path.pts[q * 2 + 1]);
          if (s.glow) {
            ctx.strokeStyle = rgba(accent, Math.min(1, b * 0.12));
            ctx.lineWidth = wd * 7;
            ctx.stroke();
          }
          ctx.strokeStyle = rgba(accent, Math.min(1, b * 0.45));
          ctx.lineWidth = wd * 2.6;
          ctx.stroke();
          ctx.strokeStyle = rgba(core, Math.min(1, b));
          ctx.lineWidth = wd;
          ctx.stroke();
        }
      }
      // Gökyüzü ışıması: dönüş çakması anında ve hemen sonrasında
      if (c >= bolt.tl) {
        const sc = c - bolt.tl;
        skyFlash = Math.max(skyFlash, bolt.pw * (0.5 + 0.5 * (bolt.endY / h)) * (pulse(sc, 0.04, 0.06) + 0.45 * Math.exp(-sc / 0.35)));
      }
      this.bolts[write++] = bolt;
    }
    this.bolts.length = write;

    // Gökyüzü/ortam ışıması: yumuşak dikey gradyan (daire yok)
    this.flash += (skyFlash - this.flash) * damp(dt, 14);
    if (o.flash >= 0.5 && this.flash > 0.02) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, rgba(core, this.flash * 0.2));
      g.addColorStop(1, rgba(core, this.flash * 0.05));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
