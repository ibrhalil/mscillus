import * as THREE from 'three';
import { binAt, sampleGradient } from './palettes';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';

const RING_COUNT = 48;
const RING_RADIUS = 4;
const SPACING = 3.4;

export class Tunnel3D implements Visualizer {
  readonly id = 'tunnel';
  readonly name = '3D Tünel';
  readonly renderer = 'three';

  private scene: THREE.Scene;
  private group = new THREE.Group();
  private rings: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>[] = [];
  private core: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private geometry: THREE.TorusGeometry;
  private coreGeometry: THREE.SphereGeometry;
  private bgColor = new THREE.Color();
  private depth = RING_COUNT * SPACING;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.geometry = new THREE.TorusGeometry(RING_RADIUS, 0.09, 8, 72);
    this.coreGeometry = new THREE.SphereGeometry(1.1, 24, 24);

    for (let i = 0; i < RING_COUNT; i++) {
      const material = new THREE.MeshBasicMaterial({ transparent: true });
      const ring = new THREE.Mesh(this.geometry, material);
      ring.position.z = -i * SPACING;
      this.group.add(ring);
      this.rings.push(ring);
    }

    const coreMaterial = new THREE.MeshBasicMaterial({ transparent: true });
    this.core = new THREE.Mesh(this.coreGeometry, coreMaterial);
    this.group.add(this.core);
    this.scene.add(this.group);
  }

  init(): void {}

  resize(): void {}

  update(frame: AudioFrame, s: VisualizerSettingsView): void {
    this.bgColor.set(s.palette.bg);
    this.scene.background = this.bgColor;
    if (!this.scene.fog) this.scene.fog = new THREE.Fog(0x000000, 18, this.depth * 0.95);
    (this.scene.fog as THREE.Fog).color.copy(this.bgColor);

    const speed = 14 * (0.35 + frame.level * 1.8 + frame.beatPulse * 1.4);

    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i];
      ring.position.z += speed * frame.dt;
      if (ring.position.z > RING_RADIUS) ring.position.z -= this.depth;

      const v = binAt(frame.freq, i / this.rings.length);
      const scale = 1 + v * 0.55 + frame.bass * 0.15;
      ring.scale.setScalar(scale);

      const [r, g, b] = sampleGradient(s.palette.colors, i / (this.rings.length - 1));
      const bright = 0.3 + v * 1.4 + frame.beatPulse * 0.3;
      ring.material.color.setRGB(
        Math.min(1, (r / 255) * bright),
        Math.min(1, (g / 255) * bright),
        Math.min(1, (b / 255) * bright),
      );
      ring.material.opacity = Math.min(1, 0.25 + v + frame.beatPulse * 0.2);
    }

    this.group.rotation.z += s.rotationSpeed * (0.3 + frame.level) * frame.dt * 2;

    const [r, g, b] = sampleGradient(s.palette.colors, 0.05);
    this.core.scale.setScalar(1 + frame.bass * 1.2 + frame.beatPulse * 1.6);
    this.core.material.color.setRGB(r / 255, g / 255, b / 255);
    this.core.material.opacity = 0.5 + frame.beatPulse * 0.5;
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.scene.fog = null;
    this.scene.background = null;
    for (const ring of this.rings) ring.material.dispose();
    this.core.material.dispose();
    this.geometry.dispose();
    this.coreGeometry.dispose();
    this.rings = [];
  }
}
