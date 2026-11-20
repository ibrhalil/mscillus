import * as THREE from 'three';
import { sampleGradient } from './palettes';
import { QuadShader } from './quadShader';
import { EventScale, OnsetTracker } from './onset';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { damp } from './util';

/**
 * Boya Damlası: kâğıda düşen YAĞLI BOYA. DÜZ (2B) bir leke: ışık yansıması, kabarıklık, gölge yok.
 *
 * Yaşam döngüsü: damla düşer (görünür) → ÖNCE saydam YAĞ tabakası hızla yayılır (boyanın rengini hafifçe alır) → pigment yağın içinde YAVAŞ
 * dağılır, yayıldıkça SEYRELİR (solar) ve yağlı alanın kenarına YETİŞİR → hemen yavaşça SİLİNİR (önce pigment, yağ biraz geç) → kâğıt boşalır.
 *
 * ÇİZİM: tuval her karede SIFIRDAN hesaplanır: kâğıt rengi × exp(−Σ yoğunluk·OD) (Beer-Lambert, renkler çarpılarak karışır). Birikim dokusu YOK:
 * önceki sürümler yoğunluk farklarını tampona çarpıp geri alıyordu; yuvarlama hataları birikiyor, silinen lekenin izi kalıyor ve tuval
 * giderek kararıyordu. Şimdi silinen leke tam olarak yok olur (iz/ghost imkânsız). Aynı anda en çok MAX_ST leke canlıdır; doluysa en yaşlısı
 * hızla silinir (yeni boyaya yer açılır).
 *
 * Müzik: damlanın boyutu (vuruşun müziğin ortalamasına göre şiddeti), vuruşta damla DÜŞER, yayılma hızı ses seviyesi ve vuruşla artar.
 */

const MAX_ST = 14;

