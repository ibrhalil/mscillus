import * as THREE from 'three';
import { sampleGradient } from './palettes';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { t } from '../i18n';
import { clamp01, damp } from './util';

/**
 * Uzay Yolculuğu: bir yıldız gibi süzülüyoruz. Dünya (yıldızlar ve nebula bulutları) sabittir; yalnızca KAMERA
 * hareket eder ve müziğin ritmine göre hızı ile yönü değişir. Bağımsız hareket eden hiçbir nesne yoktur.
 *
 * - Nesneler kameranın çevresinde, her yöne dağılmış bir küp hacimde durur ve kamera ilerledikçe küpün
 *   içinde sarmalanır (toroidal). Böylece ekran dışında kalan taraflar da hep doludur; kamera dönünce boş
 *   bölge görünmez. Sarma, parlaklığın zaten 0 olduğu uzak yüzeyde olur → aniden belirme yok.
 * - Işık çizgileri gerçek hareket bulanıklığıdır: bir yıldızın "geçmiş" konumu, kameranın doğrusal hızı VE
 *   açısal hızı (yaw/pitch/roll) hesaba katılarak bulunur; dönüşlerde çizgiler yana doğru süpürür.
 */

const STARS = 12000;
const STAR_R = 220;
const CLOUDS = 56;
const CLOUD_R = 300;
const BASE_SPEED = 24;
const MAX_STREAK = 60;

interface Cloud {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  x: number;
  y: number;
  z: number;
  t: number;
  band: number;
  size: number;
  spin: number;
  phase: number;
}

function cloudTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t('error.nebulaTexture'));
  for (let k = 0; k < 10; k++) {
    const x = 64 + (Math.random() - 0.5) * 52;
    const y = 64 + (Math.random() - 0.5) * 52;
    const r = 18 + Math.random() * 32;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.32)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(canvas);
}

