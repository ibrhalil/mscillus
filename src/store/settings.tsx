import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';
import type { CycleScope } from '../render/AutoCycle';
import type { Resolution } from '../render/RenderLoop';
import { clampOption, SHARED_OPTIONS } from '../visuals/options';
import {
  CUSTOM_COLORS_MAX,
  CUSTOM_COLORS_MIN,
  CUSTOM_PALETTE_ID,
  DEFAULT_CUSTOM_PALETTE,
  isHexColor,
  PALETTES,
  resolvePalette,
} from '../visuals/palettes';
import type { CustomPalette } from '../visuals/palettes';
import { MODES, modeMeta } from '../visuals/registry';
import type { ModeId } from '../visuals/registry';
import type { VisualizerSettingsView } from '../visuals/types';

export interface Settings {
  sensitivity: number;
  smoothing: number;
  fftSize: number;
  paletteId: string;
  showFps: boolean;
  /** Moda göre özelleştirilmiş seçenek değerleri: `modeOptions[modeId][optionId]`. */
  modeOptions: Record<string, Record<string, number>>;
  /** Favori mod kimlikleri (eklenme sırasıyla); mod seçicide en üstte gösterilir. */
  favorites: ModeId[];
  /** `paletteId === 'custom'` iken kullanılan, panelde düzenlenen palet. */
  customPalette: CustomPalette;
  /** Çizim çözünürlüğü; 'auto' FPS düşünce kendiliğinden küçültür. */
  resolution: Resolution;
  /** 0 = sınırsız. */
  fpsCap: number;
  /** Klavyeyle / otomatik geçişte mod adı kısa süre ekranda görünür. */
  modeToast: boolean;
  /** Mikrofon kaynağının giriş aygıtı ('' = sistem varsayılanı). */
  micDeviceId: string;
  autoCycle: boolean;
  autoCycleSec: number;
  autoCycleScope: CycleScope;
  autoCycleShuffle: boolean;
  /** Süre dolunca sıradaki vuruşu bekle. */
  autoCycleOnBeat: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  smoothing: 0.6,
  fftSize: 2048,
  paletteId: 'neon',
  showFps: false,
  modeOptions: {},
  favorites: [],
  customPalette: DEFAULT_CUSTOM_PALETTE,
  resolution: 'auto',
  fpsCap: 0,
  modeToast: true,
  micDeviceId: '',
  autoCycle: false,
  autoCycleSec: 30,
  autoCycleScope: 'favorites',
  autoCycleShuffle: true,
  autoCycleOnBeat: true,
};

const STORAGE_KEY = 'mscillus.settings.v1';
const SAVE_DELAY_MS = 300;
export const FFT_SIZES = [512, 1024, 2048, 4096];
export const FPS_CAPS = [0, 60, 30];
export const RESOLUTIONS: readonly Resolution[] = ['auto', 'high', 'medium', 'low'];
export const AUTO_CYCLE_SEC = { min: 10, max: 300, step: 5 } as const;

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

function oneOf<T>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

/** Bozuk / eski kayıtları güvenli değerlere çevirir (bilinmeyen alanlar atılır, aralıklar sıkıştırılır). */
export function sanitize(raw: unknown): Settings {
  const partial = typeof raw === 'object' && raw !== null ? (raw as Partial<Settings>) : {};
  return {
    sensitivity: clampNumber(partial.sensitivity, 0.2, 3, DEFAULT_SETTINGS.sensitivity),
    smoothing: clampNumber(partial.smoothing, 0, 0.95, DEFAULT_SETTINGS.smoothing),
    fftSize: FFT_SIZES.includes(partial.fftSize as number)
      ? (partial.fftSize as number)
      : DEFAULT_SETTINGS.fftSize,
    paletteId:
      partial.paletteId && (PALETTES[partial.paletteId] || partial.paletteId === CUSTOM_PALETTE_ID)
        ? partial.paletteId
        : DEFAULT_SETTINGS.paletteId,
    showFps: bool(partial.showFps, DEFAULT_SETTINGS.showFps),
    modeOptions: sanitizeModeOptions(partial.modeOptions),
    favorites: sanitizeFavorites(partial.favorites),
    customPalette: sanitizeCustomPalette(partial.customPalette),
    resolution: oneOf(partial.resolution, RESOLUTIONS, DEFAULT_SETTINGS.resolution),
    fpsCap: oneOf(partial.fpsCap, FPS_CAPS, DEFAULT_SETTINGS.fpsCap),
    modeToast: bool(partial.modeToast, DEFAULT_SETTINGS.modeToast),
    micDeviceId: typeof partial.micDeviceId === 'string' ? partial.micDeviceId : DEFAULT_SETTINGS.micDeviceId,
    autoCycle: bool(partial.autoCycle, DEFAULT_SETTINGS.autoCycle),
    autoCycleSec: Math.round(
      clampNumber(partial.autoCycleSec, AUTO_CYCLE_SEC.min, AUTO_CYCLE_SEC.max, DEFAULT_SETTINGS.autoCycleSec),
    ),
    autoCycleScope: oneOf<CycleScope>(partial.autoCycleScope, ['favorites', 'all'], DEFAULT_SETTINGS.autoCycleScope),
    autoCycleShuffle: bool(partial.autoCycleShuffle, DEFAULT_SETTINGS.autoCycleShuffle),
    autoCycleOnBeat: bool(partial.autoCycleOnBeat, DEFAULT_SETTINGS.autoCycleOnBeat),
  };
}

