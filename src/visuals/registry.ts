import type * as THREE from 'three';
import { SHARED_OPTIONS, select, slider, toggle } from './options';
import type { OptionDef, SharedOptionKey } from './options';
import type { RendererKind, Visualizer } from './types';

export interface VisualizerDeps {
  ctx2d: CanvasRenderingContext2D | null;
  scene: THREE.Scene | null;
  renderer: THREE.WebGLRenderer | null;
}

type Ctor2d = new (ctx: CanvasRenderingContext2D) => Visualizer;
type CtorScene = new (scene: THREE.Scene) => Visualizer;
type CtorGl = new (gl: THREE.WebGLRenderer) => Visualizer;

export type CategoryId = 'spectrum' | 'psychedelic' | 'space' | 'nature' | 'light' | 'retro';

export const CATEGORIES: { id: CategoryId; name: string }[] = [
  { id: 'spectrum', name: 'Spektrum & Dalga' },
  { id: 'psychedelic', name: 'Psikedelik' },
  { id: 'space', name: 'Uzay & 3D' },
  { id: 'nature', name: 'Doğa' },
  { id: 'light', name: 'Işık & Parçacık' },
  { id: 'retro', name: 'Retro & Sahne' },
];

interface ModeConfig {
  /** Modun gerçekten kullandığı paylaşılan ayarlar (panelde yalnızca bunlar görünür). */
  uses?: readonly SharedOptionKey[];
  /** Yalnızca bu moda ait ek ayarlar. */
  options?: readonly OptionDef[];
}

interface ModeDef<I extends string = string> {
  id: I;
  name: string;
  key: string;
  category: CategoryId;
  renderer: RendererKind;
  /** Panelde gösterilecek tüm seçenekler: kullanılan paylaşılanlar + hız + moda özel. */
  options: readonly OptionDef[];
  create: (deps: VisualizerDeps) => Promise<Visualizer>;
}

function need<T>(value: T | null, id: string, what: string): T {
  if (!value) throw new Error(`${id} modu için ${what} gerekli`);
  return value;
}

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
    create: async (d) => new (await load())(need(d.scene, id, 'Three.js sahne')),
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
    create: async (d) => new (await load())(need(d.renderer, id, 'WebGL renderer')),
  };
}