const FRAG = `
precision highp float;
varying vec2 vUv;

uniform vec3 uBase;
uniform float uAspect;
uniform float uOil;
uniform float uBright;
uniform vec4 uE0[14];
uniform vec4 uE1[14];
uniform vec4 uE2[14];
uniform vec3 uEC[14];
uniform vec4 uF[6];
uniform vec3 uFC[6];

#define TAU 6.28318530718

float h1(float i, float seed) {
  return fract(sin(i * 127.1 + seed * 311.7) * 43758.5453);
}

// Periyodik gurultu (aci dikissiz): x aci/TAU * N, N tam sayi
float pn(float x, float N, float seed) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(h1(mod(i, N), seed), h1(mod(i + 1.0, N), seed), f);
}

float n2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = h1(i.x + i.y * 57.0, 1.0);
  float b = h1(i.x + 1.0 + i.y * 57.0, 1.0);
  float c = h1(i.x + (i.y + 1.0) * 57.0, 1.0);
  float d = h1(i.x + 1.0 + (i.y + 1.0) * 57.0, 1.0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// (yag yogunlugu, pigment yogunlugu): yag = cok yumusak kenarli duz tabaka; pigment = merkezde yogun, kenara seyrelen, tuylu kenar; amp = seyrelme
vec2 dens(float Ro, float Rp, float amp, float r, float a, float seed, float jag) {
  float oil = 0.0;
  float pig = 0.0;
  if (Ro > 0.0) {
    float Reo = Ro * (1.0 + (pn(a * 4.0, 4.0, seed) - 0.5) * 0.12 + (pn(a * 11.0, 11.0, seed + 3.0) - 0.5) * 0.05);
    oil = smoothstep(Reo, Reo * 0.5, r);
  }
  if (Rp > 0.0) {
    float Rep = Rp * (1.0 + ((pn(a * 5.0, 5.0, seed + 9.0) - 0.5) * 0.22 + (pn(a * 13.0, 13.0, seed + 5.0) - 0.5) * 0.12 + pow(pn(a * 23.0, 23.0, seed + 1.0), 4.0) * 0.25) * jag);
    float x = r / Rep;
    float body = pow(max(1.0 - x * x, 0.0), 1.3);
    float edge = smoothstep(1.0, 0.88, x);
    pig = body * edge * amp;
  }
  return vec2(oil, pig);
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.0;

  // Kagit lifleri pigmenti esit emmez: sabit (konuma bagli) modulasyon
  float fiber = 0.8 + 0.4 * n2(p * 48.0) + 0.08 * (n2(p * 190.0) - 0.5);

  vec3 od = vec3(0.0);
  for (int i = 0; i < 14; i++) {
    vec4 e2 = uE2[i];
    if (e2.y > 0.5) {
      vec4 e0 = uE0[i];
      vec4 e1 = uE1[i];
      vec2 q = p - e0.xy;
      float r = length(q);
      if (r < e0.z * 1.9 + 0.02) {
        float a = atan(q.y, q.x) / TAU;
        vec2 d = dens(e0.z, e0.w, e1.x, r, a, e1.w, e2.x);
        // Yag: ACIK, renk tonlu saydam leke (kagit ile pigment rengi arasinda en fazla ~%16 karisim + cok hafif sararma)
        vec3 oilCol = mix(vec3(1.0), exp(-uEC[i]), 0.16) * vec3(0.985, 0.975, 0.93);
        od += d.x * e1.y * (-log(oilCol)) * uOil + d.y * e1.z * fiber * uEC[i];
      }
    }
  }

  vec3 col = uBase * exp(-od);

  // Dusen damlalar: duz, hafif dikey uzamis renkli damla
  for (int i = 0; i < 6; i++) {
    vec4 f = uF[i];
    if (f.w > 0.0) {
      vec2 d = vec2(p.x - f.x, (p.y - f.y) / 2.2);
      float m = smoothstep(f.z, f.z * 0.8, length(d)) * f.w;
      col = mix(col, uFC[i] * 0.92, m);
    }
  }

  // Kagit dokusu: ince lif ve hafif leke (leke uzerinden de gorunur)
  float fib = h1(floor(gl_FragCoord.x * 0.5) + floor(gl_FragCoord.y * 0.5) * 57.0, 3.0) - 0.5;
  float cloud = h1(floor(gl_FragCoord.x * 0.06) + floor(gl_FragCoord.y * 0.06) * 57.0, 5.0) - 0.5;
  col *= 1.0 + 0.03 * fib + 0.02 * cloud;
  col *= uBright;
  col *= 0.94 + 0.08 * smoothstep(1.0, 0.2, length(vUv - 0.5));
  gl_FragColor = vec4(col, 1.0);
}
`;

interface Falling {
  x: number;
  yT: number;
  y0: number;
  t: number;
  T: number;
  r: number;
  pw: number;
  rgb: [number, number, number];
  od: [number, number, number];
  ro: number;
  jag: number;
}

interface Stain {
  x: number;
  y: number;
  /** Hedef yağ ve pigment yarıçapı (pigment yağın kenarına yetişir). */
  ro: number;
  rp: number;
  seed: number;
  jag: number;
  tauO: number;
  tauP: number;
  delayP: number;
  decayDur: number;
  age: number;
  /** İlerleme (müzikle hızlanır): yarıçap = hedef·(1 − e^−ilerleme). */
  oPr: number;
  pPr: number;
  decayT: number;
  /** Doluyken en yaşlı lekenin silinmesini hızlandıran çarpan. */
  rush: number;
  roC: number;
  rpC: number;
  ampC: number;
  lifeO: number;
  lifeP: number;
  od: [number, number, number];
}

export class PaintDrip implements Visualizer {
  readonly manualRender = true;

