import * as THREE from 'three';
import { binAtLerp, sampleGradient } from './palettes';
import { QuadShader } from './quadShader';
import { EventScale, OnsetTracker } from './onset';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { damp } from './util';

/**
 * Parazit (eski adı Statik): iki stil (tam ekran GPU shader; analog bozulmalar satır satır olduğu için shader doğal).
 *
 * ANTEN PARAZİTİ (90'lar/2000'ler CRT televizyon, çekmeyen anten): sinyal = renk çubuğu test kartı (paletten); sinyal gücü değiştikçe görüntü
 * karın arkasından belirir/kaybolur. Gerçek analog bozulmalar: (1) KAR (zayıf sinyalde yatay uzayan gri benekler + kısa parlak çizgiler);
 * (2) HUM ÇUBUKLARI (yukarı kayan geniş yumuşak yatay bantlar; şebeke paraziti); (3) BALIKSIRTI (herringbone: görüntünün üstüne binen ince zikzak
 * çapraz çizgiler); (4) HAYALET GÖRÜNTÜ (çok yollu yansıma: yana kaymış soluk kopya); (5) DİKEY KAYMA (V-hold kaybı: görüntü yukarı döner, kararma
 * çubuğu) ve satır satır YATAY TİTREME / YIRTILMA; (6) renk taşması (kanal kayması) ve zayıfken renk solması; (7) rastgele YATAY KIVILCIM çizgileri;
 * tarama çizgileri, ara taramalı titreme, vinyet.
 * SESSİZLİKTE DURAĞAN: yapısal parazit (hum çubukları, balıksırtı, hayalet, sabit hafif satır kayması, orta güçte sinyal) hareketsiz durur — yalnız kar (analog
 * kar doğası gereği hep titrer) akar; roll, dalga, sinyal kaybı, yırtılma YOK. Müzik başlayınca (`act` 0→1, yumuşak) her şey ritimle canlanır.
 * MÜZİK: sinyal netliği gürlük + vuruşla değişir (+ yavaş "hava" ve ara sıra sinyal kaybı); çubukların parlaklığı frekansla; BAS = hum çubukları,
 * TİZ = balıksırtı, ORTA = hayalet kayması; güçlü vuruşta kayma ivmesi, yırtılma bantları, kıvılcım çizgileri (müziğin ortalamasına göre şiddet).
 *
 * KLASİK KAR (eski görünüm): CRT kar yağışı, renkli taneler, yoğunluk frekansa göre; parazit çizgisi, tarama çizgileri, vinyet.
 */

