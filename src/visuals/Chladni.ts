import { binAtLerp, rgba, sampleGradient } from './palettes';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { TAU, createOffscreen, damp } from './util';

/**
 * Kum Levhası (Chladni figürleri): titreşen ince bir levhanın üstündeki kum taneleri, levhanın hiç oynamadığı "düğüm
 * çizgilerine" toplanır ve desenler oluşturur.
 *
 * Levha modu u(x,y) = cos(nπx̃)·cos(mπỹ) − sg·cos(mπx̃)·cos(nπỹ), x̃ = (x+ax)/2 (kısa kenar [−1,1], uzun kenar en-boy kadar uzar). u = 0 çizgileri düğümlerdir.
 * Her tane iki etkiyle hareket eder: (1) u²'nin eğimi boyunca aşağı kayma (düğüme yerleşme),
 * (2) titreşim şiddeti × |u| ile orantılı rastgele sıçrama (anti-düğümde güçlü, düğümde sıfır).
 * Böylece titreşim güçlüyken taneler dağılır, zayıflayınca düğüm çizgilerinde yeniden toplanır.
 *
 * Müzik: desen (n, m) ritimle sırayla figürler arasında gezer (başlangıç noktası şarkının baskın frekansına bağlı), titreşim şiddeti ses seviyesine ve
 * vuruşlara bağlıdır; n ve m yumuşakça kayar, taneler deseni takip eder.
 */

/** Kısa kenar başına kum çözünürlüğü (piksel); uzun kenar en-boy oranıyla ölçeklenir. */
const RES = 640;
const MAX_GRAINS = 20000;
const K = Math.PI / 2;
const PEAK_BINS = 48;
/** Estetik olarak birbirinden farklı (n, m) figür çiftleri; ritim sırayla bunlar arasında gezer. */
const MODE_PAIRS: [number, number][] = [
  [2, 3],
  [3, 4],
  [2, 5],
  [4, 5],
  [3, 6],
  [5, 6],
  [2, 7],
  [4, 7],
  [3, 8],
  [5, 8],
  [6, 7],
  [4, 9],
  [7, 8],
  [5, 10],
  [3, 10],
  [6, 11],
];

export class Chladni implements Visualizer {
  private ctx: CanvasRenderingContext2D;
  private sand = createOffscreen('Chladni sand');
  private shade = createOffscreen('Chladni glow');
  private img: ImageData;
  private shadeImg: ImageData;
  private resW = RES;
  private resH = RES;
  private shW = 56;
  private shH = 56;
  private gx = new Float32Array(MAX_GRAINS);
  private gy = new Float32Array(MAX_GRAINS);
  private gt = new Float32Array(MAX_GRAINS);
  /** Palet renk tablosu (tane başına sampleGradient yok). */
  private lut = new Uint8Array(64 * 3);
  private lutKey = '';

  // --- Sürekli kum yağışı ---
  /** Tane yüksekliği: >0 iken tane havada düşüyor (levha fiziği uygulanmaz), 0 = levhada. */
  private gh = new Float32Array(MAX_GRAINS);
  /** Levhada bulunan/aktif tane sayısı; yağışla artar (üst sınır: `count`). */
  private active = -1;
  private rainAcc = 0;
  /** Hızlı yumuşatılmış ses seviyesi: sakinlik (`calm`) bundan türetilir. */
  private sFast = 0;
  /** Levha etkinliği (0 sessiz … 1 titreşiyor): yumuşakça değişir; titreşim ışımasını ve sıçramayı ölçekler. */
  private act = 1;

