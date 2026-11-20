import * as THREE from 'three';
import { binAt, binAtLerp, sampleGradient } from './palettes';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { TAU, damp } from './util';

const LOOP_POINTS = 240;
const TUBE_RADIUS = 3.6;
const TUBULAR_SEGS = 700;
const RADIAL_SEGS = 72;
const RING_AHEAD = 12;
const SPEC_W = 64;
const QUALITY_SCALE = [0.6, 1, 2];

const VERT = `
uniform float uCamT;
uniform float uTime;
uniform float uWave;
varying vec2 vUv;
varying float vAhead;
varying vec3 vNormalV;
varying vec3 vViewPos;

void main() {
  vUv = uv;
  vAhead = fract(uv.x - uCamT);
  float undulate = sin(uv.x * 62.8318 - uTime * 1.9 + uv.y * 6.2831 * 2.0) * 0.5
                 + sin(uv.x * 25.1327 - uTime * 1.3) * 0.5;
  vec3 pos = position - normal * undulate * uWave;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vViewPos = mv.xyz;
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = `
precision highp float;
varying vec2 vUv;
varying float vAhead;
varying vec3 vNormalV;
varying vec3 vViewPos;
uniform float uTime;
uniform float uLoopLen;
uniform float uBass;
uniform float uLevel;
uniform float uBeat;
uniform float uRingAheadU;
uniform float uRingGlow;
uniform float uBright;
uniform float uBandAmt;
uniform float uWaves;
uniform float uDensity;
uniform float uRim;
uniform float uHaze;
uniform float uTwist;
uniform float uHue;
uniform float uColorAmt;
uniform float uDark;
uniform float uBlur;
uniform float uSpiral;
uniform float uLight;
uniform float uStreak;
uniform float uSpeedU;
uniform sampler2D uSpec;
uniform float uBands[8];
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;

const float TAU = 6.28318530718;
const float TUBE_R = 3.6;