const FRAG = `
precision highp float;
varying vec2 vUv;

uniform vec2 uRes;
uniform float uRatio;
uniform float uClock;
uniform float uStyle;
uniform float uGrain;
uniform float uDens;
uniform float uReact;
uniform float uSignal;
uniform float uRoll;
uniform float uJit;
uniform float uGhost;
uniform float uGhostOff;
uniform float uHum;
uniform float uAct;
uniform float uHumPh;
uniform float uHerrPh;
uniform float uWavePh;
uniform float uHerr;
uniform float uScan;
uniform float uVig;
uniform float uBeat;
uniform vec4 uBand[2];
uniform vec2 uLines[3];
uniform vec3 uBar[7];
uniform vec3 uNC[8];
uniform vec3 uBg;
uniform vec3 uFlash;
uniform sampler2D uSpec;

#define TAU 6.28318530718

float h1(float n, float seed) {
  return fract(sin(n * 127.1 + seed * 311.7) * 43758.5453);
}

float h2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float spec(float t) {
  return texture2D(uSpec, vec2(clamp(t, 0.0, 1.0), 0.5)).r;
}

// ---- KLASIK KAR ----
vec3 classic(vec2 px, float tq) {
  vec2 cid = floor(px / uGrain);
  float e = clamp((spec((cid.x * uGrain) / uRes.x) - 0.08) * 1.7, 0.0, 1.2);
  float dens = clamp(uDens * (1.0 + (e - 0.35) * 0.9 * uReact), 0.03, 0.97);
  float r = h2(cid + tq * vec2(0.37, 1.13));
  if (r < dens) {
    int ci = int(floor(h2(cid + tq * 3.1 + 7.0) * 8.0));
    float b = 0.45 + 0.55 * h2(cid + tq * 1.7 + 3.0);
    return uNC[ci] * b;
  }
  return uBg * 0.4;
}

// ---- ANTEN PARAZITI: test karti (renk cubuklari) ----
vec3 bars(float u, float v) {
  float uu = clamp(u, 0.0, 0.9999);
  float b = floor(uu * 7.0);
  if (v > 0.33) {
    float e = spec((b + 0.5) / 7.0 * 0.9);
    float lit = clamp(0.55 + 0.7 * clamp((e - 0.1) * 1.7 * uReact, 0.0, 1.2), 0.0, 1.1);
    return uBar[int(b)] * lit;
  }
  if (v > 0.23) {
    return uBar[int(6.0 - b)] * 0.5 * (mod(b, 2.0) < 0.5 ? 1.0 : 0.25);
  }
  return vec3(uu);
}

vec3 antenna(vec2 uv, vec2 px, float tq) {
  float line = floor(px.y / (2.0 * uRatio));
  float s = uSignal;
  // Satir basina rastgele sinyal dususu (zayifken satirlar kopar)
  float sl = clamp(s + (h1(line, floor(uClock * 8.0) * step(0.3, uAct)) - 0.5) * 0.35 * (1.0 - s), 0.0, 1.0);

  // Dikey kayma (V-hold): resim yukari doner; kararma cubugu v ~ 0 civarinda
  float v = fract(uv.y - uRoll);
  float nearBar = smoothstep(0.2, 0.0, v) + smoothstep(0.88, 1.0, v);

  // Yatay titreme / yirtilma: satir basina rastgele kayma + dalga + cubuga yakin siddetli + vurus bantlari
  // Sabit taban (sessizde de var, hareketsiz) + muzikle canli kisim (satir titremesi, ritimle dalga, kararma cubugu yakininda yirtilma)
  float jit = (h1(line, 1.0) - 0.5) * uJit * 0.5 * (1.0 - 0.5 * s)
    + (h1(line, 2.0) - 0.5) * 0.012 * nearBar * (1.0 - 0.5 * s)
    + (h1(line, tq * 0.5) - 0.5) * uJit * (0.4 + 0.6 * (1.0 - s)) * uAct * 0.9
    + sin(line * 0.07 + uWavePh) * (0.002 * (1.0 - s) + 0.012 * uBeat) * uAct
    + (h1(line, tq) - 0.5) * 0.03 * nearBar * (1.0 - 0.5 * s) * uAct;
  for (int i = 0; i < 2; i++) {
    vec4 bd = uBand[i];
    if (bd.w > 0.5 && uv.y >= bd.x && uv.y <= bd.x + bd.y) jit += bd.z;
  }
  float u = uv.x + jit;

  // Yatay yumusaklik (3 ornek) + renk tasmasi (R/B kanal kaymasi): zayifken artar
  float bl = 0.0015 + 0.004 * (1.0 - sl);
  float ch = 0.0015 + 0.005 * (1.0 - sl) + 0.008 * uBeat * uAct;
  vec3 pic = vec3(0.0);
  for (int k = -1; k <= 1; k++) {
    float uk = u + float(k) * bl;
    pic += vec3(bars(uk + ch, v).r, bars(uk, v).g, bars(uk - ch, v).b) / 3.0;
  }
  // Hayalet goruntu (cok yollu yansima): yana kaymis soluk kopya
  vec3 ghost = vec3(bars(u - uGhostOff + ch, v).r, bars(u - uGhostOff, v).g, bars(u - uGhostOff - ch, v).b);
  pic = mix(pic, ghost, clamp(0.2 * uGhost * (0.4 + (1.0 - sl)), 0.0, 0.5));
  // Zayifken renk solar
  float gray = dot(pic, vec3(0.3, 0.59, 0.11));
  pic = mix(vec3(gray), pic, 0.35 + 0.65 * sl);

  // Kararma (blanking) cubugu
  if (v < 0.07 || v > 0.985) pic = vec3(0.04) + vec3(0.03 * step(0.5, fract(px.y / (6.0 * uRatio))));

  // Balik sirti (herringbone): ince zikzak capraz cizgiler (yon her ~28 satirda degisir)
  float tri = abs(fract(line * 0.035) - 0.5) * 2.0;
  pic += sin(u * 260.0 + tri * 18.0 + uHerrPh) * 0.08 * uHerr * (0.5 + (1.0 - sl));

  // Hum cubuklari: yukari kayan genis yumusak yatay bantlar (bas)
  float hb = sin((uv.y * 2.0 + uHumPh) * TAU);
  pic *= 1.0 - uHum * 0.35 * (0.5 + 0.5 * hb);

  // Kar: yatay uzayan benekler + kisa parlak cizgiler; sinyal zayifladikca baskin
  float cellW = max(1.0, uGrain * 0.5);
  float nx = floor(px.x / cellW);
  float n = pow(h2(vec2(nx, line) + tq * vec2(1.3, 0.7)), 1.4);
  float dash = step(0.985, h2(vec2(floor(px.x / (14.0 * uRatio)), line * 1.3) + tq * 2.1));
  float snow = clamp(n + dash * 0.7, 0.0, 1.0);
  vec3 snowCol = vec3(snow) * vec3(0.95, 0.97, 1.0)
    + (vec3(h2(vec2(nx, line) + tq + 3.0), h2(vec2(nx, line) + tq + 7.0), h2(vec2(nx, line) + tq + 11.0)) - 0.5) * 0.1 * (1.0 - sl);
  float na = 0.1 + 0.9 * pow(1.0 - sl, 1.2);
  vec3 col = pic * (1.0 - 0.85 * na) + snowCol * na;

  // Rastgele yatay kivilcim cizgileri (kismi uzunluk, kar benzeri parlak)
  for (int i = 0; i < 3; i++) {
    vec2 ln = uLines[i];
    if (ln.y > 0.0 && abs(uv.y - ln.x) < 1.6 / uRes.y * uRatio) {
      float part = step(h2(vec2(floor(uv.x * 10.0), ln.x * 97.0)), 0.65);
      col = mix(col, vec3(1.0), part * ln.y * 0.85);
    }
  }
  return col;
}

void main() {
  vec2 uv = vUv;
  vec2 px = uv * uRes;
  float tq = floor(uClock * 60.0);
  vec3 col;
  if (uStyle < 0.5) {
    col = antenna(uv, px, tq);
  } else {
    col = classic(px, tq);
    // Klasik: vurusta/olasilikla beyaz parazit cizgisi
    for (int i = 0; i < 3; i++) {
      vec2 ln = uLines[i];
      if (ln.y > 0.0 && abs(uv.y - ln.x) < 1.0 / uRes.y) col = vec3(1.0);
    }
  }

  // CRT: tarama cizgileri (3 css px'te bir koyu cizgi), ara taramali hafif titreme, vinyet, vurus parlamasi
  float linePx = px.y / uRatio;
  if (uScan > 0.5) col *= mod(linePx, 3.0) < 1.0 ? 0.78 : 1.0;
  if (uStyle < 0.5) col *= 0.93 + 0.07 * step(0.5, fract((floor(px.y / (2.0 * uRatio)) + floor(uClock * 30.0)) * 0.5));
  if (uVig > 0.5) {
    vec2 q = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    col *= 1.0 - 0.55 * smoothstep(0.3, 0.8, length(q) * 1.15);
  }
  col += uFlash * 0.05 * uBeat;
  gl_FragColor = vec4(col, 1.0);
}
`;

