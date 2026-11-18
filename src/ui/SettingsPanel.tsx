import type { ChangeEvent, ReactNode } from 'react';
import { PALETTES } from '../visuals/palettes';
import { useSettings } from '../store/settings';

interface Props {
  onClose: () => void;
}

function Row({ label, value, children }: { label: string; value?: string; children?: ReactNode }) {
  return (
    <div className="panel__row">
      <div className="panel__label">
        <span>{label}</span>
        {value && <span className="panel__value">{value}</span>}
      </div>
      {children}
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  fmt,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  fmt: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <Row label={label} value={fmt(value)}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Row>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Row label={label}>
      <button
        type="button"
        className={`toggle ${checked ? 'toggle--on' : ''}`}
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
      >
        <span className="toggle__knob" />
      </button>
    </Row>
  );
}

export function SettingsPanel({ onClose }: Props) {
  const { settings, update, reset } = useSettings();

  const onFft = (e: ChangeEvent<HTMLSelectElement>) =>
    update({ fftSize: Number(e.target.value) });
  const onPalette = (e: ChangeEvent<HTMLSelectElement>) =>
    update({ paletteId: e.target.value });

  return (
    <aside className="panel">
      <div className="panel__head">
        <h2>Görsel Ayarları</h2>
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Kapat
        </button>
      </div>

      <div className="panel__section">Ses Motoru</div>
      <Slider
        label="Hassasiyet"
        min={0.2}
        max={3}
        step={0.05}
        value={settings.sensitivity}
        fmt={(v) => `${v.toFixed(2)}x`}
        onChange={(v) => update({ sensitivity: v })}
      />
      <Slider
        label="Yumuşatma"
        min={0}
        max={0.95}
        step={0.05}
        value={settings.smoothing}
        fmt={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => update({ smoothing: v })}
      />
      <Row label="FFT Çözünürlüğü" value={`${settings.fftSize}`}>
        <select value={settings.fftSize} onChange={onFft}>
          {[512, 1024, 2048, 4096].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Row>

      <div className="panel__section">Görünüm</div>
      <Row label="Renk Paleti" value={PALETTES[settings.paletteId]?.name}>
        <select value={settings.paletteId} onChange={onPalette}>
          {Object.values(PALETTES).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Row>
      <Slider
        label="Bar / Işın Sayısı"
        min={16}
        max={128}
        step={8}
        value={settings.barCount}
        fmt={(v) => `${v}`}
        onChange={(v) => update({ barCount: v })}
      />
      <Slider
        label="Parçacık Yoğunluğu"
        min={50}
        max={800}
        step={10}
        value={settings.particleCount}
        fmt={(v) => `${v}`}
        onChange={(v) => update({ particleCount: v })}
      />
      <Slider
        label="Rotasyon Hızı"
        min={0}
        max={1}
        step={0.05}
        value={settings.rotationSpeed}
        fmt={(v) => v.toFixed(2)}
        onChange={(v) => update({ rotationSpeed: v })}
      />
      <Toggle label="Parlama (Glow)" checked={settings.glow} onChange={(v) => update({ glow: v })} />
      <Toggle label="FPS Göstergesi" checked={settings.showFps} onChange={(v) => update({ showFps: v })} />

      <div className="panel__foot">
        <button type="button" className="btn" onClick={reset}>
          Varsayılanlara Dön
        </button>
        <p className="panel__note">Ayarlar tarayıcınızda otomatik kaydedilir.</p>
      </div>
    </aside>
  );
}
