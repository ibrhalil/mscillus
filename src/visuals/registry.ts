import type * as THREE from 'three';
import { SHARED_OPTIONS, select, slider, toggle } from './options';
import type { OptionDef, SharedOptionKey } from './options';
import type { RendererKind, Visualizer } from './types';
import { t } from '../i18n';

export interface VisualizerDeps {
  ctx2d: CanvasRenderingContext2D | null;
  scene: THREE.Scene | null;
  renderer: THREE.WebGLRenderer | null;
}

type Ctor2d = new (ctx: CanvasRenderingContext2D) => Visualizer;
type CtorScene = new (scene: THREE.Scene) => Visualizer;
type CtorGl = new (gl: THREE.WebGLRenderer) => Visualizer;

export type CategoryId = 'spectrum' | 'psychedelic' | 'space' | 'nature' | 'light' | 'retro';

/** `name`: İngilizce kaynak metin (gösterirken `phrase()` ile çevrilir). */
export const CATEGORIES: { id: CategoryId; name: string }[] = [
  { id: 'spectrum', name: 'Spectrum & Wave' },
  { id: 'psychedelic', name: 'Psychedelic' },
  { id: 'space', name: 'Space & 3D' },
  { id: 'nature', name: 'Nature' },
  { id: 'light', name: 'Light & Particles' },
  { id: 'retro', name: 'Retro & Stage' },
];

interface ModeConfig {
  /** Modun gerçekten kullandığı paylaşılan ayarlar (panelde yalnızca bunlar görünür). */
  uses?: readonly SharedOptionKey[];
  /** Yalnızca bu moda ait ek ayarlar. */
  options?: readonly OptionDef[];
  /**
   * Mod, geçerli seçenek değerleriyle seçili paletin renklerini / arka planını kullanıyor mu? Varsayılan: evet.
   * Hayır ise panelde Renkler sekmesi gizlenir (örn. sabit renkli "Ateş" stili).
   */
  usesPalette?: (values: Record<string, number>) => boolean;
}

interface ModeDef<I extends string = string> {
  id: I;
  /** İngilizce kaynak metin; gösterirken `phrase(name)` ile çevrilir. */
  name: string;
  key: string;
  category: CategoryId;
  renderer: RendererKind;
  /** Panelde gösterilecek tüm seçenekler: kullanılan paylaşılanlar + hız + moda özel. */
  options: readonly OptionDef[];
  usesPalette: (values: Record<string, number>) => boolean;
  create: (deps: VisualizerDeps) => Promise<Visualizer>;
}

function need<T>(value: T | null, id: string, what: string): T {
  if (!value) throw new Error(t('error.modeNeeds', { id, what }));
  return value;
}

const ALWAYS = (): boolean => true;

function optionsOf(cfg: ModeConfig): readonly OptionDef[] {
  return [
    ...(cfg.uses ?? []).map((k) => SHARED_OPTIONS[k]),
    SHARED_OPTIONS.speed,
    ...(cfg.options ?? []),
  ];
}

// Her mod kendi parçasında (chunk) tembel yüklenir; sağlayıcılar yalnızca modun
// ihtiyaç duyduğu bağımlılığı (2D context, sahne veya WebGL renderer) geçirir.
function canvas2d<I extends string>(
  id: I,
  name: string,
  key: string,
  category: CategoryId,
  load: () => Promise<Ctor2d>,
  cfg: ModeConfig = {},
): ModeDef<I> {
  return {
    id,
    name,
    key,
    category,
    renderer: 'canvas2d',
    options: optionsOf(cfg),
    usesPalette: cfg.usesPalette ?? ALWAYS,
    create: async (d) => new (await load())(need(d.ctx2d, id, 'canvas context')),
  };
}

function scene3d<I extends string>(
  id: I,
  name: string,
  key: string,
  category: CategoryId,
  load: () => Promise<CtorScene>,
  cfg: ModeConfig = {},
): ModeDef<I> {
  return {
    id,
    name,
    key,
    category,
    renderer: 'three',
    options: optionsOf(cfg),
    usesPalette: cfg.usesPalette ?? ALWAYS,
    create: async (d) => new (await load())(need(d.scene, id, 'Three.js scene')),
  };
}

function webgl<I extends string>(
  id: I,
  name: string,
  key: string,
  category: CategoryId,
  load: () => Promise<CtorGl>,
  cfg: ModeConfig = {},
): ModeDef<I> {
  return {
    id,
    name,
    key,
    category,
    renderer: 'three',
    options: optionsOf(cfg),
    usesPalette: cfg.usesPalette ?? ALWAYS,
    create: async (d) => new (await load())(need(d.renderer, id, 'WebGL renderer')),
  };
}

