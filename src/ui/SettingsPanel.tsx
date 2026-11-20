import { useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { formatOption } from '../visuals/options';
import type { OptionDef } from '../visuals/options';
import { PALETTES } from '../visuals/palettes';
import { modeMeta } from '../visuals/registry';
import type { ModeId } from '../visuals/registry';
import { modeOptionValues, useSettings } from '../store/settings';

const FFT_SIZES = [512, 1024, 2048, 4096];

interface Props {
  modeId: ModeId;
  onClose: () => void;
  onChangeSource: () => void;
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

function Segmented({
  label,
  choices,
  index,
  onChange,
}: {
  label: string;
  choices: readonly string[];
  index: number;
  onChange: (i: number) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {choices.map((c, i) => (
        <button
          key={c}
          type="button"
          className={`segmented__btn ${i === index ? 'segmented__btn--on' : ''}`}
          aria-pressed={i === index}
          onClick={() => onChange(i)}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

function OptionControl({
  def,
  value,
  onChange,
}: {
  def: OptionDef;
  value: number;
  onChange: (v: number) => void;
}) {
  if (def.kind === 'select' && def.segmented && def.choices) {
    return (
      <Row label={def.label}>
        <Segmented label={def.label} choices={def.choices} index={Math.round(value)} onChange={onChange} />
      </Row>
    );
  }
  if (def.kind === 'select') {
    return (
      <Row label={def.label}>
        <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
          {def.choices?.map((c, i) => (
            <option key={c} value={i}>
              {c}
            </option>
          ))}
        </select>
      </Row>
    );
  }
  if (def.kind === 'toggle') {
    return <Toggle label={def.label} checked={value >= 0.5} onChange={(v) => onChange(v ? 1 : 0)} />;
  }
  return (
    <Slider
      label={def.label}
      min={def.min}
      max={def.max}
      step={def.step}
      value={value}
      fmt={(v) => formatOption(def, v)}
      onChange={onChange}
    />
  );
}

export function SettingsPanel({ modeId, onClose, onChangeSource }: Props) {
  const [confirmingSource, setConfirmingSource] = useState(false);
  const { settings, update, setModeOption, resetMode, reset } = useSettings();
  const meta = modeMeta(modeId);
  const values = modeOptionValues(settings, modeId);
  const customized = Object.keys(settings.modeOptions[modeId] ?? {}).length > 0;

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
      <Row label="FFT Çözünürlüğü">
        <Segmented
          label="FFT Çözünürlüğü"
          choices={FFT_SIZES.map(String)}
          index={FFT_SIZES.indexOf(settings.fftSize)}
          onChange={(i) => update({ fftSize: FFT_SIZES[i] })}
        />
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
      <Toggle label="FPS Göstergesi" checked={settings.showFps} onChange={(v) => update({ showFps: v })} />

      <div className="panel__section">{meta.name} — Mod Ayarları</div>
      {meta.options.filter((def) => !def.showIf || def.showIf(values)).map((def) => (
        <OptionControl
          key={`${modeId}:${def.id}`}
          def={def}
          value={values[def.id]}
          onChange={(v) => setModeOption(modeId, def.id, v)}
        />
      ))}
      <button type="button" className="btn btn--ghost" disabled={!customized} onClick={() => resetMode(modeId)}>
        Bu Modu Sıfırla
      </button>

      <div className="panel__section">Ses Kaynağı</div>
      {confirmingSource ? (
        <div className="panel__confirm">
          <p className="panel__note">Müzik durur ve kaynak seçim ekranına dönülür. Devam edilsin mi?</p>
          <div className="panel__confirm-actions">
            <button type="button" className="btn btn--danger" onClick={onChangeSource}>
              Evet, değiştir
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setConfirmingSource(false)}>
              Vazgeç
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn--ghost" onClick={() => setConfirmingSource(true)}>
          Kaynağı Değiştir…
        </button>
      )}

      <div className="panel__foot">
        <button type="button" className="btn" onClick={reset}>
          Tüm Ayarları Sıfırla
        </button>
        <p className="panel__note">Ayarlar tarayıcınızda otomatik kaydedilir; mod ayarları her mod için ayrı saklanır.</p>
      </div>
    </aside>
  );
}
