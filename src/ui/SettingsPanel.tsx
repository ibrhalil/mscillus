import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import type { SourceType } from '../audio/types';
import { phrase, t } from '../i18n';
import type { MessageKey } from '../i18n';
import { LanguageSelect } from './LanguageSelect';
import { SOURCE_TEXT } from './SourcePicker';
import { tNodes, useLocale } from '../i18n/react';
import { formatOption } from '../visuals/options';
import type { OptionDef } from '../visuals/options';
import {
  CUSTOM_COLORS_MAX,
  CUSTOM_COLORS_MIN,
  CUSTOM_PALETTE_ID,
  DEFAULT_CUSTOM_PALETTE,
  PALETTES,
  resolvePalette,
} from '../visuals/palettes';
import type { CustomPalette } from '../visuals/palettes';
import { keyLabel, modeMeta } from '../visuals/registry';
import type { ModeId } from '../visuals/registry';
import { AUTO_CYCLE_SEC, FFT_SIZES, FPS_CAPS, modeOptionValues, RESOLUTIONS, useSettings } from '../store/settings';

/** Panel sekmeleri: neyin neyi etkilediği karışmasın diye ayarlar kapsamına göre ayrılır. */
export type PanelTab = 'mode' | 'colors' | 'audio' | 'general';

const TABS: { id: PanelTab; label: MessageKey }[] = [
  { id: 'mode', label: 'panel.tab.mode' },
  { id: 'colors', label: 'panel.tab.colors' },
  { id: 'audio', label: 'panel.tab.audio' },
  { id: 'general', label: 'panel.tab.general' },
];

/** `RESOLUTIONS` ile aynı sırada. */
const RESOLUTION_LABELS: readonly MessageKey[] = [
  'panel.resolutionAuto',
  'panel.resolutionHigh',
  'panel.resolutionBalanced',
  'panel.resolutionLow',
];

interface Props {
  modeId: ModeId;
  source: SourceType;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  onClose: () => void;
  onChangeSource: () => void;
  onMicDevice: (deviceId: string) => void;
}

function fmtSeconds(v: number): string {
  if (v < 60) return t('fmt.sec', { s: v });
  const m = Math.floor(v / 60);
  const rest = v % 60;
  return rest ? t('fmt.minSec', { m, s: rest }) : t('fmt.min', { m });
}

const samePalette = (a: CustomPalette, b: CustomPalette): boolean =>
  a.bg === b.bg && a.colors.length === b.colors.length && a.colors.every((c, i) => c === b.colors[i]);

/** Etiket satırı; `inline` ise kontrol etiketin sağında durur (anahtarlar), `hint` altta kısa açıklama. */
function Row({
  label,
  value,
  hint,
  inline,
  children,
}: {
  label: string;
  value?: string;
  hint?: string;
  inline?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="panel__row">
      <div className="panel__label">
        <span>{label}</span>
        {value && <span className="panel__value">{value}</span>}
        {inline && children}
      </div>
      {!inline && children}
      {hint && <p className="panel__hint">{hint}</p>}
    </div>
  );
}

function Slider({
  label,
  hint,
  min,
  max,
  step,
  value,
  fmt,
  onChange,
}: {
  label: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  fmt: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <Row label={label} value={fmt(value)} hint={hint}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Row>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Row label={label} hint={hint} inline>
      <button
        type="button"
        className={`toggle ${checked ? 'toggle--on' : ''}`}
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        aria-label={label}
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

/** Onay isteyen geri alınamaz eylem (kaynağı değiştir, tümünü sıfırla). */
function ConfirmButton({
  label,
  question,
  confirmLabel,
  onConfirm,
}: {
  label: string;
  question: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  useLocale();
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className="btn btn--ghost" onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <div className="panel__confirm">
      <p className="panel__note">{question}</p>
      <div className="panel__confirm-actions">
        <button
          type="button"
          className="btn btn--danger"
          onClick={() => {
            setAsking(false);
            onConfirm();
          }}
        >
          {confirmLabel}
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => setAsking(false)}>
          {t('panel.cancel')}
        </button>
      </div>
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
  const label = phrase(def.label);
  if (def.kind === 'select' && def.segmented && def.choices) {
    return (
      <Row label={label}>
        <Segmented label={label} choices={def.choices.map(phrase)} index={Math.round(value)} onChange={onChange} />
      </Row>
    );
  }
  if (def.kind === 'select') {
    return (
      <Row label={label}>
        <select value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))}>
          {def.choices?.map((c, i) => (
            <option key={c} value={i}>
              {phrase(c)}
            </option>
          ))}
        </select>
      </Row>
    );
  }
  if (def.kind === 'toggle') {
    return <Toggle label={label} checked={value >= 0.5} onChange={(v) => onChange(v ? 1 : 0)} />;
  }
  return (
    <Slider
      label={label}
      min={def.min}
      max={def.max}
      step={def.step}
      value={value}
      fmt={(v) => formatOption(def, v)}
      onChange={onChange}
    />
  );
}

