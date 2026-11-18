import type * as THREE from 'three';
import { SpectrumBars } from './SpectrumBars';
import { Radial } from './Radial';
import { Particles } from './Particles';
import { Waveform } from './Waveform';
import type { ModeId, ModeMeta, Visualizer } from './types';

export const MODES: ModeMeta[] = [
  { id: 'bars', name: 'Spektrum Barları', renderer: 'canvas2d', key: '1' },
  { id: 'radial', name: 'Dairesel', renderer: 'canvas2d', key: '2' },
  { id: 'particles', name: 'Parçacıklar', renderer: 'canvas2d', key: '3' },
  { id: 'wave', name: 'Dalga Formu', renderer: 'canvas2d', key: '4' },
  { id: 'tunnel', name: '3D Tünel', renderer: 'three', key: '5' },
];

export interface VisualizerDeps {
  ctx2d: CanvasRenderingContext2D | null;
  scene: THREE.Scene | null;
}

export async function createVisualizer(id: ModeId, deps: VisualizerDeps): Promise<Visualizer> {
  switch (id) {
    case 'bars': {
      if (!deps.ctx2d) throw new Error('bars modu için canvas context gerekli');
      return new SpectrumBars(deps.ctx2d);
    }
    case 'radial': {
      if (!deps.ctx2d) throw new Error('radial modu için canvas context gerekli');
      return new Radial(deps.ctx2d);
    }
    case 'particles': {
      if (!deps.ctx2d) throw new Error('particles modu için canvas context gerekli');
      return new Particles(deps.ctx2d);
    }
    case 'wave': {
      if (!deps.ctx2d) throw new Error('wave modu için canvas context gerekli');
      return new Waveform(deps.ctx2d);
    }
    case 'tunnel': {
      if (!deps.scene) throw new Error('tunnel modu için Three.js sahne gerekli');
      const { Tunnel3D } = await import('./Tunnel3D');
      return new Tunnel3D(deps.scene);
    }
  }
}
