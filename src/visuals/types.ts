import type { AudioFrame } from '../audio/types';

export type RendererKind = 'canvas2d' | 'three';

export interface Palette {
  id: string;
  name: string;
  colors: string[];
  bg: string;
}

export interface VisualizerSettingsView {
  palette: Palette;
  glow: boolean;
  /** 0 düşük, 1 orta, 2 yüksek; parlama yardımcıları buna göre ölçeklenir. */
  glowQuality: number;
  barCount: number;
  particleCount: number;
  rotationSpeed: number;
  /** Animasyon zaman ölçeği (RenderLoop `dt`'ye uygular). */
  speed: number;
  /** Etkin modun tüm seçenekleri (paylaşılan + moda özel), varsayılanlarla doldurulmuş. */
  opt: Record<string, number>;
}

export interface Visualizer {
  readonly manualRender?: boolean;
  init(w: number, h: number): void;
  resize(w: number, h: number): void;
  update(frame: AudioFrame, s: VisualizerSettingsView, w: number, h: number): void;
  dispose(): void;
}
