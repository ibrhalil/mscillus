import * as THREE from 'three';
import { binAt, sampleGradient } from './palettes';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';
import { TAU, clamp01, damp } from './util';

const ORB_COUNT = 260;
const DEFAULT_COUNT = 140;
const FIELD_RADIUS = 14;
/** RenderLoop kamerası z=4'te, -z'ye bakar; küreler z ≤ NEAR_Z'de yaşar. */
const CAM_Z = 4;
const NEAR_Z = 2;
const FAR_Z = 130;
const SHAPE_CUBE = 1;
const SHAPE_GLOW = 2;

interface Orb {
  x: number;
  y: number;
  z: number;
  baseScale: number;
  hueT: number;
  phase: number;
  drift: number;
}

/** Yumuşak, yuvarlak ışık lekesi (bokeh): çokgen kenar yok, merkezden dışa sönen parıltı. */
function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Parıltı dokusu için canvas context alınamadı');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

export class Plenoptic implements Visualizer {
  private scene: THREE.Scene;
  private group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private sphereGeometry: THREE.IcosahedronGeometry;
  private cubeGeometry: THREE.BoxGeometry;
  private planeGeometry: THREE.PlaneGeometry;
  private solidMaterial: THREE.MeshBasicMaterial;
  private glowMaterial: THREE.MeshBasicMaterial;
  private glowTex = glowTexture();
  private orbs: Orb[] = [];
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  private bgColor = new THREE.Color();
  private travel = 0;
  // Yumuşatılmış değerler: vuruş/ses sıçramasında ani hareket olmasın
  private speedS = 3;
  private sLevel = 0;
  private sBeat = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.sphereGeometry = new THREE.IcosahedronGeometry(1, 1);
    this.cubeGeometry = new THREE.BoxGeometry(1.4, 1.4, 1.4);
    this.planeGeometry = new THREE.PlaneGeometry(2, 2);
    this.solidMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.glowMaterial = new THREE.MeshBasicMaterial({
      map: this.glowTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.InstancedMesh(this.planeGeometry, this.glowMaterial, ORB_COUNT);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = DEFAULT_COUNT;
    for (let i = 0; i < ORB_COUNT; i++) {
      this.orbs.push(this.randomOrb(NEAR_Z - Math.random() * (FAR_Z - NEAR_Z)));
      this.mesh.setColorAt(i, this.color.setRGB(1, 1, 1));
    }
    this.group.add(this.mesh);
    this.scene.add(this.group);
  }

  private randomOrb(z: number): Orb {
    const angle = Math.random() * TAU;
    const radius = 3 + Math.pow(Math.random(), 0.7) * FIELD_RADIUS;
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius * 0.7,
      z,
      baseScale: 0.25 + Math.random() * 0.6,
      hueT: Math.random(),
      phase: Math.random() * TAU,
      drift: 0.3 + Math.random() * 0.8,
    };
  }

  init(): void {}

  resize(): void {}

  update(frame: AudioFrame, s: VisualizerSettingsView): void {
    const o = s.opt;
    const dt = frame.dt;
    this.bgColor.set(s.palette.bg);
    this.scene.background = this.bgColor;

    const count = Math.round(o.count);
    this.mesh.count = count;
    const shape = Math.round(o.shape);
    const wantGeom =
      shape === SHAPE_GLOW ? this.planeGeometry : shape === SHAPE_CUBE ? this.cubeGeometry : this.sphereGeometry;
    if (this.mesh.geometry !== wantGeom) this.mesh.geometry = wantGeom;
    const wantMat = shape === SHAPE_GLOW ? this.glowMaterial : this.solidMaterial;
    if (this.mesh.material !== wantMat) this.mesh.material = wantMat;
    const glow = shape === SHAPE_GLOW;

    // Yumuşatılmış ses; hız hedefine yavaşça yaklaşır (vuruşta anlık sıçrama yok)
    this.sLevel += (frame.level - this.sLevel) * damp(dt, 2.5);
    this.sBeat += (frame.beatPulse - this.sBeat) * damp(dt, 3);
    const target = (2 + this.sLevel * 9 + this.sBeat * 2.5) * o.travel;
    this.speedS += (target - this.speedS) * damp(dt, 1.5);
    this.travel += dt * (0.2 + s.rotationSpeed);

    const spread = o.spread;
    for (let i = 0; i < count; i++) {
      let orb = this.orbs[i];
      orb.z += this.speedS * dt;
      if (orb.z > NEAR_Z) {
        orb = this.randomOrb(orb.z - (FAR_Z - NEAR_Z));
        this.orbs[i] = orb;
      }

      const v = binAt(frame.freq, orb.hueT);
      const scale = orb.baseScale * o.size * (1 + v * 1.6 + frame.bass * 0.3 + this.sBeat * 0.35) * (glow ? 1.9 : 1);
      const wobbleX = Math.sin(this.travel * orb.drift + orb.phase) * 0.8 * o.drift;
      const wobbleY = Math.cos(this.travel * orb.drift * 0.8 + orb.phase) * 0.6 * o.drift;

      this.dummy.position.set((orb.x + wobbleX) * spread, (orb.y + wobbleY) * spread, orb.z);
      this.dummy.scale.setScalar(scale);
      if (glow) this.dummy.rotation.set(0, 0, 0);
      else this.dummy.rotation.set(this.travel * orb.drift + orb.phase, this.travel * 0.5 + orb.phase, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);

      // Uzakta yumuşak belirir, kameraya yaklaşınca yumuşak söner (eski formül z negatif olduğu için hiç solmuyordu)
      const dist = CAM_Z - orb.z;
      const farFade = clamp01((FAR_Z - dist) / 60);
      const nearFade = clamp01((dist - 3) / 10);
      const fade = farFade * nearFade;
      const [r, g, b] = sampleGradient(s.palette.colors, orb.hueT);
      const bright = (0.3 + v * 1.5 + this.sBeat * 0.4) * fade * (glow ? 0.6 : 1);
      this.mesh.setColorAt(
        i,
        this.color.setRGB(
          Math.min(1, (r / 255) * bright),
          Math.min(1, (g / 255) * bright),
          Math.min(1, (b / 255) * bright),
        ),
      );
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.scene.fog = null;
    this.scene.background = null;
    this.mesh.dispose();
    this.sphereGeometry.dispose();
    this.cubeGeometry.dispose();
    this.planeGeometry.dispose();
    this.solidMaterial.dispose();
    this.glowMaterial.dispose();
    this.glowTex.dispose();
    this.orbs = [];
  }
}