const SPEC_W = 64;

interface Band {
  y0: number;
  h: number;
  shift: number;
  age: number;
  dur: number;
}

interface Spark {
  y: number;
  s: number;
  age: number;
  dur: number;
}

export class StaticNoise implements Visualizer {
  readonly manualRender = true;

  private gl: THREE.WebGLRenderer;
  private quad: QuadShader;
  private tex: THREE.DataTexture;
  private data = new Uint8Array(SPEC_W);
  private specS = new Float32Array(SPEC_W);
  private res = new THREE.Vector2(1, 1);
  private bands = Array.from({ length: 2 }, () => new THREE.Vector4());
  private lines = Array.from({ length: 3 }, () => new THREE.Vector2(0, 0));
  private bar = Array.from({ length: 7 }, () => new THREE.Vector3());
  private nc = Array.from({ length: 8 }, () => new THREE.Vector3());
  private bg = new THREE.Color();
  private flash = new THREE.Color();
  private tmpSize = new THREE.Vector2();
  private paletteId = '';
  private clock = 0;
  private roll = 0;
  private rollKick = 0;
  private signal = 0.42;
  /** Müzik etkinliği 0→1 (yumuşak): sessizde 0 → parazit durağan; faz değişkenleri yalnız müzikle ilerler. */
  private act = 0;
  private humPh = 0;
  private herrPh = 0;
  private wavePh = 0;
  private dip = 1;
  private bandList: Band[] = [];
  private sparkList: Spark[] = [];
  private onset = new OnsetTracker();
  private scale = new EventScale();
  private sSlow = 0;
  private sLevel = 0;
  private sBass = 0;
  private sMid = 0;
  private sTreble = 0;