const DEFS = [
  canvas2d('bars', 'Spectrum Bars', 'S', 'spectrum', () => import('./SpectrumBars').then((m) => m.SpectrumBars), {
    uses: ['barCount', 'glow'],
    options: [
      select('style', 'Bar Style', ['Solid', 'LED', 'Thin', 'City'], 0, { segmented: true }),
      select('align', 'Position', ['From bottom', 'From center'], 0, { segmented: true }),
      select('colorMode', 'Color Distribution', ['By frequency', 'By height', 'Flowing palette', 'Single color']),
      toggle('mirror', 'Symmetric (bass in center)', false),
      slider('gap', 'Bar Gap', 0.05, 0.8, 0.05, 0.2, 'pct'),
      slider('radius', 'Corner Roundness', 0, 1, 0.05, 0.35, 'pct', { showIf: (v) => v.style === 0 }),
      slider('ledCount', 'LED Segment Count', 8, 48, 1, 26, 'int', { showIf: (v) => v.style === 1 }),
      slider('height', 'Bar Height', 0.5, 1.4, 0.05, 1, 'x'),
      slider('fall', 'Fall Speed', 0.3, 3, 0.1, 1, 'x'),
      slider('alpha', 'Opacity', 0.3, 1, 0.05, 1, 'pct'),
      slider('glowPower', 'Glow Intensity', 0.3, 2, 0.1, 1, 'x', { showIf: (v) => v.glow >= 0.5 }),
      toggle('peaks', 'Peak Caps', true),
      toggle('reflection', 'Reflection', true, { showIf: (v) => v.align === 0 }),
      toggle('baseline', 'Baseline', true),
      toggle('moon', 'Moon', true, { showIf: (v) => v.style === 3 }),
    ],
  }),
  canvas2d('radial', 'Radial', 'd', 'spectrum', () => import('./Radial').then((m) => m.Radial), {
    uses: ['barCount', 'rotationSpeed', 'glow'],
    options: [
      select('style', 'Style', ['Ray', 'Bar', 'Wave', 'Dot'], 0, { segmented: true }),
      select('extend', 'Direction', ['Outward', 'Inward', 'Both ways'], 0, { segmented: true }),
      select('colorMode', 'Color Distribution', ['By frequency', 'Flowing palette', 'Single color']),
      toggle('mirror', 'Symmetric', true),
      toggle('reverse', 'Reverse Rotation', false),
      slider('radius', 'Ring Radius', 0.5, 1.6, 0.05, 1, 'x'),
      slider('length', 'Ray Length', 0.4, 1.6, 0.05, 1, 'x'),
      slider('thickness', 'Thickness', 0.4, 2.5, 0.05, 1, 'x'),
      slider('pulse', 'Beat Pulse', 0, 2, 0.1, 1, 'x'),
      slider('fall', 'Fall Speed', 0.3, 3, 0.1, 1, 'x'),
      slider('trail', 'Trail Length', 0.3, 3, 0.1, 1, 'x'),
      toggle('fill', 'Fill', true, { showIf: (v) => v.style === 2 }),
      toggle('scope', 'Waveform Ring', false),
      toggle('ripples', 'Ripple Rings on Beat', false),
      toggle('ring', 'Center Ring', true),
      toggle('dot', 'Center Dot', true),
    ],
  }),
  canvas2d('particles', 'Particles', 'P', 'light', () => import('./Particles').then((m) => m.Particles), {
    uses: ['particleCount', 'glow'],
    options: [
      select('emitter', 'Emitter', ['Center', 'Ring', 'Bottom', 'Spectrum', 'Fountain']),
      select('shape', 'Shape', ['Dot', 'Line'], 0, { segmented: true }),
      select('colorMode', 'Color Distribution', ['Random (palette)', 'By speed', 'By lifetime', 'Single color']),
      slider('power', 'Burst Power', 0.4, 2, 0.05, 1, 'x'),
      slider('size', 'Particle Size', 0.5, 2.5, 0.05, 1, 'x'),
      slider('life', 'Lifetime', 0.4, 2.5, 0.05, 1, 'x'),
      slider('burst', 'Beat Burst', 0, 2.5, 0.1, 1, 'x'),
      slider('gravity', 'Gravity', -1, 1, 0.05, 0),
      slider('swirl', 'Swirl', -2, 2, 0.1, 0),
      slider('trail', 'Trail Length', 0.3, 3, 0.1, 1, 'x'),
      toggle('bounce', 'Bounce Off Edges', false),
      toggle('twinkle', 'Twinkle', false),
      toggle('source', 'Emitter Light', true, { showIf: (v) => v.emitter === 4 }),
    ],
  }),
  canvas2d('wave', 'Waveform', 'v', 'spectrum', () => import('./Waveform').then((m) => m.Waveform), {
    uses: ['glow'],
    options: [
      select('style', 'Style', ['Line', 'Fill', 'Bar'], 0, { segmented: true }),
      select('colorMode', 'Color Distribution', ['Horizontal', 'Vertical', 'Single color'], 0, { segmented: true }),
      slider('layers', 'Layer Count', 1, 3, 1, 3, 'int', { showIf: (v) => v.style !== 2 }),
      toggle('trigger', 'Trigger (stable waveform)', true),
      slider('window', 'Time Window', 0.2, 1, 0.05, 0.5, 'pct'),
      toggle('smooth', 'Smooth Curve', true, { showIf: (v) => v.style !== 2 }),
      slider('amp', 'Amplitude', 0.5, 2, 0.05, 1, 'x'),
      slider('thickness', 'Line Thickness', 0.5, 3, 0.1, 1, 'x'),
      slider('persist', 'Phosphor Trail', 0, 0.9, 0.05, 0, 'pct'),
      toggle('mirror', 'Bottom Reflection', false, { showIf: (v) => v.style !== 2 }),
      toggle('centerLine', 'Center Line', true),
      toggle('grid', 'Grid', false),
      toggle('crt', 'CRT Effect (scanlines, flicker)', false),
    ],
  }),
  webgl('tunnel', '3D Tunnel', 't', 'space', () => import('./Tunnel3D').then((m) => m.Tunnel3D), {
    uses: ['rotationSpeed'],
    options: [
      slider('sides', 'Tunnel Cross-Section (sides)', 3, 12, 1, 8, 'int'),
      slider('cells', 'Panel Divisions (cells)', 1, 5, 1, 3, 'int'),
      slider('travel', 'Travel Speed', 0.3, 2.5, 0.05, 1, 'x'),
      slider('react', 'Music Reactivity', 0, 2.5, 0.05, 1.2, 'x'),
      slider('sway', 'Camera Sway', 0, 2, 0.05, 1, 'x'),
      toggle('core', 'Horizon Light', true),
      slider('bright', 'Brightness', 0.4, 1.8, 0.05, 1, 'x'),
    ],
  }),
  scene3d('plenoptic', 'Plenoptic (XP)', 'o', 'space', () => import('./Plenoptic').then((m) => m.Plenoptic), {
    uses: ['rotationSpeed'],
    options: [
      select('shape', 'Shape', ['Sphere', 'Cube', 'Sparkle'], 2, { segmented: true }),
      slider('count', 'Density', 40, 260, 10, 140, 'int'),
      slider('travel', 'Travel Speed', 0.3, 2.5, 0.05, 1, 'x'),
      slider('size', 'Size', 0.5, 2, 0.05, 1, 'x'),
      slider('spread', 'Field Width', 0.6, 1.8, 0.05, 1, 'x'),
      slider('drift', 'Sway', 0, 2, 0.05, 1, 'x'),
    ],
  }),
  canvas2d('ambience', 'Ambience', 'a', 'psychedelic', () => import('./Ambience').then((m) => m.Ambience), {
    uses: ['glow', 'trail'],
    options: [
      slider('layers', 'Layer Count', 2, 7, 1, 5, 'int'),
      slider('height', 'Wave Height', 0.5, 2, 0.05, 1, 'x'),
      slider('flow', 'Wave Frequency', 0.6, 1.8, 0.05, 1, 'x'),
      slider('base', 'Height Position', 0.4, 0.85, 0.01, 0.62, 'pct'),
      slider('fill', 'Fill Opacity', 0.2, 1.4, 0.05, 1, 'x'),
      toggle('crest', 'Crest Light Line', true),
    ],
  }),
  webgl('milkdrop', 'MilkDrop (Dream Cloud)', 'm', 'psychedelic', () => import('./MilkDrop').then((m) => m.MilkDrop), {
    options: [
      slider('react', 'Music Reactivity', 0, 2.5, 0.05, 1, 'x'),
      slider('decay', 'Trail Persistence', 0.92, 0.975, 0.005, 0.955, 'pct'),
      slider('zoom', 'Zoom Strength', 0, 3, 0.05, 1, 'x'),
      slider('swirl', 'Rotation Strength', 0, 3, 0.05, 1, 'x'),
      slider('warp', 'Waviness', 0, 3, 0.05, 1, 'x'),
      slider('paint', 'Paint Density', 0.3, 2.5, 0.05, 1, 'x'),
    ],
  }),
  canvas2d('gforce', 'G-Force', 'g', 'psychedelic', () => import('./GForce').then((m) => m.GForce), {
    uses: ['particleCount', 'glow', 'trail'],
    options: [
      select('style', 'Style', ['Line', 'Dot'], 0, { segmented: true }),
      select('mirror', 'Symmetry', ['None', 'Horizontal', '4-way'], 0, { segmented: true }),
      slider('swirl', 'Swirl', 0, 2, 0.05, 0.6, 'x'),
      slider('warp', 'Flow Warp', 0, 2, 0.05, 1, 'x'),
      slider('scale', 'Flow Pattern Scale', 0.4, 2.5, 0.05, 1, 'x'),
      slider('size', 'Particle Size', 0.5, 2.5, 0.05, 1, 'x'),
      slider('life', 'Lifetime', 0.5, 2.5, 0.05, 1, 'x'),
    ],
  }),
  webgl('starfield', 'Light Speed', 'i', 'space', () => import('./Starfield').then((m) => m.Starfield), {
    options: [
      slider('travel', 'Flight Speed', 0.3, 2.5, 0.05, 1, 'x'),
      slider('streak', 'Streak Length', 0.3, 2.5, 0.05, 1, 'x'),
      slider('density', 'Star Frequency', 0.4, 2, 0.05, 1, 'x'),
      slider('size', 'Line Thickness', 0.5, 2.5, 0.05, 1, 'x'),
      slider('jump', 'Hyperjump (on strong beats)', 0, 2, 0.05, 1, 'x'),
      slider('react', 'Music Reactivity', 0, 2.5, 0.05, 1.2, 'x'),
      slider('bright', 'Brightness', 0.4, 1.8, 0.05, 1, 'x'),
    ],
  }),
  canvas2d('chladni', 'Chladni Plate', 'z', 'psychedelic', () => import('./Chladni').then((m) => m.Chladni), {
    options: [
      select('plate', 'Plate', ['Full Screen', 'Square', 'Round'], 0, { segmented: true }),
      select('colorMode', 'Sand Color', ['Palette', 'Sand'], 0, { segmented: true }),
      slider('count', 'Sand Amount', 3000, 20000, 500, 12000, 'int'),
      slider('grain', 'Grain Size', 1, 3, 1, 1, 'int'),
      slider('vibration', 'Vibration Intensity', 0.3, 2.5, 0.05, 1, 'x'),
      slider('settle', 'Settling Speed', 0.4, 3, 0.05, 1, 'x'),
      slider('rhythm', 'Shape Change (every N beats)', 2, 32, 1, 8, 'int'),
      slider('complexity', 'Pattern Complexity', 0.5, 1.6, 0.05, 1, 'x'),
      toggle('shading', 'Plate Glow', true),
      toggle('rain', 'Continuous Sand Rain from Above', true),
      slider('rainRate', 'Rain Density', 0.1, 3, 0.05, 1.4, 'x', { showIf: (v) => v.rain >= 0.5 }),
      slider('rainVis', 'Rain Visibility', 0, 1.5, 0.05, 0.4, 'x', { showIf: (v) => v.rain >= 0.5 }),
    ],
  }),
  webgl('wormhole', 'Wormhole', 'w', 'space', () => import('./Wormhole').then((m) => m.Wormhole), {
    uses: ['rotationSpeed'],
    options: [
      slider('travel', 'Flight Speed', 0.3, 2.5, 0.05, 1, 'x'),
      slider('punch', 'Beat Acceleration / FOV Kick', 0, 2, 0.05, 1, 'x'),
      slider('kick', 'Beat Jolt', 0, 2, 0.05, 1, 'x'),
      slider('bank', 'Turn Banking', 0, 2, 0.05, 1, 'x'),
      slider('fov', 'Field of View', 55, 100, 1, 70, 'int'),
      slider('wave', 'Wall Undulation', 0, 2.5, 0.05, 1, 'x'),
      slider('bands', 'Spectrum-Lit Wall', 0, 2.5, 0.05, 1, 'x'),
      slider('brightness', 'Brightness', 0.2, 1.8, 0.05, 0.8, 'x'),
      toggle('ring', 'Light Ring on Beat', true),
      slider('waves', 'Light Waves', 0, 2.5, 0.05, 0.6, 'x'),
      slider('density', 'Speck Density', 0, 2, 0.05, 0.6, 'x'),
      slider('streak', 'Speck Streaks', 0, 2, 0.05, 1, 'x'),
      slider('rim', 'Rim Glow', 0, 2, 0.05, 0.5, 'x'),
      slider('haze', 'Distant Light Haze', 0, 2, 0.05, 0.7, 'x'),
      slider('horizonDark', 'Horizon Darkening', 0.3, 3, 0.05, 1, 'x'),
      slider('horizonBlur', 'Horizon Blur', 0, 3, 0.05, 1.3, 'x'),
      slider('spiral', 'Spiral Rings', 0, 3, 1, 1, 'int'),
      slider('colorful', 'Color Vividness', 0, 1.5, 0.05, 1, 'x'),
      slider('twist', 'Spiral Twist', 0, 3, 0.05, 1, 'x'),
      select('quality', 'Resolution', ['Low', 'Medium', 'High'], 2, { segmented: true }),
    ],
  }),
  webgl('voyage', 'Space Voyage', 'n', 'space', () => import('./Voyage').then((m) => m.Voyage), {
    options: [
      slider('travel', 'Voyage Speed', 0.3, 2.5, 0.05, 1, 'x'),
      slider('steer', 'Steering', 0, 2.5, 0.05, 1, 'x'),
      slider('stars', 'Star Density', 0.2, 1, 0.05, 1, 'pct'),
      slider('streak', 'Light Streak Length', 0, 3, 0.1, 1, 'x'),
      slider('accel', 'Approach Acceleration', 0, 3, 0.1, 1, 'x'),
      slider('nebula', 'Nebula Density', 0, 2, 0.05, 1, 'x'),
      slider('vibration', 'Nebula Shimmer', 0, 2.5, 0.05, 1, 'x'),
    ],
  }),
  webgl('kaleidoscope', 'Kaleidoscope', 'k', 'psychedelic', () => import('./Kaleidoscope').then((m) => m.Kaleidoscope), {
    uses: ['rotationSpeed'],
    options: [
      select('shape', 'Shape', ['Ring + Line', 'Star', 'Hexagon', 'Crystal', 'Mixed']),
      select('layerBands', 'Layer Response', ['Bass / Mid / Treble', 'Frequency Range'], 1, { segmented: true }),
      select('colorMode', 'Color Distribution', ['By layer', 'By radius', 'Mixed'], 2, { segmented: true }),
      toggle('auto', 'Pattern Changes with Music', true),
      slider('rhythm', 'Transition (every N beats)', 4, 48, 1, 16, 'int', { showIf: (v) => v.auto >= 0.5 }),
      slider('segments', 'Segment Count', 4, 16, 2, 8, 'int', { showIf: (v) => v.auto < 0.5 }),
      slider('detail', 'Layer Count (detail)', 3, 8, 1, 6, 'int'),
      slider('zoomFlow', 'Infinite Zoom', 0, 2, 0.05, 1, 'x'),
      slider('zoom', 'Zoom Level', 0.6, 1.8, 0.05, 1, 'x'),
      slider('depth', 'Depth Fog', 0, 1.5, 0.05, 0.8, 'x'),
      slider('bloom', 'Light Bloom', 0, 2, 0.05, 0.6, 'x'),
      slider('fringe', 'Chromatic Fringe', 0, 0.25, 0.01, 0.06),
      slider('bright', 'Brightness', 0.4, 1.8, 0.05, 1, 'x'),
      select('quality', 'Resolution', ['Low', 'Medium', 'High'], 2, { segmented: true }),
    ],
  }),
  webgl('plasma', 'Plasma', 'p', 'psychedelic', () => import('./Plasma').then((m) => m.Plasma), {
    options: [
      select('style', 'Style', ['Classic', 'Fluid', 'Swirl'], 0, { segmented: true }),
      toggle('auto', 'Change Pattern Structure with Music', true),
      slider('rhythm', 'Change (every N beats)', 4, 48, 1, 12, 'int', { showIf: (v) => v.auto >= 0.5 }),
      slider('react', 'Music Reactivity', 0, 2.5, 0.05, 1, 'x'),
      slider('warp', 'Warp', 0, 2, 0.05, 0.4, 'x'),
      slider('scale', 'Pattern Scale', 0.5, 2, 0.05, 1, 'x'),
      slider('bands', 'Color Repeat', 0.5, 4, 0.1, 1, 'x'),
      slider('contrast', 'Contrast', 0.5, 2, 0.05, 1, 'x'),
      slider('bright', 'Brightness', 0.4, 1.8, 0.05, 1, 'x'),
    ],
  }),
  canvas2d('ribbons', 'Ribbons', 'l', 'light', () => import('./Ribbons').then((m) => m.Ribbons), {
    uses: ['glow', 'trail'],
    options: [
      select('curve', 'Curve', ['Random', 'Spiro'], 0, { segmented: true }),
      slider('heads', 'Ribbon Count', 1, 6, 1, 6, 'int'),
      slider('length', 'Ribbon Length', 20, 300, 5, 110, 'int'),
    ],
  }),
  webgl('galaxy', 'Galaxy', 'y', 'space', () => import('./Galaxy').then((m) => m.Galaxy), {
    uses: ['rotationSpeed'],
    options: [
      slider('arms', 'Arm Count', 2, 5, 1, 3, 'int'),
      slider('density', 'Star Density', 0.2, 1, 0.05, 0.6, 'pct'),
      slider('size', 'Star Size', 0.5, 2.5, 0.05, 1, 'x'),
      slider('tilt', 'Tilt', 0, 1.5, 0.05, 0.55),
      slider('react', 'Beat Reactivity', 0, 2, 0.1, 1, 'x'),
    ],
  }),
  webgl('fire', 'Fire', 'e', 'nature', () => import('./Fire').then((m) => m.Fire), {
    usesPalette: (v) => v.colors > 1.5, // Fire / Blue Flame sabit renkli
    options: [
      select('colors', 'Flame Color', ['Fire', 'Blue Flame', 'Palette'], 0, { segmented: true }),
      select('layout', 'Layout', ['Focused (strongest peak in center)', 'Symmetric (bass in center)', 'Left to Right']),
      slider('flame', 'Flame Height', 0.5, 1.5, 0.05, 1, 'x'),
      slider('wind', 'Wind (Breeze)', 0, 2, 0.05, 1, 'x'),
      slider('lean', 'Lean Toward Center', 0, 1.5, 0.05, 0.7, 'x'),
      slider('flicker', 'Flicker', 0, 2, 0.05, 1, 'x'),
      slider('sparks', 'Sparks', 0, 3, 0.05, 1.4, 'x'),
      slider('react', 'Music Reactivity', 0, 2.5, 0.05, 1.2, 'x'),
      slider('bright', 'Brightness', 0.4, 1.8, 0.05, 1, 'x'),
    ],
  }),
  canvas2d('matrix', 'Matrix', 'x', 'retro', () => import('./Matrix').then((m) => m.Matrix), {
    uses: ['glow', 'trail'],
    options: [
      select('glyphs', 'Characters', ['Mixed', 'Digits', 'Binary'], 0, { segmented: true }),
      slider('fontSize', 'Font Size', 10, 28, 1, 16, 'int'),
      slider('react', 'Music Reactivity (frequency-based brightness/speed)', 0, 2.5, 0.05, 1.2, 'x'),
      toggle('burst', 'New Streams on Beat', true),
    ],
  }),
  canvas2d('clock', 'Neon Clock', 'C', 'retro', () => import('./NeonClock').then((m) => m.NeonClock), {
    uses: ['glow'],
    options: [
      select('format', 'Time Format', ['24 Hours', '12 Hours'], 0, { segmented: true }),
      toggle('seconds', 'Show Seconds', true),
      select('colorMode', 'Digit Colors', ['Each digit different', 'Flowing palette', 'Single color']),
      select('glowStyle', 'Digit Glow', ['Each digit different', 'Breathing', 'Beat pulse', 'Flickering tube', 'Frequency bands']),
      slider('react', 'Music Reactivity', 0, 2.5, 0.05, 1.2, 'x'),
      slider('size', 'Size', 0.5, 1.2, 0.05, 1, 'x'),
    ],
  }),
  canvas2d('laser', 'Laser', 'b', 'light', () => import('./Laser').then((m) => m.Laser), {
    uses: ['glow', 'trail'],
    options: [
      slider('beams', 'Beam Count', 1, 7, 1, 3, 'int'),
      slider('sweep', 'Sweep Width', 0.3, 1.6, 0.05, 1, 'x'),
      slider('spread', 'Beam Spread', 0.3, 2.5, 0.05, 1, 'x'),
    ],
  }),
  canvas2d('fireworks', 'Fireworks', 'c', 'light', () => import('./Fireworks').then((m) => m.Fireworks), {
    uses: ['glow', 'trail'],
    options: [
      slider('rate', 'Rocket Rate', 0.3, 2.5, 0.1, 1, 'x'),
      slider('burst', 'Burst Size', 0.5, 2, 0.05, 1, 'x'),
      slider('life', 'Spark Lifetime', 0.5, 2, 0.05, 1, 'x'),
      slider('gravity', 'Gravity', 0.2, 2.5, 0.1, 1, 'x'),
    ],
  }),
  webgl('water', 'Water Ripples', 'u', 'nature', () => import('./Water').then((m) => m.Water), {
    usesPalette: (v) => v.style < 0.5 || v.colors > 1.5, // Realistic Water'da Ocean / Night Lake sabit renkli
    options: [
      select('style', 'Style', ['Plain Waves', 'Realistic Water'], 0, { segmented: true }),
      select('colors', 'Water Color', ['Ocean', 'Night Lake', 'Palette'], 0, { segmented: true, showIf: (v) => v.style >= 0.5 }),
      slider('drop', 'Drop Strength', 0.4, 2.5, 0.1, 1, 'x'),
      slider('rain', 'Treble Ripples (faint / rain)', 0, 2.5, 0.05, 1, 'x'),
      slider('damping', 'Wave Lifetime', 0.96, 0.999, 0.001, 0.993, 'pct'),
      slider('wave', 'Wave Prominence', 0.4, 2.5, 0.05, 1.2, 'x'),
      slider('shine', 'Sparkle', 0, 2, 0.05, 1, 'x'),
      slider('caustic', 'Light Nets (caustics)', 0, 2, 0.05, 1, 'x', { showIf: (v) => v.style >= 0.5 }),
      slider('bright', 'Brightness', 0.5, 2, 0.05, 1, 'x'),
      select('quality', 'Simulation Resolution', ['Low', 'Medium', 'High'], 1, { segmented: true, showIf: (v) => v.style >= 0.5 }),
    ],
  }),
  webgl('bubbles', 'Bubbles', 'q', 'nature', () => import('./Bubbles').then((m) => m.Bubbles), {
    options: [
      slider('rate', 'Bubble Rate', 0.3, 2.5, 0.1, 1, 'x'),
      slider('size', 'Bubble Size', 0.5, 2.2, 0.05, 1, 'x'),
      slider('rise', 'Rise Speed', 0.4, 2.5, 0.1, 1, 'x'),
      toggle('pops', 'Pop at the Top', true),
      slider('film', 'Rainbow Film', 0, 1.5, 0.05, 1, 'x'),
      slider('bright', 'Brightness', 0.4, 1.8, 0.05, 1, 'x'),
    ],
  }),
  canvas2d('snow', 'Snow', 'r', 'nature', () => import('./Snow').then((m) => m.Snow), { uses: ['particleCount', 'trail'], options: [slider('fall', 'Fall Speed', 0.4, 2.5, 0.1, 1, 'x'), slider('sway', 'Sway', 0, 3, 0.1, 1, 'x'), slider('wind', 'Wind', 0, 2, 0.1, 1, 'x'), slider('flakeSize', 'Flake Size', 0.5, 3, 0.1, 1, 'x')] }),
  canvas2d('rain', 'Rain', 'Y', 'nature', () => import('./Rain').then((m) => m.Rain), { uses: ['trail'], options: [slider('length', 'Drop Length', 0.5, 2.5, 0.1, 1, 'x'), toggle('splash', 'Splash Rings', true), toggle('lightning', 'Lightning (on strong beats)', false), slider('slant', 'Rain Slant', 0, 2, 0.1, 1, 'x'), slider('density', 'Density', 0.3, 2, 0.1, 1, 'x')] }),
  webgl('rotozoom', 'Rotozoom', 'R', 'psychedelic', () => import('./Rotozoom').then((m) => m.Rotozoom), {
    uses: ['rotationSpeed'],
    options: [
      select('pattern', 'Background Pattern', ['Truchet Arcs', 'Honeycomb', 'Voronoi', 'Moire', 'Checkerboard']),
      select('persp', 'Appearance', ['Flat', 'Perspective'], 0, { segmented: true }),
      slider('react', 'Music Reactivity (cell glow)', 0, 2.5, 0.05, 1.2, 'x'),
      slider('zoom', 'Zoom', 0.4, 2.5, 0.05, 1, 'x'),
      slider('detail', 'Pattern Frequency', 0.5, 2.5, 0.05, 1, 'x'),
      slider('scroll', 'Scroll Speed', 0, 3, 0.1, 1, 'x'),
      slider('glowLine', 'Line Brightness', 0, 2, 0.05, 1, 'x'),
      slider('bright', 'Brightness', 0.4, 1.8, 0.05, 1, 'x'),
    ],
  }),
  webgl('vortex', 'Hypnosis', 'D', 'psychedelic', () => import('./Vortex').then((m) => m.Vortex), {
    options: [
      slider('arms', 'Arm Count', 1, 8, 1, 3, 'int'),
      slider('tight', 'Tightness', 0.3, 2, 0.05, 0.8, 'x'),
      slider('depth', 'Depth (taper toward center)', 0, 1, 0.05, 0.4, 'x'),
      slider('thick', 'Thickness', 0.5, 1.5, 0.05, 1, 'x'),
      slider('spin', 'Spin Speed', 0.2, 3, 0.05, 1, 'x'),
      select('direction', 'Direction', ['Toward Center', 'Away from Center'], 0, { segmented: true }),
      slider('react', 'Music Reactivity', 0, 2, 0.05, 1, 'x'),
      slider('bright', 'Brightness', 0.4, 1.8, 0.05, 1, 'x'),
    ],
  }),
  canvas2d('opart', 'Op-Art Rings', 'K', 'psychedelic', () => import('./Opart').then((m) => m.Opart), {
    uses: ['glow'],
    options: [
      select('style', 'Style', ['Line', 'Solid Bands (Op-Art)'], 0, { segmented: true }),
      slider('rings', 'Ring Count', 8, 40, 1, 16, 'int'),
      slider('lobes', 'Lobe Count', 2, 14, 1, 6, 'int'),
      slider('wobble', 'Wobble', 0, 3, 0.1, 1, 'x'),
      slider('pulse', 'Beat Pulse', 0, 2.5, 0.1, 1, 'x'),
    ],
  }),
  webgl('static', 'Static', 'U', 'retro', () => import('./StaticNoise').then((m) => m.StaticNoise), {
    options: [
      select('style', 'Style', ['Antenna Interference (CRT)', 'Classic Snow'], 0, { segmented: true }),
      slider('sig', 'Signal Strength (picture clarity)', 0.3, 1.5, 0.05, 1, 'x', { showIf: (v) => v.style < 0.5 }),
      slider('interf', 'Interference Strength (hum bars, herringbone)', 0, 2, 0.05, 1, 'x', { showIf: (v) => v.style < 0.5 }),
      slider('roll', 'Vertical Roll (V-Hold)', 0, 2, 0.05, 1, 'x', { showIf: (v) => v.style < 0.5 }),
      slider('ghost', 'Ghosting', 0, 2, 0.05, 1, 'x', { showIf: (v) => v.style < 0.5 }),
      slider('jitter', 'Horizontal Jitter', 0, 2, 0.05, 1, 'x', { showIf: (v) => v.style < 0.5 }),
      select('grain', 'Noise Grain Size', ['Fine', 'Medium', 'Coarse'], 1, { segmented: true }),
      slider('density', 'Density', 0.4, 2, 0.05, 1, 'x', { showIf: (v) => v.style >= 0.5 }),
      slider('react', 'Music Reactivity', 0, 2.5, 0.05, 1, 'x'),
      toggle('glitch', 'Glitch Line', true),
      toggle('tear', 'Tear Band on Beat', true),
      toggle('scanlines', 'Scanlines', true),
      toggle('vignette', 'Vignette', true),
    ],
  }),
  canvas2d('spectrogram', 'Spectrogram', 'A', 'spectrum', () => import('./Spectrogram').then((m) => m.Spectrogram), {
    options: [
      slider('contrast', 'Contrast', 0.5, 2, 0.05, 1, 'x'),
      toggle('grid', 'Frequency Ruler', true),
      toggle('beatLine', 'Beat Line', true),
    ],
  }),
  webgl('metaball', 'Metaball', 'B', 'psychedelic', () => import('./Metaball').then((m) => m.Metaball), {
    options: [
      select('motion', 'Motion', ['Orbit', 'Lava (rising and falling)'], 0, { segmented: true }),
      select('render', 'Appearance', ['Metaball', 'Soft light'], 0, { segmented: true }),
      slider('count', 'Ball Count', 3, 12, 1, 9, 'int'),
      slider('size', 'Ball Size', 0.5, 1.6, 0.05, 1, 'x'),
      slider('orbit', 'Orbit Width', 0.4, 1.8, 0.05, 1, 'x'),
      slider('shine', 'Shininess (Reflection)', 0, 2, 0.05, 1, 'x', { showIf: (v) => v.render < 0.5 }),
      slider('glow', 'Aura / Glow', 0, 2, 0.05, 1, 'x'),
      slider('bright', 'Overall Brightness', 0.4, 1.8, 0.05, 1, 'x'),
    ],
  }),
  canvas2d('lightning', 'Lightning', 'L', 'nature', () => import('./Lightning').then((m) => m.Lightning), {
    uses: ['glow', 'trail'],
    options: [
      slider('rate', 'Lightning Rate', 0.2, 3, 0.1, 1, 'x'),
      slider('thickness', 'Thickness', 0.5, 2.5, 0.05, 1, 'x'),
      slider('slow', 'Slow Motion (leader duration)', 0.2, 2.5, 0.05, 0.6, 'x'),
      toggle('flash', 'Sky Light', true),
    ],
  }),
  canvas2d('vu', 'VU Meters', 'V', 'spectrum', () => import('./Vu').then((m) => m.Vu), {
    uses: ['glow'],
    options: [
      select('layout', 'Layout', ['Auto', '1×4', '2×2'], 0, { segmented: true }),
      slider('scale', 'Dial Size', 0.6, 1.3, 0.05, 1, 'x'),
      slider('gain', 'Sensitivity', 0.5, 2.5, 0.05, 1, 'x'),
      slider('stiff', 'Needle Response', 0.3, 2.5, 0.05, 1, 'x'),
      slider('lamp', 'Backlight', 0, 2, 0.05, 1, 'x'),
      toggle('peak', 'Peak Hold Marker', true),
      toggle('numbers', 'Scale Numbers', true),
      toggle('labels', 'Labels', true),
      toggle('led', 'Peak LED', true),
    ],
  }),
  canvas2d('pong', 'Audio Pong', 'X', 'retro', () => import('./Pong').then((m) => m.Pong), {
    uses: ['barCount', 'glow', 'trail'],
    options: [
      slider('balls', 'Ball Count', 1, 10, 1, 5, 'int'),
      slider('ballSize', 'Ball Size', 0.5, 2.5, 0.1, 1, 'x'),
      slider('gravity', 'Gravity', 0.4, 2, 0.05, 1, 'x'),
      slider('bounce', 'Bounce Strength', 0.5, 2, 0.05, 1, 'x'),
    ],
  }),
  canvas2d('notewaterfall', 'Note Waterfall', 'W', 'spectrum', () => import('./NoteWaterfall').then((m) => m.NoteWaterfall), {
    uses: ['glow'],
    options: [
      select('keyboard', 'Keyboard', ['Right', 'Left'], 0, { segmented: true }),
      select('naming', 'Note Names', ['C D E', 'Do Re Mi', 'Auto'], 2, { segmented: true }),
      slider('octave', 'Starting Octave', 1, 4, 1, 3, 'int'),
      slider('octaves', 'Octave Count', 2, 6, 1, 4, 'int'),
      slider('maxNotes', 'Simultaneous Notes', 1, 8, 1, 5, 'int'),
      slider('threshold', 'Detection Threshold', 0.1, 0.8, 0.05, 0.3, 'pct'),
      toggle('harmonics', 'Filter Out Harmonics', true),
      slider('scroll', 'Scroll Speed', 60, 400, 10, 160, 'int'),
      toggle('labels', 'Show Note Names', true),
      toggle('hud', 'Playing Notes Text (top left)', true),
    ],
  }),
  webgl('phosphene', 'Phosphene', 'F', 'psychedelic', () => import('./Phosphene').then((m) => m.Phosphene), {
    options: [
      slider('sym', 'Symmetry (fold count)', 4, 16, 2, 8, 'int'),
      slider('rhythm', 'Pattern Transition (every N beats)', 4, 48, 1, 16, 'int'),
      slider('flow', 'Rotation / Flow Speed', 0.2, 3, 0.05, 1, 'x'),
      slider('width', 'Line Thickness', 0.4, 2.5, 0.05, 1, 'x'),
      slider('halo', 'Halo', 0, 2, 0.05, 1, 'x'),
      slider('react', 'Music Reactivity', 0, 2.5, 0.05, 1.2, 'x'),
      slider('bright', 'Brightness', 0.4, 1.8, 0.05, 1, 'x'),
    ],
  }),
  webgl('papertear', 'Paper Tear', 'J', 'psychedelic', () => import('./PaperTear').then((m) => m.PaperTear), {
    usesPalette: (v) => v.colors < 0.5, // Paper Tones sabit renkli
    options: [
      select('colors', 'Paper Colors', ['Palette', 'Paper Tones'], 0, { segmented: true }),
      slider('tearSpeed', 'Tear Speed', 0.3, 3, 0.05, 1, 'x'),
      select('direction', 'Tear Direction', ['Random', 'Horizontal', 'Vertical'], 0, { segmented: true }),
      slider('jag', 'Jaggedness', 0.3, 2, 0.05, 1, 'x'),
      slider('fiber', 'Paper Fiber (white edge)', 0, 2, 0.05, 1, 'x'),
      slider('shadow', 'Shadow', 0, 2, 0.05, 1, 'x'),
      slider('bright', 'Brightness', 0.5, 1.5, 0.05, 1, 'x'),
    ],
  }),
  webgl('paintdrip', 'Paint Drip', 'T', 'psychedelic', () => import('./PaintDrip').then((m) => m.PaintDrip), {
    options: [
      select('base', 'Paper', ['White', 'Cream'], 0, { segmented: true }),
      slider('rate', 'Drip Rate (with rhythm/intensity)', 0.3, 2.5, 0.05, 1, 'x'),
      slider('size', 'Drop Size', 0.5, 2, 0.05, 1, 'x'),
      slider('spread', 'Spread Speed', 0.4, 2.5, 0.05, 1, 'x'),
      slider('life', 'Fade-out Time (s)', 3, 20, 1, 8, 'int'),
      slider('oil', 'Oil Ring (translucent, colored)', 0, 2, 0.05, 1, 'x'),
      slider('jag', 'Pigment Edge (feathering)', 0.3, 2, 0.05, 1, 'x'),
      slider('bright', 'Brightness', 0.6, 1.4, 0.05, 1, 'x'),
    ],
  }),
] as const satisfies readonly ModeDef[];

