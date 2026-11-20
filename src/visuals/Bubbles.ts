import * as THREE from 'three';
import { sampleGradient } from './palettes';
import { QuadShader } from './quadShader';
import { EventScale, OnsetTracker } from './onset';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { damp } from './util';

/**
 * Baloncuklar: sabun köpüğü. Her baloncuk GPU'da (instanced quad) çizilir: neredeyse saydam gövde, kenarda gökkuşağı ince film
 * (açıya ve zamana göre kayan bantlar), iki parlak yansıma, hafif şekil titreşimi. Fizik: büyük baloncuk daha hızlı yükselir
 * (kaldırma ~ boyut), hafifçe sallanır, tepede patlar (halka).
 *
 * Müzik: vuruş → alttan baloncuk demeti (sayı ve boyut vuruşun MÜZİĞİN ortalamasına göre şiddetiyle), bas → yükselme hızı (yumuşak),
 * tiz → ince küçük baloncuk akışı; bas vermeyen müzikte spektral akı onset'i ve taban akış baloncuk çıkarır. Renk boyutla ilişkilidir.
 */

const MAX_BUBBLES = 220;
const MAX_POPS = 48;

const VERT = `
attribute vec4 iPos;
attribute vec4 iCol;
uniform vec2 uRes;
varying vec2 vP;
varying vec4 vCol;
varying float vType;
void main() {
  // Cizim alani %25 genis: sekil titresimi (ellips) baloncugu bir yonde uzatir; alan dar olursa uzayan taraf duz cizgiyle KESILIRDI.
  // vP, baloncugun yaricapi 1 olacak sekilde (kare disina tasabilir) olceklenir.
  vP = position.xy * 1.25;
  vCol = iCol;
  vType = iPos.w;
  vec2 px = iPos.xy + vP * iPos.z;
  gl_Position = vec4(px / uRes * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;
varying vec2 vP;
varying vec4 vCol;
varying float vType;

uniform float uTime;
uniform float uFilm;
uniform float uBright;
uniform float uHue;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;

vec3 pal(float t) {
  t = fract(t) * 4.0;
  if (t < 1.0) return mix(uC0, uC1, t);
  if (t < 2.0) return mix(uC1, uC2, t - 1.0);
  if (t < 3.0) return mix(uC2, uC3, t - 2.0);
  return mix(uC3, uC0, t - 3.0);
}

void main() {
  vec2 p = vP;
  float seed = vCol.y;
  if (vType < 0.5) {
    // Hafif sekil titresimi (ellips olur, alan korunur)
    float wob = 0.05 * sin(uTime * 2.6 + seed * 20.0);
    p.x *= 1.0 + wob;
    p.y /= 1.0 + wob;
    float r = length(p);
    if (r > 1.0) discard;
    float ang = atan(p.y, p.x);

    // Ince film: aciya, yaricapa ve zamana gore kayan gokkusagi bantlari
    float thick = r * 1.6 + 0.35 * sin(ang * 2.0 + seed * 12.0 + uTime * 0.5) + 0.25 * sin(ang * 3.0 - uTime * 0.3 + seed * 7.0) + uTime * 0.12 + seed;
    vec3 film = pal(thick + uHue);
    float rim = pow(r, 5.0);
    float edge = smoothstep(0.86, 0.97, r) * (1.0 - smoothstep(0.985, 1.0, r));
    vec3 tint = pal(vCol.x + uHue);
    float body = 0.05 + 0.1 * (1.0 - r * r);

    vec3 c = tint * body + film * (rim * 0.9 * uFilm + edge * 0.7);
    // Yansimalar: ust solda uzun, alt sagda kucuk
    vec2 q = p - vec2(-0.38, 0.42);
    float hl = smoothstep(0.26, 0.0, length(q * vec2(1.0, 2.0)));
    float h2 = smoothstep(0.12, 0.0, length(p - vec2(0.4, -0.42)));
    c += vec3(1.0) * (hl * 0.9 + h2 * 0.45);
    gl_FragColor = vec4(c * vCol.w * uBright, 1.0);
  } else {
    // Patlama halkasi: genisleyip incelir ve soner
    float age = vCol.z;
    float r = length(p);
    float rr = 0.35 + 0.65 * age;
    float th = 0.07 * (1.0 - age) + 0.012;
    float ring = exp(-pow((r - rr) / th, 2.0));
    vec3 c = (pal(vCol.x + uHue) + vec3(0.3)) * ring * (1.0 - age) * 1.2 * vCol.w;
    gl_FragColor = vec4(c * uBright, 1.0);
  }
}
`;

