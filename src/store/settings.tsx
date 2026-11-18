import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';
import { PALETTES } from '../visuals/palettes';
import type { VisualizerSettingsView } from '../visuals/types';

export interface Settings {
  sensitivity: number;
  smoothing: number;
  fftSize: number;
  paletteId: string;
  glow: boolean;
  barCount: number;
  particleCount: number;
  rotationSpeed: number;
  showFps: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1.2,
  smoothing: 0.8,
  fftSize: 2048,
  paletteId: 'neon',
  glow: true,
  barCount: 64,
  particleCount: 300,
  rotationSpeed: 0.15,
  showFps: false,
};

const STORAGE_KEY = 'mscillus.settings.v1';
const FFT_SIZES = [512, 1024, 2048, 4096];

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

function sanitize(raw: unknown): Settings {
  const partial = typeof raw === 'object' && raw !== null ? (raw as Partial<Settings>) : {};
  return {
    sensitivity: clampNumber(partial.sensitivity, 0.2, 3, DEFAULT_SETTINGS.sensitivity),
    smoothing: clampNumber(partial.smoothing, 0, 0.95, DEFAULT_SETTINGS.smoothing),
    fftSize: FFT_SIZES.includes(partial.fftSize as number)
      ? (partial.fftSize as number)
      : DEFAULT_SETTINGS.fftSize,
    paletteId: partial.paletteId && PALETTES[partial.paletteId] ? partial.paletteId : DEFAULT_SETTINGS.paletteId,
    glow: typeof partial.glow === 'boolean' ? partial.glow : DEFAULT_SETTINGS.glow,
    barCount: Math.round(clampNumber(partial.barCount, 16, 128, DEFAULT_SETTINGS.barCount)),
    particleCount: Math.round(clampNumber(partial.particleCount, 50, 800, DEFAULT_SETTINGS.particleCount)),
    rotationSpeed: clampNumber(partial.rotationSpeed, 0, 1, DEFAULT_SETTINGS.rotationSpeed),
    showFps: typeof partial.showFps === 'boolean' ? partial.showFps : DEFAULT_SETTINGS.showFps,
  };
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

type Action = { type: 'set'; patch: Partial<Settings> } | { type: 'reset' };

function reducer(state: Settings, action: Action): Settings {
  if (action.type === 'reset') return DEFAULT_SETTINGS;
  return sanitize({ ...state, ...action.patch });
}

interface SettingsContextValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, dispatch] = useReducer(reducer, undefined, load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      return;
    }
  }, [settings]);
  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      update: (patch) => dispatch({ type: 'set', patch }),
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

export function toView(settings: Settings): VisualizerSettingsView {
  return {
    palette: PALETTES[settings.paletteId] ?? PALETTES.neon,
    glow: settings.glow,
    barCount: settings.barCount,
    particleCount: settings.particleCount,
    rotationSpeed: settings.rotationSpeed,
  };
}