function CustomPaletteEditor({ value, onChange }: { value: CustomPalette; onChange: (p: CustomPalette) => void }) {
  useLocale();
  const setColor = (i: number, c: string) =>
    onChange({ ...value, colors: value.colors.map((x, j) => (j === i ? c : x)) });
  return (
    <div className="palette-editor">
      <div className="palette-editor__colors">
        {value.colors.map((c, i) => (
          <input
            key={i}
            type="color"
            value={c}
            aria-label={t('panel.color', { n: i + 1 })}
            onChange={(e) => setColor(i, e.target.value)}
          />
        ))}
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          title={t('panel.addColor')}
          aria-label={t('panel.addColor')}
          disabled={value.colors.length >= CUSTOM_COLORS_MAX}
          onClick={() => onChange({ ...value, colors: [...value.colors, value.colors[value.colors.length - 1]] })}
        >
          +
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          title={t('panel.removeColor')}
          aria-label={t('panel.removeColor')}
          disabled={value.colors.length <= CUSTOM_COLORS_MIN}
          onClick={() => onChange({ ...value, colors: value.colors.slice(0, -1) })}
        >
          −
        </button>
      </div>
      <label className="palette-editor__bg">
        {t('panel.bgColor')}
        <input type="color" value={value.bg} onChange={(e) => onChange({ ...value, bg: e.target.value })} />
      </label>
    </div>
  );
}

function MicDeviceRow({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  useLocale();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      AudioEngine.listInputs()
        .then((list) => {
          if (alive) setDevices(list);
        })
        .catch(() => {});
    };
    load();
    navigator.mediaDevices?.addEventListener('devicechange', load);
    return () => {
      alive = false;
      navigator.mediaDevices?.removeEventListener('devicechange', load);
    };
  }, []);

  // Chrome'un "default" sözde aygıtı "Sistem varsayılanı" seçeneğiyle aynı şey.
  const listed = devices.filter((d) => d.deviceId && d.deviceId !== 'default');
  const known = listed.some((d) => d.deviceId === value);
  return (
    <Row label={t('panel.micDevice')} hint={t('panel.micHint')}>
      <select value={known ? value : ''} aria-label={t('panel.micDevice')} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('panel.micDefault')}</option>
        {listed.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || t('panel.micFallback', { n: i + 1 })}
          </option>
        ))}
      </select>
    </Row>
  );
}

function ModeTab({ modeId }: { modeId: ModeId }) {
  useLocale();
  const { settings, setModeOption, resetMode } = useSettings();
  const meta = modeMeta(modeId);
  const values = modeOptionValues(settings, modeId);
  const customized = Object.keys(settings.modeOptions[modeId] ?? {}).length > 0;
  return (
    <>
      <div className="panel__mode">
        <span className="panel__mode-name">{phrase(meta.name)}</span>
        <kbd className="kbd">{keyLabel(meta.key)}</kbd>
      </div>
      {meta.options.filter((def) => !def.showIf || def.showIf(values)).map((def) => (
        <OptionControl
          key={`${modeId}:${def.id}`}
          def={def}
          value={values[def.id]}
          onChange={(v) => setModeOption(modeId, def.id, v)}
        />
      ))}
      <button type="button" className="btn btn--ghost" disabled={!customized} onClick={() => resetMode(modeId)}>
        {t('panel.resetMode')}
      </button>
    </>
  );
}