/** Yumuşak, yuvarlak ışık lekesi: yıldızlar kare piksel yerine parıltı olarak çizilir. */
function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t('error.glowTexture'));
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export class Voyage implements Visualizer {
  readonly manualRender = true;

  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(72, 1, 0.1, CLOUD_R * 1.4);
  private tmpSize = new THREE.Vector2();
  private tmpV = new THREE.Vector3();
  private bgColor = new THREE.Color();

  // Kamera durumu
  private camX = 0;
  private camY = 0;
  private camZ = 0;
  private yaw = 0;
  private pitch = 0;
  private roll = 0;
  private yawRate = 0;
  private speed = BASE_SPEED;
  private fov = 72;
  private time = 0;
  // Nadir, yumuşak manevra: çoğu zaman düz ileri; arada bir tek bir geniş viraj (sırayla sağ/sol)
  private maneuverTimer = 18;
  private maneuverAge = -1;
  private maneuverDur = 8;
  private maneuverSign = 1;
  private maneuverYaw = 0;
  private maneuverPitch = 0;
  // Yumuşatılmış ses (hareketin kesik kesik olmaması için)
  private sLevel = 0;
  private sBass = 0;
  private sMid = 0;
  private sTreble = 0;
  /** Yavaş-atak seviye: hız bununla sürülür, tek bir yüksek ses ani hareket doğurmaz. */
  private sMotion = 0;
  /** Renk kayması: yalnızca ses varken ilerler. */
  private hue = 0;
  // Kamera ileri yönü (her karede hesaplanır)
  private fx = 0;
  private fy = 0;
  private fz = -1;

  // Yıldızlar
  /** Dünya konumları (sabit; yalnızca sarmalanır). */
  private starPos = new Float32Array(STARS * 3);
  /** Çizim konumları: yakın yıldızlar ilerleme ekseninden dışa doğru ivmelenerek uzaklaştırılır. */
  private renderPos = new Float32Array(STARS * 3);
  private starBase = new Float32Array(STARS * 3);
  private pointCol = new Float32Array(STARS * 3);
  private linePos = new Float32Array(STARS * 6);
  private lineCol = new Float32Array(STARS * 6);
  private pointsGeo = new THREE.BufferGeometry();
  private linesGeo = new THREE.BufferGeometry();
  private pointsMat: THREE.PointsMaterial;
  private glowTex = glowTexture();
  private linesMat: THREE.LineBasicMaterial;
  private paletteId = '';

  // Nebula
  private clouds: Cloud[] = [];
  private cloudTextures: THREE.CanvasTexture[] = [];

  constructor(gl: THREE.WebGLRenderer) {
    this.gl = gl;
    this.updateBasis();

    // --- Yıldızlar: kamera çevresindeki küpte rastgele; hem nokta hem çizgi (ışık çizgisi) olarak çizilir ---
    for (let i = 0; i < STARS; i++) {
      this.starPos[i * 3] = (Math.random() * 2 - 1) * STAR_R;
      this.starPos[i * 3 + 1] = (Math.random() * 2 - 1) * STAR_R;
      this.starPos[i * 3 + 2] = (Math.random() * 2 - 1) * STAR_R;
      this.starBase[i * 3] = this.starBase[i * 3 + 1] = this.starBase[i * 3 + 2] = 1;
    }
    this.pointsGeo.setAttribute('position', new THREE.BufferAttribute(this.renderPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.pointsGeo.setAttribute('color', new THREE.BufferAttribute(this.pointCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.pointsMat = new THREE.PointsMaterial({
      map: this.glowTex,
      size: 1.3,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(this.pointsGeo, this.pointsMat);
    points.frustumCulled = false;
    this.scene.add(points);

    this.linesGeo.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.linesGeo.setAttribute('color', new THREE.BufferAttribute(this.lineCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.linesMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(this.linesGeo, this.linesMat);
    lines.frustumCulled = false;
    this.scene.add(lines);

    // --- Nebula bulutları: yıldızlar gibi dünyaya sabit, kamera çevresindeki küpte sarmalanır ---
    for (let i = 0; i < 3; i++) this.cloudTextures.push(cloudTexture());
    for (let i = 0; i < CLOUDS; i++) {
      const material = new THREE.SpriteMaterial({
        map: this.cloudTextures[i % 3],
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0,
      });
      const sprite = new THREE.Sprite(material);
      this.scene.add(sprite);
      this.clouds.push({
        sprite,
        material,
        x: (Math.random() * 2 - 1) * CLOUD_R,
        y: (Math.random() * 2 - 1) * CLOUD_R,
        z: (Math.random() * 2 - 1) * CLOUD_R,
        t: Math.random(),
        band: i % 4,
        size: 60 + Math.random() * 90,
        spin: (Math.random() - 0.5) * 0.1,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  init(): void {}

  resize(): void {}

  // ---- Yardımcılar -------------------------------------------------------------

  private updateBasis(): void {
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    this.fx = sy * cp;
    this.fy = sp;
    this.fz = -cy * cp;
  }

  private colorOf(s: VisualizerSettingsView, t: number): [number, number, number] {
    const c = sampleGradient(s.palette.colors, ((t % 1) + 1) % 1);
    return [c[0] / 255, c[1] / 255, c[2] / 255];
  }

  // ---- Kare ---------------------------------------------------------------------

  update(frame: AudioFrame, s: VisualizerSettingsView): void {
    const dt = Math.max(frame.dt, 1e-3);
    const o = s.opt;
    this.time += dt;

    // Ses: parlaklık/renk için hızlı-yumuşak, hareket ve titreşim için YAVAŞ-ATAKLI (tek bir yüksek ses ani hareket yaratmasın)
    const ka = damp(dt, 3);
    this.sLevel += (frame.level - this.sLevel) * ka;
    this.sBass += (frame.bass - this.sBass) * ka;
    this.sMid += (frame.mid - this.sMid) * ka;
    this.sTreble += (frame.treble - this.sTreble) * ka;
    this.sMotion += (frame.level - this.sMotion) * damp(dt, 0.9);

    // "Müzik çalıyor mu?" keskin bir eşik: sessiz-ama-çalan müzik de müzik sayılır (eskiden ×5 yumuşak kapı hızı öldürüyordu)
    const activity = clamp01(this.sMotion * 40);

    // Hep İLERİ: müzik varken sabit bir seyir hızı, ses seviyesi bunun ÜSTÜNE ekler; tam sessizlikte yavaş bir süzülmeye iner (durmaz)
    const cruise = 0.12 + 0.48 * activity;
    const target = BASE_SPEED * o.travel * (cruise + this.sMotion * 1.6);
    this.speed += (target - this.speed) * damp(dt, 1.2);

    // Yön RİTİMDEN BAĞIMSIZ ve NADİR: çoğu zaman düz ileri gidilir. 25-55 sn'de bir, 6-10 sn süren TEK bir yumuşak viraj
    // (çan eğrisi) yapılır; virajlar sırayla sağa/sola olduğu için net yön sapması birikmez. Müzik yoksa viraj da başlamaz.
    let bump = 0;
    if (this.maneuverAge < 0) {
      this.maneuverTimer -= dt * activity;
      if (this.maneuverTimer <= 0) {
        this.maneuverAge = 0;
        this.maneuverDur = 6 + Math.random() * 4;
        this.maneuverSign = -this.maneuverSign;
        this.maneuverYaw = this.maneuverSign * (0.14 + Math.random() * 0.1);
        this.maneuverPitch = (Math.random() - 0.5) * 0.1;
      }
    } else {
      this.maneuverAge += dt;
      const p = this.maneuverAge / this.maneuverDur;
      if (p >= 1) {
        this.maneuverAge = -1;
        this.maneuverTimer = 25 + Math.random() * 30;
      } else {
        bump = Math.pow(Math.sin(Math.PI * p), 2);
      }
    }
    const yawTarget = this.maneuverYaw * bump * o.steer * activity;
    this.yawRate += (yawTarget - this.yawRate) * damp(dt, 0.8);
    this.yaw += this.yawRate * dt;

    const pitchTarget = this.maneuverPitch * bump * o.steer * activity;
    this.pitch += (pitchTarget - this.pitch) * damp(dt, 0.7);

    // Dönüşün İÇİNE yat: sağa dönerken kamera saat yönünde (pozitif roll) yatar; düz giderken yatış yok
    const rollTarget = this.yawRate * 1.6;
    this.roll += (rollTarget - this.roll) * damp(dt, 2);

    this.updateBasis();
    this.camX += this.fx * this.speed * dt;
    this.camY += this.fy * this.speed * dt;
    this.camZ += this.fz * this.speed * dt;

    // Renk kayması sesle ilerler (sessizlikte durur)
    this.hue += dt * this.sMotion * 0.12;

    // Palet değişince yıldız renkleri yeniden dağıtılır
    if (this.paletteId !== s.palette.id) {
      this.paletteId = s.palette.id;
      for (let i = 0; i < STARS; i++) {
        const c = this.colorOf(s, Math.random() * 0.8 + (Math.random() < 0.25 ? 0.2 : 0));
        const w = Math.random() < 0.55 ? 0.65 : 0; // çoğu yıldız beyaza yakın, kalanı palet rengi
        this.starBase[i * 3] = c[0] * (1 - w) + w;
        this.starBase[i * 3 + 1] = c[1] * (1 - w) + w;
        this.starBase[i * 3 + 2] = c[2] * (1 - w) + w;
      }
    }

    this.updateStars(o.stars, o.streak, o.accel);
    this.updateClouds(s, o.nebula, dt);

    // Kamera
    this.camera.position.set(this.camX, this.camY, this.camZ);
    this.tmpV.set(this.fx, this.fy, this.fz);
    this.camera.up.set(0, 1, 0).applyAxisAngle(this.tmpV, this.roll);
    this.camera.lookAt(this.camX + this.fx, this.camY + this.fy, this.camZ + this.fz);

    const fovTarget = 72 + clamp01((this.speed - BASE_SPEED) / 60) * 10;
    this.fov += (fovTarget - this.fov) * damp(dt, 3);
    this.camera.fov = this.fov;
    const size = this.gl.getDrawingBufferSize(this.tmpSize);
    this.camera.aspect = size.x / size.y;
    this.camera.updateProjectionMatrix();

    this.bgColor.set(s.palette.bg);
    this.scene.background = this.bgColor;

    this.gl.setRenderTarget(null);
    this.gl.render(this.scene, this.camera);
  }

  private updateStars(density: number, streak: number, accel: number): void {
    const { fx, fy, fz } = this;
    const count = Math.max(500, Math.round(STARS * density));
    this.pointsGeo.setDrawRange(0, count);
    this.linesGeo.setDrawRange(0, count * 2);

    // Işık çizgisi YALNIZCA ilerleme yönündedir: her yıldızın çizgisi ekran merkezindeki "ilerleme noktasına" doğru uzanır
    // (yıldız merkezden dışa akarken kuyruğu içe, yani geldiği yöne bakar). Dönüş hızı çizgi yönünü ETKİLEMEZ.
    const vx = fx * this.speed;
    const vy = fy * this.speed;
    const vz = fz * this.speed;
    const exposure = streak * 0.055;

    // Parlaklık ve renk tonu spektrumla: bas kırmızıya, orta yeşile, tiz maviye doğru kaydırır
    const gain = 0.45 + this.sTreble + this.sMid * 0.3;
    const tr = 1 + this.sBass * 0.6;
    const tg = 1 + this.sMid * 0.5;
    const tb = 1 + this.sTreble * 0.7;
    const pos = this.starPos;
    const R = STAR_R;
    const R2 = R * 2;
    for (let i = 0; i < STARS; i++) {
      const ix = i * 3;
      // Küp içinde sarmala: kamera ilerledikçe arkada kalan yüz öne geçer (orada parlaklık zaten 0)
      let ax = pos[ix] - this.camX;
      let ay = pos[ix + 1] - this.camY;
      let az = pos[ix + 2] - this.camZ;
      if (ax > R) {
        pos[ix] -= R2;
        ax -= R2;
      } else if (ax < -R) {
        pos[ix] += R2;
        ax += R2;
      }
      if (ay > R) {
        pos[ix + 1] -= R2;
        ay -= R2;
      } else if (ay < -R) {
        pos[ix + 1] += R2;
        ay += R2;
      }
      if (az > R) {
        pos[ix + 2] -= R2;
        az -= R2;
      } else if (az < -R) {
        pos[ix + 2] += R2;
        az += R2;
      }

      const d = Math.sqrt(ax * ax + ay * ay + az * az);

      // Yaklaştıkça hızlanma: yıldız yaklaşırken ilerleme ekseninden yanal uzaklığı büyür (uzaklığa bağlı genişleme),
      // yani ekranda merkezden dışa giderek daha hızlı fırlar. Doğrusal ilerleme + perspektif tek başına yeterince belirgin değildi.
      const along = ax * fx + ay * fy + az * fz;
      const flare = 1 + accel * 2.5 * Math.pow(clamp01(1 - d / R), 3);
      const px = this.camX + along * fx + (ax - along * fx) * flare;
      const py = this.camY + along * fy + (ay - along * fy) * flare;
      const pz = this.camZ + along * fz + (az - along * fz) * flare;
      this.renderPos[ix] = px;
      this.renderPos[ix + 1] = py;
      this.renderPos[ix + 2] = pz;

      const b = gain * Math.pow(clamp01(1 - d / R), 0.6) * clamp01((d - 5) / 12);
      const cr = this.starBase[ix] * b * tr;
      const cg = this.starBase[ix + 1] * b * tg;
      const cb = this.starBase[ix + 2] * b * tb;
      this.pointCol[ix] = cr;
      this.pointCol[ix + 1] = cg;
      this.pointCol[ix + 2] = cb;

      // Işık çizgisi: yıldızın bir önceki konumu = p + v·Δt (v = ilerleme hızı, ileri yönde)
      let ox = vx * exposure;
      let oy = vy * exposure;
      let oz = vz * exposure;
      // Yakındakiler belirgin uzun, uzaktakiler neredeyse nokta: ölçek uzaklıkla hızla düşer
      const lf = 0.03 + 2.2 * Math.pow(clamp01(1 - d / R), 2.2);
      ox *= lf;
      oy *= lf;
      oz *= lf;
      const m = Math.sqrt(ox * ox + oy * oy + oz * oz);
      if (m > MAX_STREAK) {
        const k = MAX_STREAK / m;
        ox *= k;
        oy *= k;
        oz *= k;
      }
      const l = i * 6;
      this.linePos[l] = px;
      this.linePos[l + 1] = py;
      this.linePos[l + 2] = pz;
      this.linePos[l + 3] = px + ox;
      this.linePos[l + 4] = py + oy;
      this.linePos[l + 5] = pz + oz;
      this.lineCol[l] = cr;
      this.lineCol[l + 1] = cg;
      this.lineCol[l + 2] = cb;
      this.lineCol[l + 3] = this.lineCol[l + 4] = this.lineCol[l + 5] = 0;
    }
    (this.pointsGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.pointsGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.linesGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.linesGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  private updateClouds(s: VisualizerSettingsView, nebula: number, dt: number): void {
    const bands = [this.sBass, this.sMid, this.sTreble, this.sLevel];
    const vibration = s.opt.vibration;
    const R = CLOUD_R;
    const R2 = R * 2;
    for (const c of this.clouds) {
      let ax = c.x - this.camX;
      let ay = c.y - this.camY;
      let az = c.z - this.camZ;
      if (ax > R) {
        c.x -= R2;
        ax -= R2;
      } else if (ax < -R) {
        c.x += R2;
        ax += R2;
      }
      if (ay > R) {
        c.y -= R2;
        ay -= R2;
      } else if (ay < -R) {
        c.y += R2;
        ay += R2;
      }
      if (az > R) {
        c.z -= R2;
        az -= R2;
      } else if (az < -R) {
        c.z += R2;
        az += R2;
      }
      const d = Math.sqrt(ax * ax + ay * ay + az * az);
      const band = bands[c.band];
      const col = this.colorOf(s, c.t + this.hue);
      c.material.color.setRGB(col[0], col[1], col[2]);
      const fadeNear = clamp01((d - 14) / 55);
      const fadeFar = clamp01((R - d) / (R * 0.4));
      // Sis titreşimi: bulutun kendi frekans bandının enerjisiyle orantılı küçük soluma/parıldama/oynama.
      // Enerji yoksa (sessizlik) titreşim de yoktur.
      const k = vibration * band;
      const w1 = Math.sin(this.time * (5 + c.band * 1.7) + c.phase);
      const w2 = Math.sin(this.time * (7.3 + c.band) + c.phase * 1.7);
      const shimmer = 1 + w2 * 0.28 * k;
      c.material.opacity = Math.min(
        0.55,
        (0.05 + 0.16 * (0.4 + band)) * (0.6 + this.sBass * 0.8) * nebula * fadeNear * fadeFar * shimmer,
      );
      c.material.rotation += c.spin * dt;
      c.sprite.position.set(c.x + w1 * 3 * k, c.y + w2 * 3 * k, c.z);
      const sz = c.size * (0.85 + band * 0.45) * (1 + w1 * 0.07 * k);
      c.sprite.scale.set(sz, sz, 1);
    }
  }

  dispose(): void {
    this.pointsGeo.dispose();
    this.linesGeo.dispose();
    this.pointsMat.dispose();
    this.glowTex.dispose();
    this.linesMat.dispose();
    for (const c of this.clouds) c.material.dispose();
    for (const t of this.cloudTextures) t.dispose();
    this.scene.clear();
  }
}
