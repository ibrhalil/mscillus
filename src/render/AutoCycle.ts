import { MODES } from '../visuals/registry';
import type { ModeId } from '../visuals/registry';

/** Süre dolduktan sonra vuruş en fazla bu kadar beklenir (vuruşsuz / sessiz müzikte geçiş takılmasın). */
const MAX_BEAT_WAIT = 4;

/** Otomatik mod geçişinin zamanlayıcısı: süre dolunca (isteğe bağlı olarak sıradaki vuruşta) geçiş ister. */
export class AutoCycleTimer {
  private elapsed = 0;

  reset(): void {
    this.elapsed = 0;
  }

  /** Geçiş zamanı geldiyse true döner ve sayacı sıfırlar. */
  tick(dt: number, interval: number, beat: boolean, waitForBeat: boolean): boolean {
    this.elapsed += dt;
    if (this.elapsed < interval) return false;
    if (waitForBeat && !beat && this.elapsed < interval + MAX_BEAT_WAIT) return false;
    this.elapsed = 0;
    return true;
  }
}

export type CycleScope = 'favorites' | 'all';

/** Geçiş havuzu: "Favoriler" seçiliyse ve en az 2 favori varsa favoriler, değilse tüm modlar. */
export function cyclePool(scope: CycleScope, favorites: readonly ModeId[]): readonly ModeId[] {
  if (scope === 'favorites' && favorites.length >= 2) return favorites;
  return MODES.map((m) => m.id);
}

/** Sıradaki modu seçer: sıralı (havuzda bir sonraki) veya karışık (torba: havuzdaki her mod bir kez gösterilmeden tekrar yok). */
export class ModeShuffler {
  private bag: ModeId[] = [];

  constructor(private random: () => number = Math.random) {}

  next(current: ModeId, pool: readonly ModeId[], shuffle: boolean): ModeId {
    if (pool.length === 0) return current;
    if (!shuffle) return pool[(pool.indexOf(current) + 1) % pool.length];
    // Havuz değişmiş olabilir (favori eklendi/çıkarıldı): torbada artık havuzda olmayanları at.
    this.bag = this.bag.filter((id) => id !== current && pool.includes(id));
    if (this.bag.length === 0) this.bag = pool.filter((id) => id !== current);
    if (this.bag.length === 0) return current;
    const [id] = this.bag.splice(Math.floor(this.random() * this.bag.length), 1);
    return id;
  }
}