const DEFS = [
  canvas2d('bars', 'Spektrum Barları', 'S', 'spectrum', () => import('./SpectrumBars').then((m) => m.SpectrumBars), {
    uses: ['barCount', 'glow'],
    options: [
      select('style', 'Bar Stili', ['Dolu', 'LED', 'İnce', 'Şehir'], 0, { segmented: true }),
      select('align', 'Konum', ['Alttan', 'Ortadan'], 0, { segmented: true }),
      select('colorMode', 'Renk Dağılımı', ['Frekansa göre', 'Yüksekliğe göre', 'Akan palet', 'Tek renk']),
      toggle('mirror', 'Simetrik (bas ortada)', false),
      slider('gap', 'Bar Aralığı', 0.05, 0.8, 0.05, 0.2, 'pct'),
      slider('radius', 'Köşe Yuvarlaklığı', 0, 1, 0.05, 0.35, 'pct', { showIf: (v) => v.style === 0 }),
      slider('ledCount', 'LED Segment Sayısı', 8, 48, 1, 26, 'int', { showIf: (v) => v.style === 1 }),
      slider('height', 'Bar Yüksekliği', 0.5, 1.4, 0.05, 1, 'x'),
      slider('fall', 'Düşüş Hızı', 0.3, 3, 0.1, 1, 'x'),
      slider('alpha', 'Saydamlık', 0.3, 1, 0.05, 1, 'pct'),
      slider('glowPower', 'Parlama Şiddeti', 0.3, 2, 0.1, 1, 'x', { showIf: (v) => v.glow >= 0.5 }),
      toggle('peaks', 'Tepe Çubukları', true),
      toggle('reflection', 'Yansıma', true, { showIf: (v) => v.align === 0 }),
      toggle('baseline', 'Taban Çizgisi', true),
      toggle('moon', 'Ay', true, { showIf: (v) => v.style === 3 }),
    ],
  }),
  canvas2d('radial', 'Dairesel', 'd', 'spectrum', () => import('./Radial').then((m) => m.Radial), {
    uses: ['barCount', 'rotationSpeed', 'glow'],
    options: [
      select('style', 'Stil', ['Işın', 'Çubuk', 'Dalga', 'Nokta'], 0, { segmented: true }),
      select('extend', 'Yön', ['Dışa', 'İçe', 'İki yönlü'], 0, { segmented: true }),
      select('colorMode', 'Renk Dağılımı', ['Frekansa göre', 'Akan palet', 'Tek renk']),
      toggle('mirror', 'Simetrik', true),
      toggle('reverse', 'Ters Dönüş', false),
      slider('radius', 'Halka Yarıçapı', 0.5, 1.6, 0.05, 1, 'x'),
      slider('length', 'Işın Uzunluğu', 0.4, 1.6, 0.05, 1, 'x'),
      slider('thickness', 'Kalınlık', 0.4, 2.5, 0.05, 1, 'x'),
      slider('pulse', 'Vuruş Nabzı', 0, 2, 0.1, 1, 'x'),
      slider('fall', 'Düşüş Hızı', 0.3, 3, 0.1, 1, 'x'),
      slider('trail', 'İz Uzunluğu', 0.3, 3, 0.1, 1, 'x'),
      toggle('fill', 'Dolgu', true, { showIf: (v) => v.style === 2 }),
      toggle('scope', 'Ses Dalgası Halkası', false),
      toggle('ripples', 'Vuruşta Dalga Halkaları', false),
      toggle('ring', 'Merkez Halka', true),
      toggle('dot', 'Merkez Nokta', true),
    ],
  }),
  canvas2d('particles', 'Parçacıklar', 'P', 'light', () => import('./Particles').then((m) => m.Particles), {
    uses: ['particleCount', 'glow'],
    options: [
      select('emitter', 'Kaynak', ['Merkez', 'Halka', 'Alt', 'Spektrum', 'Fıskiye']),
      select('shape', 'Şekil', ['Nokta', 'Çizgi'], 0, { segmented: true }),
      select('colorMode', 'Renk Dağılımı', ['Rastgele (palet)', 'Hıza göre', 'Ömre göre', 'Tek renk']),
      slider('power', 'Patlama Gücü', 0.4, 2, 0.05, 1, 'x'),
      slider('size', 'Parçacık Boyutu', 0.5, 2.5, 0.05, 1, 'x'),
      slider('life', 'Ömür', 0.4, 2.5, 0.05, 1, 'x'),
      slider('burst', 'Vuruş Patlaması', 0, 2.5, 0.1, 1, 'x'),
      slider('gravity', 'Yerçekimi', -1, 1, 0.05, 0),
      slider('swirl', 'Girdap', -2, 2, 0.1, 0),
      slider('trail', 'İz Uzunluğu', 0.3, 3, 0.1, 1, 'x'),
      toggle('bounce', 'Kenarlardan Seksin', false),
      toggle('twinkle', 'Pırıltı', false),
      toggle('source', 'Kaynak Işığı', true, { showIf: (v) => v.emitter === 4 }),
    ],
  }),
  canvas2d('wave', 'Dalga Formu', 'v', 'spectrum', () => import('./Waveform').then((m) => m.Waveform), {
    uses: ['glow'],
    options: [
      select('style', 'Stil', ['Çizgi', 'Dolgu', 'Çubuk'], 0, { segmented: true }),
      select('colorMode', 'Renk Dağılımı', ['Yatay', 'Dikey', 'Tek renk'], 0, { segmented: true }),
      slider('layers', 'Katman Sayısı', 1, 3, 1, 3, 'int', { showIf: (v) => v.style !== 2 }),
      toggle('trigger', 'Tetikleme (sabit dalga)', true),
      slider('window', 'Zaman Penceresi', 0.2, 1, 0.05, 0.5, 'pct'),
      toggle('smooth', 'Yumuşak Eğri', true, { showIf: (v) => v.style !== 2 }),
      slider('amp', 'Genlik', 0.5, 2, 0.05, 1, 'x'),
      slider('thickness', 'Çizgi Kalınlığı', 0.5, 3, 0.1, 1, 'x'),
      slider('persist', 'Fosfor İzi', 0, 0.9, 0.05, 0, 'pct'),
      toggle('mirror', 'Alt Yansıma', false, { showIf: (v) => v.style !== 2 }),
      toggle('centerLine', 'Orta Çizgi', true),
      toggle('grid', 'Izgara', false),
      toggle('crt', 'CRT Efekti (tarama çizgisi, titreşim)', false),
    ],
  }),
  webgl('tunnel', '3D Tünel', 't', 'space', () => import('./Tunnel3D').then((m) => m.Tunnel3D), {
    uses: ['rotationSpeed'],
    options: [
      slider('sides', 'Tünel Kesiti (kenar sayısı)', 3, 12, 1, 8, 'int'),
      slider('cells', 'Panel Bölümü (hücre sayısı)', 1, 5, 1, 3, 'int'),
      slider('travel', 'İlerleme Hızı', 0.3, 2.5, 0.05, 1, 'x'),
      slider('react', 'Müzik Tepkisi', 0, 2.5, 0.05, 1.2, 'x'),
      slider('sway', 'Kamera Salınımı', 0, 2, 0.05, 1, 'x'),
      toggle('core', 'Ufuk Işığı', true),
      slider('bright', 'Parlaklık', 0.4, 1.8, 0.05, 1, 'x'),
    ],
  }),
  scene3d('plenoptic', 'Plenoptic (XP)', 'o', 'space', () => import('./Plenoptic').then((m) => m.Plenoptic), {
    uses: ['rotationSpeed'],
    options: [
      select('shape', 'Şekil', ['Küre', 'Küp', 'Parıltı'], 2, { segmented: true }),
      slider('count', 'Yoğunluk', 40, 260, 10, 140, 'int'),
      slider('travel', 'İlerleme Hızı', 0.3, 2.5, 0.05, 1, 'x'),
      slider('size', 'Boyut', 0.5, 2, 0.05, 1, 'x'),
      slider('spread', 'Alan Genişliği', 0.6, 1.8, 0.05, 1, 'x'),
      slider('drift', 'Salınım', 0, 2, 0.05, 1, 'x'),
    ],
  }),
  canvas2d('ambience', 'Ambience', 'a', 'psychedelic', () => import('./Ambience').then((m) => m.Ambience), {
    uses: ['glow', 'trail'],
    options: [
      slider('layers', 'Katman Sayısı', 2, 7, 1, 5, 'int'),
      slider('height', 'Dalga Yüksekliği', 0.5, 2, 0.05, 1, 'x'),
      slider('flow', 'Dalga Sıklığı', 0.6, 1.8, 0.05, 1, 'x'),
      slider('base', 'Yükseklik Konumu', 0.4, 0.85, 0.01, 0.62, 'pct'),
      slider('fill', 'Dolgu Opaklığı', 0.2, 1.4, 0.05, 1, 'x'),
      toggle('crest', 'Tepe Işık Çizgisi', true),
    ],
  }),
  webgl('milkdrop', 'MilkDrop (Hayal Bulutu)', 'm', 'psychedelic', () => import('./MilkDrop').then((m) => m.MilkDrop), {
    options: [
      slider('react', 'Müzik Tepkisi', 0, 2.5, 0.05, 1, 'x'),
      slider('decay', 'İz Kalıcılığı', 0.92, 0.975, 0.005, 0.955, 'pct'),
      slider('zoom', 'Zoom Gücü', 0, 3, 0.05, 1, 'x'),
      slider('swirl', 'Dönme Gücü', 0, 3, 0.05, 1, 'x'),
      slider('warp', 'Dalgalanma', 0, 3, 0.05, 1, 'x'),
      slider('paint', 'Boya Yoğunluğu', 0.3, 2.5, 0.05, 1, 'x'),
    ],
  }),
  canvas2d('gforce', 'G-Force', 'g', 'psychedelic', () => import('./GForce').then((m) => m.GForce), {
    uses: ['particleCount', 'glow', 'trail'],
    options: [
      select('style', 'Stil', ['Çizgi', 'Nokta'], 0, { segmented: true }),
      select('mirror', 'Simetri', ['Yok', 'Yatay', '4 Yön'], 0, { segmented: true }),
      slider('swirl', 'Girdap', 0, 2, 0.05, 0.6, 'x'),
      slider('warp', 'Akış Bükümü', 0, 2, 0.05, 1, 'x'),
      slider('scale', 'Akış Deseni Ölçeği', 0.4, 2.5, 0.05, 1, 'x'),
      slider('size', 'Parçacık Boyutu', 0.5, 2.5, 0.05, 1, 'x'),
      slider('life', 'Ömür', 0.5, 2.5, 0.05, 1, 'x'),
    ],
  }),
  webgl('starfield', 'Işık Hızı', 'i', 'space', () => import('./Starfield').then((m) => m.Starfield), {
    options: [
      slider('travel', 'Uçuş Hızı', 0.3, 2.5, 0.05, 1, 'x'),
      slider('streak', 'Çizgi Uzunluğu', 0.3, 2.5, 0.05, 1, 'x'),
      slider('density', 'Yıldız Sıklığı', 0.4, 2, 0.05, 1, 'x'),
      slider('size', 'Çizgi Kalınlığı', 0.5, 2.5, 0.05, 1, 'x'),
      slider('jump', 'Hiper Atlama (güçlü vuruşta)', 0, 2, 0.05, 1, 'x'),
      slider('react', 'Müzik Tepkisi', 0, 2.5, 0.05, 1.2, 'x'),
      slider('bright', 'Parlaklık', 0.4, 1.8, 0.05, 1, 'x'),
    ],
  }),
  canvas2d('chladni', 'Kum Levhası', 'z', 'psychedelic', () => import('./Chladni').then((m) => m.Chladni), {
    options: [
      select('plate', 'Levha', ['Tam Ekran', 'Kare', 'Yuvarlak'], 0, { segmented: true }),
      select('colorMode', 'Kum Rengi', ['Palet', 'Kum'], 0, { segmented: true }),
      slider('count', 'Kum Miktarı', 3000, 20000, 500, 12000, 'int'),
      slider('grain', 'Tane Boyutu', 1, 3, 1, 1, 'int'),
      slider('vibration', 'Titreşim Şiddeti', 0.3, 2.5, 0.05, 1, 'x'),
      slider('settle', 'Yerleşme Hızı', 0.4, 3, 0.05, 1, 'x'),
      slider('rhythm', 'Şekil Değişimi (kaç vuruşta bir)', 2, 32, 1, 8, 'int'),
      slider('complexity', 'Desen Karmaşıklığı', 0.5, 1.6, 0.05, 1, 'x'),
      toggle('shading', 'Levha Işıması', true),
      toggle('rain', 'Üstten Sürekli Kum Yağışı', true),
      slider('rainRate', 'Yağış Yoğunluğu', 0.1, 3, 0.05, 1.4, 'x', { showIf: (v) => v.rain >= 0.5 }),
      slider('rainVis', 'Yağmurun Belirginliği', 0, 1.5, 0.05, 0.4, 'x', { showIf: (v) => v.rain >= 0.5 }),
    ],
  }),
  webgl('wormhole', 'Solucan Deliği', 'w', 'space', () => import('./Wormhole').then((m) => m.Wormhole), {
    uses: ['rotationSpeed'],
    options: [
      slider('travel', 'Uçuş Hızı', 0.3, 2.5, 0.05, 1, 'x'),
      slider('punch', 'Vuruşta Hızlanma / Görüş Sıçraması', 0, 2, 0.05, 1, 'x'),
      slider('kick', 'Vuruşta Savrulma', 0, 2, 0.05, 1, 'x'),
      slider('bank', 'Viraj Yatışı', 0, 2, 0.05, 1, 'x'),
      slider('fov', 'Görüş Açısı', 55, 100, 1, 70, 'int'),
      slider('wave', 'Duvar Dalgalanması', 0, 2.5, 0.05, 1, 'x'),
      slider('bands', 'Spektrumla Parlayan Duvar', 0, 2.5, 0.05, 1, 'x'),
      slider('brightness', 'Parlaklık', 0.2, 1.8, 0.05, 0.8, 'x'),
      toggle('ring', 'Vuruşta Işık Halkası', true),
      slider('waves', 'Işık Dalgaları', 0, 2.5, 0.05, 0.6, 'x'),
      slider('density', 'Tanecik Yoğunluğu', 0, 2, 0.05, 0.6, 'x'),
      slider('streak', 'Tanecik Çizgisi', 0, 2, 0.05, 1, 'x'),
      slider('rim', 'Kenar Parlaması', 0, 2, 0.05, 0.5, 'x'),
      slider('haze', 'Uzak Işık Sisi', 0, 2, 0.05, 0.7, 'x'),
      slider('horizonDark', 'Ufuk Kararması', 0.3, 3, 0.05, 1, 'x'),
      slider('horizonBlur', 'Ufuk Bulanıklığı', 0, 3, 0.05, 1.3, 'x'),
      slider('spiral', 'Sarmal Halkalar', 0, 3, 1, 1, 'int'),
      slider('colorful', 'Renk Canlılığı', 0, 1.5, 0.05, 1, 'x'),
      slider('twist', 'Sarmal Dönüş', 0, 3, 0.05, 1, 'x'),
      select('quality', 'Çözünürlük', ['Düşük', 'Orta', 'Yüksek'], 2, { segmented: true }),
    ],
  }),
  webgl('voyage', 'Uzay Yolculuğu', 'n', 'space', () => import('./Voyage').then((m) => m.Voyage), {
    options: [
      slider('travel', 'Yolculuk Hızı', 0.3, 2.5, 0.05, 1, 'x'),
      slider('steer', 'Yön Değiştirme', 0, 2.5, 0.05, 1, 'x'),
      slider('stars', 'Yıldız Yoğunluğu', 0.2, 1, 0.05, 1, 'pct'),
      slider('streak', 'Işık Çizgisi Uzunluğu', 0, 3, 0.1, 1, 'x'),
      slider('accel', 'Yaklaşma İvmesi', 0, 3, 0.1, 1, 'x'),
      slider('nebula', 'Nebula Yoğunluğu', 0, 2, 0.05, 1, 'x'),
      slider('vibration', 'Nebula Titreşimi', 0, 2.5, 0.05, 1, 'x'),
    ],
  }),
  webgl('kaleidoscope', 'Kaleydoskop', 'k', 'psychedelic', () => import('./Kaleidoscope').then((m) => m.Kaleidoscope), {
    uses: ['rotationSpeed'],
    options: [
      select('shape', 'Şekil', ['Halka + Çizgi', 'Yıldız', 'Altıgen', 'Kristal', 'Karışık']),
      select('layerBands', 'Katman Tepkisi', ['Bas / Orta / Tiz', 'Frekans Aralığı'], 1, { segmented: true }),
      select('colorMode', 'Renk Dağılımı', ['Katmana göre', 'Yarıçapa göre', 'Karışık'], 2, { segmented: true }),
      toggle('auto', 'Müzikle Desen Geçişi', true),
      slider('rhythm', 'Geçiş (kaç vuruşta bir)', 4, 48, 1, 16, 'int', { showIf: (v) => v.auto >= 0.5 }),
      slider('segments', 'Segment Sayısı', 4, 16, 2, 8, 'int', { showIf: (v) => v.auto < 0.5 }),
      slider('detail', 'Katman Sayısı (detay)', 3, 8, 1, 6, 'int'),
      slider('zoomFlow', 'Sonsuz Zoom', 0, 2, 0.05, 1, 'x'),
      slider('zoom', 'Yakınlık', 0.6, 1.8, 0.05, 1, 'x'),
      slider('depth', 'Derinlik Sisi', 0, 1.5, 0.05, 0.8, 'x'),
      slider('bloom', 'Işık Saçılması (bloom)', 0, 2, 0.05, 0.6, 'x'),
      slider('fringe', 'Renk Ayrışması', 0, 0.25, 0.01, 0.06),
      slider('bright', 'Parlaklık', 0.4, 1.8, 0.05, 1, 'x'),
      select('quality', 'Çözünürlük', ['Düşük', 'Orta', 'Yüksek'], 2, { segmented: true }),
    ],
  }),
  webgl('plasma', 'Plazma', 'p', 'psychedelic', () => import('./Plasma').then((m) => m.Plasma), {
    options: [
      select('style', 'Stil', ['Klasik', 'Sıvı', 'Girdap'], 0, { segmented: true }),
      toggle('auto', 'Müzikle Desen Yapısı Değişsin', true),
      slider('rhythm', 'Değişim (kaç vuruşta bir)', 4, 48, 1, 12, 'int', { showIf: (v) => v.auto >= 0.5 }),
      slider('react', 'Müzik Tepkisi', 0, 2.5, 0.05, 1, 'x'),
      slider('warp', 'Büküm', 0, 2, 0.05, 0.4, 'x'),
      slider('scale', 'Desen Ölçeği', 0.5, 2, 0.05, 1, 'x'),
      slider('bands', 'Renk Tekrarı', 0.5, 4, 0.1, 1, 'x'),
      slider('contrast', 'Kontrast', 0.5, 2, 0.05, 1, 'x'),
      slider('bright', 'Parlaklık', 0.4, 1.8, 0.05, 1, 'x'),
    ],
  }),
  canvas2d('ribbons', 'Şeritler', 'l', 'light', () => import('./Ribbons').then((m) => m.Ribbons), {
    uses: ['glow', 'trail'],
    options: [
      select('curve', 'Eğri', ['Rastgele', 'Spiro'], 0, { segmented: true }),
      slider('heads', 'Şerit Sayısı', 1, 6, 1, 6, 'int'),
      slider('length', 'Şerit Uzunluğu', 20, 300, 5, 110, 'int'),
    ],
  }),
  webgl('galaxy', 'Galaksi', 'y', 'space', () => import('./Galaxy').then((m) => m.Galaxy), {
    uses: ['rotationSpeed'],
    options: [
      slider('arms', 'Kol Sayısı', 2, 5, 1, 3, 'int'),
      slider('density', 'Yıldız Yoğunluğu', 0.2, 1, 0.05, 0.6, 'pct'),
      slider('size', 'Yıldız Boyutu', 0.5, 2.5, 0.05, 1, 'x'),
      slider('tilt', 'Eğim', 0, 1.5, 0.05, 0.55),
      slider('react', 'Ritim Tepkisi', 0, 2, 0.1, 1, 'x'),
    ],
  }),
  webgl('fire', 'Ateş', 'e', 'nature', () => import('./Fire').then((m) => m.Fire), {
    options: [
      select('colors', 'Alev Rengi', ['Ateş', 'Mavi Alev', 'Palet'], 0, { segmented: true }),
      select('layout', 'Yerleşim', ['Odaklı (en güçlü tepe ortada)', 'Simetrik (bas ortada)', 'Soldan Sağa']),
      slider('flame', 'Alev Yüksekliği', 0.5, 1.5, 0.05, 1, 'x'),
      slider('wind', 'Rüzgar (Esinti)', 0, 2, 0.05, 1, 'x'),
      slider('lean', 'Merkeze Eğilme', 0, 1.5, 0.05, 0.7, 'x'),
      slider('flicker', 'Dalgalanma', 0, 2, 0.05, 1, 'x'),
      slider('sparks', 'Kıvılcım', 0, 3, 0.05, 1.4, 'x'),
      slider('react', 'Müzik Tepkisi', 0, 2.5, 0.05, 1.2, 'x'),
      slider('bright', 'Parlaklık', 0.4, 1.8, 0.05, 1, 'x'),
    ],
  }),
  canvas2d('matrix', 'Matris', 'x', 'retro', () => import('./Matrix').then((m) => m.Matrix), {
    uses: ['glow', 'trail'],
    options: [
      select('glyphs', 'Karakterler', ['Karışık', 'Sayı', 'İkili'], 0, { segmented: true }),
      slider('fontSize', 'Yazı Boyutu', 10, 28, 1, 16, 'int'),
      slider('react', 'Müzik Tepkisi (frekansa bağlı parlaklık/hız)', 0, 2.5, 0.05, 1.2, 'x'),
      toggle('burst', 'Vuruşta Yeni Akışlar', true),
    ],
  }),
  canvas2d('laser', 'Lazer', 'b', 'light', () => import('./Laser').then((m) => m.Laser), {
    uses: ['glow', 'trail'],
    options: [
      slider('beams', 'Işın Sayısı', 1, 7, 1, 3, 'int'),
      slider('sweep', 'Tarama Genişliği', 0.3, 1.6, 0.05, 1, 'x'),
      slider('spread', 'Işın Açıklığı', 0.3, 2.5, 0.05, 1, 'x'),
    ],
  }),
  canvas2d('fireworks', 'Havai Fişek', 'c', 'light', () => import('./Fireworks').then((m) => m.Fireworks), {
    uses: ['glow', 'trail'],
    options: [
      slider('rate', 'Roket Sıklığı', 0.3, 2.5, 0.1, 1, 'x'),
      slider('burst', 'Patlama Büyüklüğü', 0.5, 2, 0.05, 1, 'x'),
      slider('life', 'Kıvılcım Ömrü', 0.5, 2, 0.05, 1, 'x'),
      slider('gravity', 'Yerçekimi', 0.2, 2.5, 0.1, 1, 'x'),
    ],
  }),
  webgl('water', 'Su Dalgası', 'u', 'nature', () => import('./Water').then((m) => m.Water), {
    options: [
      select('style', 'Stil', ['Sade Dalga', 'Gerçekçi Su'], 0, { segmented: true }),
      select('colors', 'Su Rengi', ['Okyanus', 'Gece Gölü', 'Palet'], 0, { segmented: true, showIf: (v) => v.style >= 0.5 }),
      slider('drop', 'Damla Gücü', 0.4, 2.5, 0.1, 1, 'x'),
      slider('rain', 'Tiz Dalgacıkları (silik / yağmur)', 0, 2.5, 0.05, 1, 'x'),
      slider('damping', 'Dalga Ömrü', 0.96, 0.999, 0.001, 0.993, 'pct'),
      slider('wave', 'Dalga Belirginliği', 0.4, 2.5, 0.05, 1.2, 'x'),
      slider('shine', 'Parıltı', 0, 2, 0.05, 1, 'x'),
      slider('caustic', 'Işık Ağları (caustics)', 0, 2, 0.05, 1, 'x', { showIf: (v) => v.style >= 0.5 }),
      slider('bright', 'Parlaklık', 0.5, 2, 0.05, 1, 'x'),
      select('quality', 'Simülasyon Çözünürlüğü', ['Düşük', 'Orta', 'Yüksek'], 1, { segmented: true, showIf: (v) => v.style >= 0.5 }),
    ],
  }),
  webgl('bubbles', 'Baloncuklar', 'q', 'nature', () => import('./Bubbles').then((m) => m.Bubbles), {
    options: [
      slider('rate', 'Balon Sıklığı', 0.3, 2.5, 0.1, 1, 'x'),
      slider('size', 'Balon Boyutu', 0.5, 2.2, 0.05, 1, 'x'),
      slider('rise', 'Yükselme Hızı', 0.4, 2.5, 0.1, 1, 'x'),
      toggle('pops', 'Tepede Patlasın', true),
      slider('film', 'Gökkuşağı Filmi', 0, 1.5, 0.05, 1, 'x'),
      slider('bright', 'Parlaklık', 0.4, 1.8, 0.05, 1, 'x'),
    ],
  }),
  canvas2d('snow', 'Kar', 'r', 'nature', () => import('./Snow').then((m) => m.Snow), { uses: ['particleCount', 'trail'], options: [slider('fall', 'Düşüş Hızı', 0.4, 2.5, 0.1, 1, 'x'), slider('sway', 'Salınım', 0, 3, 0.1, 1, 'x'), slider('wind', 'Rüzgâr', 0, 2, 0.1, 1, 'x'), slider('flakeSize', 'Tane Boyutu', 0.5, 3, 0.1, 1, 'x')] }),
  canvas2d('rain', 'Yağmur', 'Y', 'nature', () => import('./Rain').then((m) => m.Rain), { uses: ['trail'], options: [slider('length', 'Damla Uzunluğu', 0.5, 2.5, 0.1, 1, 'x'), toggle('splash', 'Sıçrama Halkaları', true), toggle('lightning', 'Şimşek (güçlü vuruşta)', false), slider('slant', 'Yağış Eğimi', 0, 2, 0.1, 1, 'x'), slider('density', 'Yoğunluk', 0.3, 2, 0.1, 1, 'x')] }),
  webgl('rotozoom', 'Rotozoom', 'R', 'psychedelic', () => import('./Rotozoom').then((m) => m.Rotozoom), {
    uses: ['rotationSpeed'],
    options: [
      select('pattern', 'Zemin Deseni', ['Truchet Yayları', 'Petek', 'Voronoi', 'Moiré', 'Dama']),
      select('persp', 'Görünüm', ['Düz', 'Perspektif'], 0, { segmented: true }),
      slider('react', 'Müzik Tepkisi (hücre ışıması)', 0, 2.5, 0.05, 1.2, 'x'),
      slider('zoom', 'Yakınlaştırma', 0.4, 2.5, 0.05, 1, 'x'),
      slider('detail', 'Desen Sıklığı', 0.5, 2.5, 0.05, 1, 'x'),
      slider('scroll', 'Kayma Hızı', 0, 3, 0.1, 1, 'x'),
      slider('glowLine', 'Çizgi Parlaklığı', 0, 2, 0.05, 1, 'x'),
      slider('bright', 'Parlaklık', 0.4, 1.8, 0.05, 1, 'x'),
    ],
  }),
  webgl('vortex', 'Hipnoz', 'D', 'psychedelic', () => import('./Vortex').then((m) => m.Vortex), {
    options: [
      slider('arms', 'Kol Sayısı', 1, 8, 1, 3, 'int'),
      slider('tight', 'Sıkılık', 0.3, 2, 0.05, 0.8, 'x'),
      slider('depth', 'Derinlik (merkeze incelme)', 0, 1, 0.05, 0.4, 'x'),
      slider('thick', 'Kalınlık', 0.5, 1.5, 0.05, 1, 'x'),
      slider('speed', 'Dönüş Hızı', 0.2, 3, 0.05, 1, 'x'),
      select('direction', 'Yön', ['İçe Doğru', 'Dışa Doğru'], 0, { segmented: true }),
      slider('react', 'Müzik Tepkisi', 0, 2, 0.05, 1, 'x'),
      slider('bright', 'Parlaklık', 0.4, 1.8, 0.05, 1, 'x'),
    ],
  }),
  canvas2d('opart', 'Op-Art Halkalar', 'K', 'psychedelic', () => import('./Opart').then((m) => m.Opart), {
    uses: ['glow'],
    options: [
      select('style', 'Stil', ['Çizgi', 'Dolu Bantlar (Op-Art)'], 0, { segmented: true }),
      slider('rings', 'Halka Sayısı', 8, 40, 1, 16, 'int'),
      slider('lobes', 'Dilim Sayısı', 2, 14, 1, 6, 'int'),
      slider('wobble', 'Dalgalanma', 0, 3, 0.1, 1, 'x'),
      slider('pulse', 'Vuruş Nabzı', 0, 2.5, 0.1, 1, 'x'),
    ],
  }),
  webgl('static', 'Parazit', 'U', 'retro', () => import('./StaticNoise').then((m) => m.StaticNoise), {
    options: [
      select('style', 'Stil', ['Anten Paraziti (CRT)', 'Klasik Kar'], 0, { segmented: true }),
      slider('sig', 'Sinyal Gücü (görüntü netliği)', 0.3, 1.5, 0.05, 1, 'x', { showIf: (v) => v.style < 0.5 }),
      slider('interf', 'Parazit Şiddeti (hum çubukları, balıksırtı)', 0, 2, 0.05, 1, 'x', { showIf: (v) => v.style < 0.5 }),
      slider('roll', 'Dikey Kayma (V-Hold)', 0, 2, 0.05, 1, 'x', { showIf: (v) => v.style < 0.5 }),
      slider('ghost', 'Hayalet Görüntü', 0, 2, 0.05, 1, 'x', { showIf: (v) => v.style < 0.5 }),
      slider('jitter', 'Yatay Titreme', 0, 2, 0.05, 1, 'x', { showIf: (v) => v.style < 0.5 }),
      select('grain', 'Dane Boyutu', ['İnce', 'Orta', 'Kalın'], 1, { segmented: true }),
      slider('density', 'Yoğunluk', 0.4, 2, 0.05, 1, 'x', { showIf: (v) => v.style >= 0.5 }),
      slider('react', 'Müzik Tepkisi', 0, 2.5, 0.05, 1, 'x'),
      toggle('glitch', 'Parazit Çizgisi', true),
      toggle('tear', 'Vuruşta Yırtılma Bandı', true),
      toggle('scanlines', 'Tarama Çizgileri', true),
      toggle('vignette', 'Kenar Karartma', true),
    ],
  }),
  canvas2d('spectrogram', 'Spektrogram', 'A', 'spectrum', () => import('./Spectrogram').then((m) => m.Spectrogram), {
    options: [
      slider('contrast', 'Kontrast', 0.5, 2, 0.05, 1, 'x'),
      toggle('grid', 'Frekans Cetveli', true),
      toggle('beatLine', 'Vuruş Çizgisi', true),
    ],
  }),
  webgl('metaball', 'Metaball', 'B', 'psychedelic', () => import('./Metaball').then((m) => m.Metaball), {
    options: [
      select('motion', 'Hareket', ['Yörünge', 'Lav (yükselip alçalan)'], 0, { segmented: true }),
      select('render', 'Görünüm', ['Metaball', 'Yumuşak ışık'], 0, { segmented: true }),
      slider('count', 'Top Sayısı', 3, 12, 1, 9, 'int'),
      slider('size', 'Top Boyutu', 0.5, 1.6, 0.05, 1, 'x'),
      slider('orbit', 'Yörünge Genişliği', 0.4, 1.8, 0.05, 1, 'x'),
      slider('shine', 'Parlaklık (Yansıma)', 0, 2, 0.05, 1, 'x', { showIf: (v) => v.render < 0.5 }),
      slider('glow', 'Aura / Işıma', 0, 2, 0.05, 1, 'x'),
      slider('bright', 'Genel Parlaklık', 0.4, 1.8, 0.05, 1, 'x'),
    ],
  }),
  canvas2d('lightning', 'Şimşek', 'L', 'nature', () => import('./Lightning').then((m) => m.Lightning), {
    uses: ['glow', 'trail'],
    options: [
      slider('rate', 'Şimşek Sıklığı', 0.2, 3, 0.1, 1, 'x'),
      slider('thickness', 'Kalınlık', 0.5, 2.5, 0.05, 1, 'x'),
      slider('slow', 'Yavaş Çekim (öncü çizgi süresi)', 0.2, 2.5, 0.05, 0.6, 'x'),
      toggle('flash', 'Gökyüzü Işığı', true),
    ],
  }),
  canvas2d('vu', 'VU Göstergeleri', 'V', 'spectrum', () => import('./Vu').then((m) => m.Vu), {
    uses: ['glow'],
    options: [
      select('layout', 'Yerleşim', ['Otomatik', '1×4', '2×2'], 0, { segmented: true }),
      slider('scale', 'Kadran Boyutu', 0.6, 1.3, 0.05, 1, 'x'),
      slider('gain', 'Hassasiyet', 0.5, 2.5, 0.05, 1, 'x'),
      slider('stiff', 'İğne Tepkisi', 0.3, 2.5, 0.05, 1, 'x'),
      slider('lamp', 'Arka Işık', 0, 2, 0.05, 1, 'x'),
      toggle('peak', 'Tepe Tutma İşareti', true),
      toggle('numbers', 'Ölçek Sayıları', true),
      toggle('labels', 'Etiketler', true),
      toggle('led', 'Tepe LED', true),
    ],
  }),
  canvas2d('pong', 'Audio Pong', 'X', 'retro', () => import('./Pong').then((m) => m.Pong), {
    uses: ['barCount', 'glow', 'trail'],
    options: [
      slider('balls', 'Top Sayısı', 1, 10, 1, 5, 'int'),
      slider('ballSize', 'Top Boyutu', 0.5, 2.5, 0.1, 1, 'x'),
      slider('gravity', 'Yerçekimi', 0.4, 2, 0.05, 1, 'x'),
      slider('bounce', 'Zıplama Gücü', 0.5, 2, 0.05, 1, 'x'),
    ],
  }),
  canvas2d('notewaterfall', 'Nota Rulosu', 'W', 'spectrum', () => import('./NoteWaterfall').then((m) => m.NoteWaterfall), {
    uses: ['glow'],
    options: [
      select('keyboard', 'Klavye', ['Sağ', 'Sol'], 0, { segmented: true }),
      select('naming', 'Nota Adları', ['C D E', 'Do Re Mi'], 1, { segmented: true }),
      slider('octave', 'Başlangıç Oktavı', 1, 4, 1, 3, 'int'),
      slider('octaves', 'Oktav Sayısı', 2, 6, 1, 4, 'int'),
      slider('maxNotes', 'Aynı Anda Nota', 1, 8, 1, 5, 'int'),
      slider('threshold', 'Algılama Eşiği', 0.1, 0.8, 0.05, 0.3, 'pct'),
      toggle('harmonics', 'Armonikleri Ele', true),
      slider('scroll', 'Kayma Hızı', 60, 400, 10, 160, 'int'),
      toggle('labels', 'Nota Adlarını Göster', true),
      toggle('hud', 'Çalan Notalar Yazısı (sol üst)', true),
    ],
  }),
  webgl('phosphene', 'Fosfen', 'F', 'psychedelic', () => import('./Phosphene').then((m) => m.Phosphene), {
    options: [
      slider('sym', 'Simetri (katlama sayısı)', 4, 16, 2, 8, 'int'),
      slider('rhythm', 'Desen Geçişi (kaç vuruşta bir)', 4, 48, 1, 16, 'int'),
      slider('speed', 'Dönüş / Akış Hızı', 0.2, 3, 0.05, 1, 'x'),
      slider('width', 'Çizgi Kalınlığı', 0.4, 2.5, 0.05, 1, 'x'),
      slider('halo', 'Işıma (Hale)', 0, 2, 0.05, 1, 'x'),
      slider('react', 'Müzik Tepkisi', 0, 2.5, 0.05, 1.2, 'x'),
      slider('bright', 'Parlaklık', 0.4, 1.8, 0.05, 1, 'x'),
    ],
  }),
  webgl('papertear', 'Kağıt Yırtma', 'J', 'psychedelic', () => import('./PaperTear').then((m) => m.PaperTear), {
    options: [
      select('colors', 'Kağıt Renkleri', ['Palet', 'Kağıt Tonları'], 0, { segmented: true }),
      slider('speed', 'Yırtılma Hızı', 0.3, 3, 0.05, 1, 'x'),
      select('direction', 'Yırtılma Yönü', ['Rastgele', 'Yatay', 'Dikey'], 0, { segmented: true }),
      slider('jag', 'Tırtıklılık', 0.3, 2, 0.05, 1, 'x'),
      slider('fiber', 'Kağıt Lifi (beyaz kenar)', 0, 2, 0.05, 1, 'x'),
      slider('shadow', 'Gölge', 0, 2, 0.05, 1, 'x'),
      slider('bright', 'Parlaklık', 0.5, 1.5, 0.05, 1, 'x'),
    ],
  }),
  webgl('paintdrip', 'Boya Damlası', 'T', 'psychedelic', () => import('./PaintDrip').then((m) => m.PaintDrip), {
    options: [
      select('base', 'Kağıt', ['Beyaz', 'Krem'], 0, { segmented: true }),
      slider('rate', 'Damlama Sıklığı (ritim/şiddetle)', 0.3, 2.5, 0.05, 1, 'x'),
      slider('size', 'Damla Boyutu', 0.5, 2, 0.05, 1, 'x'),
      slider('spread', 'Yayılma Hızı', 0.4, 2.5, 0.05, 1, 'x'),
      slider('life', 'Silinme Süresi (sn)', 3, 20, 1, 8, 'int'),
      slider('oil', 'Yağ Halkası (saydam, renkli)', 0, 2, 0.05, 1, 'x'),
      slider('jag', 'Pigment Kenarı (tüylenme)', 0.3, 2, 0.05, 1, 'x'),
      slider('bright', 'Parlaklık', 0.6, 1.4, 0.05, 1, 'x'),
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
