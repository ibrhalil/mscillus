import { rgba, sampleGradient } from './palettes';
import { clearFrame, lighten } from './util';
import type { Visualizer, VisualizerSettingsView } from './types';
import type { AudioFrame } from '../audio/types';

const NAMES_EN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAMES_TR = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const IS_BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];
/** Spektrumda en güçlü tepeye göre bu oranın altındaki tepeler nota sayılmaz. */
const RELATIVE_FLOOR = 0.5;
/** Nota, son tespitten sonra bu kadar süre (sn) basılı kalır; kısa kesintilerde parçalanmayı önler. */
const HOLD = 0.07;
const TOP_PAD = 30;
const BOTTOM_PAD = 8;

interface Segment {
  midi: number;
  start: number;
  end: number;
  v: number;
}

const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
/** Aynı perde sınıfı (do, re…) farklı oktavlarda aynı renk; B→C geçişi dikişsiz. */
const pitchClassT = (pc: number): number => 1 - Math.abs(2 * (pc / 12) - 1);

/**
 * Yatay piyano rulosu: spektrumdaki tepeleri gerçek nota perdelerine (MIDI) çevirir, o an çalanları
 * klavyede basılı gösterir; geçmiş, klavyeden uzağa doğru yatay akar.
 */
export class NoteWaterfall implements Visualizer {
  private ctx: CanvasRenderingContext2D;
  private segments: Segment[] = [];
  private open = new Map<number, Segment>();
  private lastSeen = new Map<number, number>();
  private clock = 0;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  init(): void {}

  resize(): void {}

  dispose(): void {
    this.segments = [];
    this.open.clear();
    this.lastSeen.clear();
  }

  /**
   * Spektrum tepelerini parabolik interpolasyonla frekansa, oradan en yakın MIDI notasına çevirir.
   * Dönen harita: nota → güç (0..1). Düşük notalarda (≈ 130 Hz altı) FFT çözünürlüğü sınırlıdır.
   */
  private detect(
    frame: AudioFrame,
    low: number,
    high: number,
    threshold: number,
    maxNotes: number,
    suppressHarmonics: boolean,
  ): Map<number, number> {
    const len = frame.freq.length;
    const binHz = frame.sampleRate / (2 * len);
    const iLo = Math.max(2, Math.floor(midiToHz(low - 0.5) / binHz));
    const iHi = Math.min(len - 2, Math.ceil(midiToHz(high + 0.5) / binHz));
    const cands = new Map<number, number>();
    let maxV = 0;
    for (let i = iLo; i <= iHi; i++) {
      const a = frame.freq[i - 1];
      const b = frame.freq[i];
      const c = frame.freq[i + 1];
      if (b < a || b <= c) continue;
      const v = b / 255;
      if (v < threshold) continue;
      const denom = a - 2 * b + c;
      const delta = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
      const hz = (i + delta) * binHz;
      const midi = Math.round(69 + 12 * Math.log2(hz / 440));
      if (midi < low || midi > high) continue;
      if (v > (cands.get(midi) ?? 0)) cands.set(midi, v);
      if (v > maxV) maxV = v;
    }
    for (const [n, v] of cands) if (v < maxV * RELATIVE_FLOOR) cands.delete(n);

    // Armonikler: daha alçak bir notanın oktav/beşli üstündeki, ondan zayıf tepeler gerçek nota değil
    if (suppressHarmonics) {
      const ordered = [...cands.keys()].sort((x, y) => x - y);
      for (const n of ordered) {
        const v = cands.get(n) as number;
        for (const d of [12, 19, 24, 28]) {
          const below = cands.get(n - d);
          if (below !== undefined && below >= v) {
            cands.delete(n);
            break;
          }
        }
      }
    }

    const top = [...cands.entries()].sort((x, y) => y[1] - x[1]).slice(0, maxNotes);
    return new Map(top);
  }

