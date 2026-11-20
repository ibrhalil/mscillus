/** Bir modun ayar panelinde gösterilen tek bir kontrol (kaydırıcı veya anahtar). */
export interface OptionDef {
  id: string;
  label: string;
  kind: 'slider' | 'toggle' | 'select';
  min: number;
  max: number;
  step: number;
  default: number;
  format?: 'int' | 'x' | 'pct';
  /** `select` için seçenek etiketleri; saklanan değer dizin numarasıdır. */
  choices?: readonly string[];
  /** `select` için: açılır liste yerine yan yana segmentli düğme grubu gösterir. */
  segmented?: boolean;
  /** Verilirse kontrol yalnızca bu koşul (modun güncel seçenek değerleriyle) doğruysa gösterilir. */
  showIf?: (values: Record<string, number>) => boolean;
}

type Extras = Pick<OptionDef, 'showIf' | 'segmented'>;

const slider = (
  id: string,
  label: string,
  min: number,
  max: number,
  step: number,
  def: number,
  format?: OptionDef['format'],
  extras: Extras = {},
): OptionDef => ({ id, label, kind: 'slider', min, max, step, default: def, format, ...extras });

export const toggle = (id: string, label: string, def: boolean, extras: Extras = {}): OptionDef => ({
  id,
  label,
  kind: 'toggle',
  min: 0,
  max: 1,
  step: 1,
  default: def ? 1 : 0,
  ...extras,
});

export const select = (
  id: string,
  label: string,
  choices: readonly string[],
  def = 0,
  extras: Extras = {},
): OptionDef => ({
  id,
  label,
  kind: 'select',
  min: 0,
  max: choices.length - 1,
  step: 1,
  default: def,
  choices,
  ...extras,
});

export { slider };

/** Birden çok modun paylaştığı seçenekler; her mod yalnızca kullandıklarını gösterir. */
export const SHARED_OPTIONS = {
  barCount: slider('barCount', 'Bar / Öğe Sayısı', 16, 128, 8, 64, 'int'),
  particleCount: slider('particleCount', 'Parçacık Yoğunluğu', 50, 800, 10, 300, 'int'),
  rotationSpeed: slider('rotationSpeed', 'Rotasyon Hızı', 0, 1, 0.05, 0.15),
  // 0 kapalı; 1-3 düşük/orta/yüksek kalite (bkz. toView: glow = değer > 0, glowQuality = değer - 1)
  glow: select('glow', 'Parlama (Glow)', ['Kapalı', 'Düşük', 'Orta', 'Yüksek'], 3, { segmented: true }),
  trail: slider('trail', 'İz Uzunluğu', 0.3, 3, 0.1, 1, 'x'),
  speed: slider('speed', 'Animasyon Hızı', 0.25, 2.5, 0.05, 1, 'x'),
} as const;

export type SharedOptionKey = keyof typeof SHARED_OPTIONS;

export function clampOption(def: OptionDef, value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : def.default;
  const c = Math.min(def.max, Math.max(def.min, n));
  return def.kind === 'slider' ? c : Math.round(c);
}

export function formatOption(def: OptionDef, v: number): string {
  if (def.choices) return def.choices[Math.round(v)] ?? '';
  if (def.format === 'int') return `${Math.round(v)}`;
  if (def.format === 'x') return `${v.toFixed(2)}x`;
  if (def.format === 'pct') return `${Math.round(v * 100)}%`;
  return v.toFixed(2);
}
