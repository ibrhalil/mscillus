import * as THREE from 'three';
import { sampleGradient } from './palettes';
import { QuadShader } from './quadShader';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { damp } from './util';

/**
 * Kağıt Yırtma: üst üste düz renkli kağıtlar. Üst kâğıtta TEK bir yerden başlayan çizgisel bir yırtık ilerler (V biçiminde: başlangıçta en
 * geniş, uçta kapalı), iki yan açılarak geri çekilir ve altındaki YENİ kâğıdı gösterir; o kâğıt tamamen göründüğünde yeni yırtık başlar
 * (sonsuz). Ritim her vuruşta yırtığa kısa bir hamle verir.
 *
 * Gerçekçilik (v3): (1) yırtık kenarı İKİ KATMANLI: renkli yüzey kenarı + onun ardında beyaz, LİFLİ çekirdek bandı (lifler kenara dik, bant
 * genişliği düzensiz); (2) kâğıt gerçek yırtıkta havalanır: kenar ışığı yakalar, üstteki kâğıttan alttakine IŞIĞA GÖRE KAYDIRILMIŞ yumuşak gölge
 * (yükseklik açılmayla artar, yarı gölge genişler) + kenar boyunca ortam kararması; (3) kâğıt dokusu: bulutsu leke + ince lif + yönlü lifler;
 * (4) katmanlar alttan üste, kenar yumuşatmalı (smoothstep) birleştirilir.
 */

const LAYERS = 3;

const FRAG = `
precision highp float;
varying vec2 vUv;

uniform float uAspect;
uniform float uPxH;
uniform float uFiber;
uniform float uShadow;
uniform float uJag;
uniform vec4 uT0[3];
uniform vec4 uT1[3];
uniform vec4 uTX[3];
uniform vec3 uLC[4];
uniform float uBright;
uniform float uLevel;

float h1(float i, float seed) {
  return fract(sin(i * 127.1 + seed * 311.7) * 43758.5453);
}

float n1(float x, float seed) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(h1(i, seed), h1(i + 1.0, seed), f);
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

// Yirtigin isaretli mesafesi: pozitif = yirtik araligi. a = (cx, cy, dx, dy); b = (yariUzunluk, ilerleme tau, W, tohum);
// x = (acilma karisimi, kalkma). Aralik V bicimli: baslangicta (x=0) en genis, ilerleyen ucta kapali.
float tearE(vec4 a, vec4 b, vec4 xx, vec2 p) {
  float Lh = b.x;
  if (Lh <= 0.0 || b.z <= 0.0) return -1.0;
  float seed = b.w;
  vec2 dir = a.zw;
  vec2 nrm = vec2(-dir.y, dir.x);
  vec2 q = p - a.xy;
  float u = dot(q, dir);
  float s = dot(q, nrm);
  float x = (u + Lh) / (2.0 * Lh);
  float tau = max(b.y, 0.001);
  float xt = x / tau;
  float vprof = 0.3 + 0.7 * pow(clamp(1.0 - xt, 0.0, 1.0), 0.9);
  float tip = mix(smoothstep(1.0, 0.82, xt), 1.0, xx.x);
  float w = b.z * vprof * tip;
  if (x < 0.0) w = 0.0;
  if (w <= 0.0) return -1.0;
  float c = (n1(u * 3.0, seed) - 0.5) * 0.12 * uJag + (n1(u * 13.0, seed + 3.0) - 0.5) * 0.03 * uJag;
  float ej = ((n1(u * 27.0, seed + 5.0) - 0.5) * 0.02 + (n1(u * 90.0, seed + 8.0) - 0.5) * 0.006) * uJag;
  return w + ej - abs(s - c);
}

float layerE(int d, vec2 p) {
  return tearE(uT0[d], uT1[d], uTX[d], p);
}

// Kagit yuzeyi: bulutsu leke + ince lif + yonlu lifler
vec3 paperFace(vec3 base, vec2 p) {
  float m = 0.94 + 0.08 * n2(p * 3.0) + 0.04 * (n2(p * 260.0) - 0.5) + 0.03 * (n2(vec2(p.x * 420.0, p.y * 35.0)) - 0.5);
  return base * m;
}

// Gorunen kagit katmani: renkli yuzey -> beyaz LIFLI cekirdek bandi -> (bosluk). eb = kenara mesafe (kagit tarafinda)
vec3 paperLayer(int d, vec3 base, vec2 p, float eb) {
  vec2 dir = uT0[d].zw;
  float u = dot(p, dir);
  float fibW = uFiber * (0.005 + 0.02 * n1(u * 7.0, 5.0) + 0.004 * n1(u * 31.0, 9.0));
  float strands = n2(vec2(u * 210.0, eb * 38.0));
  float fine = n2(vec2(u * 600.0, eb * 120.0));
  vec3 white = vec3(0.97, 0.95, 0.91) * (0.82 + 0.22 * strands + 0.1 * (fine - 0.5));
  float inBand = smoothstep(fibW, fibW * 0.55, eb + (strands - 0.5) * fibW * 0.6);
  vec3 face = paperFace(base, p);
  // Kenar isik yakalar (havalanan kagit)
  face *= 1.0 + 0.14 * exp(-eb / 0.035) * uTX[d].y;
  return mix(face, white, inBand);
}

// Ustteki kagidin altindakine dusurdugu golge: isiga gore KAYDIRILMIS ornekleme, yukseklikle genisleyen yari golge + kenar kararmasi
float shadowFrom(int up, vec2 p, float Eup) {
  float lift = uTX[up].y;
  vec2 L2 = normalize(vec2(-0.6, 0.8));
  float Eo = layerE(up, p + L2 * (0.008 + 0.1 * lift));
  float width = 0.004 + 0.06 * lift;
  float sh = smoothstep(width, -width, Eo) * 0.45;
  float ao = exp(-max(Eup, 0.0) * 22.0) * 0.18;
  return clamp(sh + ao, 0.0, 0.65) * uShadow;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.0;
  float E0 = layerE(0, p);
  float E1 = layerE(1, p);
  float E2 = layerE(2, p);

  vec3 c3 = paperFace(uLC[3], p) * (1.0 - shadowFrom(2, p, E2));
  vec3 c2 = paperLayer(2, uLC[2], p, max(-E2, 0.0)) * (1.0 - shadowFrom(1, p, E1));
  vec3 c1 = paperLayer(1, uLC[1], p, max(-E1, 0.0)) * (1.0 - shadowFrom(0, p, E0));
  vec3 c0 = paperLayer(0, uLC[0], p, max(-E0, 0.0));

  // Alttan uste, kenar yumusatmali birlesim
  float aa = uPxH * 1.2;
  vec3 col = c3;
  col = mix(col, c2, smoothstep(aa, -aa, E2));
  col = mix(col, c1, smoothstep(aa, -aa, E1));
  col = mix(col, c0, smoothstep(aa, -aa, E0));

  col *= 0.94 + 0.1 * vUv.y;
  col *= uBright * (0.95 + 0.1 * uLevel);
  gl_FragColor = vec4(col, 1.0);
}
`;

