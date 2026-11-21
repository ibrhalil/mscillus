import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import type { SourceType } from '../audio/types';
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

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'mode', label: 'Bu Mod' },
  { id: 'colors', label: 'Renkler' },
  { id: 'audio', label: 'Ses' },
  { id: 'general', label: 'Genel' },
];

const SOURCE_LABELS: Record<SourceType, string> = {
  tab: 'Tarayıcı Sekmesi',
  system: 'Sistem Sesi',
  file: 'Yerel Dosya',
  mic: 'Mikrofon',
};

const RESOLUTION_LABELS = ['Otomatik', 'Yüksek', 'Dengeli', 'Düşük'];
const FPS_CAP_LABELS = ['Sınırsız', '60', '30'];

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
  if (v < 60) return `${v} sn`;
  const m = Math.floor(v / 60);
  const rest = v % 60;
  return rest ? `${m} dk ${rest} sn` : `${m} dk`;
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
          Vazgeç
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
        <select value={value} aria-label={def.label} onChange={(e) => onChange(Number(e.target.value))}>
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

function CustomPaletteEditor({ value, onChange }: { value: CustomPalette; onChange: (p: CustomPalette) => void }) {
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
            aria-label={`Renk ${i + 1}`}
            onChange={(e) => setColor(i, e.target.value)}
          />
        ))}
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          title="Renk ekle"
          aria-label="Renk ekle"
          disabled={value.colors.length >= CUSTOM_COLORS_MAX}
          onClick={() => onChange({ ...value, colors: [...value.colors, value.colors[value.colors.length - 1]] })}
        >
          +
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          title="Son rengi çıkar"
          aria-label="Son rengi çıkar"
          disabled={value.colors.length <= CUSTOM_COLORS_MIN}
          onClick={() => onChange({ ...value, colors: value.colors.slice(0, -1) })}
        >
          −
        </button>
      </div>
      <label className="palette-editor__bg">
        Arka plan rengi
        <input type="color" value={value.bg} onChange={(e) => onChange({ ...value, bg: e.target.value })} />
      </label>
    </div>
  );
}

