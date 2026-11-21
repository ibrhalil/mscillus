import * as THREE from 'three';
import { binAtLerp, sampleGradient } from './palettes';
import { QuadShader } from './quadShader';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { damp } from './util';

/**
 * Fosfen: gözleri kapatıp bastırınca görülen geometrik formlar (Klüver "form constants"): petek/kafes, örümcek ağı, spiral,
 * log-kutupsal kafes. Dört desen kaleydoskopik katlanmış (N-katlı simetrik) bir zeminde sürekli birbirine DÖNÜŞÜR (çapraz geçiş,
 * zıplama yok), yavaşça döner ve nefes alır; çizgiler koyu zeminde parlayan ışık hatları gibidir. (Eski sürüm "girdap tünel"
 * idi ve reddedildi; tünel işini Solucan Deliği yapıyor.)
 *
 * Müzik: radyal spektrum çizgi parlaklığını (merkez bas, dış tiz), bas çizgi kalınlığını/nefesi, tiz ince parıltıyı, vuruşlar
 * desen geçişini tetikler (her N vuruşta ya da 14 sn'de bir). Yön/şekil ritimle sıçramaz.
 */

const FRAG = `
precision highp float;
varying vec2 vUv;

uniform float uAspect;
uniform float uPxH;
uniform float uRot;
uniform float uZoom;
uniform float uMorph;
uniform float uSym;
uniform float uWidth;
uniform float uHalo;
uniform float uReact;
uniform float uBright;
uniform float uHue;
uniform float uBass;
uniform float uTreble;
uniform float uLevel;
uniform float uBeat;
uniform float uClock;
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

// Petek: Shane'in altigen izgarasi (hucre merkezine goreli konum)
vec2 hexLocal(vec2 p) {
  const vec2 s = vec2(1.7320508, 1.0);
  vec4 hC = floor(vec4(p, p - vec2(1.0, 0.5)) / s.xyxy) + 0.5;
  vec4 h = vec4(p - hC.xy * s, p - (hC.zw + 0.5) * s);
  return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? h.xy : h.zw;
}

float hexNorm(vec2 q) {
  const vec2 s = vec2(1.7320508, 1.0);
  q = abs(q);
  return max(dot(q, s * 0.5), q.y);
}

// Her desen: en yakin cizgiye mesafe (dunya birimi)
float dHoney(vec2 p, float r) {
  float cell = 0.2 * (1.0 + 0.12 * sin(uClock * 0.4) + uBass * 0.15);
  vec2 q = hexLocal(p / cell + vec2(0.0, uZoom * 0.5));
  return abs(0.5 - hexNorm(q)) * cell;
}

float dWeb(float r, float a, float seg) {
  float lr = log(max(r, 0.002)) - uZoom;
  float dRing = abs(fract(lr * 1.5 + 0.5) - 0.5) / 1.5 * r;
  float dSpoke = r * min(a, seg * 0.5 - a);
  return min(dRing, dSpoke);
}

float dSpiral(float r, float a, float seg) {
  float lr = log(max(r, 0.002)) - uZoom;
  float tw = 1.3;
  float k = 1.0 / (seg * 0.5);
  float s = a * k * 0.5 + lr * tw;
  float grad = sqrt(k * k * 0.25 + tw * tw) / max(r, 0.01);
  return abs(fract(s + 0.5) - 0.5) / grad;
}

float dLattice(float r, float a, float seg) {
  float lr = log(max(r, 0.002)) - uZoom;
  float u = a / (seg * 0.5) * 2.0;
  float dU = abs(fract(u + 0.5) - 0.5) * (seg * 0.5 / 2.0) * r;
  float dV = abs(fract(lr * 2.0 + 0.5) - 0.5) / 2.0 * r;
  return min(dU, dV);
}

// Cizgi parlamasi: keskin cekirdek (en az 1 piksel) + genis hale
float glow(float d) {
  float w = uWidth * (0.006 + 0.004 * uBass * uReact);
  float aa = uPxH * 1.3;
  float core = smoothstep(max(w, aa) + aa, max(w - aa, 0.0), d);
  float halo = exp(-d * 55.0) * 0.45 * uHalo;
  return core + halo;
}

void main() {
  vec2 uv = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.0;

  // Donus + kaleydoskopik katlama (N-katli simetri; faz tam sektor oldugundan aci sinirinda dikis yok)
  float c = cos(uRot);
  float s0 = sin(uRot);
  vec2 p = mat2(c, -s0, s0, c) * uv;
  float r = length(p);
  float seg = TAU / uSym;
  float a = abs(mod(atan(p.y, p.x), seg) - seg * 0.5);
  a = seg * 0.5 - a;
  vec2 pf = r * vec2(cos(a), sin(a));

  // Desen agirliklari: uMorph in [0,4) dairesel; komsu iki desen capraz gecer (toplam 1)
  float L = 0.0;
  for (int k = 0; k < 4; k++) {
    float diff = abs(mod(uMorph - float(k) + 2.0, 4.0) - 2.0);
    float w = smoothstep(0.0, 1.0, clamp(1.0 - diff, 0.0, 1.0));
    if (w > 0.001) {
      float d;
      if (k == 0) d = dHoney(pf, r);
      else if (k == 1) d = dWeb(r, a, seg);
      else if (k == 2) d = dSpiral(r, a, seg);
      else d = dLattice(r, a, seg);
      L += w * glow(d);
    }
  }

  // Muzik: radyal spektrum parlakligi (merkez bas, dis tiz) + tiz parilti
  float e = clamp((texture2D(uSpec, vec2(clamp(r * 0.5, 0.0, 1.0), 0.5)).r - 0.1) * 1.7 * uReact, 0.0, 1.3);
  float twinkle = 1.0 + 0.35 * uTreble * uReact * (hash(floor(pf * 9.0) + floor(uClock * 8.0)) - 0.5) * 2.0;
  L *= (0.5 + 1.1 * e) * twinkle;

  vec3 col = pal(r * 0.45 + a * 0.3 + uHue) * L;
  col += pal(r * 0.45 + a * 0.3 + uHue + 0.3) * L * L * 0.25;

  // Zemin: cok hafif renkli isima (koyu)
  col += uBg + pal(uHue + 0.5) * 0.03 * exp(-r * 0.8) * (0.4 + uLevel);

  col *= uBright * (0.8 + 0.25 * uBeat + 0.2 * uLevel);
  col *= smoothstep(0.0, 0.05, r) * smoothstep(2.6, 0.9, r);
  col = 1.0 - exp(-col * 1.4);
  gl_FragColor = vec4(col, 1.0);
}
`;

