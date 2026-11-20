import * as THREE from 'three';
import { binAtLerp, sampleGradient } from './palettes';
import { QuadShader } from './quadShader';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { damp } from './util';

/**
 * Metaball: tam ekran GPU shader (eski sürüm çeyrek çözünürlükte CPU alanı, palet gradyanıyla düz boyuyordu; yarıçaplar ham
 * bas/orta/tizle titriyordu). Toplar kompakt çekirdekli (Wyvill) alan toplamıdır; yüzey alanın gradyanından aydınlatılır:
 * yaygın/yansıma/kenar ışığı → parlak, 3B damla görünümü; çevrede yumuşak hale. Renkler topların renklerinin alan ağırlıklı karışımı.
 *
 * Her topun kendi frekansı (spektrum konumu) vardır: yarıçapı o frekansın (yumuşatılmış) enerjisiyle büyür, rengi enerjisiyle
 * paletin başından sonuna kayar. Vuruşta toplar merkezden hafifçe dışa itilir. Hareket: Yörünge ya da Lav (yükselip alçalan).
 */

const MAX_BALLS = 12;

const FRAG = `
precision highp float;
varying vec2 vUv;

uniform float uAspect;
uniform float uPxH;
uniform float uCount;
uniform float uThr;
uniform float uSoft;
uniform float uShine;
uniform float uGlow;
uniform float uBright;
uniform float uBeat;
uniform float uLevel;
uniform vec4 uB[12];
uniform vec3 uBC[12];
uniform vec3 uBg;

void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.0;

  // Alan, gradyan ve renk: kompakt cekirdek w = (1 - d^2/R^2)^3
  float F = 0.0;
  vec2 G = vec2(0.0);
  vec3 C = vec3(0.0);
  float W = 0.0;
  for (int i = 0; i < 12; i++) {
    if (float(i) < uCount) {
      vec4 b = uB[i];
      float R = b.z * 2.2;
      vec2 d = p - b.xy;
      float q = dot(d, d) / (R * R);
      if (q < 1.0) {
        float a = 1.0 - q;
        float w = a * a * a;
        F += w;
        G += -6.0 * a * a * d / (R * R);
        C += uBC[i] * w;
        W += w;
      }
    }
  }
  vec3 base = C / max(W, 0.0001);

  vec3 col = uBg;
  if (uSoft > 0.5) {
    // Yumusak isik: alan dogrudan parlama (esik yok)
    float g = pow(clamp(F * 1.1, 0.0, 1.6), 0.9);
    col += base * g * 1.15 * uGlow + vec3(smoothstep(1.2, 2.2, F)) * 0.25;
  } else {
    float aa = 1.5 * uPxH * length(G) + 0.003;
    float inside = smoothstep(uThr - aa, uThr + aa, F);

    // Yuzey normali: alan yukseklik gibi (merkez duz, kenar egimli -> kure gorunumu)
    vec3 n = normalize(vec3(-G * 0.18, 1.0));
    vec3 L = normalize(vec3(-0.45, 0.6, 0.65));
    float diff = clamp(dot(n, L), 0.0, 1.0);
    float spec = pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 60.0);
    float rim = pow(1.0 - n.z, 2.0);
    float core = smoothstep(uThr, uThr * 3.0, F);

    vec3 lit = base * (0.35 + 0.75 * diff) * (0.7 + 0.5 * core) + vec3(1.0) * spec * 0.9 * uShine + base * rim * 0.6;
    // Cevrede yumusak hale
    float aura = pow(clamp(F / uThr, 0.0, 1.0), 3.0) * (1.0 - inside) * 0.5 * uGlow;
    col = mix(col + base * aura, lit, inside);
  }

  col *= uBright * (0.92 + 0.15 * uBeat + 0.1 * uLevel);
  col *= mix(0.7, 1.0, smoothstep(2.2, 0.4, length(p)));
  col = col / (1.0 + col * 0.2);
  gl_FragColor = vec4(col, 1.0);
}
`;

const SPEEDS = [0.1, 0.14, 0.08, 0.17, 0.11, 0.2, 0.13, 0.09, 0.15, 0.12, 0.18, 0.1];

interface BallDef {
  orbit: number;
  speed: number;
  phase: number;
  size: number;
  /** Spektrum konumu (0..1): alçak frekans küçük indeks. */
  bin: number;
  t: number;
}

export class Metaball implements Visualizer {
  readonly manualRender = true;

  private gl: THREE.WebGLRenderer;
  private quad: QuadShader;
  private defs: BallDef[] = [];
  private e = new Float32Array(MAX_BALLS);
  private uB = Array.from({ length: MAX_BALLS }, () => new THREE.Vector4());
  private uBC = Array.from({ length: MAX_BALLS }, () => new THREE.Vector3(1, 1, 1));
  private bg = new THREE.Color();
  private tmpSize = new THREE.Vector2();
  private time = 0;
  private hue = 0;
  private sMid = 0;
  private sBeat = 0;
  private sLevel = 0;