const BG_FRAG = `
precision highp float;
varying vec2 vUv;
uniform vec3 uBg;
uniform vec3 uTint;
uniform float uLevel;
void main() {
  vec3 deep = uBg * 0.7;
  vec3 top = uBg + uTint * (0.05 + 0.1 * uLevel);
  gl_FragColor = vec4(mix(deep, top, smoothstep(0.0, 1.0, vUv.y)), 1.0);
}
`;

interface Bubble {
  x: number;
  y: number;
  r: number;
  vy: number;
  vx: number;
  seed: number;
  phase: number;
  age: number;
  /** Ömür (sn): dolunca ekranın herhangi bir yerinde patlar; küçükler daha çabuk. */
  life: number;
  /** Ritim yükselişinde işaretlenen planlı patlama zamanı (Infinity = yok). */
  popAt: number;
}

interface Pop {
  x: number;
  y: number;
  r: number;
  age: number;
  t: number;
  /** Süre (sn) ve parlaklık: büyük baloncuk daha uzun ve parlak patlar. */
  dur: number;
  power: number;
}

export class Bubbles implements Visualizer {
  readonly manualRender = true;

  private gl: THREE.WebGLRenderer;
  private bg: QuadShader;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private geo = new THREE.InstancedBufferGeometry();
  private mat: THREE.ShaderMaterial;
  private iPos = new Float32Array((MAX_BUBBLES + MAX_POPS) * 4);
  private iCol = new Float32Array((MAX_BUBBLES + MAX_POPS) * 4);
  private colors = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];
  private bgCol = new THREE.Color();
  private tint = new THREE.Color();
  private res = new THREE.Vector2(1, 1);
  private bubbles: Bubble[] = [];
  private pops: Pop[] = [];
  private time = 0;
  private hue = 0;
  private streamAcc = 0;
  /** Zamana yayılmış çıkışlar: demet tek seferde değil, kısa bir akış olarak çıkar. */
  private pending: { t: number; x0: number; spread: number; r: number; vyMul: number }[] = [];
  private onset = new OnsetTracker();
  private scale = new EventScale();
  private sBass = 0;
  private sTreble = 0;
  private sLevel = 0;

  constructor(gl: THREE.WebGLRenderer) {
    this.gl = gl;
    this.bg = new QuadShader(BG_FRAG, {
      uBg: { value: this.bgCol },
      uTint: { value: this.tint },
      uLevel: { value: 0 },
    });

    const plane = new THREE.PlaneGeometry(2, 2);
    this.geo.index = plane.index;
    this.geo.setAttribute('position', plane.getAttribute('position'));
    this.geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.iPos, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('iCol', new THREE.InstancedBufferAttribute(this.iCol, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uRes: { value: this.res },
        uTime: { value: 0 },
        uFilm: { value: 1 },
        uBright: { value: 1 },
        uHue: { value: 0 },
        uC0: { value: this.colors[0] },
        uC1: { value: this.colors[1] },
        uC2: { value: this.colors[2] },
        uC3: { value: this.colors[3] },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  init(): void {}

  resize(): void {}

  /** Boyuta bağlı yükselme hızı (px/sn): dev baloncuklar fazla hızlanmasın diye r 60'ta sınırlanır. */
  private vtOf(r: number): number {
    return 22 + 3 * Math.min(r, 60);
  }

  /** Geniş boyut çeşitliliği: log-normal benzeri dağılım (çoğu orta/küçük, ara sıra çok büyük). */
  private randSize(base: number, max: number): number {
    const g = Math.random() + Math.random() + Math.random() - 1.5;
    return Math.min(max, Math.max(3, base * Math.exp(g * 1.2)));
  }

  /** Dipte (yeni çıkış bölgesinde) mevcut baloncuklardan en uzak x'i seçer (8 adaydan): dip dibe/kümeli çıkış olmaz. */
  private bestX(w: number, r: number, around: number | undefined, spread: number): number {
    let best = w * 0.5;
    let bestScore = -1e9;
    for (let k = 0; k < 8; k++) {
      const x = around === undefined ? Math.random() * w : Math.min(w, Math.max(0, around + (Math.random() - 0.5) * spread));
      let score = 1e9;
      for (const b of this.bubbles) {
        if (b.y > r * 3 + 140) continue;
        score = Math.min(score, Math.hypot(x - b.x, -r - b.y) - (r + b.r));
      }
      if (score > bestScore) {
        bestScore = score;
        best = x;
      }
    }
    return best;
  }

  private spawn(x: number, y: number, r: number, vy: number): void {
    if (this.bubbles.length >= MAX_BUBBLES) return;
    const life = (2.5 + 9 * Math.pow(Math.random(), 1.4)) * (0.6 + 0.4 * Math.min(1, r / 25));
    this.bubbles.push({ x, y, r, vy, vx: 0, seed: Math.random(), phase: Math.random() * 6.283, age: 0, life, popAt: Infinity });
  }

  update(frame: AudioFrame, s: VisualizerSettingsView, w: number, h: number): void {
    const o = s.opt;
    const dt = frame.dt;
    this.time += dt;
    this.res.set(w, h);
    this.hue += dt * (0.004 + this.sLevel * 0.02);

    this.sBass += (frame.bass - this.sBass) * damp(dt, 3);
    this.sTreble += (frame.treble - this.sTreble) * damp(dt, 5);
    this.sLevel += (frame.level - this.sLevel) * damp(dt, 3);
    this.scale.tick(dt);

    const rise = o.rise * (0.75 + 0.5 * this.sBass);
    const sz = o.size;
    const musicOn = this.sLevel > 0.02;
    const loud = Math.min(1, this.sLevel * 3.5);

    // --- Çıkış: vuruş = demet (sayı/boyut göreli şiddetle), onset = küçük demet, tiz = ince akış ---
    const onsetHit = this.onset.update(frame, dt);
    if (frame.beat || onsetHit) {
      const e = frame.beat ? frame.bass + 0.3 * Math.min(1, this.sLevel * 2) : 0.3 * Math.min(1, this.onset.ratio / 4) + 0.3 * frame.bass;
      const pw = this.scale.rel(e);
      const count = (frame.beat ? 3 : 2) + Math.round(10 * Math.pow(pw, 1.2) * o.rate);
      // Boyut RİTİMLE İLİŞKİLİ: hem müziğin kendi ortalamasına göre (pw) hem de mutlak ses seviyesine (loud) göre; sessizken küçük
      const r0 = (7 + 30 * pw) * (0.45 + 0.55 * loud) * sz;
      // Ritim yükselişinde yeni baloncuklar çıkarken ESKİLER patlar: en yaşlılardan, demetin ~%70'i kadar (şiddetle artar),
      // 0.05–0.5 sn içine serpiştirilmiş zamanlarla (hepsi aynı anda değil)
      if (o.pops >= 0.5) {
        const old = this.bubbles.filter((b) => b.age > 1.5 && b.popAt === Infinity).sort((a, b) => b.age - a.age);
        const kill = Math.min(old.length, Math.max(1, Math.round(count * 0.7)));
        for (let i = 0; i < kill; i++) old[i].popAt = this.time + 0.05 + Math.random() * 0.45;
      }
      // Demet tek seferde ve tek noktada DEĞİL: geniş bir banda yayılır ve 0.5 sn'ye kadar zamana serpiştirilir
      const x0 = w * (0.1 + Math.random() * 0.8);
      const spread = Math.min(w * 0.5, 160 + r0 * 5);
      for (let i = 0; i < count; i++) {
        // Boyutlar çeşitli ama üst sınır şiddete bağlı (`pw`); dev baloncuk yalnız güçlü vuruşta çıkabilir
        const giant = pw > 0.55 && Math.random() < 0.18 * pw ? 1.6 : 1;
        const r = this.randSize(r0, r0 * (1.3 + pw)) * giant;
        this.pending.push({ t: this.time + i * (0.05 + Math.random() * 0.08) + Math.random() * 0.15, x0, spread, r, vyMul: 1.7 });
      }
    }
    // İnce akış: tiz yükseldikçe sıklaşır; müzik varken taban akış (zayıf tizli müzikte de bir şey çıksın)
    if (musicOn) {
      this.streamAcc += dt * (0.9 + 18 * Math.max(0, this.sTreble - 0.05)) * o.rate;
      while (this.streamAcc >= 1) {
        this.streamAcc -= 1;
        // Taban akış: boyut ve üst sınır o anki ses seviyesine bağlı → sessizken yalnız küçük baloncuklar
        const r = this.randSize(3.5 * sz * (0.6 + 0.8 * loud), (8 + 30 * loud) * sz);
        this.spawn(this.bestX(w, r, undefined, 0), -r, r, this.vtOf(r) * rise);
      }
    }

    // Zamanı gelen çıkışlar: boş yer seçilerek bırakılır
    if (this.pending.length > 0) {
      const due = this.pending.filter((q) => q.t <= this.time);
      this.pending = this.pending.filter((q) => q.t > this.time);
      for (const q of due) {
        this.spawn(this.bestX(w, q.r, q.x0, q.spread), -q.r - Math.random() * 20, q.r, this.vtOf(q.r) * rise * q.vyMul);
      }
    }

    // --- Fizik ---
    const popZone = o.pops >= 0.5;
    for (const b of this.bubbles) {
      b.age += dt;
      // Baloncuğa özgü ±15% hız farkı: aynı boyuttakiler bile birbirinden ayrılır
      const vt = this.vtOf(b.r) * rise * (0.85 + 0.3 * b.seed);
      b.vy += (vt - b.vy) * damp(dt, 2);
      b.vx += (Math.sin(this.time * (0.7 + b.seed) + b.phase) * (16 / (1 + 0.04 * b.r)) * (0.6 + this.sLevel * 1.5) - b.vx) * damp(dt, 2);
      b.y += b.vy * dt;
      b.x += b.vx * dt;
    }

    // Yumuşak ayrışma: üst üste binen baloncuklar birbirini nazikçe iter (birleşme yok, iç içe girmezler)
    const bl = this.bubbles;
    for (let i = 0; i < bl.length; i++) {
      for (let j = i + 1; j < bl.length; j++) {
        const a = bl[i];
        const b = bl[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = 0.95 * (a.r + b.r);
        if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
        const d = Math.hypot(dx, dy);
        if (d >= min || d < 0.001) continue;
        const push = (min - d) * 0.35;
        const nx = dx / d;
        const ny = dy / d;
        const ma = a.r * a.r;
        const mb = b.r * b.r;
        a.x -= nx * push * (mb / (ma + mb));
        a.y -= ny * push * (mb / (ma + mb)) * 0.3;
        b.x += nx * push * (ma / (ma + mb));
        b.y += ny * push * (ma / (ma + mb)) * 0.3;
      }
    }

    // Patlama: tepeye ulaştı, ömrü doldu (ekranın her yerinde, farklı zamanlarda) ya da ritim yükselişiyle işaretlendi.
    // Önce patlayanlar belirlenir, sonra HER patlama çevresindeki baloncuklara boyutuyla orantılı bir ŞOK DALGASI (itme) uygular.
    const next: Bubble[] = [];
    const popping: Bubble[] = [];
    for (const b of this.bubbles) {
      const topY = popZone ? h * (0.78 + 0.17 * b.seed) : h + b.r;
      if (popZone && (b.age > b.life || this.time >= b.popAt || b.y > topY)) {
        popping.push(b);
        continue;
      }
      if (b.y > h + b.r) continue;
      next.push(b);
    }
    for (const p of popping) {
      const power = Math.min(1, p.r / (40 * sz));
      if (this.pops.length < MAX_POPS) {
        this.pops.push({ x: p.x, y: p.y, r: p.r * 1.7, age: 0, t: 0.15 + 0.7 * power, dur: 0.35 + 0.4 * power, power: 0.6 + 0.6 * power });
      }
      // Şok dalgası: menzil ~ 4.5·r; itme hızı ~ patlayan boyutu / komşu boyutu (küçükler daha çok savrulur), uzaklıkla karesel azalır
      const range = p.r * 4.5;
      for (const o2 of next) {
        const dx = o2.x - p.x;
        const dy = o2.y - p.y;
        const d = Math.hypot(dx, dy);
        const reach = range + o2.r;
        if (d >= reach || d < 0.001) continue;
        const fall = 1 - d / reach;
        const imp = 7 * p.r * (14 / (o2.r + 10)) * fall * fall;
        o2.vx += (dx / d) * imp;
        o2.vy += (dy / d) * imp;
      }
    }
    this.bubbles = next;
    this.pops = this.pops.filter((p) => (p.age += dt / p.dur) < 1);

    // --- GPU'ya yaz ---
    let n = 0;
    for (const b of this.bubbles) {
      const t = 0.15 + 0.7 * Math.min(1, b.r / (45 * sz)) + (b.seed - 0.5) * 0.15;
      const birth = Math.exp(-b.age * 3) * 0.5;
      const alpha = (0.55 + 0.45 * Math.min(1, b.r / 30)) * Math.min(1, b.age / 0.3) * (1 + birth);
      this.iPos[n * 4] = b.x;
      this.iPos[n * 4 + 1] = b.y;
      this.iPos[n * 4 + 2] = b.r;
      this.iPos[n * 4 + 3] = 0;
      this.iCol[n * 4] = t;
      this.iCol[n * 4 + 1] = b.seed;
      this.iCol[n * 4 + 2] = b.age;
      this.iCol[n * 4 + 3] = alpha;
      n++;
    }
    for (const p of this.pops) {
      this.iPos[n * 4] = p.x;
      this.iPos[n * 4 + 1] = p.y;
      this.iPos[n * 4 + 2] = p.r;
      this.iPos[n * 4 + 3] = 1;
      this.iCol[n * 4] = p.t;
      this.iCol[n * 4 + 1] = 0;
      this.iCol[n * 4 + 2] = p.age;
      this.iCol[n * 4 + 3] = p.power;
      n++;
    }
    this.geo.instanceCount = n;
    (this.geo.getAttribute('iPos') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('iCol') as THREE.InstancedBufferAttribute).needsUpdate = true;

    for (let i = 0; i < 4; i++) {
      const x = this.hue * 0.5 + i * 0.25;
      const c = sampleGradient(s.palette.colors, 1 - Math.abs(2 * (x - Math.floor(x)) - 1));
      this.colors[i].setRGB(c[0] / 255, c[1] / 255, c[2] / 255);
    }
    this.bgCol.set(s.palette.bg);
    const tc = sampleGradient(s.palette.colors, 0.5);
    this.tint.setRGB(tc[0] / 255, tc[1] / 255, tc[2] / 255);
    const bu = this.bg.material.uniforms;
    bu.uLevel.value = this.sLevel;
    const u = this.mat.uniforms;
    u.uTime.value = this.time;
    u.uFilm.value = o.film;
    u.uBright.value = o.bright;
    u.uHue.value = this.hue;

    // Önce zemin, sonra baloncuklar (temizleme kapalı)
    this.bg.render(this.gl, null);
    this.gl.autoClear = false;
    this.gl.render(this.scene, this.cam);
    this.gl.autoClear = true;
  }

  dispose(): void {
    this.bg.dispose();
    this.geo.dispose();
    this.mat.dispose();
  }
}