function ColorsTab() {
  useLocale();
  const { settings, update } = useSettings();
  const isCustom = settings.paletteId === CUSTOM_PALETTE_ID;
  const custom = resolvePalette(CUSTOM_PALETTE_ID, settings.customPalette);
  const cards = [...Object.values(PALETTES).map((p) => ({ id: p.id, palette: p })), { id: CUSTOM_PALETTE_ID, palette: custom }];

  const choose = (id: string) => {
    const from = PALETTES[settings.paletteId];
    // Özel palet hiç düzenlenmediyse o an seçili hazır paletten başlasın.
    if (id === CUSTOM_PALETTE_ID && from && samePalette(settings.customPalette, DEFAULT_CUSTOM_PALETTE)) {
      update({ paletteId: id, customPalette: { colors: [...from.colors], bg: from.bg } });
    } else {
      update({ paletteId: id });
    }
  };

  return (
    <>
      <div className="palettes" role="radiogroup" aria-label={t('panel.palettes')}>
        {cards.map(({ id, palette }) => {
          const on = settings.paletteId === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`palette-card ${on ? 'palette-card--on' : ''}`}
              style={{ background: palette.bg }}
              onClick={() => choose(id)}
            >
              <span
                className="palette-card__swatch"
                style={{ background: `linear-gradient(90deg, ${palette.colors.join(', ')})` }}
              />
              <span className="palette-card__name">{id === CUSTOM_PALETTE_ID ? t('panel.paletteCustom') : phrase(palette.name)}</span>
            </button>
          );
        })}
      </div>
      {isCustom && (
        <>
          <div className="panel__section">{t('panel.customSection')}</div>
          <p className="panel__hint">{t('panel.customHint')}</p>
          <CustomPaletteEditor value={settings.customPalette} onChange={(p) => update({ customPalette: p })} />
        </>
      )}
    </>
  );
}

function AudioTab({
  source,
  onChangeSource,
  onMicDevice,
}: {
  source: SourceType;
  onChangeSource: () => void;
  onMicDevice: (deviceId: string) => void;
}) {
  useLocale();
  const { settings, update } = useSettings();
  return (
    <>
      <div className="panel__section">{t('panel.section.source')}</div>
      <Row label={t('panel.listening')} value={t(SOURCE_TEXT[source].title)} />
      {source === 'mic' && <MicDeviceRow value={settings.micDeviceId} onChange={onMicDevice} />}
      <ConfirmButton
        label={t('panel.changeSource')}
        question={t('panel.changeSourceQuestion')}
        confirmLabel={t('panel.changeSourceConfirm')}
        onConfirm={onChangeSource}
      />

      <div className="panel__section">{t('panel.section.analysis')}</div>
      <Slider
        label={t('panel.sensitivity')}
        hint={t('panel.sensitivityHint')}
        min={0.2}
        max={3}
        step={0.05}
        value={settings.sensitivity}
        fmt={(v) => `${v.toFixed(2)}x`}
        onChange={(v) => update({ sensitivity: v })}
      />
      <Slider
        label={t('panel.smoothing')}
        hint={t('panel.smoothingHint')}
        min={0}
        max={0.95}
        step={0.05}
        value={settings.smoothing}
        fmt={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => update({ smoothing: v })}
      />
      <Row label={t('panel.fft')} hint={t('panel.fftHint')}>
        <Segmented
          label={t('panel.fftGroup')}
          choices={FFT_SIZES.map(String)}
          index={FFT_SIZES.indexOf(settings.fftSize)}
          onChange={(i) => update({ fftSize: FFT_SIZES[i] })}
        />
      </Row>
    </>
  );
}

