import type { AudioFrame } from '../audio/types';

export type RendererKind = 'canvas2d' | 'three';

export type ModeId = 'bars' | 'radial' | 'particles' | 'wave' | 'tunnel';

export interface ModeMeta {
  id: ModeId;
  name: string;
  renderer: RendererKind;
  key: string;
}

export interface Palette {
  id: string;
  name: string;
  colors: string[];
  bg: string;
}

export interface VisualizerSettingsView {
  palette: Palette;
  glow: boolean;
  barCount: number;
  particleCount: number;
  rotationSpeed: number;
}

export interface Visualizer {
  readonly id: ModeId;
  readonly name: string;
  readonly renderer: RendererKind;
  init(w: number, h: number): void;
  resize(w: number, h: number): void;
  update(frame: AudioFrame, s: VisualizerSettingsView, w: number, h: number): void;
  dispose(): void;
}
