import * as THREE from 'three';
import { binAtLerp, sampleGradient } from './palettes';
import { QuadShader } from './quadShader';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { clamp01, damp } from './util';

/**
 * Kaleydoskop (mandala): tam ekran, tek geçişli shader. Ekran önce `segments` adet aynalı dilime katlanır (polar katlama),
 * sonra her yineleme koordinatı katlar (abs), kaydırır, döndürür ve büyütür (KIFS). Her katmanın katlama izi parlak ışık hattı
 * olarak çizilir.
 *
 * - ŞEKİL: iz halka+çizgi, yıldız, altıgen, kristal veya katman katman karışık olabilir.
 * - DERİNLİK: uzak katmanlar sisli/geniş ışıma ve sönük; merkezde çekirdek; sonsuz zoom (iki zoom fazının çapraz geçişi).
 * - MÜZİKLE GEÇİŞ: her N vuruşta / tını değişiminde karartma-geçişiyle yeni segment sayısı ve katlama tohumu.
 * - RENK/IŞIK: çapsal/katmana göre renk, bloom (geniş hale), renk ayrışması (ince kenar rengi kayması), vuruşta kenar parlaması.
 */

const FRAG = `
precision highp float;
varying vec2 vUv;

uniform float uTime;
uniform float uAspect;
uniform float uSeg;
uniform float uIter;
uniform float uRot;
uniform float uHue;
uniform float uBreath;
uniform float uZoom;
uniform float uZoomPhase;
uniform float uZoomFlow;
uniform float uBright;
uniform float uShape;
uniform float uDepth;
uniform float uBloom;
uniform float uFringe;
uniform float uColorMode;
uniform float uLayerBands;
uniform float uTrans;
uniform vec2 uSeed;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uLevel;
uniform float uBeat;
uniform sampler2D uSpec;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uBg;

#define TAU 6.28318530718

vec3 pal(float t) {
  t = fract(t) * 4.0;
  if (t < 1.0) return mix(uC0, uC1, t);
  if (t < 2.0) return mix(uC1, uC2, t - 1.0);
  if (t < 3.0) return mix(uC2, uC3, t - 2.0);
  return mix(uC3, uC0, t - 3.0);
}

mat2 rot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

float sdHex(vec2 p, float r) {
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}

// Katlama izine uzaklık: 0 halka+çizgi, 1 yıldız, 2 altıgen, 3 kristal
float shapeD(vec2 z, float R, float k) {
  if (k < 0.5) return min(abs(length(z) - R), 1.2 * abs(z.x + z.y * 0.6));
  if (k < 1.5) return abs(length(z) - R * (0.65 + 0.3 * cos(5.0 * atan(z.y, z.x)))) * 0.8;
  if (k < 2.5) return abs(sdHex(z, R * 0.8));
  vec2 q = abs(z);
  return abs(max(q.x, q.y) + 0.3 * (q.x + q.y) - R);
}

vec3 mandala(vec2 p, float zm) {
  float r0 = length(p);

  // Polar katlama: ekranı seg adet aynalı dilime indir
  float a = atan(p.y, p.x) + uRot;
  float seg = TAU / uSeg;
  a = abs(mod(a, seg) - seg * 0.5);
  vec2 z = vec2(cos(a), sin(a)) * r0 * uZoom * zm * (1.0 + 0.22 * sin(uBreath));

  // Çapsal spektrum: merkezden dışa doğru frekanslar (düşük merkezde)
  float spec = texture2D(uSpec, vec2(clamp(r0 * 0.6, 0.0, 1.0), 0.5)).r;

  vec3 col = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uIter) break;
    float fi = float(i);

    // Katmanın enerjisi: "Frekans Aralığı" modunda her katman spektrumun KENDİ aralığına bağlıdır (katman 0 = en düşük frekans,
    // son katman = en yüksek; aralıktan 3 örnek). Eski mod: katmanlar sırayla bas/orta/tiz (i % 3).
    float m3 = mod(fi, 3.0);
    float band = m3 < 0.5 ? uBass : (m3 < 1.5 ? uMid : uTreble);
    if (uLayerBands > 0.5) {
      float t0 = fi / uIter;
      float t1 = (fi + 1.0) / uIter;
      float e = (texture2D(uSpec, vec2(mix(t0, t1, 0.2), 0.5)).r
               + texture2D(uSpec, vec2(mix(t0, t1, 0.5), 0.5)).r
               + texture2D(uSpec, vec2(mix(t0, t1, 0.8), 0.5)).r) / 3.0;
      band = clamp((e - 0.15) * 1.6, 0.0, 1.2); // zayıf tabanı at, kontrastı aç
    }

    // Yinelemeli katlama: abs → kaydır → döndür → büyüt (uSeed: desen geçişlerinde yumuşakça kayan tohum)
    z = abs(z) - (vec2(0.42 + 0.10 * sin(uTime * 0.31 + fi), 0.28 + 0.08 * cos(uTime * 0.23 + fi * 1.7)) + uSeed * (0.5 + 0.15 * fi));
    z = rot(uTime * 0.07 * (1.0 + fi * 0.35) + fi * 0.9 + (uLayerBands > 0.5 ? band * 0.35 : uBass * 0.25)) * z;
    z *= 1.32;

    float k = uShape > 3.5 ? mod(fi, 4.0) : uShape;
    float d = shapeD(z, 0.55 + 0.12 * sin(uTime * 0.5 + fi), k);

    // Derinlik: ileri katmanlar daha geniş (sisli) ve sönük ışıma
    float depthT = fi / max(uIter - 1.0, 1.0);
    float depthW = mix(1.0, 0.35, depthT * uDepth);
    float width = 0.012 * (1.0 + depthT * uDepth * 1.6);
    float glow = 0.01 / (d + width) * depthW;
    float bloom = uBloom * 0.02 / (d * d * 8.0 + 0.05) * depthW;

    float ci = (uColorMode < 0.5 ? fi * 0.19 : (uColorMode < 1.5 ? r0 * 0.55 : fi * 0.19 + r0 * 0.35)) + uHue;
    // Renk ayrışması: kırmızı/yeşil/mavi kanalları palette biraz farklı noktalardan okunur (hat kenarlarında ince renk kayması)
    vec3 c = vec3(pal(ci - uFringe).r, pal(ci).g, pal(ci + uFringe).b);
    float gain = uLayerBands > 0.5 ? (0.25 + band * 1.9 + spec * 0.25) : (0.4 + band * 1.3 + spec * 0.6);
    col += c * (glow * (uLayerBands > 0.5 ? 0.8 + band * 0.8 : 1.0) + bloom) * gain;
  }

  // Merkez çekirdeği (derinlik hissi) ve vuruşta kenar parlaması
  col += pal(uHue) * exp(-r0 * 3.0) * (0.05 + uBeat * 0.12) * uDepth;
  col += pal(uHue + 0.5) * uBeat * 0.16 * uBloom * smoothstep(0.6, 1.5, r0);
  return col;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.0;
  float r0 = length(p);

  vec3 col;
  if (uZoomFlow < 0.001) {
    col = mandala(p, 1.0);
  } else {
    // Sonsuz zoom: iki zoom fazının çapraz geçişi (faz 0'a sarınca aynı görüntüye döner → dikişsiz)
    float ph = fract(uZoomPhase);
    float w = smoothstep(0.0, 1.0, ph);
    col = mix(mandala(p, pow(1.32, -ph)), mandala(p, pow(1.32, 1.0 - ph)), w);
  }

  // Işık ritimle belirginleşir (yumuşatılmış seviye + vuruş); uTrans desen geçişlerindeki karartma
  col *= (0.45 + uLevel * 0.9 + uBeat * 0.3) * uBright * uTrans;
  col = uBg + col * 0.6;
  col = 1.0 - exp(-col * 1.25);
  col *= smoothstep(2.1, 0.5, r0);
  gl_FragColor = vec4(col, 1.0);
}
`;

