import * as THREE from 'three';
import { binAtLerp, sampleGradient } from './palettes';
import { QuadShader } from './quadShader';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { damp } from './util';

/**
 * Ateş: tam ekran GPU shader (eski sürüm CPU'da çeyrek çözünürlükte "Doom ateşi" hücresel simülasyonuydu: bloklu görünüm,
 * her piksele rastgele gürültü, ham spektrum doğrudan sütunlara).
 *
 * Alev: yukarı kayan, alanı kendisiyle bükülmüş fbm gürültüsü; her sütunun alev yüksekliği o sütundaki yumuşatılmış spektrum
 * enerjisidir (merkezde bas ya da soldan sağa). Vuruşta alev kabarır; ses seviyesi yükselme hızını biraz değiştirir.
 * Kıvılcımlar ara sıra, rastgele patlamalar halinde çıkar; hızlı ve parlak başlar, soğuyarak (beyaz→sarı→kızıl→karanlık) söner. Renk: ateş / mavi alev / palet.
 */

const FRAG = `
precision highp float;
varying vec2 vUv;

uniform float uTime;
uniform float uClock;
uniform vec4 uBeatEv[6];
uniform float uFast;
uniform float uFlash;
uniform float uAspect;
uniform float uFlame;
uniform float uTurb;
uniform float uSparks;
uniform float uReact;
uniform float uBright;
uniform float uLayout;
uniform float uBinC;
uniform float uWind;
uniform float uLean;
uniform float uMode;
uniform float uLevel;
uniform float uBeat;
uniform sampler2D uSpec;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

vec3 pal(float t) {
  t = fract(t) * 4.0;
  if (t < 1.0) return mix(uC0, uC1, t);
  if (t < 2.0) return mix(uC1, uC2, t - 1.0);
  if (t < 3.0) return mix(uC2, uC3, t - 2.0);
  return mix(uC3, uC0, t - 3.0);
}

// Sicaklik 0..1 -> renk
vec3 ramp(float h) {
  if (uMode < 0.5) {
    vec3 c = mix(vec3(0.0), vec3(0.45, 0.02, 0.0), smoothstep(0.0, 0.25, h));
    c = mix(c, vec3(1.0, 0.30, 0.0), smoothstep(0.2, 0.5, h));
    c = mix(c, vec3(1.0, 0.78, 0.15), smoothstep(0.45, 0.78, h));
    return mix(c, vec3(1.0, 0.97, 0.8), smoothstep(0.75, 1.0, h));
  }
  if (uMode < 1.5) {
    vec3 c = mix(vec3(0.0), vec3(0.02, 0.05, 0.35), smoothstep(0.0, 0.25, h));
    c = mix(c, vec3(0.1, 0.4, 1.0), smoothstep(0.2, 0.5, h));
    c = mix(c, vec3(0.5, 0.85, 1.0), smoothstep(0.45, 0.78, h));
    return mix(c, vec3(0.95, 1.0, 1.0), smoothstep(0.75, 1.0, h));
  }
  return pal(h * 0.85) * smoothstep(0.0, 0.3, h) + vec3(smoothstep(0.85, 1.0, h) * 0.5);
}

// Ekran x -> spektrum konumu. 0: ODAKLI (ekran ortasi = en guclu frekans uBinC, yanlari frekans komsulari, sinirda aynalanir);
// 1: simetrik (bas ortada; d^1.5 merkezde sivri V olusmasini onler); 2: soldan saga
float binX(float x) {
  if (uLayout < 0.5) {
    float t = abs(uBinC + (x - 0.5) * 0.6);
    return t > 1.0 ? max(2.0 - t, 0.0) : t;
  }
  if (uLayout < 1.5) return pow(abs(x - 0.5) * 2.0, 1.5);
  return x;
}

float colEnergy(float x) {
  float xs = binX(x);
  float e = max((texture2D(uSpec, vec2(clamp(xs, 0.0, 1.0), 0.5)).r - 0.1) * 1.6 * uReact, 0.0);
  // Yumusak sikistirma: yuksek tepeler ince igne gibi yukselmesin
  return 1.25 * e / (1.0 + 0.4 * e);
}

float colHeight(float x) {
  // Taban yuksekligi YOK: muzik yokken alev tamamen soner
  return clamp(0.74 * colEnergy(x) * uFlame + 0.1 * uBeat * uFlame + 0.06 * uLevel + 0.3 * uFlash * uFlame, 0.0, 1.3);
}

// Tek kivilcim: hizli ve cok parlak cikar (uzun iz), surtunmeyle yavaslar, kuculur ve beyaz-saridan turuncuya, kizila,
// karanliga SOGUYARAK soner. boost > 1: daha parlak, hizli ve uzun omurlu (vurus kivilcimlari). flameGate: yalnizca o noktada
// alev gercekten yuksekse cikar (vurus kivilcimlari guclu sutunlardan kopar).
vec3 oneSpark(vec2 uv, float x0, float y0, float sd, float age, float boost, float flameGate) {
  float L = (1.5 + 1.2 * hash(vec2(sd, 8.0))) * (0.8 + 0.25 * boost);
  if (age <= 0.0 || age >= L) return vec3(0.0);
  float v0 = (0.45 + 0.5 * hash(vec2(sd, 10.0))) * (0.8 + 0.3 * boost);
  float k = 1.5;
  float ex = exp(-k * age);
  float py = y0 + v0 * (1.0 - ex) / k;
  float px = x0 + (hash(vec2(sd, 11.0)) - 0.5) * 0.14 * (1.0 - ex) / k + uWind * 0.05 * age * age + sin(age * 7.0 + sd) * 0.005;
  vec2 d = vec2((uv.x - px) * uAspect, uv.y - py);
  if (abs(d.x) > 0.06 || abs(d.y) > 0.14) return vec3(0.0);
  if (flameGate > 0.5 && colHeight(x0) < y0 + 0.05) return vec3(0.0);
  float temp = exp(-age / (L * 0.45));
  float sx = 0.0032 * (0.55 + 0.45 * temp) * (0.9 + 0.2 * boost);
  // Kor: yuvarlak parlak bas + yumusak hale + KISA, ucu incelen kuyruk (kuyruk uzunlugu hiza bagli ama sinirli; eskiden bas/kuyruk
  // orani ~10:1 oldugu icin ilk anda ince cizgi gibi gorunuyordu)
  float stretch = clamp(6.0 * v0 * ex * temp, 0.0, 2.5);
  vec2 dd = d / sx;
  float head = exp(-dot(dd, dd));
  float halo = 0.22 * exp(-dot(dd, dd) / 9.0);
  float below = max(-dd.y, 0.0);
  float tail = (dd.y < 0.0 ? 1.0 : 0.0) * exp(-below / (0.8 + 1.4 * stretch)) * exp(-dd.x * dd.x * 1.3) * 0.55 * min(1.0, stretch);
  float g = head + halo + tail;
  float fade = smoothstep(L, L * 0.75, age);
  return ramp(0.12 + 0.88 * temp) * g * (0.15 + 2.2 * pow(temp, 1.4)) * boost * fade;
}

// Kivilcimlar: (1) ARA SIRA, RASTGELE: 6 yuva, her biri 4-10 sn aralikla 1-3 kivilcimlik patlama; (2) VURUS: JS her vurusta bir olay
// (zaman, siddet, tohum) gonderir; siddet arttikca daha cok, daha parlak, daha hizli kivilcim koparir. Muzik bitince (uLevel) kaybolur.
vec3 sparksAt(vec2 uv) {
  vec3 acc = vec3(0.0);
  // Kapi: yavas seviye (sessizlikte ~1 sn tutar) YA DA hizli seviye (ilk ani vurus hemen acar)
  float gate = smoothstep(0.02, 0.1, max(uLevel, uFast));
  if (gate < 0.001 || uSparks < 0.01) return acc;
  float rb = 1.0 + 0.6 * uBeat;

  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float T = (3.0 + 5.0 * hash(vec2(fi, 1.0))) / max(uSparks, 0.2);
    float tt = uClock + hash(vec2(fi, 2.0)) * T;
    float ev = floor(tt / T);
    float age0 = tt - ev * T;
    float seed = ev * 7.13 + fi * 3.1;
    if (age0 < 3.2 && hash(vec2(seed, 5.0)) < 0.8) {
      float x0 = hash(vec2(seed, 6.0));
      float y0 = 0.03 + 0.3 * hash(vec2(seed, 7.0)) * uFlame;
      for (int j = 0; j < 3; j++) {
        float fj = float(j);
        float sd = seed + fj * 11.3;
        if (j == 0 || hash(vec2(sd, 9.0)) < 0.6) acc += oneSpark(uv, x0, y0, sd, age0 - fj * 0.06, rb, 0.0);
      }
    }
  }

  for (int e = 0; e < 6; e++) {
    vec4 ev = uBeatEv[e];
    float age0 = uClock - ev.x;
    if (ev.x > 0.0 && age0 > 0.0 && age0 < 2.4) {
      // Normal vurus: kucuk demet (2-6). ANI BASLANGIC (w=1): cok dolu patlama (~24) — fark gozle net gorulsun
      // Ani baslangicta sayi/parlaklik SIDDETE gore olceklenir: hafif onset ~6 kivilcim, en sert ~22
      float onset = ev.w > 0.5 ? 1.0 : 0.0;
      float sev = clamp((ev.y - 0.9) / 1.3, 0.0, 1.0);
      float n = onset > 0.5 ? min(24.0, mix(6.0, 22.0, sev) * clamp(uSparks / 1.4, 0.5, 1.2)) : min(8.0, (1.0 + 3.0 * ev.y) * clamp(uSparks, 0.5, 3.0));
      for (int j = 0; j < 24; j++) {
        float fj = float(j);
        if (fj < n) {
          float sd = ev.z + fj * 5.7;
          float x0 = hash(vec2(sd, 6.0));
          float y0 = 0.02 + 0.25 * hash(vec2(sd, 7.0)) * uFlame;
          // ev.w = 1: ani baslangic (sessizlikten sert vurus) -> alev henuz yukselmediginden alev kapisi yok
          acc += oneSpark(uv, x0, y0, sd, age0 - fj * 0.02, onset > 0.5 ? mix(1.8, 3.2, sev) : 1.0 + 0.5 * ev.y, onset > 0.5 ? 0.0 : 1.0);
        }
      }
    }
  }
  return acc * gate;
}

void main() {
  vec2 uv = vUv;

  // Esinti + merkeze cekim: alevler yukseldikce ruzgarla yana yatar ve merkeze dogru egilir (konveksiyon). Piksel (x,y) tabandaki
  // x_b sutununa aittir: x_b = x + (x - 0.5)*lean*y^1.3 - ruzgar*y^1.3
  float lift = pow(uv.y, 1.3);
  float xb = uv.x + (uv.x - 0.5) * 0.5 * uLean * lift - uWind * 0.22 * lift;
  // Esinti sirasinda alev dilleri hafifce titrer (durgan donemde dik ve sakin)
  xb += sin(uv.y * 8.0 - uClock * 5.0) * 0.012 * abs(uWind) * lift;
  float hgt = colHeight(xb);

  // Yukari kayan, kendisiyle bukulmus gurultu: alev dilleri
  vec2 p = vec2(xb * uAspect * 3.2, uv.y * 1.7 - uTime * 1.7);
  vec2 q = vec2(fbm(p * 0.8 + vec2(3.1, -uTime * 0.4)), fbm(p * 0.8 + vec2(7.7, -uTime * 0.6)));
  float n = fbm(p + (q - 0.5) * 1.6 * uTurb);

  float d = uv.y / max(hgt, 0.001);
  float heat = (1.0 - d) * 1.2 + (n - 0.45) * uTurb * 0.9 * (0.35 + d * 0.9);
  heat += smoothstep(0.1, 0.0, uv.y) * 0.4;
  // Kapi: alev yuksekligi sifira yakinken hicbir sicaklik kalmaz (gurultu/taban kizarmasi dahil)
  float lit = smoothstep(0.0, 0.07, hgt);
  heat = pow(clamp(heat, 0.0, 1.0), 1.25) * lit;

  vec3 col = ramp(heat);

  col += sparksAt(uv);

  // Alevin yaydigi sicak isik (tabanda)
  col += ramp(0.45) * exp(-uv.y * 3.0) * (0.05 + 0.1 * colEnergy(uv.x)) * 0.8 * lit;

  col *= uBright;
  col = 1.0 - exp(-col * 1.4);
  gl_FragColor = vec4(col, 1.0);
}
`;

