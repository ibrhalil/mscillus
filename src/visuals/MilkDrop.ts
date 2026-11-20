import * as THREE from 'three';
import { sampleGradient } from './palettes';
import { QuadShader } from './quadShader';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrev;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uLevel;
uniform float uBeat;
uniform float uAspect;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform float uDecay;
uniform float uZoom;
uniform float uPaint;
uniform float uSwirl;
uniform float uWarp;

void main() {
  vec2 c = vUv - 0.5;
  c.x *= uAspect;
  float r = length(c);

  float zoom = 1.0 - (0.004 + uBass * 0.018 + uBeat * 0.02) * uZoom;
  float rot = (0.006 * sin(uTime * 0.11) + uMid * 0.02 * sin(r * 3.0 - uTime * 0.2)) * uSwirl;
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 rc = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * zoom;

  vec2 suv = 0.5 + rc;
  suv.x /= uAspect;
  suv.x += 0.012 * uWarp * sin(suv.y * 3.0 + uTime * 0.35) * (1.0 + uBass * 1.2);
  suv.y += 0.010 * uWarp * cos(suv.x * 2.5 - uTime * 0.27) * (1.0 + uBass * 1.2);
  suv.y -= 0.0012;

  vec3 prev = texture2D(uPrev, suv).rgb;
  prev *= uDecay;

  float hueA = uTime * 0.008 + uBeat * 0.006;
  float hca = cos(hueA);
  float hsa = sin(hueA);
  mat3 hueM = mat3(
    0.299 + 0.701 * hca + 0.168 * hsa, 0.587 - 0.587 * hca + 0.330 * hsa, 0.114 - 0.114 * hca - 0.497 * hsa,
    0.299 - 0.299 * hca - 0.328 * hsa, 0.587 + 0.413 * hca + 0.035 * hsa, 0.114 - 0.114 * hca + 0.292 * hsa,
    0.299 - 0.300 * hca + 1.250 * hsa, 0.587 - 0.588 * hca - 1.050 * hsa, 0.114 + 0.886 * hca - 0.203 * hsa
  );
  prev = hueM * prev;

  float m1 = sin(vUv.x * 4.0 + uTime * 0.25) * sin(vUv.y * 3.0 - uTime * 0.18);
  float m2 = sin(vUv.x * 2.0 - uTime * 0.12 + 1.7) * sin(vUv.y * 5.0 + uTime * 0.21);
  vec3 paint = mix(uColorA, uColorB, 0.5 + 0.35 * m1);
  paint = mix(paint, uColorC, 0.5 + 0.35 * m2);
  paint *= smoothstep(1.15, 0.0, r);
  // Denge parlaklığı ~ boya / (1 - decay): decay'e bölerek iz kalıcılığı değişince ekran beyaza doymaz / kararmaz
  paint *= (0.010 + uLevel * 0.10 + uTreble * 0.08 + uBeat * 0.22) * uPaint * ((1.0 - uDecay) / 0.045);

  vec3 col = prev + paint;
  col = col / (1.0 + col * 0.12);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class MilkDrop implements Visualizer {
  readonly manualRender = true;

  private gl: THREE.WebGLRenderer;
  private quad: QuadShader;
  private targets: THREE.WebGLRenderTarget[] = [];
  private cur = 0;
  private time = 0;
  private tmpSize = new THREE.Vector2();
  private colors = [new THREE.Color(), new THREE.Color(), new THREE.Color()];

  constructor(gl: THREE.WebGLRenderer) {
    this.gl = gl;
    this.quad = new QuadShader(FRAG, {
      uPrev: { value: null },
      uTime: { value: 0 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uTreble: { value: 0 },
      uLevel: { value: 0 },
      uBeat: { value: 0 },
      uAspect: { value: 1 },
      uColorA: { value: this.colors[0] },
      uColorB: { value: this.colors[1] },
      uColorC: { value: this.colors[2] },
      uDecay: { value: 0.955 },
      uZoom: { value: 1 },
      uPaint: { value: 1 },
      uSwirl: { value: 1 },
      uWarp: { value: 1 },
    });
    this.rebuildTargets();
  }

  init(): void {}

  resize(): void {
    this.rebuildTargets();
  }

  private rebuildTargets(): void {
    const size = this.gl.getDrawingBufferSize(this.tmpSize);
    const tw = Math.max(256, Math.floor(size.x * 0.5));
    const th = Math.max(256, Math.floor(size.y * 0.5));
    for (const t of this.targets) t.dispose();
    const opts = {
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    };
    this.targets = [
      new THREE.WebGLRenderTarget(tw, th, opts),
      new THREE.WebGLRenderTarget(tw, th, opts),
    ];
    this.cur = 0;
  }

  update(frame: AudioFrame, s: VisualizerSettingsView): void {
    this.time += frame.dt;
    const u = this.quad.material.uniforms;
    const size = this.gl.getDrawingBufferSize(this.tmpSize);

    const base = (this.time * 0.03) % 1;
    const samples = [
      sampleGradient(s.palette.colors, base),
      sampleGradient(s.palette.colors, (base + 0.33) % 1),
      sampleGradient(s.palette.colors, (base + 0.66) % 1),
    ];
    for (let i = 0; i < 3; i++) {
      this.colors[i].setRGB(samples[i][0] / 255, samples[i][1] / 255, samples[i][2] / 255);
    }

    u.uTime.value = this.time;
    const react = s.opt.react;
    u.uBass.value = frame.bass * react;
    u.uMid.value = frame.mid * react;
    u.uTreble.value = frame.treble * react;
    u.uLevel.value = frame.level * react;
    u.uBeat.value = frame.beatPulse * react;
    u.uAspect.value = size.x / size.y;
    u.uDecay.value = s.opt.decay;
    u.uZoom.value = s.opt.zoom;
    u.uPaint.value = s.opt.paint;
    u.uSwirl.value = s.opt.swirl;
    u.uWarp.value = s.opt.warp;

    const src = this.targets[this.cur];
    const dst = this.targets[1 - this.cur];

    u.uPrev.value = src.texture;
    this.quad.render(this.gl, dst);

    u.uPrev.value = dst.texture;
    this.quad.render(this.gl, null);

    this.cur = 1 - this.cur;
  }

  dispose(): void {
    for (const t of this.targets) t.dispose();
    this.targets = [];
    this.quad.dispose();
  }
}