  private gl: THREE.WebGLRenderer;
  private quad: QuadShader;
  private uE0 = Array.from({ length: MAX_ST }, () => new THREE.Vector4());
  private uE1 = Array.from({ length: MAX_ST }, () => new THREE.Vector4());
  private uE2 = Array.from({ length: MAX_ST }, () => new THREE.Vector4());
  private uEC = Array.from({ length: MAX_ST }, () => new THREE.Vector3(0, 0, 0));
  private uF = Array.from({ length: 6 }, () => new THREE.Vector4());
  private uFC = Array.from({ length: 6 }, () => new THREE.Vector3(0, 0, 0));
  private base = new THREE.Vector3(0.98, 0.97, 0.95);
  private tmpSize = new THREE.Vector2();
  private stains: Stain[] = [];
  private falling: Falling[] = [];
  private onset = new OnsetTracker();
  private scale = new EventScale();
  private lastT = 0.5;
  private sLevel = 0;
  private sBeat = 0;
  private clock = 0;
  private bgAcc = 0;
  /** Gecikmeli damlalar: güçlü vuruşta art arda 2-3 damla. */
  private pending: { t: number; pw: number }[] = [];

  constructor(gl: THREE.WebGLRenderer) {
    this.gl = gl;
    this.quad = new QuadShader(FRAG, {
      uBase: { value: this.base },
      uAspect: { value: 1 },
      uOil: { value: 1 },
      uBright: { value: 1 },
      uE0: { value: this.uE0 },
      uE1: { value: this.uE1 },
      uE2: { value: this.uE2 },
      uEC: { value: this.uEC },
      uF: { value: this.uF },
      uFC: { value: this.uFC },
    });
  }

  init(): void {}

  resize(): void {}