/** Geçerli bir `#rrggbb` listesi (2-6 renk) ve arka plan değilse varsayılan özel palet. Geçerliyse aynı nesne (kimlik korunur). */
function sanitizeCustomPalette(raw: unknown): CustomPalette {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_CUSTOM_PALETTE;
  const { colors, bg } = raw as Partial<CustomPalette>;
  const valid =
    Array.isArray(colors) &&
    colors.length >= CUSTOM_COLORS_MIN &&
    colors.length <= CUSTOM_COLORS_MAX &&
    colors.every(isHexColor) &&
    isHexColor(bg);
  return valid ? (raw as CustomPalette) : DEFAULT_CUSTOM_PALETTE;
}

function sanitizeFavorites(raw: unknown): ModeId[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set<string>(MODES.map((m) => m.id));
  const out: ModeId[] = [];
  for (const id of raw) {
    if (typeof id === 'string' && known.has(id) && !out.includes(id as ModeId)) out.push(id as ModeId);
  }
  return out;
}

/** Bilinmeyen mod/seçenekleri atar, değerleri tanımın aralığına sıkıştırır, varsayılana eşit olanları saklamaz. */
function sanitizeModeOptions(raw: unknown): Settings['modeOptions'] {
  const out: Settings['modeOptions'] = {};
  if (typeof raw !== 'object' || raw === null) return out;
  const input = raw as Record<string, unknown>;
  for (const mode of MODES) {
    const stored = input[mode.id];
    if (typeof stored !== 'object' || stored === null) continue;
    const values: Record<string, number> = {};
    for (const def of mode.options) {
      const v = (stored as Record<string, unknown>)[def.id];
      if (v === undefined) continue;
      const c = clampOption(def, v);
      if (c !== def.default) values[def.id] = c;
    }
    if (Object.keys(values).length > 0) out[mode.id] = values;
  }
  return out;
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return sanitize(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

type Action =
  | { type: 'set'; patch: Partial<Settings> }
  | { type: 'option'; mode: ModeId; id: string; value: number }
  | { type: 'resetMode'; mode: ModeId }
  | { type: 'toggleFavorite'; mode: ModeId }
  | { type: 'reset' };

function reducer(state: Settings, action: Action): Settings {
  switch (action.type) {
    case 'reset':
      return DEFAULT_SETTINGS;
    case 'set':
      return sanitize({ ...state, ...action.patch });
    case 'option':
      return sanitize({
        ...state,
        modeOptions: {
          ...state.modeOptions,
          [action.mode]: { ...state.modeOptions[action.mode], [action.id]: action.value },
        },
      });
    case 'toggleFavorite':
      return {
        ...state,
        favorites: state.favorites.includes(action.mode)
          ? state.favorites.filter((id) => id !== action.mode)
          : [...state.favorites, action.mode],
      };
    case 'resetMode': {
      const { [action.mode]: _dropped, ...rest } = state.modeOptions;
      return { ...state, modeOptions: rest };
    }
  }
}

interface SettingsContextValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  setModeOption: (mode: ModeId, id: string, value: number) => void;
  resetMode: (mode: ModeId) => void;
  toggleFavorite: (mode: ModeId) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, dispatch] = useReducer(reducer, undefined, load);

  // Kaydırıcı sürüklenirken her adımda yazmamak için gecikmeli kayıt; sayfa kapanırken bekleyen kayıt hemen yazılır.
  useEffect(() => {
    const save = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch {
        // depolama dolu / kapalı
      }
    };
    const timer = window.setTimeout(save, SAVE_DELAY_MS);
    window.addEventListener('pagehide', save);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pagehide', save);
    };
  }, [settings]);
  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      update: (patch) => dispatch({ type: 'set', patch }),
      setModeOption: (mode, id, value) => dispatch({ type: 'option', mode, id, value }),
      resetMode: (mode) => dispatch({ type: 'resetMode', mode }),
      toggleFavorite: (mode) => dispatch({ type: 'toggleFavorite', mode }),
      reset: () => dispatch({ type: 'reset' }),
    }),
    [settings],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings, SettingsProvider içinde kullanılmalı');
  return value;
}

/** Bir modun seçeneklerini (kayıtlı değer ya da varsayılan) çözer. */
export function modeOptionValues(settings: Settings, mode: ModeId): Record<string, number> {
  const stored = settings.modeOptions[mode];
  const out: Record<string, number> = {};
  for (const def of modeMeta(mode).options) out[def.id] = clampOption(def, stored?.[def.id]);
  return out;
}

const viewCache = new WeakMap<Settings, Map<ModeId, VisualizerSettingsView>>();

export function toView(settings: Settings, mode: ModeId): VisualizerSettingsView {
  let perMode = viewCache.get(settings);
  if (!perMode) viewCache.set(settings, (perMode = new Map()));
  const cached = perMode.get(mode);
  if (cached) return cached;

  const opt = modeOptionValues(settings, mode);
  const pick = (k: keyof typeof SHARED_OPTIONS) => opt[k] ?? SHARED_OPTIONS[k].default;
  const view: VisualizerSettingsView = {
    palette: resolvePalette(settings.paletteId, settings.customPalette),
    glow: pick('glow') > 0,
    glowQuality: Math.max(0, Math.round(pick('glow')) - 1),
    barCount: Math.round(pick('barCount')),
    particleCount: Math.round(pick('particleCount')),
    rotationSpeed: pick('rotationSpeed'),
    speed: pick('speed'),
    opt,
  };
  perMode.set(mode, view);
  return view;
}