interface Tear {
  cx: number;
  cy: number;
  dx: number;
  dy: number;
  lh: number;
  tau: number;
  w: number;
  seed: number;
  open: number;
}

interface Layer {
  main: Tear | null;
}

const PAPER_TONES: [number, number, number][] = [
  [0.86, 0.36, 0.28],
  [0.16, 0.5, 0.52],
  [0.93, 0.74, 0.28],
  [0.2, 0.28, 0.5],
  [0.88, 0.5, 0.58],
  [0.46, 0.62, 0.4],
  [0.95, 0.9, 0.78],
  [0.55, 0.33, 0.5],
];

export class PaperTear implements Visualizer {
  readonly manualRender = true;

  private gl: THREE.WebGLRenderer;
  private quad: QuadShader;
  private uT0 = Array.from({ length: LAYERS }, () => new THREE.Vector4());
  private uT1 = Array.from({ length: LAYERS }, () => new THREE.Vector4());
  private uTX = Array.from({ length: LAYERS }, () => new THREE.Vector4());
  private uLC = Array.from({ length: 4 }, () => new THREE.Vector3(1, 1, 1));
  private tmpSize = new THREE.Vector2();
  private layers: Layer[] = Array.from({ length: LAYERS }, () => ({ main: null }));
  private layerId = 0;
  private mainDelay = 0.6;
  private hue = 0;
  /** Vuruş hamlesi: vuruşta 1'e çıkar, hızla söner; yırtık ucu bu kadar hızlanır. */
  private jerk = 0;
  private sLevel = 0;