  /** Pigment rengi: güçlü damla paletin sonuna doğru; öncekinden belirgin farklı. rgb = görünen renk, od = −ln renk. */
  private pickColor(pw: number, s: VisualizerSettingsView): { rgb: [number, number, number]; od: [number, number, number] } {
    // Kâğıda yakın (açık/beyazımsı) renk görünmez leke olur: parlak renkler elenir (6 deneme), olmazsa koyulaştırılır
    let c: [number, number, number] = [0, 0, 0];
    let t = 0;
    for (let tries = 0; tries < 6; tries++) {
      t = (0.1 + 0.7 * pw + Math.random() * 0.25 + tries * 0.17) % 1;
      if (Math.abs(t - this.lastT) < 0.22) t = (t + 0.4) % 1;
      c = sampleGradient(s.palette.colors, t) as [number, number, number];
      if ((0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]) / 255 < 0.72) break;
    }
    this.lastT = t;
    const lum = (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]) / 255;
    const k = lum > 0.72 ? 0.62 : 1;
    const r = (c[0] / 255) * k;
    const g = (c[1] / 255) * k;
    const b = (c[2] / 255) * k;
    return {
      rgb: [r, g, b],
      od: [-Math.log(Math.max(0.06, r)), -Math.log(Math.max(0.06, g)), -Math.log(Math.max(0.06, b))],
    };
  }

  /** Damla ekranın tepesinden düşer (görünür), inince leke başlar. */
  private fall(cx: number, cy: number, ro: number, pw: number, c: { rgb: [number, number, number]; od: [number, number, number] }, jag: number): void {
    if (this.falling.length >= 6) return;
    // Kapasite: leke yuvası yoksa damla HİÇ düşmez (düşüp iz bırakmama yok); en yaşlının silinmesi hızlanır
    if (this.stains.length + this.falling.length >= MAX_ST) {
      if (this.stains.length > 0) this.stains.reduce((a, b) => (a.age > b.age ? a : b)).rush = 4;
      return;
    }
    // Damla EKRANIN EN TEPESİNDEN başlar (leke bölgesine yakın bir yerde doğmuş gibi görünmez); düşme süresi mesafeyle büyür (kare kökü:
    // yerçekimi ivmesi), böylece tepeden inişi ~0.2–0.3 sn sürer. Hız arttıkça damla dikey uzar (shader).
    const y0 = 1.08;
    this.falling.push({ x: cx, yT: cy, y0, t: 0, T: 0.1 + 0.13 * Math.sqrt(Math.max(y0 - cy, 0.2)), r: 0.012 + 0.02 * pw, pw, rgb: c.rgb, od: c.od, ro, jag });
  }

  /** Lekeyi başlatır. Doluysa en yaşlı lekenin silinmesi hızlandırılır (yeni boyaya yer açılır); bu damla düşmez. */
  private stain(f: Falling, life: number): void {
    if (this.stains.length >= MAX_ST) return; // fall() kapasiteyi zaten garantiler
    this.stains.push({
      x: f.x,
      y: f.yT,
      ro: f.ro,
      rp: f.ro * 0.96,
      seed: Math.random() * 60,
      jag: f.jag,
      tauO: 0.35 + 0.25 * f.pw,
      tauP: 2.2 + 1.4 * f.pw,
      delayP: 0.3 + 0.2 * f.pw,
      // Büyük leke daha geç silinir: süre damla şiddetiyle (boyutla) 0.45× – 2.05× değişir (küçük ≈ yarısı, büyük ≈ iki katı)
      decayDur: life * (0.45 + 1.6 * f.pw),
      age: 0,
      oPr: 0,
      pPr: 0,
      decayT: 0,
      rush: 1,
      roC: 0,
      rpC: 0,
      ampC: 1,
      lifeO: 1,
      lifeP: 1,
      od: f.od,
    });
  }

  update(frame: AudioFrame, s: VisualizerSettingsView): void {
    const o = s.opt;
    const dt = frame.dt;
    const size = this.gl.getDrawingBufferSize(this.tmpSize);
    const aspect = size.x / size.y;
    const cream = Math.round(o.base) === 1;
    this.base.set(cream ? 0.95 : 0.98, cream ? 0.92 : 0.97, cream ? 0.84 : 0.95);

    this.sLevel += (frame.level - this.sLevel) * damp(dt, 3);
    this.sBeat += (frame.beatPulse - this.sBeat) * damp(dt, 5);
    this.scale.tick(dt);

    this.clock += dt;

    // --- DAMLAMA SIKLIĞI ritme ve şiddetine göre ---
    // (1) Ritim: her vuruş/onset bir tetikleyici (hızlı ritim = sık damla). (2) Şiddet (müziğin ortalamasına göre pw): zayıf vuruş bazen HİÇ damlamaz,
    // orta vuruş 1 damla, güçlü vuruş art arda 2-3 damla (kısa aralıklı). (3) Genel gürlük: yüksek müzikte vuruşlar arasında da ara sıra damlar.
    // Onset eşiği düşürüldü (2.0 → 1.5, bekleme 0.5 → 0.35 sn): durağan müzikteki küçük yükselişler de damla tetikler
    const hit = this.onset.update(frame, dt, 1.5, 0.35);
    if (frame.beat || hit) {
      const e = frame.beat ? frame.bass + 0.3 * Math.min(1, this.sLevel * 2) : 0.3 * Math.min(1, this.onset.ratio / 4) + 0.3 * frame.bass;
      const pw = this.scale.rel(e);
      let base: number;
      if (pw < 0.3) base = (pw / 0.3) * 0.6;
      else if (pw < 0.7) base = 1;
      else base = pw > 0.9 ? 2.6 : 2;
      const nf = base * o.rate;
      const n = Math.floor(nf) + (Math.random() < nf - Math.floor(nf) ? 1 : 0);
      for (let i = 0; i < n; i++) this.pending.push({ t: this.clock + i * (0.07 + Math.random() * 0.08), pw: Math.max(0.05, pw * (1 - 0.12 * i)) });
    }
    // Taban akış: müzik ÇALIYORSA vuruş/onset gelmese de (durağan, sakin müzik) damla düşer: ~0.45/sn sakin → ~1.3/sn gürken.
    // Sessizde (müzik yok) düşmez. Sakin müzikte damlalar küçük, gürken büyür.
    const loud = Math.min(1, this.sLevel * 3);
    if (this.sLevel > 0.015) {
      this.bgAcc += dt * (0.3 + 1.0 * loud) * o.rate;
      while (this.bgAcc >= 1) {
        this.bgAcc -= 1;
        this.pending.push({ t: this.clock, pw: 0.12 + 0.3 * Math.random() + 0.25 * loud });
      }
    }
    // Zamanı gelen damlalar düşer (boyut şiddetle; renk şiddetle)
    if (this.pending.length > 0) {
      const due = this.pending.filter((q) => q.t <= this.clock);
      this.pending = this.pending.filter((q) => q.t > this.clock);
      for (const q of due) {
        const ro = (0.14 + 0.5 * q.pw) * o.size;
        this.fall((Math.random() * 2 - 1) * aspect * 0.8, (Math.random() * 2 - 1) * 0.7, ro, q.pw, this.pickColor(q.pw, s), o.jag);
      }
    }

    // --- Düşen damlalar: inince leke ---
    for (const f of this.falling) f.t += dt;
    const landed = this.falling.filter((f) => f.t >= f.T);
    this.falling = this.falling.filter((f) => f.t < f.T);
    for (const f of landed) this.stain(f, o.life);

    // --- Lekeleri ilerlet: yağ hızlı → pigment yavaş (yetişene dek, seyrelerek) → hemen yavaş silinme ---
    const rate = (0.6 + 1.2 * this.sLevel + 1.2 * this.sBeat) * o.spread;
    for (const st of this.stains) {
      st.age += dt;
      st.oPr += (dt * rate) / st.tauO;
      if (st.age > st.delayP) st.pPr += (dt * rate) / st.tauP;
      st.roC = st.ro * (1 - Math.exp(-st.oPr));
      st.rpC = st.rp * (1 - Math.exp(-st.pPr));
      // Seyrelme: yayıldıkça pigment yoğunluğu 1 → 0.35 (boya koyulaşmaz, solar)
      const f = st.rpC / st.rp;
      st.ampC = 1 - 0.65 * f * f;
      // Pigment yağın kenarına yetişince (%95) hemen yavaş silinir; doluyken en yaşlı daha hızlı
      if (st.pPr >= 3 || st.rush > 1) st.decayT += (dt / st.decayDur) * st.rush;
      // Silinme eğrisi SONDA ÇOK YAVAŞLAR (dışbükey): hızlı başlar, kuyruk uzundur → son anda ani kaybolma fark edilmez.
      // Pigment `(1−u)^2.2`; yağ biraz geç başlar ve daha uzun sürer (u: 0.15 → 1.25).
      const u = st.decayT;
      st.lifeP = Math.pow(Math.max(1 - u, 0), 2.2);
      st.lifeO = Math.pow(Math.max(1 - Math.max(u - 0.15, 0) / 1.1, 0), 2.0);
    }
    // Tamamen silinenler listeden çıkar (önceki sürümün aksine iz kalmaz: çizim her karede sıfırdan)
    this.stains = this.stains.filter((st) => st.decayT < 1.25);

    for (let i = 0; i < MAX_ST; i++) {
      const st = this.stains[i];
      if (st) {
        this.uE0[i].set(st.x, st.y, st.roC, st.rpC);
        this.uE1[i].set(st.ampC, st.lifeO, st.lifeP, st.seed);
        this.uE2[i].set(st.jag, 1, 0, 0);
        this.uEC[i].set(st.od[0], st.od[1], st.od[2]);
      } else {
        this.uE2[i].set(0, 0, 0, 0);
      }
    }
    for (let i = 0; i < 6; i++) {
      const f = this.falling[i];
      if (f) {
        const k = Math.min(1, f.t / f.T);
        this.uF[i].set(f.x, f.y0 - (f.y0 - f.yT) * k * k, f.r, 1);
        this.uFC[i].set(f.rgb[0], f.rgb[1], f.rgb[2]);
      } else {
        this.uF[i].set(0, 0, 0, 0);
      }
    }

    const u = this.quad.material.uniforms;
    u.uAspect.value = aspect;
    u.uOil.value = o.oil;
    u.uBright.value = o.bright;
    this.quad.render(this.gl, null);
  }

  dispose(): void {
    this.quad.dispose();
  }
}
