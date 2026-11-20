import { binAtLerp } from './palettes';
import type { AudioFrame } from '../audio/types';
import { damp } from './util';

/**
 * Bas vermeyen / ritmi zayıf müzikte `frame.beat` gelmeyebilir; spektral akı (32 bantta pozitif artışların toplamı) herhangi bir
 * bantta ani yükselişi yakalar. `update` her karede çağrılır; onset olduğunda true döner (bekleme süresi kendiliğinden işler).
 */
export class OnsetTracker {
  private prev = new Float32Array(32);
  private avg = 0.1;
  private cooldown = 0;
  /** Son karedeki akı ve akı/ortalama oranı (şiddet tahmini için). */
  flux = 0;
  ratio = 0;

  update(frame: AudioFrame, dt: number, minRatio = 2.0, cooldown = 0.5): boolean {
    let flux = 0;
    for (let i = 0; i < 32; i++) {
      const v = binAtLerp(frame.freq, i / 31);
      flux += Math.max(0, v - this.prev[i]);
      this.prev[i] += (v - this.prev[i]) * damp(dt, 14);
    }
    this.avg += (flux - this.avg) * damp(dt, 1.2);
    this.cooldown -= dt;
    this.flux = flux;
    this.ratio = flux / (this.avg + 0.05);
    if (this.cooldown <= 0 && flux > 0.12 && this.ratio > minRatio) {
      this.cooldown = cooldown;
      return true;
    }
    return false;
  }
}

/**
 * Olay şiddetini MÜZİĞİN KENDİ ortalamasına göre ölçer (bas hep yüksek olsa bile çeşitlenir): ortalamanın üstü → 1'e, altı → 0'a yakın.
 */
export class EventScale {
  private avg = 0.3;
  private peak = 0.5;

  tick(dt: number): void {
    this.peak = Math.max(this.avg + 0.12, this.peak - dt * 0.03);
  }

  rel(e: number): number {
    this.peak = Math.max(e, this.peak);
    const spread = Math.max(0.12, this.peak - this.avg);
    const pw = Math.min(1, Math.max(0, 0.5 + 0.5 * ((e - this.avg) / spread)));
    this.avg += (e - this.avg) * 0.15;
    return pw;
  }
}