const SPEC_W = 64;
const QUALITY_SCALE = [0.6, 1, 2];
/** Desen geçişlerinde sırayla gezilen segment sayıları. */
const SEG_LIST = [6, 8, 10, 12, 5, 7, 9, 4, 16, 14];
const DIP_DOWN = 0.3;
const DIP_UP = 0.5;

export class Kaleidoscope implements Visualizer {
  readonly manualRender = true;

  private gl: THREE.WebGLRenderer;
  private quad: QuadShader;
  private tex: THREE.DataTexture;
  private data = new Uint8Array(SPEC_W);
  /** Bin başına yumuşatılmış spektrum: hızlı yükselir (damp 14), yavaş düşer (damp 5) → katman ışıması titremez. */
  private specS = new Float32Array(SPEC_W);
  private colors = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];
  private bg = new THREE.Color();
  private seed = new THREE.Vector2();
  private seedT = new THREE.Vector2();
  private tmpSize = new THREE.Vector2();
  private flow = 0;
  private rotAcc = 0;
  private hue = 0;
  private breath = 0;
  private zoomPhase = 0;
  private sBass = 0;
  private sMid = 0;
  private sTreble = 0;
  private sLevel = 0;
  private sBeat = 0;
  private appliedRatio = 0;

  // Müzikle desen geçişi
  private seg = 8;
  private nextSeg = 8;
  private block = 0;
  private beatCount = 0;
  private blockTimer = 0;
  private tb = 0.4;
  private tbLong = 0.4;
  private dipping = false;
  private dipT = 0;
  private trans = 1;

  constructor(gl: THREE.WebGLRenderer) {
    this.gl = gl;
    this.tex = new THREE.DataTexture(this.data, SPEC_W, 1, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    this.quad = new QuadShader(FRAG, {
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uSeg: { value: 8 },
      uIter: { value: 6 },
      uRot: { value: 0 },
      uHue: { value: 0 },
      uBreath: { value: 0 },
      uZoom: { value: 1 },
      uZoomPhase: { value: 0 },
      uZoomFlow: { value: 1 },
      uBright: { value: 1 },
      uShape: { value: 0 },
      uDepth: { value: 0.8 },
      uBloom: { value: 0.6 },
      uFringe: { value: 0.06 },
      uColorMode: { value: 2 },
      uLayerBands: { value: 1 },
      uTrans: { value: 1 },
      uSeed: { value: this.seed },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uTreble: { value: 0 },
      uLevel: { value: 0 },
      uBeat: { value: 0 },
      uSpec: { value: this.tex },
      uC0: { value: this.colors[0] },
      uC1: { value: this.colors[1] },
      uC2: { value: this.colors[2] },
      uC3: { value: this.colors[3] },
      uBg: { value: this.bg },
    });
  }

  init(): void {}

  resize(): void {
    this.appliedRatio = 0;
  }

  /** "Çözünürlük" ayarı: çizim tamponunu küçültür (iki zoom fazı + 8 katman piksel başına pahalı olabilir). */
  private applyQuality(level: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ratio = level >= 2 ? dpr : Math.min(dpr, QUALITY_SCALE[level]);
    if (ratio === this.appliedRatio) return;
    this.appliedRatio = ratio;
    const el = this.gl.domElement;
    this.gl.setPixelRatio(ratio);
    this.gl.setSize(el.clientWidth || 1, el.clientHeight || 1, false);
  }

  update(frame: AudioFrame, s: VisualizerSettingsView): void {
    const o = s.opt;
    const dt = frame.dt;
    this.applyQuality(Math.round(o.quality));

    const ka = damp(dt, 4);
    this.sBass += (frame.bass - this.sBass) * ka;
    this.sMid += (frame.mid - this.sMid) * ka;
    this.sTreble += (frame.treble - this.sTreble) * ka;
    this.sLevel += (frame.level - this.sLevel) * damp(dt, 3);
    this.sBeat += (frame.beatPulse - this.sBeat) * damp(dt, 5);

    // Akış, dönüş, renk, nefes ve zoom sesle (yumuşak) ilerler; sessizlikte yavaşlar
    this.flow += dt * (0.2 + this.sLevel * 1.4);
    this.rotAcc += dt * (0.04 + s.rotationSpeed * 0.5 + this.sLevel * 0.25);
    this.hue += dt * (0.008 + this.sLevel * 0.1);
    this.breath += dt * (0.5 + this.sMid * 1.5);
    this.zoomPhase += dt * o.zoomFlow * (0.03 + this.sLevel * 0.22);

    let wsum = 0;
    let wpos = 0;
    for (let i = 0; i < SPEC_W; i++) {
      const raw = binAtLerp(frame.freq, i / (SPEC_W - 1));
      const cur = this.specS[i];
      const v = cur + (raw - cur) * damp(dt, raw > cur ? 14 : 5);
      this.specS[i] = v;
      this.data[i] = Math.min(255, Math.round(v * 255));
      const e = v * v * (0.3 + 1.7 * (i / (SPEC_W - 1)));
      wsum += e;
      wpos += e * (i / (SPEC_W - 1));
    }
    this.tex.needsUpdate = true;
    if (wsum > 0.3) this.tb += (wpos / wsum - this.tb) * damp(dt, 4);
    this.tbLong += (this.tb - this.tbLong) * damp(dt, 0.25);

    // --- Müzikle desen geçişi: karartma → segment/tohum değişimi → aydınlanma ---
    if (o.auto >= 0.5) {
      if (frame.beat) this.beatCount++;
      this.blockTimer += dt;
      const timbreShift = Math.abs(this.tb - this.tbLong) > 0.07 && this.blockTimer > 4;
      if (!this.dipping && (this.blockTimer > 24 || this.beatCount >= Math.round(o.rhythm) || timbreShift)) {
        this.dipping = true;
        this.dipT = 0;
        this.blockTimer = 0;
        this.beatCount = 0;
        this.tbLong = this.tb;
        this.block++;
        this.nextSeg = SEG_LIST[(this.block * 3 + Math.floor(this.tb * SEG_LIST.length * 0.999)) % SEG_LIST.length];
      }
      if (this.dipping) {
        const prev = this.dipT;
        this.dipT += dt;
        if (prev < DIP_DOWN && this.dipT >= DIP_DOWN) {
          this.seg = this.nextSeg;
          this.seedT.set((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.4);
        }
        const f =
          this.dipT < DIP_DOWN ? 1 - this.dipT / DIP_DOWN : Math.min(1, (this.dipT - DIP_DOWN) / DIP_UP);
        this.trans = 0.15 + 0.85 * f * f * (3 - 2 * f);
        if (this.dipT >= DIP_DOWN + DIP_UP) {
          this.dipping = false;
          this.trans = 1;
        }
      }
    } else {
      this.seg = o.segments;
      this.trans = 1;
      this.dipping = false;
    }
    this.seed.x += (this.seedT.x - this.seed.x) * damp(dt, 1.2);
    this.seed.y += (this.seedT.y - this.seed.y) * damp(dt, 1.2);

    for (let i = 0; i < 4; i++) {
      const x = this.hue * 0.5 + i * 0.25;
      const c = sampleGradient(s.palette.colors, 1 - Math.abs(2 * (x - Math.floor(x)) - 1));
      this.colors[i].setRGB(c[0] / 255, c[1] / 255, c[2] / 255);
    }
    this.bg.set(s.palette.bg);

    const size = this.gl.getDrawingBufferSize(this.tmpSize);
    const u = this.quad.material.uniforms;
    u.uTime.value = this.flow;
    u.uAspect.value = size.x / size.y;
    u.uSeg.value = o.auto >= 0.5 ? this.seg : o.segments;
    u.uIter.value = o.detail;
    u.uRot.value = this.rotAcc;
    u.uHue.value = this.hue;
    u.uBreath.value = this.breath;
    u.uZoom.value = o.zoom;
    u.uZoomPhase.value = this.zoomPhase;
    u.uZoomFlow.value = o.zoomFlow;
    u.uBright.value = o.bright;
    u.uShape.value = Math.round(o.shape);
    u.uDepth.value = o.depth;
    u.uBloom.value = o.bloom;
    u.uFringe.value = o.fringe;
    u.uColorMode.value = Math.round(o.colorMode);
    u.uLayerBands.value = Math.round(o.layerBands) === 1 ? 1 : 0;
    u.uTrans.value = clamp01(this.trans);
    u.uBass.value = this.sBass;
    u.uMid.value = this.sMid;
    u.uTreble.value = this.sTreble;
    u.uLevel.value = this.sLevel;
    u.uBeat.value = this.sBeat;

    this.quad.render(this.gl, null);
  }

  dispose(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const el = this.gl.domElement;
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(el.clientWidth || 1, el.clientHeight || 1, false);
    this.tex.dispose();
    this.quad.dispose();
  }
}
