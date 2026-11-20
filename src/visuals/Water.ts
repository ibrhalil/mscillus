import * as THREE from 'three';
import { binAtLerp, sampleGradient } from './palettes';
import { QuadShader } from './quadShader';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { damp } from './util';

/**
 * Su: iki stil — SADE DALGA (varsayılan: yalnız halkalar; ritimde rastgele yerde şiddete göre büyüyen dalga) ve GERÇEKÇİ SU.
 * Gerçekçi stilde dalga denklemi simülasyonu (CPU, sabit 60 Hz adımla → kare hızından bağımsız) + GPU yüzey görünümü.
 * Eski sürüm yalnızca |yükseklik|'i palete boyayan parlak halkalardı; şimdi yüzey normalleri (yükseklik eğimi) ile:
 * kırılan ışık ağları (caustics), güneş/ay parıltısı, derinlik rengi ve eğime bağlı ışıma. Kenarlarda sünger (dalga sönümü) var.
 *
 * Müzik: vuruşta damla (şiddet = bas, 1-2 küçük eş damla), tiz ince yağmur dalgaları sürer; sessizlikte yüzey sakinleşir
 * (hafif esinti dalgacıkları kalır — su yine su gibi görünür).
 */

const FRAG = `
precision highp float;
varying vec2 vUv;

uniform sampler2D uH;
uniform vec2 uGrid;
uniform float uTime;
uniform float uAspect;
uniform float uSlope;
uniform float uShine;
uniform float uCaustic;
uniform float uBright;
uniform float uMode;
uniform float uStyle;
uniform vec3 uBg;
uniform vec4 uD0[16];
uniform vec4 uD1[16];
uniform float uHue;
uniform float uLevel;
uniform float uBeat;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;

#define TAU 6.28318530718

vec3 pal(float t) {
  t = fract(t) * 4.0;
  if (t < 1.0) return mix(uC0, uC1, t);
  if (t < 2.0) return mix(uC1, uC2, t - 1.0);
  if (t < 3.0) return mix(uC2, uC3, t - 2.0);
  return mix(uC3, uC0, t - 3.0);
}

// Yukseklik alani: R32F doku (filtre yok) uzerinde elle bilineer ornekleme (her GPU'da calisir)
float hf(vec2 uv) {
  vec2 p = uv * uGrid - 0.5;
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 s = 1.0 / uGrid;
  float a = texture2D(uH, (i + vec2(0.5, 0.5)) * s).r;
  float b = texture2D(uH, (i + vec2(1.5, 0.5)) * s).r;
  float c = texture2D(uH, (i + vec2(0.5, 1.5)) * s).r;
  float d = texture2D(uH, (i + vec2(1.5, 1.5)) * s).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Kirilan isik aglari (caustics): dongusel sinus yinelemesi
float caustic(vec2 uv, float t) {
  vec2 p = mod(uv * TAU, TAU) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - 3.5 / float(n + 1));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}

void main() {
  vec2 uv = vUv;

  // SADE DALGA: simulasyon YOK; her damla dusdugu noktadan cikan TEK halka (analitik). TUM dalgalar ayni kurala uyar:
  //  - SONUM: zarf = genlik * (1 - yas/omur)^2 / sqrt(0.25 + 2R) (yayilma kaybi + zamanla sonme); omur ve genlik damla boyutundan turer
  //  - ETKILESIM: dalgalar ISARETLI yukseklige katki yapar (h toplami) -> tepe+tepe guclenir, tepe+cukur birbirini goturur (girisim);
  //    buyuk dalgalar ekran kenarindan YANSIR (ayna goruntu kaynaklari), yansiyan dalga gelenlerle girisim yapar.
  if (uStyle < 0.5) {
    vec2 p = vec2(uv.x * uAspect, uv.y);
    float hs = 0.0;
    vec3 ca = vec3(0.0);
    float wa = 0.0;
    for (int i = 0; i < 16; i++) {
      vec4 a = uD0[i];
      vec4 b = uD1[i];
      if (b.x > 0.0) {
        float age = a.z;
        float k = max(1.0 - age / b.y, 0.0);
        float S = a.w;
        // Boyut S genis aralikta etki eder: kucuk = ince, yavas, kisa; buyuk = kalin, hizli, uzun
        float R = (0.10 + 0.26 * S) * age;
        float w = (0.008 + 0.04 * S) * (1.0 + 0.5 * age);
        float amp = b.x * k * k;
        // RENK = siddet x kalan omur: genc ve guclu dalga paletin sicak/parlak ucunda baslar; zayifladikca ve yaslandikca
        // soguk/sonuk uca kayar (silik tiz dalgaciklar zaten dusuk genlikli oldugundan soguk gorunur)
        // Renk: baslangic rengi damlanin SIDDETINE (genlik) gore paletin tum araligindan secilir (kucuk = baslangic, buyuk = son uc),
        // zamanla (kalan omur k) baslangic rengine dogru soguyarak kayar; her damlaya kucuk rastgele ton sapmasi (b.z) eklenir.
        // Renk PARLAKLIKTAN AYRI: tam parlakliga normalize edilir; parlaklik yalniz genlikten gelir.
        float inten = clamp((b.x - 0.1) / 0.85, 0.0, 1.0);
        float tcol = clamp(inten * (0.25 + 0.75 * k) + b.z, 0.0, 1.0);
        vec3 ringCol = pal(tcol * 0.9 + uHue * 0.5);
        ringCol = ringCol / max(max(ringCol.r, ringCol.g), max(ringCol.b, 0.001));
        // j = 0: gercek kaynak; j = 1..4: sol/sag/alt/ust duvar yansimalari (yalniz buyuk damlalar, genlik x0.6)
        for (int j = 0; j < 5; j++) {
          vec2 c = a.xy;
          float g = 1.0;
          if (j == 1) c.x = -a.x;
          else if (j == 2) c.x = 2.0 * uAspect - a.x;
          else if (j == 3) c.y = -a.y;
          else if (j == 4) c.y = 2.0 - a.y;
          if (j > 0) g = S > 0.9 ? 0.6 : 0.0;
          if (g > 0.0) {
            float d = length(p - c);
            float q = (d - R) / w;
            if (abs(q) < 5.0) {
              float env = amp * g / sqrt(0.25 + 2.0 * R);
              float t = env * (exp(-q * q) - 0.5 * exp(-(q + 1.7) * (q + 1.7) * 0.8));
              hs += t;
              ca += ringCol * abs(t);
              wa += abs(t);
              if (j == 0) {
                float sp = amp * 1.1 * exp(-d * d / (w * w)) * exp(-age * 6.0);
                hs -= sp;
                ca += ringCol * sp;
                wa += sp;
              }
            }
          }
        }
      }
    }
    // Isaretli toplam yalniz PARLAKLIGI belirler (girisim: tepe+cukur goturur); renk, katkilarin |agirlikli| ortalamasidir (kanallar
    // ayri sikistirilmadigi icin ton korunur, beyaza yikanmaz)
    vec3 rcol = ca / max(wa, 0.0001);
    float hp = pow(max(hs, 0.0) * uSlope * 1.4, 0.7);
    hp = hp / (1.0 + hp);
    float hn = pow(max(-hs, 0.0) * uSlope * 1.4, 0.7);
    hn = hn / (1.0 + hn);
    vec3 c = uBg + rcol * hp * 1.2 + rcol * hn * 0.55 + mix(rcol, vec3(1.0), 0.6) * hp * hp * 0.35 * uShine + pal(uHue * 0.5) * 0.02 * uLevel;
    c *= uBright * (0.9 + 0.2 * uBeat);
    c *= mix(0.7, 1.0, smoothstep(1.0, 0.2, length(uv - 0.5)));
    gl_FragColor = vec4(c / (1.0 + c * 0.2), 1.0);
    return;
  }
  vec2 e = 1.0 / uGrid;

  // Yuzey egimi -> normal
  float dx = hf(uv + vec2(e.x, 0.0)) - hf(uv - vec2(e.x, 0.0));
  float dy = hf(uv + vec2(0.0, e.y)) - hf(uv - vec2(0.0, e.y));
  vec3 n = normalize(vec3(-dx * uSlope * 0.6, -dy * uSlope * 0.6, 1.0));
  float slope = length(n.xy);

  // Derinlik rengi
  vec3 deep;
  vec3 shallow;
  vec3 lightCol;
  if (uMode < 0.5) {
    deep = vec3(0.0, 0.07, 0.16);
    shallow = vec3(0.02, 0.42, 0.52);
    lightCol = vec3(1.0, 0.97, 0.88);
  } else if (uMode < 1.5) {
    deep = vec3(0.005, 0.012, 0.05);
    shallow = vec3(0.04, 0.16, 0.32);
    lightCol = vec3(0.8, 0.9, 1.0);
  } else {
    deep = pal(uHue) * 0.14;
    shallow = pal(uHue + 0.35) * 0.55;
    lightCol = mix(vec3(1.0), pal(uHue + 0.6), 0.35);
  }
  float g = 0.25 + 0.55 * uv.y + 0.2 * (1.0 - length(uv - 0.5));
  vec3 col = mix(deep, shallow, clamp(g, 0.0, 1.0));

  // Kirilan isik aglari: dalga egimiyle kayar (suyun altindaki taban)
  vec2 ruv = (uv + n.xy * 0.06) * vec2(uAspect, 1.0) * 1.4;
  float cs = caustic(ruv, uTime * 0.6);
  col += shallow * 1.6 * cs * uCaustic * (0.55 + 0.7 * uBeat + 0.4 * uLevel);

  // Gunes/ay parilti: keskin + genis hale
  vec3 L = normalize(vec3(-0.35, 0.55, 0.75));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float nh = max(dot(n, H), 0.0);
  col += lightCol * (pow(nh, 120.0) * 1.4 + pow(nh, 14.0) * 0.12) * uShine;

  // Egime bagli isima (dalga sirtlari) + goksel yansima
  col += mix(shallow, lightCol, 0.4) * slope * 0.9;
  col += lightCol * pow(1.0 - n.z, 2.0) * 0.5 * uShine;
  if (uMode > 1.5) col += pal(uHue + slope * 1.5) * slope * 0.5;

  col *= uBright * (0.9 + 0.15 * uBeat);
  col *= mix(0.6, 1.0, smoothstep(1.0, 0.2, length(uv - 0.5)));
  col = col / (1.0 + col * 0.25);
  gl_FragColor = vec4(col, 1.0);
}
`;

