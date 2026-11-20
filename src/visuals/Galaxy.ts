import * as THREE from 'three';
import { binAtLerp, sampleGradient } from './palettes';
import { EventScale, OnsetTracker } from './onset';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { TAU, damp } from './util';

/**
 * Galaksi: GPU yildiz alani (yuvarlak yumusak nokta sprite'lari, 24k'ya kadar yildiz) — eski surum kare noktali 1800 yildizdi.
 * Sarmal kollar + kalin merkez (bulge) + az sayida buyuk parlak yildiz. Yildiz yaricapi frekansa eslenir (merkez bas, dis tiz), yumusatilmis.
 *
 * Ritim yalniz parlaklik/boyut: vurusta merkezden disa dogru yayilan parlaklik dalgasi (siddet muzigin kendi ortalamasina gore)
 * + merkez cekirdegi bas ile nefes alir. Donus hizi YAVAS suzulmus ses seviyesiyle degisir; kollarin sekli/yonu degismez. Sessizde yildizlar
 * yalniz hafif titrer (galaksi yavasca doner).
 */

const MAX_STARS = 24000;
const MAX_R = 12;
const DIST = 20;
const WAVES = 3;
const SPEC_W = 64;

const VERT = `
attribute vec4 aS;
uniform float uRot;
uniform float uTime;
uniform float uScale;
uniform float uSize;
uniform float uReact;
uniform float uBass;
uniform sampler2D uSpec;
uniform vec2 uW[3];
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
varying vec3 vCol;
varying float vA;

vec3 pal(float t) {
  t = fract(t) * 4.0;
  if (t < 1.0) return mix(uC0, uC1, t);
  if (t < 2.0) return mix(uC1, uC2, t - 1.0);
  if (t < 3.0) return mix(uC2, uC3, t - 2.0);
  return mix(uC3, uC0, t - 3.0);
}

void main() {
  float t = aS.x;
  float v = texture2D(uSpec, vec2(clamp(t, 0.0, 1.0), 0.5)).r;
  float c = cos(uRot);
  float s = sin(uRot);
  vec3 p = vec3(c * position.x + s * position.z, position.y, -s * position.x + c * position.z);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);

  float tw = 0.82 + 0.18 * sin(uTime * (0.6 + aS.y * 1.8) + aS.y * 40.0);
  float wave = 0.0;
  for (int k = 0; k < 3; k++) {
    float d = (t - uW[k].x) / 0.09;
    wave += uW[k].y * exp(-d * d);
  }
  float core = exp(-t * 5.0);
  float e = clamp((v - 0.08) * 1.5, 0.0, 1.3) * uReact;

  float b = (0.28 + 0.9 * e + 0.9 * wave * uReact + core * (0.1 + 0.5 * uBass * uReact)) * tw;
  vec3 col = pal(t * 0.8 + 0.02);
  col = mix(col, vec3(1.0, 0.95, 0.85), core * 0.55);
  if (aS.w > 0.5) col = mix(col, vec3(1.0), 0.45);

  vCol = col;
  vA = b;
  gl_PointSize = clamp(uSize * aS.z * (1.0 + 0.5 * wave * uReact + 0.25 * e) * uScale / (-mv.z), 1.0, 48.0);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = `
