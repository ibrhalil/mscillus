import * as THREE from 'three';
import { binAtLerp, sampleGradient } from './palettes';
import { QuadShader } from './quadShader';
import { EventScale, OnsetTracker } from './onset';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { damp } from './util';

/**
 * Işık Hızı: hiper uzay — yıldızlar merkezden dışarı fışkıran ışık çizgileri (tam ekran GPU shader; eski sürüm kare noktalar + çizgi izi,
 * hız ham ses seviyesi/vuruşla sıçrıyordu, müzikle yıldız ilişkisi yoktu). Uzay Yolculuğu (yıldızlar arasında yavaş seyir) ile örtüşmez:
 * burada bakış hep ileri, tüm alan merkezden akar.
 *
 * Log-kutupsal hücre alanı: `ln R − T` (T üstel zoom); her hücrede bir yıldız, radyal bir çizgi (başı dışarıda, kuyruğu merkeze doğru söner).
 * Çizgi uzunluğu = hız (hareket bulanıklığı). 3 katman (farklı sıklık). Her yıldız kendi AÇISAL dilimine göre bir frekansa bağlıdır
 * (alt = bas, üst = tiz, simetrik): o frekans çaldıkça parlar ve çizgisi uzar → alan bir ekolayzır gibi okunur.
 *
 * Hız yumuşatılmış ses seviyesiyle; güçlü vuruşta (müziğin ortalamasına göre) HİPER ATLAMA: hız yumuşakça artar (damp), çizgiler uzar,
 * merkezde ışık parlar, sonra yavaşça sakinleşir (anlık sıçrama yok).
 */

const FRAG = `
precision highp float;
varying vec2 vUv;

uniform float uAspect;
uniform float uPxH;
uniform float uT;
uniform float uSpd;
uniform float uStreak;
uniform float uJump;
uniform float uSize;
uniform float uReact;
uniform float uBright;
uniform float uHue;
uniform float uDensity;
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

float h2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float spec(float t) {
  return texture2D(uSpec, vec2(clamp(t, 0.0, 1.0), 0.5)).r;
}

// Bir katman: Na aci dilimi, Kr radyal hucre/e-kati. ang01: acinin tur cinsinden konumu (alt = 0.5), lr = ln R - T, R: ekran yaricapi
vec3 starLayer(float ang01, float lr, float R, float Na, float Kr, float seed) {
  vec3 acc = vec3(0.0);
  float rho = lr * Kr;
  float ri0 = floor(rho);
  float aiF = ang01 * Na;
  float ai = floor(aiF);
  for (int k = 0; k < 2; k++) {
    // k = 1: bir dis hucre (kuyrugu bu piksele uzanabilir)
    float ri = ri0 + float(k);
    vec2 id = vec2(ai, mod(ri, 997.0)) + seed;
    if (h2(id) < uDensity * 0.55) {
      float acen = ai + 0.5 + (h2(id + 7.1) - 0.5) * 0.6;
      float da = (aiF - acen) / Na * TAU * R;
      float rc = ri + h2(id + 3.3);
      float dr = rho - rc;

      // Frekans: acisal dilime gore (alt = bas, ust = tiz, simetrik)
      float t = abs(acen / Na - 0.5) * 2.0;
      float lit = clamp((spec(t * 0.9) - 0.1) * 1.7 * uReact, 0.0, 1.3);

      // Cizgi: kafa dis uc, kuyruk merkeze dogru soner; uzunluk hizla ve frekansla
      float len = (0.05 + uStreak * uSpd * Kr * 0.1) * (0.5 + h2(id + 9.7)) * (1.0 + 0.8 * lit) * (1.0 + 1.5 * uJump);
      float along = dr <= 0.0 ? pow(smoothstep(-len, 0.0, dr), 1.5) : exp(-dr * 40.0);

      float wd = max((0.0009 + 0.0035 * R) * uSize, uPxH * 0.9);
      float across = exp(-pow(da / wd, 2.0));

      float base = 0.4 + 0.9 * h2(id + 1.9);
      float near = 0.35 + 0.9 * min(R, 1.2);
      float inten = base * near * (0.45 + 0.9 * lit) * smoothstep(0.015, 0.08, R);
      vec3 c = mix(pal(uHue + t * 0.4 + h2(id + 5.5) * 0.3), vec3(1.0), 0.35 + 0.3 * lit);
      acc += c * inten * along * across;
    }
  }
  return acc;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.0;
  float R = max(length(p), 0.0008);
  float lr = log(R) - uT;
  // Acinin tur cinsinden konumu: alt = 0.5 (alt-ust ekseninde simetrik), dikissiz (tam sayi dilim)
  float ang01 = atan(p.x, -p.y) / TAU + 0.5;

  vec3 col = starLayer(ang01, lr, R, 48.0, 2.2, 0.0);
  col += starLayer(ang01, lr, R, 96.0, 3.0, 31.0);
  col += starLayer(ang01, lr, R, 180.0, 4.2, 67.0);

  // Atlama: merkezde yumusak isik (delik degil)
  col += pal(uHue + 0.1) * uJump * 0.14 * exp(-R * 1.6);

  col *= uBright;
  col = 1.0 - exp(-col * 1.3);
  col += uBg * 0.8;
  col *= smoothstep(2.8, 0.8, R);
  gl_FragColor = vec4(col, 1.0);
}
`;