const QUALITY_H = [160, 220, 300];
const STEP = 1 / 60;

export class Water implements Visualizer {
  readonly manualRender = true;

  private gl: THREE.WebGLRenderer;
  private quad: QuadShader;
  private tex: THREE.DataTexture | null = null;
  private texData = new Float32Array(0);
  private cur = new Float32Array(0);
  private prev = new Float32Array(0);
  private sponge = new Float32Array(0);
  private gw = 0;
  private gh = 0;
  private gridKey = '';
  private colors = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];
  private grid = new THREE.Vector2(2, 2);
  private bg = new THREE.Color();
  private tmpSize = new THREE.Vector2();
  private acc = 0;
  private time = 0;
  private hue = 0;
  private rainAcc = 0;
  /** Vuruş algılanmasa da çalışsın diye spektrum akısı (flux) ile onset algılama: bas vermeyen/ritmi zayıf müzik. */
  private prevBands = new Float32Array(32);
  private fluxAvg = 0.1;
  private sinceDrop = 0;
  private cooldown = 0;
  private recent: { x: number; y: number; t: number }[] = [];
  private clock = 0;
  private dropGain = 1;
  private lifeScale = 1;
  /** Olay enerjisi istatistiği: boyut, MÜZİĞİN kendi ortalamasına göre belirlenir (bas hep yüksekse bile boyut çeşitlenir). */
  private avgE = 0.3;
  private peakE = 0.5;
  /** Sade stil damla halkaları: d0 = (x, y, yaş, boyut), d1 = (genlik, ömür); genlik 0 = boş yuva. */
  private d0 = Array.from({ length: 16 }, () => new THREE.Vector4());
  private d1 = Array.from({ length: 16 }, () => new THREE.Vector4());
  private sTreble = 0;
  private sLevel = 0;
  private sBeat = 0;

  constructor(gl: THREE.WebGLRenderer) {
    this.gl = gl;
    this.quad = new QuadShader(FRAG, {
      uH: { value: null },
      uGrid: { value: this.grid },
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uSlope: { value: 1 },
      uShine: { value: 1 },
      uCaustic: { value: 1 },
      uBright: { value: 1 },
      uMode: { value: 0 },
      uStyle: { value: 0 },
      uD0: { value: this.d0 },
      uD1: { value: this.d1 },
      uBg: { value: this.bg },
      uHue: { value: 0 },
      uLevel: { value: 0 },
      uBeat: { value: 0 },
      uC0: { value: this.colors[0] },
      uC1: { value: this.colors[1] },
      uC2: { value: this.colors[2] },
      uC3: { value: this.colors[3] },
    });
  }

  init(): void {}

  resize(): void {
    this.gridKey = '';
  }

  /** Simülasyon ızgarasını canvas oranına göre (yeniden) kurar. */
  private ensureGrid(aspect: number, quality: number): void {
    const gh = QUALITY_H[Math.max(0, Math.min(2, quality))];
    const gw = Math.min(720, Math.round(gh * aspect));
    const key = `${gw}x${gh}`;
    if (key === this.gridKey) return;
    this.gridKey = key;
    this.gw = gw;
    this.gh = gh;
    this.cur = new Float32Array(gw * gh);
    this.prev = new Float32Array(gw * gh);
    this.texData = new Float32Array(gw * gh);
    // Kenar sünger bandı: dalgalar duvardan yansıyıp ekranı karıştırmasın
    this.sponge = new Float32Array(gw * gh);
    const band = 10;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const edge = Math.min(x, gw - 1 - x, y, gh - 1 - y);
        this.sponge[y * gw + x] = edge >= band ? 1 : 0.9 + 0.1 * (edge / band);
      }
    }
    this.tex?.dispose();
    this.tex = new THREE.DataTexture(this.texData, gw, gh, THREE.RedFormat, THREE.FloatType);
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;
    this.grid.set(gw, gh);
    this.quad.material.uniforms.uH.value = this.tex;
  }

  /** Gauss damla: merkezde `amp` (negatif = çukur), yarıçap sigma hücre. */
  private drop(cx: number, cy: number, sigma: number, amp: number): void {
    const { gw, gh, cur } = this;
    const r = Math.ceil(sigma * 3);
    const x0 = Math.max(1, Math.floor(cx) - r);
    const x1 = Math.min(gw - 2, Math.ceil(cx) + r);
    const y0 = Math.max(1, Math.floor(cy) - r);
    const y1 = Math.min(gh - 2, Math.ceil(cy) + r);
    const inv = 1 / (2 * sigma * sigma);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        cur[y * gw + x] += amp * Math.exp(-d2 * inv);
      }
    }
  }

  private stepSim(damping: number): void {
    const { gw, gh, cur, prev, sponge } = this;
    for (let y = 1; y < gh - 1; y++) {
      const row = y * gw;
      for (let x = 1; x < gw - 1; x++) {
        const i = row + x;
        const v = (cur[i - 1] + cur[i + 1] + cur[i - gw] + cur[i + gw]) / 2 - prev[i];
        prev[i] = v * damping * sponge[i];
      }
    }
    this.cur = prev;
    this.prev = cur;
  }

  /**
   * Sade stil: yeni halka (boş yuva yoksa en yaşlıyı değiştirir). TÜM dalgalar için aynı yasa: genlik ve ömür boyuttan türer
   * (büyük dalga güçlü ve uzun yaşar, küçük/tiz dalga zayıf ve çabuk söner); `ampMul` yalnız olay şiddetini ölçekler.
   */
  private spawnRing(x: number, y: number, size: number, ampMul = 1): void {
    let idx = -1;
    let oldest = -1;
    let oldestAge = -1;
    for (let i = 0; i < 16; i++) {
      if (this.d1[i].x <= 0) {
        idx = i;
        break;
      }
      if (this.d0[i].z > oldestAge) {
        oldestAge = this.d0[i].z;
        oldest = i;
      }
    }
    if (idx < 0) idx = oldest;
    this.d0[idx].set(x, y, 0, size);
    // Tüm özellikler boyuttan türer (geniş aralık): küçük S ≈ 0.2 → zayıf/ince/kısa; büyük S ≈ 1.8 → güçlü/kalın/uzun. z = rastgele ton sapması.
    this.d1[idx].set((0.1 + 0.5 * size) * this.dropGain * ampMul, (0.8 + 2.6 * size) * this.lifeScale, (Math.random() - 0.5) * 0.2, 0);
  }

  update(frame: AudioFrame, s: VisualizerSettingsView): void {
    const o = s.opt;
    const dt = frame.dt;
    const size = this.gl.getDrawingBufferSize(this.tmpSize);
    const aspect = size.x / size.y;
    this.ensureGrid(aspect, Math.round(o.quality));
    const sc = this.gh / 240;

    this.sTreble += (frame.treble - this.sTreble) * damp(dt, 5);
    this.sLevel += (frame.level - this.sLevel) * damp(dt, 3);
    this.sBeat += (frame.beatPulse - this.sBeat) * damp(dt, 5);
    this.time += dt * (0.5 + this.sLevel * 0.5);
    this.clock += dt;
    this.peakE = Math.max(this.avgE + 0.12, this.peakE - dt * 0.03);
    for (let i = 0; i < 16; i++) {
      if (this.d1[i].x > 0) {
        this.d0[i].z += dt;
        if (this.d0[i].z > this.d1[i].y) this.d1[i].x = 0;
      }
    }
    this.hue += dt * (0.004 + this.sLevel * 0.02);

    const realistic = Math.round(o.style) === 1;
    this.dropGain = o.drop;
    this.lifeScale = 0.5 + (o.damping - 0.96) / 0.039;

    // Tetikleyici: (1) vuruş, (2) spektral akı (herhangi bir bantta ani yükseliş — bas olmasa da), (3) müzik varken uzun süre
    // hiçbir şey olmadıysa yumuşak bir damla (karanlık ekran kalmasın)
    let flux = 0;
    for (let i = 0; i < 32; i++) {
      const v = binAtLerp(frame.freq, i / 31);
      flux += Math.max(0, v - this.prevBands[i]);
      this.prevBands[i] += (v - this.prevBands[i]) * damp(dt, 14);
    }
    this.fluxAvg += (flux - this.fluxAvg) * damp(dt, 1.2);
    this.cooldown -= dt;
    this.sinceDrop += dt;
    const ratio = flux / (this.fluxAvg + 0.05);
    // Aynı yerde/aynı anda iç içe dalga olmasın: tetikleyiciler arası bekleme (vuruş 0.3, akı 0.5 sn), boşta damlası 2.2 sn
    const beatOk = frame.beat && this.cooldown <= 0;
    const fluxOnset = this.cooldown <= 0 && flux > 0.12 && ratio > 2.0;
    const idleDrop = this.sinceDrop > 2.2 && this.sLevel > 0.02;
    const trigger = beatOk || fluxOnset || idleDrop;
    if (trigger) {
      this.cooldown = beatOk ? 0.3 : 0.5;
      this.sinceDrop = 0;
      // Konum: son 3.5 sn'de düşen damlalardan EN UZAK aday (8 rastgele adaydan) → dalgalar aynı yerde iç içe girmez
      this.recent = this.recent.filter((r) => this.clock - r.t < 3.5);
      let bx = this.gw * 0.5;
      let by = this.gh * 0.5;
      let bestScore = -1;
      for (let c = 0; c < 8; c++) {
        const cx = this.gw * (0.12 + Math.random() * 0.76);
        const cy = this.gh * (0.12 + Math.random() * 0.76);
        let score = 1e9;
        for (const r of this.recent) {
          const age = this.clock - r.t;
          score = Math.min(score, Math.hypot((cx - r.x) / this.gw, (cy - r.y) / this.gh) * (1 + age * 0.15));
        }
        if (score > bestScore) {
          bestScore = score;
          bx = cx;
          by = cy;
        }
      }
      this.recent.push({ x: bx, y: by, t: this.clock });
      if (realistic) {
        // Gerçekçi: bas şiddetinde büyük damla + 1-2 küçük eş damla
        this.drop(bx, by, 2.4 * sc, -(0.9 + frame.bass * 1.8) * o.drop);
        const extra = Math.random() < 0.6 ? 1 : 2;
        for (let k = 0; k < extra; k++) {
          this.drop(bx + (Math.random() - 0.5) * 24 * sc, by + (Math.random() - 0.5) * 24 * sc, 1.6 * sc, -(0.3 + frame.bass * 0.5) * o.drop);
        }
      } else {
        // Sade: TEK damla → TEK halka. Boyut S bas ve şiddete göre: bas vuruşu büyük damla; bas yoksa (akı/boşta) küçük damla.
        // Boyut = olayın enerjisinin yakın zamandaki ORTALAMAYA göre konumu (z-puanı benzeri): ortalamanın üstü büyük, altı küçük
        let e = 0.1;
        if (beatOk) e = frame.bass + 0.3 * Math.min(1, this.sLevel * 2);
        else if (fluxOnset) e = 0.3 * Math.min(1, ratio / 4) + 0.3 * frame.bass;
        this.peakE = Math.max(e, this.peakE);
        const spread = Math.max(0.12, this.peakE - this.avgE);
        const pw = Math.min(1, Math.max(0, 0.5 + 0.5 * ((e - this.avgE) / spread)));
        this.avgE += (e - this.avgE) * 0.15;
        let size = (0.2 + 1.6 * Math.pow(pw, 1.3)) * (0.88 + Math.random() * 0.24);
        if (!beatOk && !fluxOnset) size = 0.25;
        this.spawnRing((bx / this.gw) * aspect, by / this.gh, size);
      }
    }

    // Tiz dalgacıkları. Gerçekçi: ince yağmur (simülasyona damla). Sade: SİLİK, küçük ve KISA ömürlü halkalar (~1 sn); genlikleri düşük
    // olduğundan büyük dalgaların üstünü örtmez, kendi kendine çabuk söner. Yalnız tiz varken (sessizlikte hiçbir şey çıkmaz).
    if (realistic) this.rainAcc += dt * (0.8 + this.sTreble * 30) * o.rain;
    else if (this.sTreble > 0.06) this.rainAcc += dt * (1 + 14 * (this.sTreble - 0.06)) * o.rain;
    while (this.rainAcc >= 1) {
      this.rainAcc -= 1;
      if (realistic) {
        this.drop(
          this.gw * (0.05 + Math.random() * 0.9),
          this.gh * (0.05 + Math.random() * 0.9),
          (1.0 + Math.random() * 0.6) * sc,
          -(0.12 + Math.random() * 0.25) * (0.4 + this.sTreble * 2) * o.drop,
        );
      } else {
        // Tiz dalgacığı: aynı yasa (küçük boyut → düşük genlik, kısa ömür); `ampMul` tiz şiddetiyle ölçekler
        this.spawnRing(Math.random() * aspect, Math.random(), 0.12 + Math.random() * 0.08, 0.5 + Math.min(1, this.sTreble * 2));
      }
    }

    // Sabit adımlı simülasyon (yalnız Gerçekçi; Sade analitik halkalarla çizilir, CPU'da simülasyon yok)
    if (realistic) {
      this.acc = Math.min(this.acc + dt, STEP * 3);
      while (this.acc >= STEP) {
        this.acc -= STEP;
        this.stepSim(o.damping);
      }
      this.texData.set(this.cur);
      if (this.tex) this.tex.needsUpdate = true;
    }

    for (let i = 0; i < 4; i++) {
      const x = this.hue * 0.5 + i * 0.25;
      const c = sampleGradient(s.palette.colors, 1 - Math.abs(2 * (x - Math.floor(x)) - 1));
      this.colors[i].setRGB(c[0] / 255, c[1] / 255, c[2] / 255);
    }

    const u = this.quad.material.uniforms;
    u.uTime.value = this.time;
    u.uAspect.value = aspect;
    u.uSlope.value = o.wave;
    u.uShine.value = o.shine;
    u.uCaustic.value = o.caustic;
    u.uBright.value = o.bright;
    u.uMode.value = Math.round(o.colors);
    u.uStyle.value = realistic ? 1 : 0;
    this.bg.set(s.palette.bg);
    u.uHue.value = this.hue;
    u.uLevel.value = this.sLevel;
    u.uBeat.value = this.sBeat;

    this.quad.render(this.gl, null);
  }

  dispose(): void {
    this.tex?.dispose();
    this.quad.dispose();
  }
}