  constructor(gl: THREE.WebGLRenderer) {
    this.gl = gl;
    this.quad = new QuadShader(FRAG, {
      uAspect: { value: 1 },
      uPxH: { value: 0.002 },
      uFiber: { value: 1 },
      uShadow: { value: 1 },
      uJag: { value: 1 },
      uT0: { value: this.uT0 },
      uT1: { value: this.uT1 },
      uTX: { value: this.uTX },
      uLC: { value: this.uLC },
      uBright: { value: 1 },
      uLevel: { value: 0 },
    });
  }

  init(): void {}

  resize(): void {}

  private angle(direction: number): number {
    if (direction === 1) return (Math.random() - 0.5) * 0.25;
    if (direction === 2) return Math.PI / 2 + (Math.random() - 0.5) * 0.25;
    return Math.random() * Math.PI;
  }

  private layerColor(id: number, s: VisualizerSettingsView, tones: boolean): [number, number, number] {
    if (tones) return PAPER_TONES[(((id * 3) % PAPER_TONES.length) + PAPER_TONES.length) % PAPER_TONES.length];
    const t = (0.382 * id + this.hue) % 1;
    const c = sampleGradient(s.palette.colors, 1 - Math.abs(2 * t - 1));
    return [c[0] / 255, c[1] / 255, c[2] / 255];
  }

  update(frame: AudioFrame, s: VisualizerSettingsView): void {
    const o = s.opt;
    const dt = frame.dt;
    const size = this.gl.getDrawingBufferSize(this.tmpSize);
    const aspect = size.x / size.y;
    const R0 = Math.hypot(aspect, 1) + 0.6;
    const dirOpt = Math.round(o.direction);

    this.sLevel += (frame.level - this.sLevel) * damp(dt, 3);
    this.hue += dt * 0.003;
    if (frame.beat) this.jerk = 1;
    this.jerk = Math.max(0, this.jerk - dt * 3.5);

    // --- Tek yırtık: ilerler (V), sonra iki yan açılır/geri çekilir; kâğıt gidince alttaki üst olur, yeni yırtık başlar ---
    const top = this.layers[0];
    if (!top.main) {
      this.mainDelay -= dt;
      if (this.mainDelay <= 0) {
        const th = this.angle(dirOpt);
        const off = (Math.random() - 0.5) * 0.5;
        top.main = {
          cx: -Math.sin(th) * off,
          cy: Math.cos(th) * off,
          dx: Math.cos(th),
          dy: Math.sin(th),
          lh: R0,
          tau: 0,
          w: 0.004,
          seed: Math.random() * 50,
          open: 0,
        };
      }
    }
    if (top.main) {
      const m = top.main;
      if (m.tau < 1) {
        m.tau = Math.min(1, m.tau + dt * (0.06 + 0.05 * this.sLevel + 0.3 * this.jerk) * o.tearSpeed);
        m.w = 0.004 + 0.045 * m.tau;
      } else {
        m.open += dt * o.tearSpeed * (1 + 1.2 * this.jerk);
        m.w = 0.049 + 0.25 * m.open * m.open;
        if (m.w * 0.3 > R0 + 0.3) {
          this.layers.shift();
          this.layers.push({ main: null });
          this.layerId++;
          this.mainDelay = 0.6 + Math.random() * 1.4;
        }
      }
    }

    // --- GPU'ya yaz ---
    for (let d = 0; d < LAYERS; d++) {
      const t = this.layers[d].main;
      const a = this.uT0[d];
      const b = this.uT1[d];
      const x = this.uTX[d];
      if (!t) {
        a.set(0, 0, 1, 0);
        b.set(0, 0, 0, 0);
        x.set(0, 0, 0, 0);
        continue;
      }
      a.set(t.cx, t.cy, t.dx, t.dy);
      b.set(t.lh, Math.max(t.tau, 0.001), t.w, t.seed);
      x.set(Math.min(1, t.open / 0.4), Math.min(1, t.w / 0.12), 0, 0);
    }
    const tones = Math.round(o.colors) === 1;
    for (let i = 0; i < 4; i++) {
      const c = this.layerColor(this.layerId + i, s, tones);
      this.uLC[i].set(c[0], c[1], c[2]);
    }

    const u = this.quad.material.uniforms;
    u.uAspect.value = aspect;
    u.uPxH.value = 2 / size.y;
    u.uFiber.value = o.fiber;
    u.uShadow.value = o.shadow;
    u.uJag.value = o.jag * (0.8 + 0.5 * this.sLevel);
    u.uBright.value = o.bright;
    u.uLevel.value = this.sLevel;

    this.quad.render(this.gl, null);
  }

  dispose(): void {
    this.quad.dispose();
  }
}
