import * as THREE from 'three';
import { binAtLerp, sampleGradient } from './palettes';
import { QuadShader } from './quadShader';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { damp } from './util';

/**
 * Rotozoom: dönen ve yakınlaşan sonsuz zemin (demoscene klasiği). Eski sürüm düz bir dama karoydu; şimdi tam ekran GPU shader:
 * zemin Truchet yayları, petek, Voronoi hücreleri, moiré halkaları veya dama olabilir ve isteğe bağlı olarak PERSPEKTİF
 * (mode-7 benzeri eğik düzlem, ufuk çizgisi, derinlik sisi) ile görünür.
 *
 * MÜZİK: her hücreye rastgele bir frekans (spektrum binı) atanır; o frekans çaldığında hücre/yay ışır → zemin bir "ekolayzır
 * mozaiği". Bas zoom'u, seviye dönüşü, vuruş parlaklığı sürer; hepsi yumuşatılmıştır.
 */

const FRAG = `
precision highp float;
varying vec2 vUv;

uniform float uTime;
uniform float uAspect;
uniform float uAng;
uniform float uZoom;
uniform vec2 uOff;
uniform float uPattern;
uniform float uPersp;
uniform float uDetail;
uniform float uGlow;
uniform float uReact;
uniform float uBright;
uniform float uHue;
uniform float uBass;
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

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec2 hash2(vec2 p) {
  return vec2(hash(p), hash(p + 19.19));
}

// Hücrenin frekans enerjisi: her hücre rastgele bir spektrum binına bağlanır
float cellEnergy(vec2 id) {
  float e = texture2D(uSpec, vec2(hash(id + 3.7), 0.5)).r;
  return clamp((e - 0.12) * 1.8, 0.0, 1.2);
}

// Her desen: x = çizgi/kenar ışıması, y = hücre dolgusu, z = hücre kimliği (renk), w = enerji
vec4 pattern(vec2 p, float t) {
  if (uPattern < 0.5) {
    // Truchet yayları
    vec2 id = floor(p);
    vec2 f = fract(p);
    if (hash(id) > 0.5) f.x = 1.0 - f.x;
    float d = min(abs(length(f) - 0.5), abs(length(f - 1.0) - 0.5));
    float glow = uGlow * 0.03 / (d + 0.025);
    return vec4(glow, smoothstep(0.1, 0.0, d - 0.05) * 0.4, hash(id + 1.3), cellEnergy(id));
  }
  if (uPattern < 1.5) {
    // Petek
    vec2 r = vec2(1.0, 1.73);
    vec2 h = r * 0.5;
    vec2 a = mod(p, r) - h;
    vec2 b = mod(p - h, r) - h;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    vec2 id = p - gv;
    vec2 q = abs(gv);
    float hd = max(dot(q, normalize(vec2(1.0, 1.73))), q.x);
    float edge = 0.5 - hd;
    float glow = uGlow * 0.03 / (edge + 0.03);
    return vec4(glow, smoothstep(0.5, 0.0, hd) * 0.5, hash(id), cellEnergy(id));
  }
  if (uPattern < 2.5) {
    // Voronoi hücreleri (noktalar yavaşça salınır)
    vec2 n = floor(p);
    vec2 f = fract(p);
    float d1 = 8.0;
    float d2 = 8.0;
    vec2 cid = n;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = 0.5 + 0.5 * sin(t * 0.6 + TAU * hash2(n + g));
        float d = length(g + o - f);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          cid = n + g;
        } else if (d < d2) {
          d2 = d;
        }
      }
    }
    float border = d2 - d1;
    float glow = uGlow * 0.03 / (border + 0.03);
    return vec4(glow, smoothstep(0.7, 0.0, d1) * 0.5, hash(cid), cellEnergy(cid));
  }
  if (uPattern < 3.5) {
    // Moiré: üç hareketli merkezden halka girişimi
    float v = sin(length(p - vec2(sin(t * 0.3) * 2.0, cos(t * 0.23) * 2.0)) * 5.0)
            + sin(length(p - vec2(cos(t * 0.27) * 2.5, sin(t * 0.33) * 2.0)) * 5.5)
            + sin(length(p + vec2(sin(t * 0.21) * 2.0, cos(t * 0.31) * 2.5)) * 4.5);
    float k = 0.5 + v / 6.0;
    float line = uGlow * 0.04 / (abs(sin(v * 1.4)) + 0.06);
    return vec4(line, k * 0.45, k, texture2D(uSpec, vec2(clamp(k, 0.0, 1.0), 0.5)).r);
  }
  // Dama (klasik)
  vec2 id = floor(p);
  float c = mod(id.x + id.y, 2.0);
  vec2 f = abs(fract(p) - 0.5);
  float edge = 0.5 - max(f.x, f.y);
  return vec4(uGlow * 0.02 / (edge + 0.03), c * 0.6, hash(id), cellEnergy(id));
}

void main() {
  vec2 uv = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.0;
  float t = uTime;
  vec2 p;
  float fog = 1.0;

  if (uPersp > 0.5) {
    // Eğik düzlem (mode-7): ufuk üstte, zemin derinliğe doğru küçülür
    float hor = 0.9;
    float dy = hor - uv.y;
    float z = 1.0 / max(dy, 0.04);
    p = vec2(uv.x * z, z);
    fog = clamp(1.0 - z * 0.06, 0.0, 1.0);
    p *= 0.9;
  } else {
    p = uv;
  }

  // Dönme + yakınlaşma + kayma
  float c = cos(uAng);
  float s = sin(uAng);
  p = mat2(c, -s, s, c) * p;
  p = p * uZoom * uDetail + uOff;

  vec4 pt = pattern(p, t);
  float e = pt.w * uReact;

  vec3 base = pal(pt.z * 0.6 + uHue);
  vec3 col = base * pt.y * (0.35 + e * 0.9);
  col += pal(pt.z * 0.6 + uHue + 0.25) * pt.x * (0.25 + e * 1.4);

  float b = (0.5 + uLevel * 0.9 + uBeat * 0.3 * uReact) * uBright;
  col *= b * fog;
  col = uBg + col;
  col = col / (1.0 + col * 0.4);
  col *= smoothstep(2.3, 0.6, length(uv));
  gl_FragColor = vec4(col, 1.0);
}
`;