  update(frame: AudioFrame, s: VisualizerSettingsView, w: number, h: number): void {
    const ctx = this.ctx;
    const o = s.opt;
    clearFrame(ctx, s.palette.bg, w, h);
    this.clock += frame.dt;

    const octaves = Math.round(o.octaves);
    const low = 12 * (Math.round(o.octave) + 1);
    const rows = octaves * 12;
    const high = low + rows - 1;
    const names = Math.round(o.naming) === 0 ? NAMES_EN : NAMES_TR;
    const noteName = (n: number) => `${names[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;

    // --- Tespit + basılı tutma (histerezis) ---
    const found = this.detect(frame, low, high, o.threshold, Math.round(o.maxNotes), o.harmonics >= 0.5);
    for (const [n, v] of found) {
      this.lastSeen.set(n, this.clock);
      const seg = this.open.get(n);
      if (seg) {
        seg.end = this.clock;
        if (v > seg.v) seg.v = v;
      } else {
        const fresh: Segment = { midi: n, start: this.clock, end: this.clock, v };
        this.segments.push(fresh);
        this.open.set(n, fresh);
      }
    }
    for (const [n, seg] of this.open) {
      if (found.has(n)) continue;
      if (this.clock - (this.lastSeen.get(n) ?? 0) > HOLD) this.open.delete(n);
      else seg.end = this.clock;
    }

    // --- Yerleşim: klavye bir kenarda, geçmiş ondan uzağa akar ---
    const kbRight = Math.round(o.keyboard) === 0;
    const kbW = Math.min(116, Math.max(64, w * 0.1));
    const dir = kbRight ? -1 : 1;
    const nowX = kbRight ? w - kbW : kbW;
    const kbX = kbRight ? w - kbW : 0;
    const showHud = o.hud >= 0.5;
    const top = showHud ? TOP_PAD : BOTTOM_PAD;
    const rowH = (h - top - BOTTOM_PAD) / rows;
    const rowY = (n: number) => h - BOTTOM_PAD - (n - low + 1) * rowH;
    const pxPerSec = o.scroll;
    const rollL = kbRight ? 0 : kbW;
    const rollR = kbRight ? w - kbW : w;

    // Satır zemini: siyah notalar biraz koyu, her C'de ince çizgi
    for (let n = low; n <= high; n++) {
      const pc = n % 12;
      ctx.fillStyle = IS_BLACK[pc] ? 'rgba(255,255,255,0.045)' : 'rgba(255,255,255,0.012)';
      ctx.fillRect(rollL, rowY(n), rollR - rollL, rowH);
      if (pc === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(rollL, rowY(n) + rowH - 1, rollR - rollL, 1);
      }
    }

    // --- Geçmiş: her nota bir yatay çubuk ---
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.max(8, Math.min(12, rowH - 3))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    let write = 0;
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      const xOld = nowX + dir * (this.clock - seg.start) * pxPerSec;
      const xNew = nowX + dir * (this.clock - seg.end) * pxPerSec;
      const xl = Math.min(xOld, xNew);
      const xr = Math.max(xOld, xNew);
      const farEdge = kbRight ? xr : xl;
      const gone = kbRight ? farEdge < rollL : farEdge > rollR;
      if (gone) continue;
      this.segments[write++] = seg;

      const cl = Math.max(rollL, xl);
      const cr = Math.min(rollR, xr);
      const bw = Math.max(3, cr - cl);
      const y = rowY(seg.midi);
      const color = sampleGradient(s.palette.colors, pitchClassT(seg.midi % 12));
      const isOpen = this.open.get(seg.midi) === seg;
      if (s.glow) {
        ctx.fillStyle = rgba(color, 0.14);
        ctx.beginPath();
        ctx.roundRect(cl - 2, y - 1, bw + 4, rowH + 2, 5);
        ctx.fill();
      }
      ctx.fillStyle = rgba(color, 0.4 + 0.55 * Math.min(1, seg.v));
      ctx.beginPath();
      ctx.roundRect(cl, y + 1, bw, Math.max(2, rowH - 2), 3);
      ctx.fill();
      if (isOpen) {
        ctx.fillStyle = rgba(lighten(color, 0.6), 0.95);
        ctx.fillRect(kbRight ? cr - 3 : cl, y + 1, 3, Math.max(2, rowH - 2));
      }
      if (o.labels >= 0.5 && bw > 34 && rowH >= 10) {
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.textAlign = 'left';
        ctx.fillText(noteName(seg.midi), cl + 5, y + rowH / 2 + 0.5);
      }
    }
    this.segments.length = write;

    // --- Klavye: çalan notalar basılı ---
    ctx.textBaseline = 'middle';
    for (let n = low; n <= high; n++) {
      const pc = n % 12;
      const black = IS_BLACK[pc];
      const pressed = this.open.has(n);
      const color = sampleGradient(s.palette.colors, pitchClassT(pc));
      const y = rowY(n);
      // Beyaz tuşlar tam genişlik (siyahlar ikinci turda, üstlerine, dış kenara yaslı ve kısa çizilir)
      if (!black) {
        ctx.fillStyle = pressed ? rgba(lighten(color, 0.35), 1) : 'rgba(235,238,245,0.92)';
        ctx.fillRect(kbX, y, kbW, rowH);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(kbX, y + rowH - 1, kbW, 1);
      }
    }
    for (let n = low; n <= high; n++) {
      const pc = n % 12;
      if (!IS_BLACK[pc]) continue;
      const pressed = this.open.has(n);
      const color = sampleGradient(s.palette.colors, pitchClassT(pc));
      const keyW = kbW * 0.62;
      const kx = kbRight ? kbX + (kbW - keyW) : kbX;
      ctx.fillStyle = pressed ? rgba(color, 1) : 'rgba(18,20,28,0.96)';
      ctx.fillRect(kx, rowY(n), keyW, rowH);
    }
    if (o.labels >= 0.5) {
      ctx.font = `600 ${Math.max(8, Math.min(11, rowH - 3))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = kbRight ? 'right' : 'left';
      const lx = kbRight ? kbX + kbW - 5 : kbX + 5;
      for (let n = low; n <= high; n++) {
        const pc = n % 12;
        const pressed = this.open.has(n);
        if (!(pc === 0 || pressed) || rowH < 9) continue;
        ctx.fillStyle = pressed ? 'rgba(0,0,0,0.85)' : 'rgba(40,44,56,0.8)';
        if (IS_BLACK[pc] && !pressed) continue;
        ctx.fillText(noteName(n), lx, rowY(n) + rowH / 2 + 0.5);
      }
    }
    // Klavye ile rulo arasında "şimdi" çizgisi
    const accent = sampleGradient(s.palette.colors, 0.5);
    ctx.fillStyle = rgba(accent, 0.35 + frame.beatPulse * 0.4);
    ctx.fillRect(nowX - 1, top, 2, h - top - BOTTOM_PAD);

    // --- Üst bilgi: şu an çalan notalar ---
    if (showHud) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = '600 15px ui-monospace, SFMono-Regular, Menlo, monospace';
      const playing = [...this.open.keys()].sort((a, b) => a - b).map(noteName);
      ctx.fillStyle = rgba(lighten(accent, 0.4), playing.length ? 0.95 : 0.4);
      ctx.fillText(playing.length ? playing.join('  ') : '—', rollL + 12, 20);
    }

    if (frame.beatPulse > 0.05) {
      ctx.fillStyle = rgba(accent, 0.05 * frame.beatPulse);
      ctx.fillRect(rollL, top, rollR - rollL, h - top - BOTTOM_PAD);
    }
  }
}