const SPEC_W = 64;

export class Starfield implements Visualizer {
  readonly manualRender = true;

  private gl: THREE.WebGLRenderer;
  private quad: QuadShader;
  private tex: THREE.DataTexture;
  private data = new Uint8Array(SPEC_W);
  private specS = new Float32Array(SPEC_W);
  private colors = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];
  private bg = new THREE.Color();
  private tmpSize = new THREE.Vector2();
  private T = 0;
  private spd = 1;
  private jump = 0;
  /** Atlama zarfı (tetiklenince tepeye çıkar, yavaş söner); `jump` bu zarfı yumuşakça izler. */
  private jumpEnv = 0;
  /** Hız için ayrı, yavaş ses seviyesi süzgeci (vuruşlardaki kısa yükselmeler hızı oynatmasın). */
  private sSlow = 0;
  private accel = 0;
  private jumpCool = 0;
  private hue = 0;
  private onset = new OnsetTracker();
  private scale = new EventScale();
  private sLevel = 0;

  constructor(gl: THREE.WebGLRenderer) {
    this.gl = gl;
    this.tex = new THREE.DataTexture(this.data, SPEC_W, 1, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    this.quad = new QuadShader(FRAG, {
      uAspect: { value: 1 },
      uPxH: { value: 0.002 },
      uT: { value: 0 },
      uSpd: { value: 1 },
      uStreak: { value: 1 },
      uJump: { value: 0 },
      uSize: { value: 1 },
      uReact: { value: 1 },
      uBright: { value: 1 },
      uHue: { value: 0 },
      uDensity: { value: 1 },
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
    this.sLevel += (frame.level - this.sLevel) * damp(dt, 3);
    this.sSlow += (frame.level - this.sSlow) * damp(dt, 0.7);
    this.hue += dt * (0.004 + this.sLevel * 0.02);
    this.scale.tick(dt);

    // Hiper atlama: yalnız GÜÇLÜ vuruş/onset (müziğin ortalamasına göre); art arda tetiklenmez (1.5 sn bekleme)
    this.jumpCool -= dt;
    const hit = this.onset.update(frame, dt, 1.8, 0.4);
    if (frame.beat || hit) {
      const e = frame.beat ? frame.bass + 0.3 * Math.min(1, this.sLevel * 2) : 0.3 * Math.min(1, this.onset.ratio / 4) + 0.3 * frame.bass;
      const pw = this.scale.rel(e);
      if (pw > 0.6 && this.jumpCool <= 0) {
        this.jumpEnv = Math.max(this.jumpEnv, (0.4 + 0.6 * pw) * o.jump);
        this.jumpCool = 1.5;
      }
    }
    // Atlama: zarf yavaş söner (0.45/sn), `jump` onu kademeli izler (yükselirken 2.5, inerken 1.2 → ani fırlama/kesilme yok)
    this.jumpEnv = Math.max(0, this.jumpEnv - dt * 0.45);
    this.jump += (this.jumpEnv - this.jump) * damp(dt, this.jumpEnv > this.jump ? 2.5 : 1.2);

    // Hız: YAVAŞ süzülmüş seviye + atlama; hızın kendisi de ivme sınırlı yumuşak geçişle değişir:
    // hedefe `damp 1.1` ile yaklaşılır ve ivme (birim/sn²) sınırlanır → hızlanma ve yavaşlama aniden olmaz
    const target = (0.8 + 1.6 * Math.min(1, this.sSlow * 3)) * o.travel + 4.5 * this.jump;
    const want = (target - this.spd) * damp(dt, 1.1);
    const maxStep = 1.6 * dt; // en çok 1.6 hız birimi / sn
    const clamped = Math.max(-maxStep, Math.min(maxStep, want));
    this.accel += (clamped - this.accel) * damp(dt, 6);
    this.spd += this.accel;
    this.T += dt * this.spd;

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
    u.uT.value = this.T;
    u.uSpd.value = this.spd;
    u.uStreak.value = o.streak;
    u.uJump.value = Math.min(1, this.jump);
    u.uSize.value = o.size;
    u.uReact.value = o.react;
    u.uBright.value = o.bright;
    u.uHue.value = this.hue;
    u.uDensity.value = o.density;

    this.quad.render(this.gl, null);
  }

  dispose(): void {
    this.tex.dispose();
    this.quad.dispose();
  }
}