  constructor(gl: THREE.WebGLRenderer) {
    this.gl = gl;
    this.tex = new THREE.DataTexture(this.data, SPEC_W, 1, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    this.quad = new QuadShader(FRAG, {
      uRes: { value: this.res },
      uRatio: { value: 1 },
      uClock: { value: 0 },
      uStyle: { value: 0 },
      uGrain: { value: 4 },
      uDens: { value: 0.4 },
      uReact: { value: 1 },
      uSignal: { value: 0.5 },
      uRoll: { value: 0 },
      uJit: { value: 0.01 },
      uGhost: { value: 1 },
      uGhostOff: { value: 0.03 },
      uHum: { value: 0.3 },
      uAct: { value: 0 },
      uHumPh: { value: 0 },
      uHerrPh: { value: 0 },
      uWavePh: { value: 0 },
      uHerr: { value: 0.2 },
      uScan: { value: 1 },
      uVig: { value: 1 },
      uBeat: { value: 0 },
      uBand: { value: this.bands },
      uLines: { value: this.lines },
      uBar: { value: this.bar },
      uNC: { value: this.nc },
      uBg: { value: this.bg },
      uFlash: { value: this.flash },
      uSpec: { value: this.tex },
    });
  }

  init(): void {}

  resize(): void {}

  update(frame: AudioFrame, s: VisualizerSettingsView): void {
    const o = s.opt;
    const dt = frame.dt;
    this.clock += dt;
    const size = this.gl.getDrawingBufferSize(this.tmpSize);
    const ratio = this.gl.getPixelRatio();
    this.res.set(size.x, size.y);
    const antenna = Math.round(o.style) === 0;

    this.sSlow += (frame.level - this.sSlow) * damp(dt, 0.8);
    this.sLevel += (frame.level - this.sLevel) * damp(dt, 5);
    this.sBass += (frame.bass - this.sBass) * damp(dt, 4);
    this.sMid += (frame.mid - this.sMid) * damp(dt, 4);
    this.sTreble += (frame.treble - this.sTreble) * damp(dt, 4);
    this.scale.tick(dt);

    for (let i = 0; i < SPEC_W; i++) {
      const raw = binAtLerp(frame.freq, i / (SPEC_W - 1));
      const cur = this.specS[i];
      const v = cur + (raw - cur) * damp(dt, raw > cur ? 12 : 5);
      this.specS[i] = v;
      this.data[i] = Math.min(255, Math.round(v * 255));
    }
    this.tex.needsUpdate = true;

    if (this.paletteId !== s.palette.id) {
      this.paletteId = s.palette.id;
      for (let i = 0; i < 7; i++) {
        const c = sampleGradient(s.palette.colors, i / 6);
        this.bar[i].set(c[0] / 255, c[1] / 255, c[2] / 255);
      }
      for (let i = 0; i < 8; i++) {
        const c = sampleGradient(s.palette.colors, i / 7);
        this.nc[i].set(c[0] / 255, c[1] / 255, c[2] / 255);
      }
      const f = sampleGradient(s.palette.colors, 0.5);
      this.flash.setRGB(f[0] / 255 + (1 - f[0] / 255) * 0.6, f[1] / 255 + (1 - f[1] / 255) * 0.6, f[2] / 255 + (1 - f[2] / 255) * 0.6);
    }
    this.bg.set(s.palette.bg);

    // --- Olaylar: vuruş şiddeti (müziğin ortalamasına göre; bas vermeyen müzikte onset) ---
    const hit = this.onset.update(frame, dt, 1.8, 0.4);
    let pw = 0;
    if (frame.beat || hit) {
      const e = frame.beat ? frame.bass + 0.3 * Math.min(1, this.sLevel * 2) : 0.3 * Math.min(1, this.onset.ratio / 4) + 0.3 * frame.bass;
      pw = this.scale.rel(e);
    }

    if (antenna) {
      // Müzik etkinliği: sessizde 0 (parazit DURAĞAN), müzikle 1'e yumuşakça çıkar
      const loud = Math.min(1, this.sSlow * 3);
      const actTarget = Math.min(1, Math.max(0, (this.sSlow - 0.012) / 0.04));
      this.act += (actTarget - this.act) * damp(dt, 2);
      const act = this.act;

      // Sinyal netliği: sessizde SABİT orta güç (0.42); müzikle gürlük + vuruş + yavaş "hava"; ara sıra tam sinyal kaybı (yalnız müzikle)
      const t = this.clock;
      const weather = 0.5 + 0.5 * Math.sin(t * 0.37) * Math.sin(t * 0.91 + 1.3);
      const dipTarget = Math.sin(t * 0.23) + Math.sin(t * 0.61 + 2) > 1.5 ? 0.15 : 1;
      this.dip += (dipTarget - this.dip) * damp(dt, 4);
      const musicSig = 0.15 + 0.65 * loud + 0.3 * frame.beatPulse + 0.25 * (weather - 0.5);
      const target = Math.min(1, Math.max(0, (0.42 + (musicSig - 0.42) * act) * o.sig)) * (1 + (this.dip - 1) * act);
      this.signal += (target - this.signal) * damp(dt, 4);

      // V-hold: yalnız müzikle; zayıf sinyalde hızlanır; vuruş ivmesi (yumuşakça söner). Sessizde konum sabit.
      if (pw > 0.3) this.rollKick = Math.max(this.rollKick, (pw > 0.7 ? 0.8 : 0.3) * pw);
      this.rollKick = Math.max(0, this.rollKick - dt * 1.5);
      const rollSpeed = act * (0.012 + 1.3 * Math.pow(1 - this.signal, 3.5) * o.roll + this.rollKick * o.roll);
      this.roll = (this.roll + dt * rollSpeed) % 1;

      // Faz değişkenleri yalnız müzikle ilerler (hum çubukları bas/gürlükle, balıksırtı tizle, satır dalgası ritimle)
      this.humPh += dt * act * 0.08 * (0.4 + 1.2 * loud + this.sBass);
      this.herrPh += dt * act * 3 * (0.5 + loud + this.sTreble * 2);
      this.wavePh += dt * act * 2.5 * (0.6 + loud);

      // Yırtılma bantları (orta/güçlü vuruş) ve kıvılcım çizgileri (güçlü vuruş)
      if (o.tear >= 0.5 && pw > 0.3 && this.bandList.length < 2) {
        this.bandList.push({
          y0: Math.random() * 0.9,
          h: 0.02 + 0.06 * pw,
          shift: (Math.random() < 0.5 ? -1 : 1) * (0.02 + 0.1 * pw) * (0.5 + Math.random()),
          age: 0,
          dur: 0.12 + 0.13 * pw,
        });
      }
      if (o.glitch >= 0.5 && pw > 0.5 && this.sparkList.length < 3) {
        this.sparkList.push({ y: Math.random(), s: 0.5 + 0.5 * pw, age: 0, dur: 0.08 });
      }
    } else if (o.glitch >= 0.5) {
      // Klasik: eski davranış — vuruşta ya da %6 olasılıkla 1 beyaz çizgi; şiddetli vuruşta ek çizgiler
      const n = (frame.beat || Math.random() < 0.06 ? 1 : 0) + (pw > 0.5 ? Math.round(pw * 3) : 0);
      this.sparkList = [];
      for (let i = 0; i < Math.min(3, n); i++) this.sparkList.push({ y: Math.random(), s: 1, age: 0, dur: 0 });
    }

    // Bant ve kıvılcım yaşları
    for (const b of this.bandList) b.age += dt;
    this.bandList = this.bandList.filter((b) => b.age < b.dur);
    for (const k of this.sparkList) k.age += dt;
    if (antenna) this.sparkList = this.sparkList.filter((k) => k.age < k.dur);
    for (let i = 0; i < 2; i++) {
      const b = this.bandList[i];
      if (b) this.bands[i].set(b.y0, b.h, b.shift * (1 - b.age / b.dur), 1);
      else this.bands[i].set(0, 0, 0, 0);
    }
    for (let i = 0; i < 3; i++) {
      const k = this.sparkList[i];
      if (k) this.lines[i].set(k.y, k.s);
      else this.lines[i].set(0, 0);
    }

    // Klasik yoğunluk (eski formül, yumuşatılmış seviye)
    const baseDensity = Math.min(0.97, (0.2 + Math.min(0.75, this.sLevel * 0.9 + frame.beatPulse * 0.2)) * o.density);

    const u = this.quad.material.uniforms;
    u.uRatio.value = ratio;
    u.uClock.value = this.clock;
    u.uStyle.value = antenna ? 0 : 1;
    u.uGrain.value = [2, 4, 8][Math.max(0, Math.min(2, Math.round(o.grain)))] * ratio;
    u.uDens.value = baseDensity;
    u.uReact.value = o.react;
    u.uSignal.value = this.signal;
    u.uRoll.value = this.roll;
    u.uJit.value = (0.004 + 0.02 * (1 - this.signal)) * o.jitter * 2.5;
    u.uGhost.value = o.ghost;
    u.uGhostOff.value = 0.02 + 0.04 * this.sMid;
    // Bas = hum çubukları, tiz = balıksırtı
    u.uHum.value = Math.min(1, 0.2 + 0.9 * this.sBass) * o.interf;
    u.uHerr.value = Math.min(1, 0.1 + 1.4 * this.sTreble) * o.interf;
    u.uScan.value = o.scanlines >= 0.5 ? 1 : 0;
    u.uVig.value = o.vignette >= 0.5 ? 1 : 0;
    u.uBeat.value = frame.beatPulse;
    u.uAct.value = antenna ? this.act : 1;
    u.uHumPh.value = this.humPh;
    u.uHerrPh.value = this.herrPh;
    u.uWavePh.value = this.wavePh;

    this.quad.render(this.gl, null);
  }

  dispose(): void {
    this.tex.dispose();
    this.quad.dispose();
  }
}