precision highp float;
varying vec3 vCol;
varying float vA;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = exp(-d * d * 3.5);
  gl_FragColor = vec4(vCol * vA, a * 0.6);
}
`;

interface Wave {
  r: number;
  amp: number;
}

export class Galaxy implements Visualizer {
  readonly manualRender = true;

  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  private points: THREE.Points;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;
  private tex: THREE.DataTexture;
  private data = new Uint8Array(SPEC_W);
  private specS = new Float32Array(SPEC_W);
  private colors = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];
  private bg = new THREE.Color();
  private tmpSize = new THREE.Vector2();
  private waveU = Array.from({ length: WAVES }, () => new THREE.Vector2(9, 0));
  private waves: Wave[] = [];
  private onset = new OnsetTracker();
  private scale = new EventScale();
  private builtArms = -1;
  private rot = 0;
  private time = 0;
  private hue = 0;
  private sLevel = 0;
  private sBass = 0;

  constructor(gl: THREE.WebGLRenderer) {
    this.gl = gl;
    this.tex = new THREE.DataTexture(this.data, SPEC_W, 1, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uRot: { value: 0 },
        uTime: { value: 0 },
        uScale: { value: 800 },
        uSize: { value: 0.075 },
        uReact: { value: 1 },
        uBass: { value: 0 },
        uSpec: { value: this.tex },
        uW: { value: this.waveU },
        uC0: { value: this.colors[0] },
        uC1: { value: this.colors[1] },
        uC2: { value: this.colors[2] },
        uC3: { value: this.colors[3] },
      },
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.position.z = -DIST;
    this.scene.add(this.points);
  }

  init(): void {}

  resize(): void {}

  /** Yildiz konumlari: sarmal kollar + kalin merkez. Kol sayisi degisince yeniden uretilir. */
  private build(arms: number): void {
    const pos = new Float32Array(MAX_STARS * 3);
    const aS = new Float32Array(MAX_STARS * 4);
    const g = () => Math.random() + Math.random() + Math.random() - 1.5;
    for (let i = 0; i < MAX_STARS; i++) {
      let x: number;
      let y: number;
      let z: number;
      let t: number;
      if (Math.random() < 0.22) {
        // Merkez: yassilastirilmis kure, gauss yogunluk
        const rad = Math.abs(g()) * 0.16 * MAX_R * 2;
        const th = Math.random() * TAU;
        const ph = Math.acos(2 * Math.random() - 1);
        x = Math.sin(ph) * Math.cos(th) * rad;
        z = Math.sin(ph) * Math.sin(th) * rad;
        y = Math.cos(ph) * rad * 0.6;
        t = Math.min(1, Math.hypot(x, z) / MAX_R);
      } else {
        t = Math.pow(Math.random(), 1.1);
        const arm = i % arms;
        const scatter = g() * (1.0 - t * 0.5);
        const angle = (arm / arms) * TAU + t * Math.PI * 3.5 + scatter * 0.55;
        const r = 0.5 + t * MAX_R;
        x = Math.cos(angle) * r;
        z = Math.sin(angle) * r;
        y = g() * (1.0 - t * 0.6) * 0.7;
      }
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      const big = Math.random() < 0.04;
      aS[i * 4] = t;
      aS[i * 4 + 1] = Math.random();
      aS[i * 4 + 2] = (0.5 + Math.random() * 0.9) * (big ? 2.2 : 1);
      aS[i * 4 + 3] = big ? 1 : 0;
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('aS', new THREE.BufferAttribute(aS, 4));
    this.builtArms = arms;
  }

  update(frame: AudioFrame, s: VisualizerSettingsView): void {
    const o = s.opt;
    const dt = frame.dt;
    const arms = Math.round(o.arms);
    if (arms !== this.builtArms) this.build(arms);
    this.geo.setDrawRange(0, Math.round(MAX_STARS * o.density));

    // Yumusatilmis ses; donus hizi yavas filtreden (ani hizlanma/yavaslama yok)
    this.sLevel += (frame.level - this.sLevel) * damp(dt, 1.2);
    this.sBass += (frame.bass - this.sBass) * damp(dt, 5);
    this.time += dt;
    this.rot += dt * (0.1 + s.rotationSpeed) * (0.4 + Math.min(1, this.sLevel * 2) * 0.9);
    this.hue += dt * (0.004 + this.sLevel * 0.01);

    for (let i = 0; i < SPEC_W; i++) {
      const raw = binAtLerp(frame.freq, i / (SPEC_W - 1));
      const cur = this.specS[i];
      const v = cur + (raw - cur) * damp(dt, raw > cur ? 12 : 4);
      this.specS[i] = v;
      this.data[i] = Math.min(255, Math.round(v * 255));
    }
    this.tex.needsUpdate = true;

    // Vurus: merkezden disa yayilan parlaklik dalgasi
    this.scale.tick(dt);
    const hit = this.onset.update(frame, dt, 2.0, 0.4) || frame.beat;
    if (hit) {
      const pw = this.scale.rel(0.6 * frame.bass + 0.4 * frame.level);
      const w: Wave = { r: 0, amp: 0.3 + 0.9 * pw };
      if (this.waves.length >= WAVES) this.waves.shift();
      this.waves.push(w);
    }
    for (let k = this.waves.length - 1; k >= 0; k--) {
      const w = this.waves[k];
      w.r += dt * 0.45;
      if (w.r > 1.2) this.waves.splice(k, 1);
    }
    for (let k = 0; k < WAVES; k++) {
      const w = this.waves[k];
      if (w) this.waveU[k].set(w.r, w.amp * Math.max(0, 1 - w.r / 1.2));
      else this.waveU[k].set(9, 0);
    }

    for (let i = 0; i < 4; i++) {
      const x = this.hue * 0.5 + i * 0.25;
      const c = sampleGradient(s.palette.colors, 1 - Math.abs(2 * (x - Math.floor(x)) - 1));
      this.colors[i].setRGB(c[0] / 255, c[1] / 255, c[2] / 255);
    }
    this.bg.set(s.palette.bg);

    const size = this.gl.getDrawingBufferSize(this.tmpSize);
    this.cam.aspect = size.x / size.y;
    this.cam.updateProjectionMatrix();
    this.points.rotation.x = o.tilt;

    const u = this.mat.uniforms;
    u.uRot.value = this.rot;
    u.uTime.value = this.time;
    u.uScale.value = size.y / (2 * Math.tan((this.cam.fov * Math.PI) / 360));
    u.uSize.value = 0.075 * o.size;
    u.uReact.value = o.react;
    u.uBass.value = this.sBass;

    this.gl.setRenderTarget(null);
    this.gl.setClearColor(this.bg);
    this.gl.render(this.scene, this.cam);
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}
