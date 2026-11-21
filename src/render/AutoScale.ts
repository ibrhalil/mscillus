/** Otomatik çözünürlüğün basamakları (cihaz piksel oranının çarpanı). */
export const AUTO_STEPS = [1, 0.85, 0.7, 0.6, 0.5] as const;

const LOW_RATIO = 0.85; // hedefin altına düşünce küçült
const HIGH_RATIO = 0.95; // hedefe yetişince (bir süre) büyüt
const LOW_WINDOWS = 2; // küçültmeden önce art arda düşük ölçüm sayısı
const COOLDOWN = 2; // değişimden sonra ölçülmeyen pencere sayısı (yeniden boyutlama takılması)
const MIN_GAIN = 1.08; // küçültme en az bu kadar FPS kazandırmalı, yoksa geri alınır
const BLOCK_START = 30;
const BLOCK_MAX = 300;
const UP_HOLD_START = 4;
const UP_HOLD_MAX = 60;
const BOUNCE_WINDOW = 10;

/**
 * FPS'e bakarak çözünürlük basamağını seçer. Saniyede bir ölçer; hedefin altında kalırsa küçültür, rahatsa geri büyütür.
 * Küçültme FPS'i artırmıyorsa (tarayıcı 30 FPS'e kısıtlıyor, darboğaz işlemci vb.) geri alır ve bir süre denemez;
 * büyütür büyütmez yeniden düşüyorsa büyütmeden önce daha uzun bekler (salınım olmasın).
 */
export class AutoScale {
  level = 0;
  private clock = 0;
  private acc = 0;
  private frames = 0;
  private cooldown = COOLDOWN;
  private lowCount = 0;
  private goodFor = 0;
  private upHold = UP_HOLD_START;
  private lastUpAt = -Infinity;
  private fpsBeforeDrop = 0;
  private blockedUntil = 0;
  private blockFor = BLOCK_START;

  get scale(): number {
    return AUTO_STEPS[this.level];
  }

  /** Mod değişince: o modun hatırlanan basamağından başla, yükleme takılmasını ölçme. */
  reset(level = 0): void {
    this.level = Math.min(AUTO_STEPS.length - 1, Math.max(0, level));
    this.acc = 0;
    this.frames = 0;
    this.cooldown = COOLDOWN;
    this.lowCount = 0;
    this.goodFor = 0;
    this.fpsBeforeDrop = 0;
  }

  /** Gerçek kare süresini (sn) ekler; basamak değiştiyse true döner. `target`: hedef FPS. */
  tick(realDt: number, target: number): boolean {
    if (!(realDt > 0) || realDt > 0.5) return false; // sekme gizliydi / takılma
    this.clock += realDt;
    this.acc += realDt;
    this.frames++;
    if (this.acc < 1) return false;
    const fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;
    return this.evaluate(fps, target);
  }

  private evaluate(fps: number, target: number): boolean {
    if (this.cooldown > 0) {
      this.cooldown--;
      return false;
    }
    if (this.fpsBeforeDrop > 0) {
      const before = this.fpsBeforeDrop;
      this.fpsBeforeDrop = 0;
      if (fps < before * MIN_GAIN) {
        // Küçültme işe yaramadı: geri al, bir süre (giderek uzayan) yeniden deneme.
        this.level--;
        this.blockedUntil = this.clock + this.blockFor;
        this.blockFor = Math.min(BLOCK_MAX, this.blockFor * 2);
        this.cooldown = COOLDOWN;
        return true;
      }
    }
    if (fps < target * LOW_RATIO) {
      this.goodFor = 0;
      if (++this.lowCount < LOW_WINDOWS || this.clock < this.blockedUntil || this.level >= AUTO_STEPS.length - 1) {
        return false;
      }
      if (this.clock - this.lastUpAt < BOUNCE_WINDOW) this.upHold = Math.min(UP_HOLD_MAX, this.upHold * 2);
      this.level++;
      this.lowCount = 0;
      this.fpsBeforeDrop = fps;
      this.cooldown = COOLDOWN;
      return true;
    }
    this.lowCount = 0;
    if (fps >= target * HIGH_RATIO) {
      if (++this.goodFor >= this.upHold && this.level > 0) {
        this.level--;
        this.goodFor = 0;
        this.lastUpAt = this.clock;
        this.cooldown = COOLDOWN;
        return true;
      }
    } else {
      this.goodFor = 0;
    }
    return false;
  }
}
