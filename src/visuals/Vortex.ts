import * as THREE from 'three';
import { binAtLerp, sampleGradient } from './palettes';
import { QuadShader } from './quadShader';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { damp } from './util';

/**
 * Hipnoz: TEK kalın Arşimet spirali — ekran parlak/koyu bantlara bölünür ve döner (klasik hipnoz sarmalı; iki katman üst üste
 * binince hipnoz etkisi bozulduğu için ikinci spiral kaldırıldı). Eski "Girdap" modunun Hipnoz stili; Spektrum ve
 * Çevrinti stilleri silindi. Tam ekran GPU shader, kenarlar analitik yumuşatılmış (keskin ama pürüzsüz).
 *
 * Ritim yalnız: spiral kalınlığı (yarıçapa karşılık gelen frekans: merkez bas, dış tiz), hızda küçük değişim ve vuruş halkası.
 * Kolların yönü/şekli ritimle değişmez.
 */

const FRAG = `
precision highp float;
varying vec2 vUv;

uniform float uAspect;
uniform float uPxH;
uniform float uRot;
uniform float uArms;
uniform float uTight;
uniform float uDepth;
uniform float uThick;
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

// Yumusak kenarli bant: f in [c-hw, c+hw]
float band(float f, float c, float hw, float aa) {
  return smoothstep(c - hw - aa, c - hw + aa, f) * (1.0 - smoothstep(c + hw - aa, c + hw + aa, f));
}

void main() {
  vec2 uv = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.0;
  float r = length(uv);
  float a = atan(uv.y, uv.x);

  // Arsimet spirali: s = (a - donus)/TAU * kol -/+ r * k. Faz kol sayisinin tam kati oldugu icin aci sinirinda dikis yok.
  // Derinlik: 0 = esit aralikli Arsimet; 1 = merkeze dogru incelen (perspektif, log) bantlar -> "dalis" hissi
  float k = uTight * uArms * 0.9;
  float rad = (1.0 - uDepth) * r + uDepth * 0.55 * log(r + 0.02);
  float dRad = (1.0 - uDepth) + uDepth * 0.55 / (r + 0.02);
  float aa = ((uArms / TAU) / max(r, 0.03) + k * dRad) * uPxH * 1.5 + 0.004;

  // Kalinlik: parlak bant / koyu bant orani (duty); yaricapa karsilik gelen frekansla nefes alir
  float er = clamp((texture2D(uSpec, vec2(clamp(r * 0.5, 0.0, 1.0), 0.5)).r - 0.1) * 1.7 * uReact, 0.0, 1.3);
  float duty = clamp(0.5 + (uThick - 1.0) * 0.3 + 0.1 * (er - 0.3), 0.2, 0.8);

  // TEK spiral: ekran parlak ve koyu bantlara bolunur (iki katman yok); bantlar surekli doner
  float f = fract((a - uRot) / TAU * uArms - rad * k);
  float m = band(f, 0.5, duty * 0.5, aa);

  vec3 cA = pal(uHue + 0.1);
  vec3 cB = pal(uHue + 0.6) * 0.2;
  vec3 col = mix(cB, cA * (0.85 + 0.3 * er), m);

  // Yakin ve uzak: merkezde cizgiler sikisir (sis), kenarda sonuk
  col *= smoothstep(0.0, 0.06, r) * smoothstep(2.7, 1.0, r);
  col *= 0.75 + uLevel * 0.45;

  // Vurus halkasi + merkez isigi (delik yok)
  float rr = 0.35 + (1.0 - uBeat) * 0.9;
  col += pal(uHue + 0.3) * exp(-abs(r - rr) * 30.0) * uBeat * 0.5 * uReact;
  col += pal(uHue + 0.1) * exp(-r * 7.0) * (0.2 + uBass * uReact * 0.6);

  col *= uBright;
  col = 1.0 - exp(-col * 1.5);
  col += uBg * 0.8;
  gl_FragColor = vec4(col, 1.0);
}
`;

const SPEC_W = 64;

export class Vortex implements Visualizer {
  readonly manualRender = true;

  private gl: THREE.WebGLRenderer;
  private quad: QuadShader;
  private tex: THREE.DataTexture;
  private data = new Uint8Array(SPEC_W);
  private specS = new Float32Array(SPEC_W);
  private colors = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];
  private bg = new THREE.Color();
  private tmpSize = new THREE.Vector2();
  private rot = 0;
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
      uAspect: { value: 1 },
      uPxH: { value: 0.002 },
      uRot: { value: 0 },
      uArms: { value: 3 },
      uTight: { value: 0.8 },
      uDepth: { value: 0.4 },
      uThick: { value: 1 },
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

    // Yumuşatılmış ses
    this.sBass += (frame.bass - this.sBass) * damp(dt, 4);
    this.sLevel += (frame.level - this.sLevel) * damp(dt, 3);
    this.sBeat += (frame.beatPulse - this.sBeat) * damp(dt, 5);

    // Dönüş: tek spiral. Ritim hızı yalnız küçük miktarda değiştirir; yön hiç değişmez.
    const dir = Math.round(o.direction) === 1 ? 1 : -1;
    const w = dir * o.speed * (0.5 + this.sLevel * 0.25 + this.sBass * 0.1);
    this.rot += dt * w;
    this.hue += dt * (0.006 + this.sLevel * 0.03);

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
    u.uArms.value = Math.round(o.arms);
    u.uTight.value = o.tight;
    u.uDepth.value = o.depth;
    u.uThick.value = o.thick;
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
