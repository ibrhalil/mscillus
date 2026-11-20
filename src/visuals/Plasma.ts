import * as THREE from 'three';
import { binAtLerp, sampleGradient } from './palettes';
import { QuadShader } from './quadShader';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { damp } from './util';

/**
 * Plazma: tam ekran, tek geçişli GPU shader (eski sürüm CPU'da 8× düşük çözünürlükte hesaplanıyordu ve müzik desene
 * hiç işlemiyordu — yalnızca zaman hızı ve parlaklık değişiyordu).
 *
 * Alan: klasik sinüs toplamı; üç stil: Klasik (hafif büküm), Sıvı (4 kat alan bükümü), Girdap (yarıçapla dönen koordinat).
 * MÜZİK DESENİN İÇİNE işler: bas bükümün şiddetini, orta frekansı/ölçeği, tiz ince dalgacıkları sürer; çapsal spektrum
 * halkaları (merkez = düşük frekans) alana eklenir; ritim parlaklığı ve renk akışını belirler.
 */

const FRAG = `
precision highp float;
varying vec2 vUv;

uniform float uTime;
uniform float uAspect;
uniform float uScale;
uniform float uBands;
uniform float uGamma;
uniform float uWarp;
uniform float uStyle;
uniform float uReact;
uniform float uBright;
uniform vec4 uP;
uniform float uE;
uniform float uRotF;
uniform float uHue;
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

// Plazma alani: dort sinus (yatay, dikey, capraz, radyal). Frekanslar uP ile (muzikle bloklar arasinda yumusakca degisen
// yapi), uE carpim terimi (dama/kafes dokusu) ekler: desen zamanla gercekten FARKLI gorunur.
float field(vec2 p, float t) {
  float v = 0.25 * (sin(p.x * uP.x + t) + sin(p.y * 1.3 * uP.y + t * 1.1) + sin((p.x - p.y) * 0.7 * uP.z + t * 0.8) + sin(length(p) * 0.9 * uP.w - t * 1.4));
  return v + uE * 2.0 * sin(p.x * p.y * 0.35 + t * 0.6);
}

void main() {
  vec2 uv = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.0;
  float r = length(uv);
  float t = uTime;

  // Mid frekans deseni sıklaştırır (ölçek), bas büküm şiddetini artırır
  vec2 p = uv * 3.0 * uScale * (1.0 + uMid * 0.35 * uReact);
  float w = uWarp * (0.55 + uBass * 1.5 * uReact);

  if (uStyle < 0.5) {
    p += w * 0.5 * vec2(sin(p.y * 0.7 + t * 0.5), cos(p.x * 0.7 - t * 0.4));
  } else if (uStyle < 1.5) {
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      p += w * 0.6 * vec2(
        sin(p.y * (1.1 + fi * 0.5) + t * (0.4 + fi * 0.13) + fi * 2.0),
        cos(p.x * (1.2 + fi * 0.4) - t * (0.35 + fi * 0.11) + fi * 1.3)
      );
    }
  } else {
    p = rot(r * (1.4 + w * 1.4) - t * 0.5) * p;
    p += w * 0.35 * vec2(sin(p.y * 0.8 + t * 0.4), cos(p.x * 0.8 - t * 0.3));
  }

  p = rot(uRotF + 0.1 * sin(t * 0.1)) * p;
  float v = field(p, t);

  // Çapsal spektrum halkaları: merkezden dışa frekanslar; her halka kendi enerjisiyle parlar
  float spec = texture2D(uSpec, vec2(clamp(r * 0.55, 0.0, 1.0), 0.5)).r;
  v += uReact * (spec - 0.25) * 0.45 * sin(r * 9.0 - t * 1.6);
  // Tiz: ince hızlı dalgacıklar
  v += uTreble * uReact * 0.16 * sin(p.x * 4.5 + p.y * 3.7 + t * 3.0);

  float k = clamp(0.5 + 0.5 * v, 0.0, 1.0);
  k = pow(k, uGamma);

  vec3 col = pal(k * uBands + uHue);
  float b = (0.32 + 0.95 * k) * (0.5 + uLevel * 0.9 + uBeat * 0.3 * uReact) * uBright;
  col *= b;
  col = uBg + col;
  col = col / (1.0 + col * 0.35);
  col *= smoothstep(2.4, 0.7, r);
  gl_FragColor = vec4(col, 1.0);
}
`;

const SPEC_W = 64;
/** Desen yapıları: (x, y, çapraz, radyal frekans çarpanı), kafes terimi E, alan dönüşü (rad). */
const PRESETS: { p: [number, number, number, number]; e: number; rot: number }[] = [
  { p: [1, 1, 1, 1], e: 0, rot: 0 },
  { p: [1.6, 0.7, 1.2, 1.5], e: 0, rot: 0.4 },
  { p: [0.8, 1.8, 0.6, 0.9], e: 0.12, rot: 1.0 },
  { p: [2.0, 2.0, 0.5, 1.2], e: 0, rot: 0.2 },
  { p: [1.2, 0.6, 1.8, 0.5], e: 0.2, rot: -0.6 },
  { p: [0.6, 0.6, 0.6, 2.0], e: 0, rot: 0 },
  { p: [1.4, 1.1, 2.2, 1.0], e: 0.08, rot: 0.8 },
  { p: [0.9, 1.7, 1.3, 1.8], e: 0.15, rot: -0.3 },
];