  constructor(gl: THREE.WebGLRenderer) {
    this.gl = gl;
    for (let i = 0; i < MAX_BALLS; i++) {
      this.defs.push({
        orbit: 0.12 + Math.random() * 0.5,
        speed: (0.15 + Math.random() * 0.5) * (Math.random() < 0.5 ? -1 : 1),
        phase: Math.random() * Math.PI * 2,
        size: 0.1 + Math.random() * 0.12,
        bin: i / (MAX_BALLS - 1),
        t: Math.random(),
      });
    }
    this.quad = new QuadShader(FRAG, {
      uAspect: { value: 1 },
      uPxH: { value: 0.002 },
      uCount: { value: 9 },
      uThr: { value: 0.35 },
      uSoft: { value: 0 },
      uShine: { value: 1 },
      uGlow: { value: 1 },
      uBright: { value: 1 },
      uBeat: { value: 0 },
      uLevel: { value: 0 },
      uB: { value: this.uB },
      uBC: { value: this.uBC },
      uBg: { value: this.bg },
    });
  }

  init(): void {}

  resize(): void {}

  update(frame: AudioFrame, s: VisualizerSettingsView): void {
    const o = s.opt;
    const dt = frame.dt;
    const size = this.gl.getDrawingBufferSize(this.tmpSize);
    const aspect = size.x / size.y;

    this.sMid += (frame.mid - this.sMid) * damp(dt, 3);
    this.sBeat += (frame.beatPulse - this.sBeat) * damp(dt, 5);
    this.sLevel += (frame.level - this.sLevel) * damp(dt, 3);
    this.time += dt * (0.3 + this.sMid * 0.5);
    this.hue += dt * (0.004 + this.sLevel * 0.02);

    const count = Math.max(3, Math.min(MAX_BALLS, Math.round(o.count)));
    const lava = Math.round(o.motion) === 1;
    for (let i = 0; i < count; i++) {
      const def = this.defs[i];
      // Topun kendi frekansının yumuşatılmış enerjisi (hızlı yükselir, yavaş söner)
      const raw = binAtLerp(frame.freq, Math.min(1, 0.02 + def.bin * 0.85));
      const cur = this.e[i];
      this.e[i] = cur + (raw - cur) * damp(dt, raw > cur ? 10 : 3.5);
      const en = Math.min(1.2, this.e[i] * 1.3);

      const ang = this.time * def.speed * Math.PI * 2 + def.phase;
      let bx: number;
      let by: number;
      if (lava) {
        const cycle = 0.5 + 0.5 * Math.sin(this.time * SPEEDS[i] * Math.PI * 2 + i * 1.7);
        bx = Math.sin(this.time * 0.25 + i * 2.1) * 0.18 * o.orbit * aspect;
        by = -0.85 + cycle * 1.7;
      } else {
        bx = Math.cos(ang) * def.orbit * o.orbit * aspect * 0.9 + Math.sin(this.time * 0.4 + def.phase) * 0.02;
        by = Math.sin(ang) * def.orbit * o.orbit * 0.8;
      }
      // Vuruşta hafifçe merkezden dışa itilir
      const len = Math.hypot(bx, by) || 1;
      const kick = this.sBeat * 0.08;
      bx += (bx / len) * kick;
      by += (by / len) * kick;

      const r = def.size * o.size * (0.6 + 0.9 * en) + this.sBeat * 0.012;
      this.uB[i].set(bx, by, r, 0);

      // Renk enerjiyle paletin başından sonuna kayar (+ topa özgü küçük sapma, yavaş ton kayması)
      const tt = Math.min(1, Math.max(0, 0.12 + 0.7 * en + def.t * 0.2 + this.hue * 0.3));
      const c = sampleGradient(s.palette.colors, tt);
      this.uBC[i].set(c[0] / 255, c[1] / 255, c[2] / 255);
    }
    this.bg.set(s.palette.bg);

    const u = this.quad.material.uniforms;
    u.uAspect.value = aspect;
    u.uPxH.value = 2 / size.y;
    u.uCount.value = count;
    u.uSoft.value = Math.round(o.render) === 1 ? 1 : 0;
    u.uShine.value = o.shine;
    u.uGlow.value = o.glow;
    u.uBright.value = o.bright;
    u.uBeat.value = this.sBeat;
    u.uLevel.value = this.sLevel;

    this.quad.render(this.gl, null);
  }

  dispose(): void {
    this.quad.dispose();
  }
}