const SPEC_W = 64;

export class Rotozoom implements Visualizer {
  readonly manualRender = true;

  private gl: THREE.WebGLRenderer;
  private quad: QuadShader;
  private tex: THREE.DataTexture;
  private data = new Uint8Array(SPEC_W);
  private specS = new Float32Array(SPEC_W);
  private colors = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];
  private bg = new THREE.Color();
  private off = new THREE.Vector2();
  private tmpSize = new THREE.Vector2();
  private time = 0;
  private ang = 0;
  private zoomPhase = 0;
  private offX = 0;
  private offY = 0;
  private hue = 0;
  private sBass = 0;
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
      uAspect: { value: 1 },
      uAng: { value: 0 },
      uZoom: { value: 1 },
      uOff: { value: this.off },
      uPattern: { value: 0 },
      uPersp: { value: 0 },
      uDetail: { value: 1 },
      uGlow: { value: 1 },
      uReact: { value: 1 },
      uBright: { value: 1 },
      uHue: { value: 0 },
      uBass: { value: 0 },
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

  resize(): void {}

  update(frame: AudioFrame, s: VisualizerSettingsView): void {
    const o = s.opt;
    const dt = frame.dt;

    this.sBass += (frame.bass - this.sBass) * damp(dt, 4);
    this.sLevel += (frame.level - this.sLevel) * damp(dt, 3);
    this.sBeat += (frame.beatPulse - this.sBeat) * damp(dt, 5);

    // Hareket yumuşatılmış sesle; sessizlikte yavaşlar (rotozoom'un klasik zoom salınımı + basla nefes)
    this.time += dt * (0.3 + this.sLevel * 1.2);
    this.ang += dt * (0.12 + this.sLevel * 0.8 + s.rotationSpeed * 0.6);
    this.zoomPhase += dt * (0.18 + this.sLevel * 0.5);
    const sc = o.scroll * (0.35 + this.sLevel * 1.4) * dt;
    this.offX += sc * 0.7;
    this.offY += sc * 0.5;
    this.hue += dt * (0.008 + this.sLevel * 0.09);

    // Zoom: yavaş salınım (exp: oransal yakınlaşma) × bas nefesi
    const zoom = 2.4 * o.zoom * Math.exp(0.55 * Math.sin(this.zoomPhase)) * (1 + this.sBass * 0.25 * o.react);

    for (let i = 0; i < SPEC_W; i++) {
      const raw = binAtLerp(frame.freq, i / (SPEC_W - 1));
      const cur = this.specS[i];
      const v = cur + (raw - cur) * damp(dt, raw > cur ? 14 : 5);
      this.specS[i] = v;
      this.data[i] = Math.min(255, Math.round(v * 255));
    }
    this.tex.needsUpdate = true;

    for (let i = 0; i < 4; i++) {
      const x = this.hue * 0.5 + i * 0.25;
      const c = sampleGradient(s.palette.colors, 1 - Math.abs(2 * (x - Math.floor(x)) - 1));
      this.colors[i].setRGB(c[0] / 255, c[1] / 255, c[2] / 255);
    }
    this.bg.set(s.palette.bg);
    this.off.set(this.offX, this.offY);

    const size = this.gl.getDrawingBufferSize(this.tmpSize);
    const u = this.quad.material.uniforms;
    u.uTime.value = this.time;
    u.uAspect.value = size.x / size.y;
    u.uAng.value = this.ang;
    u.uZoom.value = zoom;
    u.uPattern.value = Math.round(o.pattern);
    u.uPersp.value = Math.round(o.persp);
    u.uDetail.value = o.detail;
    u.uGlow.value = o.glowLine;
    u.uReact.value = o.react;
    u.uBright.value = o.bright;
    u.uHue.value = this.hue;
    u.uBass.value = this.sBass;
    u.uLevel.value = this.sLevel;
    u.uBeat.value = this.sBeat;

    this.quad.render(this.gl, null);
  }

  dispose(): void {
    this.tex.dispose();
    this.quad.dispose();
  }
}
