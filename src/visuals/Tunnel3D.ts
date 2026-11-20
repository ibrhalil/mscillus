import * as THREE from 'three';
import { binAtLerp, sampleGradient } from './palettes';
import { QuadShader } from './quadShader';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { damp } from './util';

/**
 * 3D Tünel: gerçek perspektifli, düz, çokgen kesitli bir tünelde ileri uçuş (tam ekran GPU shader; eski sürüm 48 torus halkasıydı,
 * müzik yalnız parlaklık, hız ham ses seviyesiyle sıçrıyordu). Duvar paneller halinde ızgaradır (kare hücreler).
 *
 * MÜZİK GEÇMİŞİ TÜNELİN DUVARINDA AKAR: her hücre, uzak uçta doğduğu andaki spektrumu taşır (satır = tünelde dünya hücresi, sütun = çevre
 * boyunca frekans, alçak frekans ortada simetrik). Hücreler ileri uçuşla kameraya yaklaşıp geçer → yeni ses ufukta doğar, yanından geçerek
 * gider. Vuruş, tüm çevreyi saran parlak bir halka olarak tünelde yaklaşır. Hız yumuşatılmış ses seviyesiyle; kamera çok hafif salınır.
 */

const HIST = 64;
/** Görünen en uzak hücre sayısı: yeni satır bu kadar ilerideki hücreye yazılır (sis uzaktakileri zaten gizler). */
const FAR = 46;