const SPEC_W = 96;

export class Fire implements Visualizer {
  readonly manualRender = true;

  private gl: THREE.WebGLRenderer;
  private quad: QuadShader;
  private tex: THREE.DataTexture;
  private data = new Uint8Array(SPEC_W);
  private specS = new Float32Array(SPEC_W);
  private colors = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];
  private tmpSize = new THREE.Vector2();
  private time = 0;
  private clock = 0;
  /** Odak: en güçlü (ortalamasının en çok üstüne çıkan) frekans konumu; yavaşça süzülerek değişir. */
  private binC = 0.1;
  private blur = new Float32Array(SPEC_W);
  /** Vuruş kıvılcım olayları (halka tampon): (başlangıç zamanı, şiddet, tohum). */
  private beatEv = Array.from({ length: 6 }, () => new THREE.Vector4(-100, 0, 0, 0));
  private beatIdx = 0;
  private lastBeat = -1;
  /** Hızlı ses seviyesi (damp 25): ani başlangıcı yavaş seviyeden önce yakalar. */
  private fast = 0;
  /** Ani patlamada 1'e çıkar, ~0.5 sn'de söner: alev bir an kabarır. */
  private flash = 0;
  // Rüzgar durum makinesi
  private windV = 0;
  private gustT = 0;
  private gustD = 0;
  private gustA = 0;
  private gustDir = 1;
  /** > 0 iken durağan dönem (kalan süre, sn); 0 iken esinti sürüyor. */
  private calmT = 2;
  private avg = new Float32Array(SPEC_W);
  private sLevel = 0;
  private sBeat = 0;

  constructor(gl: THREE.WebGLRenderer) {
    this.gl = gl;
    this.tex = new THREE.DataTexture(this.data, SPEC_W, 1, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    this.quad = new QuadShader(FRAG, {
      uTime: { value: 0 },
      uClock: { value: 0 },
      uBeatEv: { value: this.beatEv },
      uFast: { value: 0 },
      uFlash: { value: 0 },
      uAspect: { value: 1 },
      uFlame: { value: 1 },
      uTurb: { value: 1 },
      uSparks: { value: 1 },
      uReact: { value: 1 },
      uBright: { value: 1 },
      uLayout: { value: 0 },
      uBinC: { value: 0.1 },
      uWind: { value: 0 },
      uLean: { value: 0.7 },
      uMode: { value: 0 },
      uLevel: { value: 0 },
      uBeat: { value: 0 },
      uSpec: { value: this.tex },
      uC0: { value: this.colors[0] },
      uC1: { value: this.colors[1] },
      uC2: { value: this.colors[2] },
      uC3: { value: this.colors[3] },
    });
  }

  init(): void {}

  resize(): void {}

  /**
   * Esinti: sakin dönem (2.5–7 sn, rüzgâr ~0) → rastgele yönde (±), rastgele şiddette (0.4–1.2), rastgele sürede (1.5–4 sn) bir esinti
   * (sin² zarfı: yumuşak başlar, doruğa çıkar, söner; üstüne hafif dalgalanma). Bazen (%25) hemen ters yönde ikinci bir esinti gelir.
   */
  private stepWind(dt: number): void {
    let target = 0;
    if (this.calmT > 0) {
      this.calmT -= dt;
      if (this.calmT <= 0) {
        this.gustT = 0;
        this.gustD = 1.5 + Math.random() * 2.5;
        this.gustA = 0.4 + Math.random() * 0.8;
        this.gustDir = Math.random() < 0.5 ? -1 : 1;
      }
    } else {
      this.gustT += dt;
      const k = this.gustT / this.gustD;
      if (k >= 1) {
        const chain = Math.random() < 0.25;
        this.calmT = chain ? 0.2 + Math.random() * 0.6 : 2.5 + Math.random() * 4.5;
        if (chain) this.gustDir = -this.gustDir;
        else this.gustDir = Math.random() < 0.5 ? -1 : 1;
      } else {
        const env = Math.sin(Math.PI * k);
        target = this.gustDir * this.gustA * env * env * (1 + 0.2 * Math.sin(this.clock * 5));
      }
    }
    this.windV += (target - this.windV) * damp(dt, 3);
  }

  update(frame: AudioFrame, s: VisualizerSettingsView): void {
    const o = s.opt;
    const dt = frame.dt;

    this.sLevel += (frame.level - this.sLevel) * damp(dt, 3);
    this.sBeat += (frame.beatPulse - this.sBeat) * damp(dt, 6);
    // Yükselme hızı ses seviyesiyle biraz değişir (sessizlikte alev sönmeden hafifçe kıpırdar)
    this.time += dt * (0.55 + this.sLevel * 0.6);

    // Sütun enerjisi: zamanda yumuşak yükselir (damp 9) ve daha yavaş söner (damp 4)
    for (let i = 0; i < SPEC_W; i++) {
      const raw = binAtLerp(frame.freq, i / (SPEC_W - 1));
      const cur = this.specS[i];
      this.specS[i] = cur + (raw - cur) * damp(dt, raw > cur ? 9 : 4);
    }
    // Uzayda yumuşatma: komşu sütunlar birbirine karışır → tek bir bin ince sivri alev çıkarmaz, alevler geniş tepeler olur
    for (let i = 0; i < SPEC_W; i++) {
      let sum = 0;
      let wsum = 0;
      for (let k = -3; k <= 3; k++) {
        const j = Math.min(SPEC_W - 1, Math.max(0, i + k));
        const wgt = 4 - Math.abs(k);
        sum += this.specS[j] * wgt;
        wsum += wgt;
      }
      this.blur[i] = sum / wsum;
      this.data[i] = Math.min(255, Math.round(this.blur[i] * 255));
    }

    // Odak frekans: her sütunun yavaş ortalamasının en çok üstüne çıkan sütun (en "yüksek tepe"); müzik varken hedef güncellenir,
    // merkez yavaşça süzülür (damp 1.3) → sürekli değişir ama sıçramaz
    let best = 0.08;
    let bestI = -1;
    for (let i = 0; i < SPEC_W; i++) {
      this.avg[i] += (this.blur[i] - this.avg[i]) * damp(dt, 0.4);
      const prom = this.blur[i] - this.avg[i] * 0.9;
      if (prom > best) {
        best = prom;
        bestI = i;
      }
    }
    if (bestI >= 0) this.binC += (bestI / (SPEC_W - 1) - this.binC) * damp(dt, 1.3);
    this.clock += dt;
    // Rüzgar: rastgele esintiler (rastgele yön/şiddet/süre) ve aralarında DURAĞAN dönemler (rüzgâr ~0, alev dik durur)
    this.stepWind(dt);

    // Ani yükseliş (vuruş): güçlüğüne göre bir kıvılcım demeti tetikle (en fazla 5.5 vuruş/sn).
    // ANİ BAŞLANGIÇ: yavaş seviye henüz düşükken (sessizlik/sakinlik) gelen sert vuruş = seviye sıçraması büyük → şiddet çok yüksek,
    // en fazla kıvılcım, alev kapısı yok (alev daha yükselmeden hemen çıkar).
    this.fast += (frame.level - this.fast) * damp(dt, 25);
    this.flash = Math.max(0, this.flash - dt * 2);
    if (frame.beat && this.clock - this.lastBeat > 0.18) {
      this.lastBeat = this.clock;
      const jump = Math.max(0, frame.level - this.sLevel);
      const onset = (jump > 0.06 && this.sLevel < 0.1) || jump > 0.18 ? 1 : 0;
      const strength = Math.min(2.2, 0.5 + frame.bass * 0.6 + this.sLevel * 0.6 + jump * 5);
      if (onset) this.flash = Math.max(this.flash, 0.3 + 0.7 * Math.min(1, Math.max(0, (strength - 0.9) / 1.3)));
      this.beatEv[this.beatIdx].set(this.clock, strength, Math.random() * 100, onset);
      this.beatIdx = (this.beatIdx + 1) % this.beatEv.length;
    }
    const wind = this.windV * o.wind * (0.7 + 0.5 * this.sLevel);
    this.tex.needsUpdate = true;

    for (let i = 0; i < 4; i++) {
      const c = sampleGradient(s.palette.colors, i / 3);
      this.colors[i].setRGB(c[0] / 255, c[1] / 255, c[2] / 255);
    }

    const size = this.gl.getDrawingBufferSize(this.tmpSize);
    const u = this.quad.material.uniforms;
    u.uTime.value = this.time;
    u.uClock.value = this.clock;
    u.uFast.value = this.fast;
    u.uFlash.value = this.flash;
    u.uAspect.value = size.x / size.y;
    u.uFlame.value = o.flame;
    u.uTurb.value = o.flicker;
    u.uSparks.value = o.sparks;
    u.uReact.value = o.react;
    u.uBright.value = o.bright;
    u.uLayout.value = Math.round(o.layout);
    u.uBinC.value = this.binC;
    u.uWind.value = wind;
    u.uLean.value = o.lean;
    u.uMode.value = Math.round(o.colors);
    u.uLevel.value = this.sLevel;
    u.uBeat.value = this.sBeat;

    this.quad.render(this.gl, null);
  }

  dispose(): void {
    this.tex.dispose();
    this.quad.dispose();
  }
}