const SPEC_W = 64;

export class Phosphene implements Visualizer {
  readonly manualRender = true;

  private gl: THREE.WebGLRenderer;
  private quad: QuadShader;
  private tex: THREE.DataTexture;
  private data = new Uint8Array(SPEC_W);
  private specS = new Float32Array(SPEC_W);
  private colors = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];
  private bg = new THREE.Color();
  private tmpSize = new THREE.Vector2();
  private clock = 0;
  private rot = 0;
  private zoom = 0;
  private hue = 0;
  /** Desen indeksi: morph yumuşakça morphT'ye kayar (4'lü dairesel). */
  private morph = 0;
  private morphT = 0;
  private beatCount = 0;
  private morphTimer = 0;
  private sBass = 0;
  private sTreble = 0;
  private sLevel = 0;
  private sBeat = 0;

  constructor(gl: THREE.WebGLRenderer) {
    this.gl = gl;
    this.tex = new THREE.DataTexture(this.data, SPEC_W, 1, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    this.quad = new QuadShader(FRAG, {
      uAspect: { value: 1 },
      uPxH: { value: 0.002 },
      uRot: { value: 0 },
      uZoom: { value: 0 },
      uMorph: { value: 0 },
      uSym: { value: 8 },
      uWidth: { value: 1 },
      uHalo: { value: 1 },
      uReact: { value: 1 },
      uBright: { value: 1 },
      uHue: { value: 0 },
      uBass: { value: 0 },
      uTreble: { value: 0 },
      uLevel: { value: 0 },
      uBeat: { value: 0 },
      uClock: { value: 0 },
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
    this.clock += dt;

    this.sBass += (frame.bass - this.sBass) * damp(dt, 4);
    this.sTreble += (frame.treble - this.sTreble) * damp(dt, 5);
    this.sLevel += (frame.level - this.sLevel) * damp(dt, 3);
    this.sBeat += (frame.beatPulse - this.sBeat) * damp(dt, 5);

    // Dönüş ve yakınlaşma seviyeyle yavaşça birikir (ritim yönü/şekli bozmaz)
    this.rot += dt * (0.05 + this.sLevel * 0.2) * o.flow;
    this.zoom += dt * (0.05 + this.sLevel * 0.12) * o.flow;
    this.hue += dt * (0.004 + this.sLevel * 0.02);

    // Desen geçişi: her `rhythm` vuruşta ya da 14 sn'de bir (hedef +1; morph yumuşakça kayar → çapraz geçiş)
    if (frame.beat) this.beatCount++;
    this.morphTimer += dt;
    if (this.beatCount >= Math.round(o.rhythm) || this.morphTimer > 14) {
      this.beatCount = 0;
      this.morphTimer = 0;
      this.morphT += 1;
    }
    this.morph += (this.morphT - this.morph) * damp(dt, 0.9);

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

    const size = this.gl.getDrawingBufferSize(this.tmpSize);
    const u = this.quad.material.uniforms;
    u.uAspect.value = size.x / size.y;
    u.uPxH.value = 2 / size.y;
    u.uRot.value = this.rot;
    u.uZoom.value = this.zoom;
    u.uMorph.value = ((this.morph % 4) + 4) % 4;
    u.uSym.value = Math.round(o.sym);
    u.uWidth.value = o.width;
    u.uHalo.value = o.halo;
    u.uReact.value = o.react;
    u.uBright.value = o.bright;
    u.uHue.value = this.hue;
    u.uBass.value = this.sBass;
    u.uTreble.value = this.sTreble;
    u.uLevel.value = this.sLevel;
    u.uBeat.value = this.sBeat;
    u.uClock.value = this.clock;

    this.quad.render(this.gl, null);
  }

  dispose(): void {
    this.tex.dispose();
    this.quad.dispose();
  }
}