export class Plasma implements Visualizer {
  readonly manualRender = true;

  private gl: THREE.WebGLRenderer;
  private quad: QuadShader;
  private tex: THREE.DataTexture;
  private data = new Uint8Array(SPEC_W);
  private specS = new Float32Array(SPEC_W);
  private colors = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];
  private bg = new THREE.Color();
  private tmpSize = new THREE.Vector2();
  // Desen "yapısı": preset'ler arasında müzikle yumuşakça geçilir
  private pCur = new THREE.Vector4(1, 1, 1, 1);
  private eCur = 0;
  private rotCur = 0;
  private block = 0;
  private beatCount = 0;
  private blockTimer = 0;
  private tb = 0.4;
  private tbLong = 0.4;
  private preset = 0;
  private flow = 0;
  private hue = 0;
  private sBass = 0;
  private sMid = 0;
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
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uScale: { value: 1 },
      uBands: { value: 1 },
      uGamma: { value: 0.8 },
      uWarp: { value: 1 },
      uStyle: { value: 1 },
      uReact: { value: 1 },
      uBright: { value: 1 },
      uP: { value: this.pCur },
      uE: { value: 0 },
      uRotF: { value: 0 },
      uHue: { value: 0 },
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

  resize(): void {}

  update(frame: AudioFrame, s: VisualizerSettingsView): void {
    const o = s.opt;
    const dt = frame.dt;

    // Yumuşatılmış ses (ham değerler desenin kendisine işlediği için titreşmesin)
    const ka = damp(dt, 5);
    this.sBass += (frame.bass - this.sBass) * ka;
    this.sMid += (frame.mid - this.sMid) * ka;
    this.sTreble += (frame.treble - this.sTreble) * ka;
    this.sLevel += (frame.level - this.sLevel) * damp(dt, 3);
    this.sBeat += (frame.beatPulse - this.sBeat) * damp(dt, 6);

    // Akış ve renk sesle ilerler (eski hız: 0.6 + seviye·1.8 + vuruş·0.8; sessizlikte yavaşlar)
    this.flow += dt * (0.5 + this.sLevel * 1.8 + this.sBeat * 0.8);
    this.hue += dt * (0.01 + this.sLevel * 0.1);

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
    if (wsum > 0.3) this.tb += (wpos / wsum - this.tb) * damp(dt, 4);
    this.tbLong += (this.tb - this.tbLong) * damp(dt, 0.25);

    // Müzikle desen yapısı değişimi: her N vuruşta / tını değişiminde / 20 sn'de başka bir preset (şarkıya özgü başlangıç), yumuşak geçiş
    if (o.auto >= 0.5) {
      if (frame.beat) this.beatCount++;
      this.blockTimer += dt;
      const timbreShift = Math.abs(this.tb - this.tbLong) > 0.07 && this.blockTimer > 4;
      if (this.blockTimer > 20 || this.beatCount >= Math.round(o.rhythm) || timbreShift) {
        this.blockTimer = 0;
        this.beatCount = 0;
        this.tbLong = this.tb;
        this.block++;
        this.preset = (this.block * 3 + Math.floor(this.tb * PRESETS.length * 0.999)) % PRESETS.length;
      }
    } else {
      this.preset = 0;
    }
    const pr = PRESETS[this.preset];
    const kp = damp(dt, 0.9);
    this.pCur.x += (pr.p[0] - this.pCur.x) * kp;
    this.pCur.y += (pr.p[1] - this.pCur.y) * kp;
    this.pCur.z += (pr.p[2] - this.pCur.z) * kp;
    this.pCur.w += (pr.p[3] - this.pCur.w) * kp;
    this.eCur += (pr.e - this.eCur) * kp;
    this.rotCur += (pr.rot - this.rotCur) * kp;
    this.tex.needsUpdate = true;

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
    u.uScale.value = o.scale;
    u.uBands.value = o.bands;
    u.uGamma.value = 0.8 * o.contrast;
    u.uWarp.value = o.warp;
    u.uStyle.value = Math.round(o.style);
    u.uReact.value = o.react;
    u.uBright.value = o.bright;
    u.uHue.value = this.hue;
    u.uE.value = this.eCur;
    u.uRotF.value = this.rotCur;
    u.uBass.value = this.sBass;
    u.uMid.value = this.sMid;
    u.uTreble.value = this.sTreble;
    u.uLevel.value = this.sLevel;
    u.uBeat.value = this.sBeat;

    this.quad.render(this.gl, null);
  }

  dispose(): void {
    this.tex.dispose();
    this.quad.dispose();
  }
}