function GeneralTab() {
  useLocale();
  const { settings, update, reset } = useSettings();
  return (
    <>
      <div className="panel__section">{t('panel.section.language')}</div>
      <Row label={t('lang.label')}>
        <LanguageSelect />
      </Row>

      <div className="panel__section">{t('panel.section.autoCycle')}</div>
      <Toggle
        label={t('panel.autoCycle')}
        hint={t('panel.autoCycleHint')}
        checked={settings.autoCycle}
        onChange={(v) => update({ autoCycle: v })}
      />
      {settings.autoCycle && (
        <>
          <Slider
            label={t('panel.autoInterval')}
            min={AUTO_CYCLE_SEC.min}
            max={AUTO_CYCLE_SEC.max}
            step={AUTO_CYCLE_SEC.step}
            value={settings.autoCycleSec}
            fmt={fmtSeconds}
            onChange={(v) => update({ autoCycleSec: v })}
          />
          <Row
            label={t('panel.autoScope')}
            hint={
              settings.autoCycleScope === 'favorites' && settings.favorites.length < 2
                ? t('panel.autoScopeHint')
                : undefined
            }
          >
            <Segmented
              label={t('panel.autoScope')}
              choices={[t('panel.autoScopeFavorites'), t('panel.autoScopeAll')]}
              index={settings.autoCycleScope === 'favorites' ? 0 : 1}
              onChange={(i) => update({ autoCycleScope: i === 0 ? 'favorites' : 'all' })}
            />
          </Row>
          <Row label={t('panel.autoOrder')}>
            <Segmented
              label={t('panel.autoOrder')}
              choices={[t('panel.autoOrderRandom'), t('panel.autoOrderSequential')]}
              index={settings.autoCycleShuffle ? 0 : 1}
              onChange={(i) => update({ autoCycleShuffle: i === 0 })}
            />
          </Row>
          <Toggle
            label={t('panel.autoOnBeat')}
            hint={t('panel.autoOnBeatHint')}
            checked={settings.autoCycleOnBeat}
            onChange={(v) => update({ autoCycleOnBeat: v })}
          />
        </>
      )}

      <div className="panel__section">{t('panel.section.display')}</div>
      <Toggle label={t('panel.modeToast')} checked={settings.modeToast} onChange={(v) => update({ modeToast: v })} />
      <Toggle label={t('panel.showFps')} checked={settings.showFps} onChange={(v) => update({ showFps: v })} />

      <div className="panel__section">{t('panel.section.performance')}</div>
      <Row label={t('panel.resolution')} hint={t('panel.resolutionHint')}>
        <Segmented
          label={t('panel.resolution')}
          choices={RESOLUTION_LABELS.map((k) => t(k))}
          index={RESOLUTIONS.indexOf(settings.resolution)}
          onChange={(i) => update({ resolution: RESOLUTIONS[i] })}
        />
      </Row>
      <Row label={t('panel.fpsCap')} hint={t('panel.fpsCapHint')}>
        <Segmented
          label={t('panel.fpsCap')}
          choices={FPS_CAPS.map((c) => (c === 0 ? t('panel.fpsCapUnlimited') : String(c)))}
          index={FPS_CAPS.indexOf(settings.fpsCap)}
          onChange={(i) => update({ fpsCap: FPS_CAPS[i] })}
        />
      </Row>

      <div className="panel__section">{t('panel.section.reset')}</div>
      <ConfirmButton
        label={t('panel.resetAll')}
        question={t('panel.resetAllQuestion')}
        confirmLabel={t('panel.resetAllConfirm')}
        onConfirm={reset}
      />
      <p className="panel__note">{t('panel.savedNote')}</p>
    </>
  );
}

export function SettingsPanel({ modeId, source, tab, onTabChange, onClose, onChangeSource, onMicDevice }: Props) {
  useLocale();
  const meta = modeMeta(modeId);
  const scope: Record<PanelTab, ReactNode> = {
    mode: tNodes('panel.scope.mode', { name: phrase(meta.name) }),
    colors: t('panel.scope.colors'),
    audio: t('panel.scope.audio'),
    general: t('panel.scope.general'),
  };

  return (
    <aside className="panel" aria-label={t('panel.title')}>
      <div className="panel__top">
        <div className="panel__head">
          <h2>{t('panel.title')}</h2>
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            title={`${t('panel.close')} (Esc)`}
            aria-label={t('panel.close')}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="tabs" role="tablist" aria-label={t('panel.tabs')}>
          {TABS.map((tabDef) => (
            <button
              key={tabDef.id}
              type="button"
              role="tab"
              id={`panel-tab-${tabDef.id}`}
              aria-selected={tab === tabDef.id}
              aria-controls="panel-tabpanel"
              className={`tabs__btn ${tab === tabDef.id ? 'tabs__btn--on' : ''}`}
              onClick={() => onTabChange(tabDef.id)}
            >
              {t(tabDef.label)}
            </button>
          ))}
        </div>
        <p className="panel__scope">{scope[tab]}</p>
      </div>

      <div className="panel__body" role="tabpanel" id="panel-tabpanel" aria-labelledby={`panel-tab-${tab}`}>
        {tab === 'mode' && <ModeTab modeId={modeId} />}
        {tab === 'colors' && <ColorsTab />}
        {tab === 'audio' && <AudioTab source={source} onChangeSource={onChangeSource} onMicDevice={onMicDevice} />}
        {tab === 'general' && <GeneralTab />}
      </div>
    </aside>
  );
}