vec3 pal(float t) {
  t = fract(t) * 3.0;
  if (t < 1.0) return mix(uColorA, uColorB, t);
  if (t < 2.0) return mix(uColorB, uColorC, t - 1.0);
  return mix(uColorC, uColorA, t - 2.0);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Duvarda (açı u, derinlik s) ızgarasında hücre başına en fazla bir parıltı; parıltı bir IŞIK ÇİZGİSİDİR: yuvarlak bir baş + tünel
// boyunca uzağa (ilerleme noktasına doğru) uzanan, doğrusal sönen ince kuyruk. Hücreler derinlik yönünde uzundur ve
// başın/kuyruğun TAMAMI hücre içinde kalır (hücre kenarında kesilip ızgara çizgisi bırakmaz).
float sparkle(float u, float s, float n, float seed, float dens) {
  float cell = TAU * TUBE_R / n;
  // Döngü boyunca TAM SAYIDA hücre: desen halka kapanırken (başı = sonu) dikişsiz birleşir
  float nS = max(1.0, floor(uLoopLen / (cell * 3.0)));
  float cellS = uLoopLen / nS;
  vec2 g = vec2(u * n, s / cellS);
  vec2 id = floor(g);
  vec2 f = fract(g);
  id.x = mod(id.x, n);
  id.y = mod(id.y, nS);
  float h = hash(id + seed);
  if (h > dens) return 0.0;
  vec2 j = vec2(hash(id + seed + 7.1), hash(id + seed + 13.7));
  float dxw = (f.x - (0.25 + 0.5 * j.x)) * cell;
  float dyw = (f.y - (0.15 + 0.3 * j.y)) * cellS;
  float rw = (0.06 + 0.06 * hash(id + seed + 3.3)) * cell;
  // Kuyruk uzunluğu hızla ve "Tanecik Çizgisi" ayarıyla artar (ayar 0 → neredeyse nokta)
  float Lw = min(rw * (1.0 + 5.0 * uStreak * clamp(uSpeedU / 20.0, 0.3, 1.5)), 0.5 * cellS);
  float head = smoothstep(1.0, 0.0, length(vec2(dxw, min(dyw, 0.0))) / rw);
  float tail = dyw > 0.0 ? clamp(1.0 - dyw / Lw, 0.0, 1.0) : 1.0;
  float tw = 0.55 + 0.45 * sin(uTime * (2.0 + h * 5.0) + h * 50.0);
  return head * tail * tw;
}

void main() {
  float aheadU = vAhead * uLoopLen;
  // Ufuk: uzaklaştıkça KARARIR (uDark) ve ince detay silinir/BULANIKLAŞIR (uBlur)
  float fade = exp(-aheadU * 0.018 * uDark);
  float detail = exp(-aheadU * 0.045 * uBlur);

  float flow1 = sin(vUv.x * TAU * 18.0 - uTime * 1.9 + sin(vUv.y * TAU * 2.0 + uTime * 0.6) * 1.4);
  float flow2 = sin(vUv.x * TAU * 41.0 - uTime * 3.2 + vUv.y * TAU * 6.0);
  float wall = clamp(0.55 + 0.4 * flow1 + 0.18 * flow2, 0.05, 1.3);
  wall = mix(0.55, wall, detail);

  // 8 sektörün enerjisi açı boyunca YUMUŞAK geçişle birleşir (eskiden sert sektör kenarları boyuna çizgiler yapıyordu)
  float sf = vUv.y * 8.0;
  float s0 = floor(sf);
  float st01 = smoothstep(0.0, 1.0, fract(sf));
  float e0 = 0.0;
  float e1 = 0.0;
  for (int i = 0; i < 8; i++) {
    if (float(i) == mod(s0, 8.0)) e0 = uBands[i];
    if (float(i) == mod(s0 + 1.0, 8.0)) e1 = uBands[i];
  }
  float e = mix(e0, e1, st01);

  float ct = fract(vUv.x * 2.0 + uTime * 0.012);
  vec3 col = mix(uColorA, uColorB, ct);
  col = mix(col, uColorC, 0.5 + 0.5 * flow1);

  float ringDist = (uRingAheadU - aheadU) * 0.55;
  float ring = exp(-ringDist * ringDist) * uRingGlow;

  // Karanlık taban + RİTİMLE belirginleşen ışık: uLight sessizlikte düşük, müzik seviyesi ve vuruşla yükselir
  float b = (0.05 + wall * (0.14 + e * uBandAmt * 0.9 + uBass * 0.4)) * fade * uBright * uLight;
  col = col * b + uColorC * ring * 1.7 * exp(-aheadU * 0.012);

  // --- Kuantum katmanı (eski Kuantum Dalışı) — tüm desenler DÖNGÜ ve ÇEVRE boyunca periyodik (dikişsiz) ---
  float s = vUv.x * uLoopLen;
  // Sarmal dönüş: döngü boyunca TAM SAYIDA tur (eskiden s·twist·0.01 halka kapanırken sıçrıyordu)
  float twistN = floor(uTwist * 2.0 + 0.5);
  float ua = vUv.y + vUv.x * twistN;
  float m = 0.5 - 0.5 * cos(ua * TAU); // pürüzsüz ayna: sert katlanma çizgisi yok
  float spec = texture2D(uSpec, vec2(m, 0.25)).r;
  float wv = texture2D(uSpec, vec2(m, 0.75)).r - 0.5;
  float sw = s + wv * 1.6 * uWaves * (0.4 + uLevel);
  // Halka sıklıkları döngü uzunluğuna tam bölünür: k·loopLen = 2π·N
  float k1 = TAU * floor(0.9 * uLoopLen / TAU + 0.5) / uLoopLen;
  float k2 = TAU * floor(2.7 * uLoopLen / TAU + 0.5) / uLoopLen;
  // Yalnızca DAİRESEL halkalar (boyuna kaburga yok), yumuşak kenarlı
  // SARMAL: halka fazı çevre açısıyla TAM SAYI periyot kaymaktadır (çevrede dikişsiz); N=1 ≈ halkalar ~17° eğik, N=2 ≈ ~34°.
  // İnce halkanın (k2 ≈ 3·k1) eğimi aynı kalsın diye kayması 3 katıdır.
  float spN = floor(uSpiral + 0.5);
  float qr1 = pow(0.5 + 0.5 * cos(sw * k1 - TAU * ua * spN), 3.0);
  float qr2 = pow(0.5 + 0.5 * cos(sw * k2 + 1.3 - TAU * ua * spN * 3.0), 5.0);
  float qw = qr1 * (0.22 + spec * 0.8 + uBass * 0.5) + qr2 * 0.16 * (0.3 + uLevel);
  // Renk: boyunca tam sayı döngü + çevrede sin (çevre dikişi yok; eskiden ua·0.2 boyuna renk çizgisi bırakıyordu)
  vec3 qcol = pal(vUv.x * 8.0 + 0.12 * sin(ua * TAU) + uHue) * qw * uWaves * 0.6;

  float p1 = sparkle(ua, s, 24.0, 1.0, 0.8 * uDensity);
  float p2 = sparkle(ua, s, 40.0, 5.0, 0.65 * uDensity);
  float p3 = sparkle(ua, s, 64.0, 9.0, 0.5 * uDensity);
  vec3 dust = mix(pal(vUv.x * 5.0 + 0.5 + uHue), vec3(1.0), 0.6) * (p1 + 0.8 * p2 + 0.6 * p3) * (0.8 + uLevel * 1.2);

  col += (qcol + dust) * fade * detail * uLight;

  // Kenar (ışına teğet duvar) parlaması: tünelin yuvarlaklığı ve derinlik
  float rim = pow(1.0 - abs(dot(normalize(vNormalV), normalize(-vViewPos))), 2.5);
  col *= 1.0 + uRim * 0.9 * rim;

  // Uzak duvar karanlığa değil ışık sisine karışır (tünelin ucundaki ışık)
  col += pal(uHue * 0.5 + 0.1) * uHaze * (0.25 + uBass * 0.5) * (1.0 - fade) * 0.7 * uLight;

  // Renk canlılığı müzik ritmiyle artar; UZAKTAKİ duvar ve sis renksizdir (sessizlikte tünel gri tonlardadır)
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uColorAmt * mix(0.2, 1.0, fade));

  col = col / (1.0 + col * 0.25);
  gl_FragColor = vec4(col, 1.0);
}
`;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Kapalı yol: SEKİZ (∞) biçimi. Eski yol büyük bir daireydi ve merkez hep kameranın sağında kaldığı için tünel durmadan
 * SAĞA kıvrılıyordu. Sekizde bir lob sağa, diğeri sola döner; yön her yarım turda değişir.
 * Kesişme noktasında iki geçiş farklı yükseklikte (y = ±H) olduğu için tüp kendini kesmez.
 */
function buildLoopCurve(): THREE.CatmullRomCurve3 {
  const A = randRange(70, 90);
  const B = randRange(48, 66);
  const H = randRange(14, 20);
  const c1 = randRange(2, 8);
  const c2 = randRange(2, 8);
  const d = randRange(0, 5);
  const ph1 = Math.random() * TAU;
  const ph2 = Math.random() * TAU;
  const ph3 = Math.random() * TAU;
  const flip = Math.random() < 0.5 ? -1 : 1; // hangi lobun önce geleceği

  const points: THREE.Vector3[] = [];
  for (let i = 0; i < LOOP_POINTS; i++) {
    const theta = (i / LOOP_POINTS) * TAU;
    points.push(
      new THREE.Vector3(
        flip * (A * Math.sin(theta) + c1 * Math.sin(3 * theta + ph1)),
        H * Math.cos(theta) + d * Math.sin(2 * theta + ph3),
        B * Math.sin(2 * theta) + c2 * Math.sin(3 * theta + ph2),
      ),
    );
  }
  return new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5);
}

export class Wormhole implements Visualizer {
  readonly manualRender = true;

  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private curve: THREE.CatmullRomCurve3;
  private loopLen: number;
  private geometry: THREE.TubeGeometry;
  private material: THREE.ShaderMaterial;
  private colors = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
  private bands: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  private tmpSize = new THREE.Vector2();
  private bgColor = new THREE.Color();
  private up = new THREE.Vector3(0, 1, 0);
  private camT = 0;
  private time = 0;
  private bank = 0;
  private kick = 0;
  private ringT = 0;
  private ringGlow = 0;
  private sLevel = 0;
  private hue = 0;
  private colorAmt = 0.3;
  private lightS = 0.4;
  // Yumuşatılmış değerler: vuruşta/ses sıçramasında ani (zıplayan) hareket olmasın
  private sBeat = 0;
  private sBass = 0;
  private speedS = 10;
  private kickS = 0;
  private fovS = 70;
  private speedNow = 0;
  private appliedRatio = 0;
  private specData = new Uint8Array(SPEC_W * 2);
  private specTex: THREE.DataTexture;

  constructor(gl: THREE.WebGLRenderer) {
    this.gl = gl;

    this.curve = buildLoopCurve();
    // Yay uzunluğu tablosu sıklaştırılır: konum/teğet eşlemesindeki kademeli (parça parça doğrusal) hız dalgalanması giderilir
    this.curve.arcLengthDivisions = 3000;
    this.curve.updateArcLengths();
    this.loopLen = this.curve.getLength();

    this.specTex = new THREE.DataTexture(this.specData, SPEC_W, 2, THREE.RedFormat, THREE.UnsignedByteType);
    this.specTex.minFilter = THREE.LinearFilter;
    this.specTex.magFilter = THREE.LinearFilter;
    this.specTex.needsUpdate = true;

    this.geometry = new THREE.TubeGeometry(this.curve, TUBULAR_SEGS, TUBE_RADIUS, RADIAL_SEGS, true);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      uniforms: {
        uCamT: { value: 0 },
        uTime: { value: 0 },
        uWave: { value: 0.35 },
        uLoopLen: { value: this.loopLen },
        uBass: { value: 0 },
        uLevel: { value: 0 },
        uBeat: { value: 0 },
        uRingAheadU: { value: RING_AHEAD },
        uRingGlow: { value: 0 },
        uBright: { value: 1 },
        uBandAmt: { value: 1 },
        uWaves: { value: 1 },
        uDensity: { value: 1 },
        uRim: { value: 1 },
        uHaze: { value: 1 },
        uTwist: { value: 1 },
        uHue: { value: 0 },
        uColorAmt: { value: 0.3 },
        uDark: { value: 1 },
        uBlur: { value: 1 },
        uSpiral: { value: 1 },
        uLight: { value: 0.4 },
        uStreak: { value: 1 },
        uSpeedU: { value: 0 },
        uSpec: { value: this.specTex },
        uBands: { value: this.bands },
        uColorA: { value: this.colors[0] },
        uColorB: { value: this.colors[1] },
        uColorC: { value: this.colors[2] },
      },
    });
    const tube = new THREE.Mesh(this.geometry, this.material);
    tube.frustumCulled = false;
    this.scene.add(tube);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 600);
    this.ringT = RING_AHEAD / this.loopLen;
  }

  init(): void {}

  resize(): void {
    // RenderLoop piksel oranını yeniden kurar; kalite ayarı bir sonraki karede yeniden uygulanır.
    this.appliedRatio = 0;
  }

  /** "Çözünürlük" ayarı: çizim tamponunu küçültür (ekrana bilinear büyür). */
  private applyQuality(level: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ratio = level >= 2 ? dpr : Math.min(dpr, QUALITY_SCALE[level]);
    if (ratio === this.appliedRatio) return;
    this.appliedRatio = ratio;
    const el = this.gl.domElement;
    this.gl.setPixelRatio(ratio);
    this.gl.setSize(el.clientWidth || 1, el.clientHeight || 1, false);
  }

  update(frame: AudioFrame, s: VisualizerSettingsView): void {
    this.time += frame.dt;

    const o = s.opt;
    // Seviye düşük-geçiren filtreden geçer: tek bir yüksek ses hızı birden fırlatmaz; vuruş atılımı `punch` ile ayarlanır (0 = kapalı)
    this.sLevel += (frame.level - this.sLevel) * damp(frame.dt, 2.5);
    this.sBeat += (frame.beatPulse - this.sBeat) * damp(frame.dt, 3);
    this.sBass += (frame.bass - this.sBass) * damp(frame.dt, 3);
    // Hız hedefine yavaşça yaklaşır (vuruşta anlık sıçrama yok)
    const speedTarget = (10 + this.sLevel * 16 + this.sBeat * 10 * o.punch + s.rotationSpeed * 6) * o.travel;
    this.speedS += (speedTarget - this.speedS) * damp(frame.dt, 1.5);
    const speed = this.speedS;
    this.speedNow = speed;
    this.hue += frame.dt * this.sLevel * 0.12;
    this.applyQuality(Math.round(o.quality));
    this.camT = (this.camT + (speed * frame.dt) / this.loopLen) % 1;

    const pos = this.curve.getPointAt(this.camT);
    const fwd = this.curve.getTangentAt(this.camT).normalize();
    const fwd2 = this.curve.getTangentAt((this.camT + 0.012) % 1).normalize();

    this.up.addScaledVector(fwd, -this.up.dot(fwd));
    if (this.up.lengthSq() < 0.3) this.up.set(1, 0, 0);
    else this.up.normalize();

    const yaw = fwd.x * fwd2.z - fwd.z * fwd2.x;
    const bankTarget = Math.max(-0.7, Math.min(0.7, yaw * 12 * o.bank));
    this.bank += (bankTarget - this.bank) * damp(frame.dt, 3);

    if (frame.beat && Math.random() < 0.3) this.kick += (Math.random() - 0.5) * 0.5 * o.kick;
    this.kick *= Math.pow(0.15, frame.dt);

    const sway = Math.sin(this.time * 0.11) * 0.35 + Math.sin(this.time * 0.057) * 0.2;
    this.kickS += (this.kick - this.kickS) * damp(frame.dt, 2.5);
    const rollAngle = this.bank + sway + this.kickS;
    const rolledUp = this.up.clone().applyAxisAngle(fwd, rollAngle);

    this.camera.up.copy(rolledUp);
    this.camera.position.copy(pos);
    this.camera.lookAt(pos.clone().addScaledVector(fwd, 10));
    this.fovS += (o.fov + this.sBeat * 6 * o.punch - this.fovS) * damp(frame.dt, 4);
    this.camera.fov = this.fovS;
    this.camera.updateProjectionMatrix();

    if (o.ring >= 0.5 && frame.beat) {
      this.ringT = (this.camT + RING_AHEAD / this.loopLen) % 1;
      this.ringGlow = 1;
    }
    this.ringGlow = Math.max(0, this.ringGlow - frame.dt * 0.55);

    const u = this.material.uniforms;
    const base = (this.time * 0.02) % 1;
    const stops = [base, (base + 0.35) % 1, (base + 0.7) % 1];
    for (let i = 0; i < 3; i++) {
      const c = sampleGradient(s.palette.colors, stops[i]);
      this.colors[i].setRGB(c[0] / 255, c[1] / 255, c[2] / 255);
    }
    for (let i = 0; i < 8; i++) {
      this.bands[i] = binAt(frame.freq, i / 8);
    }

    const ringAheadU = ((this.ringT - this.camT + 1) % 1) * this.loopLen;

    u.uCamT.value = this.camT;
    u.uTime.value = this.time;
    u.uWave.value = (0.35 + this.sBass * 0.6 + this.sBeat * 0.25) * o.wave;
    u.uBright.value = o.brightness;
    u.uBandAmt.value = o.bands;
    u.uWaves.value = o.waves;
    u.uDensity.value = o.density;
    u.uRim.value = o.rim;
    u.uHaze.value = o.haze;
    u.uTwist.value = o.twist;
    u.uHue.value = this.hue;
    // Renk canlılığı: seviye ve vuruşla (hızlı-yumuşak) artar, sessizlikte sönükleşir
    const colorTarget = Math.min(1, 0.1 + this.sLevel * 2.5 + frame.beatPulse * 0.5);
    this.colorAmt += (colorTarget - this.colorAmt) * damp(frame.dt, 6);
    u.uColorAmt.value = Math.min(1.5, this.colorAmt * o.colorful);
    u.uSpeedU.value = this.speedNow;
    u.uDark.value = o.horizonDark;
    u.uBlur.value = o.horizonBlur;
    u.uSpiral.value = o.spiral;
    // Işık ritimle belirginleşir: sessizlikte loş, seviye ve vuruşla yükselir (hızlı-yumuşak, vuruşta parlayıp söner)
    const lightTarget = Math.min(2, 0.3 + this.sLevel * 2.4 + this.sBeat * 1.0);
    this.lightS += (lightTarget - this.lightS) * damp(frame.dt, 8);
    u.uLight.value = this.lightS;
    u.uStreak.value = o.streak;

    // Ses dokusu: satır 0 spektrum (log eksen), satır 1 dalga biçimi
    const wave = frame.wave;
    for (let i = 0; i < SPEC_W; i++) {
      const t = i / (SPEC_W - 1);
      this.specData[i] = Math.min(255, Math.round(binAtLerp(frame.freq, t) * 255));
      this.specData[SPEC_W + i] = wave[Math.min(wave.length - 1, Math.floor(t * (wave.length - 1)))];
    }
    this.specTex.needsUpdate = true;
    u.uBass.value = this.sBass;
    u.uLevel.value = this.sLevel;
    u.uBeat.value = this.sBeat;
    u.uRingAheadU.value = ringAheadU;
    u.uRingGlow.value = this.ringGlow;

    this.bgColor.set(s.palette.bg);
    this.scene.background = this.bgColor;

    const size = this.gl.getDrawingBufferSize(this.tmpSize);
    this.camera.aspect = size.x / size.y;
    this.camera.updateProjectionMatrix();

    this.gl.setRenderTarget(null);
    this.gl.render(this.scene, this.camera);
  }

  dispose(): void {
    // Diğer modlar için piksel oranını RenderLoop'un varsayılanına döndür
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const el = this.gl.domElement;
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(el.clientWidth || 1, el.clientHeight || 1, false);
    this.specTex.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