const FRAG = `
precision highp float;
varying vec2 vUv;

uniform float uAspect;
uniform float uPxH;
uniform float uT;
uniform float uRot;
uniform float uSides;
uniform float uCells;
uniform float uReact;
uniform float uBright;
uniform float uHue;
uniform float uBass;
uniform float uLevel;
uniform float uCore;
uniform vec2 uSway;
uniform sampler2D uHist;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uBg;

#define PI 3.14159265359
#define TAU 6.28318530718

vec3 pal(float t) {
  t = fract(t) * 4.0;
  if (t < 1.0) return mix(uC0, uC1, t);
  if (t < 2.0) return mix(uC1, uC2, t - 1.0);
  if (t < 3.0) return mix(uC2, uC3, t - 2.0);
  return mix(uC3, uC0, t - 3.0);
}

// Gecmis dokusu: t = cevre boyunca frekans konumu (0..1, dogrusal), row = dunya hucre indeksi mod 64
float hist(float t, float row) {
  float x = t * 63.0;
  float i0 = floor(x);
  float f = x - i0;
  float y = (row + 0.5) / 64.0;
  float v0 = texture2D(uHist, vec2((i0 + 0.5) / 64.0, y)).r;
  float v1 = texture2D(uHist, vec2((min(i0 + 1.0, 63.0) + 0.5) / 64.0, y)).r;
  return mix(v0, v1, f);
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.0 - uSway;
  float r = max(length(p), 0.0008);
  float a = atan(p.y, p.x) + uRot;

  // Cokgen kesit (apothem = 1): aci -> duvar paneli + panel ici konum; derinlik z = 1/(cos(la)*r) (perspektif)
  float N = uSides;
  float seg = TAU / N;
  float ai = mod(a, TAU);
  float pidx = floor(ai / seg);
  float la = ai - pidx * seg - seg * 0.5;
  float cl = cos(la);
  float z = 1.0 / (cl * r);
  float w = tan(la) / tan(seg * 0.5);

  // Kare hucreler: hucre boyu = panel genisligi / hucre sayisi; s = dunya hucre koordinati (kamera ilerledikce yaklasir)
  float M = uCells;
  float L = 2.0 * tan(seg * 0.5) / M;
  float zc = z / L;
  float s = zc + uT;
  float j = floor(s);
  float fz = s - j;
  float cwf = (w * 0.5 + 0.5) * M;
  float cwi = floor(cwf);
  float fx = cwf - cwi;

  // Hucrenin enerjisi: cevre boyunca konum (simetrik, alcak frekans ortada) x tunelde dogdugu andaki spektrum
  float cellC = pidx * M + cwi;
  float Nc = N * M;
  float tt = abs(cellC + 0.5 - Nc * 0.5) / (Nc * 0.5);
  float e = hist(tt, mod(j, 64.0));
  float lit = clamp((e - 0.1) * 1.8 * uReact, 0.0, 1.3);

  // Perspektif nedeniyle piksel basina hucre birimi (uzakta moire olmasin): dv buyudukce ayrinti ortalamaya gecer
  float dv = (1.0 / (r * r * cl)) * uPxH / L;
  float detail = clamp(1.0 - dv * 1.6, 0.0, 1.0);

  float bd = min(min(fx, 1.0 - fx), min(fz, 1.0 - fz));
  float lw = 0.07;
  float line = smoothstep(lw + dv, max(lw - dv, 0.0), bd);
  float inner = 1.0 - line;

  vec3 c = pal(0.3 * tt + j * 0.012 + uHue);
  vec3 col = c * (inner * lit * 1.2 + line * (0.12 + 0.7 * lit)) + uBg * 0.3;
  col = mix(c * lit * 0.45 + uBg * 0.3, col, detail);

  // Yapisal detay: halka cerceveler (her 8 hucrede bir) + kose seritleri (panel kenarlari)
  if (mod(j, 8.0) < 0.5) col += pal(uHue + 0.5) * smoothstep(0.1 + dv, 0.0, fz) * (0.25 + 0.5 * uLevel) * detail;
  col += pal(uHue + 0.15) * smoothstep(0.92, 1.0, abs(w)) * (0.18 + 0.6 * uLevel) * detail;

  // Sis ve uzak uc solma
  float fog = exp(-zc * 0.07) * smoothstep(46.0, 28.0, zc);
  col *= fog * uBright;

  // Ufuk isigi (delik degil: ufka dogru isik); bas ile nabiz atar
  col += pal(uHue + 0.1) * exp(-r * 5.0) * (0.22 + uBass * uReact * 0.9) * uCore;

  col *= smoothstep(2.8, 0.7, r);
  col = 1.0 - exp(-col * 1.3);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Tunnel3D implements Visualizer {
  readonly manualRender = true;

  private gl: THREE.WebGLRenderer;
  private quad: QuadShader;
  private tex: THREE.DataTexture;
  private data = new Uint8Array(HIST * HIST);
  private specS = new Float32Array(HIST);
  private colors = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];
  private bg = new THREE.Color();
  private sway = new THREE.Vector2();
  private tmpSize = new THREE.Vector2();
  private clock = 0;
  /** Dünya hücre koordinatı (sınırsız); shader'a 1024 mod'u gider (64'ün katı → satır eşlemesi tutarlı). */
  private travel = 0;
  private rot = 0;
  private hue = 0;
  private beatFlag = false;
  private sLevel = 0;
  private sBass = 0;

  constructor(gl: THREE.WebGLRenderer) {
    this.gl = gl;
    this.tex = new THREE.DataTexture(this.data, HIST, HIST, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;
    this.quad = new QuadShader(FRAG, {
      uAspect: { value: 1 },
      uPxH: { value: 0.002 },
      uT: { value: 0 },
      uRot: { value: 0 },
      uSides: { value: 8 },
      uCells: { value: 3 },
      uReact: { value: 1 },
      uBright: { value: 1 },
      uHue: { value: 0 },
      uBass: { value: 0 },
      uLevel: { value: 0 },
      uCore: { value: 1 },
      uSway: { value: this.sway },
      uHist: { value: this.tex },
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

    this.sLevel += (frame.level - this.sLevel) * damp(dt, 3);
    this.sBass += (frame.bass - this.sBass) * damp(dt, 4);
    this.hue += dt * (0.004 + this.sLevel * 0.02);
    if (frame.beat) this.beatFlag = true;

    // Spektrum (yumuşatılmış): hızlı yükselir, orta hızda söner
    for (let i = 0; i < HIST; i++) {
      const raw = binAtLerp(frame.freq, i / (HIST - 1));
      const cur = this.specS[i];
      this.specS[i] = cur + (raw - cur) * damp(dt, raw > cur ? 14 : 6);
    }

    // İleri uçuş: hız yumuşatılmış seviyeyle (hücre/sn); her yeni hücre sınırında uzak uca bir satır yazılır
    const speed = (3.5 + 7 * Math.min(1, this.sLevel * 3)) * o.travel;
    const prev = Math.floor(this.travel);
    this.travel += dt * speed;
    const now = Math.floor(this.travel);
    for (let n = prev + 1; n <= now; n++) {
      const row = (n + FAR) % HIST;
      const boost = this.beatFlag ? 0.55 : 0; // vuruş: tüm çevreyi saran parlak halka
      this.beatFlag = false;
      for (let i = 0; i < HIST; i++) {
        this.data[row * HIST + i] = Math.min(255, Math.round((this.specS[i] + boost) * 255));
      }
      this.tex.needsUpdate = true;
    }
    this.rot += dt * s.rotationSpeed * (0.1 + this.sLevel * 0.3);

    // Kamera: çok hafif, yavaş salınım (bas biraz büyütür)
    const amp = 0.06 * o.sway * (1 + this.sBass);
    this.sway.set(Math.sin(this.clock * 0.37) * amp, Math.cos(this.clock * 0.29) * amp * 0.7);

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
    u.uT.value = this.travel % 1024;
    u.uRot.value = this.rot;
    u.uSides.value = Math.round(o.sides);
    u.uCells.value = Math.round(o.cells);
    u.uReact.value = o.react;
    u.uBright.value = o.bright;
    u.uHue.value = this.hue;
    u.uBass.value = this.sBass;
    u.uLevel.value = this.sLevel;
    u.uCore.value = o.core >= 0.5 ? 1 : 0;

    this.quad.render(this.gl, null);
  }

  dispose(): void {
    this.tex.dispose();
    this.quad.dispose();
  }
}