export type ModeId = (typeof DEFS)[number]['id'];

export interface ModeMeta {
  id: ModeId;
  name: string;
  key: string;
  category: CategoryId;
  renderer: RendererKind;
  options: readonly OptionDef[];
  usesPalette: (values: Record<string, number>) => boolean;
}

const BY_ID = new Map<string, ModeDef>(DEFS.map((d) => [d.id, d]));

export const MODES: readonly ModeMeta[] = DEFS;

export function modeMeta(id: ModeId): ModeMeta {
  return BY_ID.get(id) as ModeMeta;
}

/** Sıradaki (delta=1) veya önceki (delta=-1) mod; liste sonunda başa sarar. */
export function adjacentMode(id: ModeId, delta: number): ModeId {
  const i = MODES.findIndex((m) => m.id === id);
  return MODES[(i + delta + MODES.length) % MODES.length].id;
}

/** Klavye kısayolunu (Shift duyarlı) gösterim etiketine çevirir: `⇧F`, `M`, `5`. */
export function keyLabel(key: string): string {
  return /^[A-Z]$/.test(key) ? `⇧${key}` : key.toUpperCase();
}

export function createVisualizer(id: ModeId, deps: VisualizerDeps): Promise<Visualizer> {
  return (BY_ID.get(id) as ModeDef).create(deps);
}

/** Favorilerin ikinci kısayolu: eklenme sırasıyla 1-9 ve 0 (ilk 10 favori). */
export const FAVORITE_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const;

/** Favori listesindeki sıraya göre modun rakam tuşu; favori değilse veya 10'dan sonraysa null. */
export function favoriteKey(favorites: readonly ModeId[], id: ModeId): string | null {
  const i = favorites.indexOf(id);
  return i >= 0 && i < FAVORITE_KEYS.length ? FAVORITE_KEYS[i] : null;
}

/** Basılan rakam tuşuna karşılık gelen favori mod (yoksa undefined). */
export function favoriteForKey(favorites: readonly ModeId[], key: string): ModeId | undefined {
  const i = (FAVORITE_KEYS as readonly string[]).indexOf(key);
  return i >= 0 ? favorites[i] : undefined;
}