function MicDeviceRow({ value, onChange }: { value: string; onChange: (id: string) => void }) {
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
    <Row
      label="Giriş Aygıtı"
      hint={'macOS\'ta sistem sesi için "BlackHole 2ch"i seçin; sistemin giriş ayarını değiştirmeniz gerekmez.'}
    >
      <select value={known ? value : ''} aria-label="Giriş Aygıtı" onChange={(e) => onChange(e.target.value)}>
        <option value="">Sistem varsayılanı</option>
        {listed.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Giriş ${i + 1}`}
          </option>
        ))}
      </select>
    </Row>
  );
}

function ModeTab({ modeId }: { modeId: ModeId }) {
  const { settings, setModeOption, resetMode } = useSettings();
  const meta = modeMeta(modeId);
  const values = modeOptionValues(settings, modeId);
  const customized = Object.keys(settings.modeOptions[modeId] ?? {}).length > 0;
  return (
    <>
      <div className="panel__mode">
        <span className="panel__mode-name">{meta.name}</span>
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
        Bu Modu Varsayılana Döndür
      </button>
    </>
  );
}

function ColorsTab() {
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
      <div className="palettes" role="radiogroup" aria-label="Renk paleti">
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
              <span className="palette-card__name">{id === CUSTOM_PALETTE_ID ? 'Özel (kendin seç)' : palette.name}</span>
            </button>
          );
        })}
      </div>
      {isCustom && (
        <>
          <div className="panel__section">Özel Palet</div>
          <p className="panel__hint">
            Renkler soldan sağa sırayla birbirine geçer; modlar renklerini bu geçişten alır. 2–6 renk seçebilirsiniz.
          </p>
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
  const { settings, update } = useSettings();
  return (
    <>
      <div className="panel__section">Ses Kaynağı</div>
      <Row label="Şu an dinlenen" value={SOURCE_LABELS[source]} />
      {source === 'mic' && <MicDeviceRow value={settings.micDeviceId} onChange={onMicDevice} />}
      <ConfirmButton
        label="Kaynağı Değiştir…"
        question="Müzik durur ve kaynak seçim ekranına dönülür. Devam edilsin mi?"
        confirmLabel="Evet, değiştir"
        onConfirm={onChangeSource}
      />

      <div className="panel__section">Ses Analizi</div>
      <Slider
        label="Tepki Gücü (Hassasiyet)"
        hint="Görsellerin sese ne kadar güçlü tepki vereceği. Duyulan sesi değiştirmez."
        min={0.2}
        max={3}
        step={0.05}
        value={settings.sensitivity}
        fmt={(v) => `${v.toFixed(2)}x`}
        onChange={(v) => update({ sensitivity: v })}
      />
      <Slider
        label="Yumuşatma"
        hint="Yüksek: daha akıcı, sakin hareket. Düşük: daha ani, keskin tepki."
        min={0}
        max={0.95}
        step={0.05}
        value={settings.smoothing}
        fmt={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => update({ smoothing: v })}
      />
      <Row
        label="Frekans Ayrıntısı (FFT)"
        hint="Yüksek değer frekansları daha ince ayırır ama tepkiyi biraz geciktirir."
      >
        <Segmented
          label="Frekans Ayrıntısı"
          choices={FFT_SIZES.map(String)}
          index={FFT_SIZES.indexOf(settings.fftSize)}
          onChange={(i) => update({ fftSize: FFT_SIZES[i] })}
        />
      </Row>
    </>
  );
}

function GeneralTab() {
  const { settings, update, reset } = useSettings();
  return (
    <>
      <div className="panel__section">Otomatik Mod Geçişi</div>
      <Toggle
        label="Modları Kendiliğinden Değiştir"
        hint="Belirli aralıklarla bir sonraki moda geçer. Üst çubuktaki ↻ düğmesiyle de açılıp kapanır."
        checked={settings.autoCycle}
        onChange={(v) => update({ autoCycle: v })}
      />
      {settings.autoCycle && (
        <>
          <Slider
            label="Geçiş Süresi"
            min={AUTO_CYCLE_SEC.min}
            max={AUTO_CYCLE_SEC.max}
            step={AUTO_CYCLE_SEC.step}
            value={settings.autoCycleSec}
            fmt={fmtSeconds}
            onChange={(v) => update({ autoCycleSec: v })}
          />
          <Row
            label="Hangi Modlar"
            hint={
              settings.autoCycleScope === 'favorites' && settings.favorites.length < 2
                ? 'Favoriler arasında geçiş için en az 2 favori (★) gerekli; şimdilik tüm modlar kullanılıyor.'
                : undefined
            }
          >
            <Segmented
              label="Hangi Modlar"
              choices={['Favoriler', 'Tüm Modlar']}
              index={settings.autoCycleScope === 'favorites' ? 0 : 1}
              onChange={(i) => update({ autoCycleScope: i === 0 ? 'favorites' : 'all' })}
            />
          </Row>
          <Row label="Sıra">
            <Segmented
              label="Sıra"
              choices={['Rastgele', 'Sıralı']}
              index={settings.autoCycleShuffle ? 0 : 1}
              onChange={(i) => update({ autoCycleShuffle: i === 0 })}
            />
          </Row>
          <Toggle
            label="Vuruşta Geç"
            hint="Süre dolunca geçiş için müziğin bir sonraki vuruşunu bekler."
            checked={settings.autoCycleOnBeat}
            onChange={(v) => update({ autoCycleOnBeat: v })}
          />
        </>
      )}

      <div className="panel__section">Ekran</div>
      <Toggle
        label="Mod Değişince Adını Göster"
        checked={settings.modeToast}
        onChange={(v) => update({ modeToast: v })}
      />
      <Toggle label="FPS Göstergesi" checked={settings.showFps} onChange={(v) => update({ showFps: v })} />

      <div className="panel__section">Performans</div>
      <Row
        label="Çözünürlük"
        hint="Otomatik: görüntü takılmaya başlarsa çözünürlüğü kendiliğinden düşürür, rahatlayınca geri yükseltir."
      >
        <Segmented
          label="Çözünürlük"
          choices={RESOLUTION_LABELS}
          index={RESOLUTIONS.indexOf(settings.resolution)}
          onChange={(i) => update({ resolution: RESOLUTIONS[i] })}
        />
      </Row>
      <Row label="FPS Sınırı" hint="Düşük sınır pil tüketimini ve ısınmayı azaltır.">
        <Segmented
          label="FPS Sınırı"
          choices={FPS_CAP_LABELS}
          index={FPS_CAPS.indexOf(settings.fpsCap)}
          onChange={(i) => update({ fpsCap: FPS_CAPS[i] })}
        />
      </Row>

      <div className="panel__section">Sıfırlama</div>
      <ConfirmButton
        label="Tüm Ayarları Sıfırla…"
        question="Tüm modların ayarları, favoriler, renk paleti ve genel ayarlar varsayılana döner. Emin misiniz?"
        confirmLabel="Evet, sıfırla"
        onConfirm={reset}
      />
      <p className="panel__note">Ayarlar bu tarayıcıda otomatik kaydedilir.</p>
    </>
  );
}

export function SettingsPanel({ modeId, source, tab, onTabChange, onClose, onChangeSource, onMicDevice }: Props) {
  const meta = modeMeta(modeId);
  const scope: Record<PanelTab, ReactNode> = {
    mode: (
      <>
        Yalnızca <strong>{meta.name}</strong> modunu etkiler. Her modun ayarları ayrı saklanır.
      </>
    ),
    colors: 'Seçtiğiniz renk paleti tüm modlarda kullanılır.',
    audio: 'Hangi sesin dinlendiği ve görsellerin sese nasıl tepki verdiği — tüm modlarda geçerli.',
    general: 'Otomatik mod geçişi, ekran ve performans — tüm uygulama için.',
  };

  return (
    <aside className="panel" aria-label="Ayarlar">
      <div className="panel__top">
        <div className="panel__head">
          <h2>Ayarlar</h2>
          <button type="button" className="btn btn--ghost btn--icon" title="Kapat (Esc)" aria-label="Kapat" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="tabs" role="tablist" aria-label="Ayar grupları">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`panel-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="panel-tabpanel"
              className={`tabs__btn ${tab === t.id ? 'tabs__btn--on' : ''}`}
              onClick={() => onTabChange(t.id)}
            >
              {t.label}
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