  // Mod parametreleri (yumuşakça kayar)
  private n = 3;
  private m = 2;
  /** Blok başında kilitlenen baskın frekans tepesi (log eksen, 0..1): dizideki başlangıç noktasını belirler. */
  private t1 = 0.3;
  private tp = 0.3;
  private tb = 0.4;
  private tb0 = 0.4;
  private tbLong = 0.4;
  private specFast = new Float32Array(PEAK_BINS);
  private beatCount = 0;
  private blockTimer = 0;
  private block = 0;
  private sg = 1;
  private spec = new Float32Array(PEAK_BINS);
  // Yumuşatılmış ses
  private sLevel = 0;
  private sBeat = 0;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
    this.sand.canvas.width = this.sand.canvas.height = RES;
    this.img = this.sand.ctx.createImageData(RES, RES);
    this.shade.canvas.width = this.shade.canvas.height = 56;
    this.shadeImg = this.shade.ctx.createImageData(56, 56);
    for (let i = 0; i < MAX_GRAINS; i++) {
      this.gx[i] = Math.random() * 2 - 1;
      this.gy[i] = Math.random() * 2 - 1;
      this.gt[i] = Math.random();
    }
  }

  init(): void {}

  resize(): void {}

  dispose(): void {}

  /**
   * Sürekli kum yağışı: levhanın HER yerine, üstten, her saniye tane sayısının ~%8'i (×yoğunluk) düşer.
   * Aktif tane sayısı üst sınıra gelene kadar yeni kum EKLENİR; sınırdayken rastgele bir tane alınıp yeniden yağdırılır
   * (eski kum yavaşça yenilenir, toplam sabit kalır). Düşen taneler `gh` 1→0 ile iner, yere varınca küçük saçılma yapıp levhaya katılır.
   */
  private updateRain(dt: number, count: number, rate: number, round: boolean): void {
    const gx = this.gx;
    const gy = this.gy;
    const gh = this.gh;
    for (let i = 0; i < this.active; i++) {
      if (gh[i] <= 0) continue;
      gh[i] -= dt * 1.8;
      if (gh[i] <= 0) {
        gh[i] = 0;
        gx[i] = Math.max(-1, Math.min(1, gx[i] + (Math.random() - 0.5) * 0.03));
        gy[i] = Math.max(-1, Math.min(1, gy[i] + (Math.random() - 0.5) * 0.03));
      }
    }

    this.rainAcc += count * 0.08 * rate * dt;
    const n = Math.min(Math.floor(this.rainAcc), 700);
    this.rainAcc -= Math.floor(this.rainAcc);
    for (let k = 0; k < n; k++) {
      let idx: number;
      if (this.active < count) {
        idx = this.active++;
      } else {
        idx = Math.floor(Math.random() * this.active);
        if (gh[idx] > 0) continue;
      }
      let x = Math.random() * 2 - 1;
      let y = Math.random() * 2 - 1;
      if (round) {
        const r = Math.sqrt(Math.random()) * 0.999;
        const ang = Math.random() * TAU;
        x = Math.cos(ang) * r;
        y = Math.sin(ang) * r;
      }
      gx[idx] = x;
      gy[idx] = y;
      gh[idx] = 0.6 + 0.4 * Math.random(); // farklı yüksekliklerden: iniş zamanları dağılır, yağmur kesintisiz akar
      this.gt[idx] = Math.random();
    }
  }

  /** Levha en-boy oranına göre kum ve ışıma tamponlarını (yalnızca boyut değişince) yeniden kurar. */
  private ensureBuffers(resW: number, resH: number, shW: number, shH: number): void {
    if (resW !== this.resW || resH !== this.resH) {
      this.resW = resW;
      this.resH = resH;
      this.sand.canvas.width = resW;
      this.sand.canvas.height = resH;
      this.img = this.sand.ctx.createImageData(resW, resH);
    }
    if (shW !== this.shW || shH !== this.shH) {
      this.shW = shW;
      this.shH = shH;
      this.shade.canvas.width = shW;
      this.shade.canvas.height = shH;
      this.shadeImg = this.shade.ctx.createImageData(shW, shH);
    }
  }

  update(frame: AudioFrame, s: VisualizerSettingsView, w: number, h: number): void {
    const ctx = this.ctx;
    const o = s.opt;
    const dt = frame.dt;
    const f = Math.min(3, dt * 60);

    // Levha geometrisi: TAM EKRAN (varsayılan, dikdörtgen), kare veya yuvarlak. Alan koordinatları fiziksel ölçülür (kısa kenar = [−1,1],
    // uzun kenar en-boy oranı kadar uzar) → hücreler hep kare kalır, desen yalnızca daha çok tekrar eder.
    const plateMode = Math.round(o.plate);
    const full = plateMode === 0;
    const round = plateMode === 2;
    const shortSide = Math.min(w, h);
    const ax = full ? w / shortSide : 1;
    const ay = full ? h / shortSide : 1;
    const side = shortSide * 0.88;
    const pw = full ? w : side;
    const ph = full ? h : side;
    const x0 = full ? 0 : (w - side) / 2;
    const y0 = full ? 0 : (h - side) / 2;
    this.ensureBuffers(Math.round(RES * ax), Math.round(RES * ay), Math.max(8, Math.round(56 * ax)), Math.max(8, Math.round(56 * ay)));
    const resW = this.resW;
    const resH = this.resH;

    // --- Ses ---
    this.sLevel += (frame.level - this.sLevel) * damp(dt, 3);
    this.sBeat += (frame.beatPulse - this.sBeat) * damp(dt, 6);

    // Mod seçimi: üç katman birlikte çalışır —
    //  (1) RİTİM: her `rhythm` vuruşta (vuruş yoksa 12 sn'de) sıradaki figür çiftine geçilir; başlangıç noktası şarkıya özgüdür.
    //  (2) CANLI TON: baskın frekans tepesi (`tp`, notalar/melodi) ve parlaklık (`tb`, tını) blok başındaki değerlerinden saptıkça n ve m SÜREKLİ kayar
    //      → aynı şarkıda nota/tını değişince şekil gözle görülür biçimde morflanır. (Eskiden blok başında kilitlenip arada hiçbir şey değişmiyordu.)
    //  (3) GEÇİŞ: tını kısa süreli ortalamadan belirgin saparsa (bölüm/nakarat/enstrüman geçişi) blok hemen ilerler.
    const sp = this.spec;
    const spF = this.specFast;
    let wSum = 0;
    let wPos = 0;
    let peak = 0;
    for (let i = 0; i < PEAK_BINS; i++) {
      const t = i / (PEAK_BINS - 1);
      const v = binAtLerp(frame.freq, t) * (0.3 + 1.7 * t);
      sp[i] += (v - sp[i]) * damp(dt, 0.7);
      spF[i] += (v - spF[i]) * damp(dt, 6);
      const e = spF[i] * spF[i];
      wSum += e;
      wPos += e * t;
      if (spF[i] > spF[peak]) peak = i;
    }
    // Tepe konumu: komşularla parabolik inceltme (bin aralığından ince çözünürlük), parlaklık: karesel ağırlıklı merkez
    const lo = spF[Math.max(0, peak - 1)];
    const hi = spF[Math.min(PEAK_BINS - 1, peak + 1)];
    const den = lo - 2 * spF[peak] + hi;
    const sub = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (lo - hi)) / den)) : 0;
    if (wSum > 0.5) {
      this.tp += ((peak + sub) / (PEAK_BINS - 1) - this.tp) * damp(dt, 4);
      this.tb += (wPos / wSum - this.tb) * damp(dt, 4);
    }
    this.tbLong += (this.tb - this.tbLong) * damp(dt, 0.25);

    if (frame.beat) this.beatCount++;
    this.blockTimer += dt;
    const blockBeats = Math.max(1, Math.round(o.rhythm));
    const timbreShift = Math.abs(this.tb - this.tbLong) > 0.06 && this.blockTimer > 1.8;
    if (this.blockTimer > 12 || this.beatCount >= blockBeats || timbreShift) {
      this.blockTimer = 0;
      this.beatCount = 0;
      this.block++;
      this.t1 = this.tp; // blok başı: ton referansı (n, m bu değerden sapmayla kayar)
      this.tb0 = this.tb;
      this.tbLong = this.tb;
    }
    const pair = MODE_PAIRS[(this.block * 5 + Math.floor(this.t1 * MODE_PAIRS.length * 0.999)) % MODE_PAIRS.length];
    const dn = Math.max(-4, Math.min(4, 14 * (this.tp - this.t1)));
    const dm = Math.max(-3, Math.min(3, 12 * (this.tb - this.tb0)));
    const complexity = o.complexity;
    const tn = Math.max(1.2, pair[0] + dn) * complexity;
    let tm = Math.max(1.2, pair[1] + dm) * complexity;
    if (Math.abs(tn - tm) < 1.2) tm = tn + 1.2;
    this.n += (tn - this.n) * damp(dt, 1.8);
    this.m += (tm - this.m) * damp(dt, 1.8);
    // İşaret: u = cos·cos − sg·cos·cos. sg=+1 köşegenleri düğüm yapar (klasik figür), sg=−1 farklı bir simetri; bloklar arasında yumuşakça değişir
    this.sg += ((this.block % 2 === 0 ? 1 : -1) - this.sg) * damp(dt, 1.4);
    const sg = this.sg;
    const n = this.n;
    const m = this.m;

    // Titreşim şiddeti: ses seviyesi + vuruş (vuruşta taneler sıçrar, sonra düğümlerde yeniden toplanır)
    let amp = (0.12 + this.sLevel * 2.2 + this.sBeat * 1.4) * o.vibration;

    // --- Kum ekleme animasyonu: arada bir üstten bir meme levhayı boydan boya tarar, yeni kum yağdırır ---
    const count = Math.round(o.count);
    if (this.active < 0) this.active = Math.floor(count * 0.4);
    this.active = Math.min(this.active, count);

    // SAKİNLİK (kademeli ve HIZLI): levha titreşmezse kum düğümlere toplanmaz; yağış eski kumu yeniler → şekil dağılır, levha kumla KAPLI kalır
    // (ASLA temizlenmez). `calm` 0 (müzik canlı) … 1 (sessiz/çok sakin) sürekli bir değerdir; ham seviye çok kısa süre yumuşatılır (damp 12) ve
    // bekleme süresi YOK. (Eskiden: seviye damp 3 ile yumuşar → 1 sn bekleme → dağılma = toplam 3-4 sn gecikme, ve yalnız TAM sessizlikte devreye giriyordu;
    // sakin müzik bölümlerinde hiç tepki yoktu.)
    this.sFast += (frame.level - this.sFast) * damp(dt, 12);
    const ct = Math.min(1, Math.max(0, (this.sFast - 0.012) / 0.048));
    const calm = 1 - ct * ct * (3 - 2 * ct);
    this.act += ((1 - calm) - this.act) * damp(dt, 8);
    amp *= this.act; // sakinlikte levha ışıması ve sıçrama SÖNER (eski desen parıltısı kalmaz)
    if (o.rain >= 0.5) this.updateRain(dt, count, o.rainRate * (1 + 3 * calm), round);
    const active = this.active;
    const gh = this.gh;

    // Sakinlikte eski şekil HIZLICA erir: her tane `calm`'a oranlı olasılıkla (tam sakinlikte yarı ömür ≈0.23 sn) rastgele yeni bir yere konur
    if (calm > 0.02) {
      const p = 1 - Math.exp(-dt * 3.0 * calm);
      for (let i = 0; i < active; i++) {
        if (gh[i] > 0 || Math.random() > p) continue;
        let nx = Math.random() * 2 - 1;
        let ny = Math.random() * 2 - 1;
        if (round) {
          const r = Math.sqrt(Math.random()) * 0.999;
          const ang = Math.random() * TAU;
          nx = Math.cos(ang) * r;
          ny = Math.sin(ang) * r;
        }
        this.gx[i] = nx;
        this.gy[i] = ny;
      }
    }
    // Kum yalnızca levha TİTREŞİRKEN düğümlere kayar; sakinlikte kayma azalır/durur
    const vibrating = 1 - calm;
    const eta = 0.0045 * o.settle * f * vibrating;
    const noise = 0.022 * f;
    const gx = this.gx;
    const gy = this.gy;
    for (let i = 0; i < active; i++) {
      if (gh[i] > 0) continue; // havada düşen tane: levha fiziği yok
      let x = gx[i];
      let y = gy[i];
      const kx = ax * (x + 1) * K;
      const ky = ay * (y + 1) * K;
      const cxn = Math.cos(n * kx);
      const sxn = Math.sin(n * kx);
      const cxm = Math.cos(m * kx);
      const sxm = Math.sin(m * kx);
      const cyn = Math.cos(n * ky);
      const syn = Math.sin(n * ky);
      const cym = Math.cos(m * ky);
      const sym = Math.sin(m * ky);
      const u = cxn * cym - sg * cxm * cyn;
      const ux = -n * K * sxn * cym + sg * m * K * sxm * cyn;
      const uy = -m * K * cxn * sym + sg * n * K * cxm * syn;
      const jump = noise * amp * (Math.abs(u) + 0.04);
      // Hareket fiziksel birimde hesaplanır, normalize koordinata (÷ax, ÷ay) çevrilir
      x += (-eta * u * ux + (Math.random() - 0.5) * 2 * jump) / ax;
      y += (-eta * u * uy + (Math.random() - 0.5) * 2 * jump) / ay;
      if (x < -1) x = -1 + (-1 - x);
      else if (x > 1) x = 1 - (x - 1);
      if (y < -1) y = -1 + (-1 - y);
      else if (y > 1) y = 1 - (y - 1);
      if (round) {
        const r2 = x * x + y * y;
        if (r2 > 1) {
          const k = 0.999 / Math.sqrt(r2);
          x *= k;
          y *= k;
        }
      }
      gx[i] = x;
      gy[i] = y;
    }

    // --- Çizim: levha, titreşim ışıması, kum ---
    ctx.fillStyle = s.palette.bg;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.beginPath();
    if (round) ctx.arc(w / 2, h / 2, side / 2, 0, TAU);
    else if (full) ctx.rect(0, 0, w, h);
    else ctx.roundRect(x0, y0, side, side, side * 0.02);
    ctx.fillStyle = 'rgba(16,18,26,0.95)';
    ctx.fill();
    ctx.clip();

    const accent = sampleGradient(s.palette.colors, 0.3);
    if (o.shading >= 0.5) {
      const shW = this.shW;
      const shH = this.shH;
      const sd = this.shadeImg.data;
      for (let j = 0; j < shH; j++) {
        const yy = ay * (((j + 0.5) / shH) * 2) * K;
        const cyn = Math.cos(n * yy);
        const cym = Math.cos(m * yy);
        for (let i = 0; i < shW; i++) {
          const xx = ax * (((i + 0.5) / shW) * 2) * K;
          const u = Math.cos(n * xx) * cym - sg * Math.cos(m * xx) * cyn;
          const a = Math.min(1, Math.abs(u) * amp * 0.5) * this.act;
          const p = (j * shW + i) * 4;
          sd[p] = accent[0];
          sd[p + 1] = accent[1];
          sd[p + 2] = accent[2];
          sd[p + 3] = Math.round(a * 130);
        }
      }
      this.shade.ctx.putImageData(this.shadeImg, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.shade.canvas, x0, y0, pw, ph);
    }

    const data = this.img.data;
    data.fill(0);
    if (this.lutKey !== s.palette.id) {
      this.lutKey = s.palette.id;
      for (let i = 0; i < 64; i++) {
        const c = sampleGradient(s.palette.colors, i / 63);
        this.lut[i * 3] = Math.min(255, c[0] * 1.15 + 30);
        this.lut[i * 3 + 1] = Math.min(255, c[1] * 1.15 + 30);
        this.lut[i * 3 + 2] = Math.min(255, c[2] * 1.15 + 30);
      }
    }
    const lut = this.lut;
    const paletteMode = Math.round(o.colorMode) === 0;
    const size = Math.round(o.grain);
    for (let i = 0; i < active; i++) {
      if (gh[i] > 0) continue;
      const px = Math.floor(((gx[i] + 1) / 2) * (resW - size));
      const py = Math.floor(((gy[i] + 1) / 2) * (resH - size));
      let r: number;
      let g: number;
      let b: number;
      if (paletteMode) {
        const li = Math.floor((0.2 + 0.7 * this.gt[i]) * 63) * 3;
        const k = 0.75 + 0.25 * this.gt[i];
        r = lut[li] * k;
        g = lut[li + 1] * k;
        b = lut[li + 2] * k;
      } else {
        const k = 0.8 + 0.2 * this.gt[i];
        r = 238 * k;
        g = 218 * k;
        b = 176 * k;
      }
      for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
          const p = ((py + dy) * resW + (px + dx)) * 4;
          data[p] = r;
          data[p + 1] = g;
          data[p + 2] = b;
          data[p + 3] = 255;
        }
      }
    }
    this.sand.ctx.putImageData(this.img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.sand.canvas, x0, y0, pw, ph);
    ctx.imageSmoothingEnabled = true;
    ctx.restore();

    // Düşen taneler (yukarıdan bakış: yükseklik büyüklük/saydamlıkla gösterilir: yüksekte büyük ve silik, inerken küçülür ve netleşir)
    if (o.rain >= 0.5) {
      // Düşen kumun GÖRÜNÜRLÜĞÜ (`rainVis`) yalnızca çizimi etkiler; ekleme/yağış mekaniği aynıdır.
      const vis = o.rainVis;
      const px = pw / resW;
      ctx.fillStyle = 'rgb(236,222,190)';
      for (let i = 0; i < active; i++) {
        const hh = gh[i];
        if (hh <= 0) continue;
        ctx.globalAlpha = Math.min(1, (0.05 + 0.3 * (1 - hh)) * vis);
        const sz = px * size * (1 + hh * Math.min(1, vis));
        ctx.fillRect(x0 + ((gx[i] + 1) / 2) * pw - sz / 2, y0 + ((gy[i] + 1) / 2) * ph - sz / 2, sz, sz);
      }
      ctx.globalAlpha = 1;
    }

    // Levha çerçevesi (titreşimle hafifçe parlar); tam ekranda çerçeve yok
    if (!full) {
      ctx.strokeStyle = rgba(accent, 0.25 + Math.min(0.5, this.sBeat * 0.5));
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (round) ctx.arc(w / 2, h / 2, side / 2, 0, TAU);
      else ctx.roundRect(x0, y0, side, side, side * 0.02);
      ctx.stroke();
    }
  }
}
