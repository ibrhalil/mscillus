export type RepeatMode = 'off' | 'all' | 'one';

/**
 * Çalma listesi sırası: tekrar / karıştırma kuralları. Öğelerin kendisiyle ilgilenmez; yalnızca hangi dizinin
 * çalınacağına karar verir (AudioEngine dosyayı yükler).
 */
export class Playlist<T> {
  private items: T[] = [];
  private history: number[] = [];
  /** Karıştırmada bu turda henüz çalınmamış dizinler (her parça bir kez çalınmadan tekrar yok). */
  private bag: number[] = [];
  index = -1;
  repeat: RepeatMode = 'off';
  shuffle = false;

  constructor(private random: () => number = Math.random) {}

  get length(): number {
    return this.items.length;
  }

  get current(): T | undefined {
    return this.items[this.index];
  }

  get all(): readonly T[] {
    return this.items;
  }

  set(items: readonly T[]): void {
    this.items = [...items];
    this.index = this.items.length > 0 ? 0 : -1;
    this.history = [];
    this.refillBag();
  }

  add(items: readonly T[]): void {
    const start = this.items.length;
    this.items.push(...items);
    for (let i = start; i < this.items.length; i++) this.bag.push(i);
    if (this.index < 0 && this.items.length > 0) this.index = 0;
  }

  /** Çalan parça dışındaki bir parçayı listeden çıkarır; çıkarıldıysa true. */
  remove(i: number): boolean {
    if (i === this.index || i < 0 || i >= this.items.length) return false;
    this.items.splice(i, 1);
    if (i < this.index) this.index--;
    const shift = (list: number[]) => list.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x));
    this.bag = shift(this.bag);
    this.history = shift(this.history);
    return true;
  }

  setShuffle(on: boolean): void {
    this.shuffle = on;
    this.history = [];
    this.refillBag();
  }

  /**
   * Sıradaki parçaya geçer ve dizinini döndürür. `auto`: parça kendiliğinden bitti (tekrar kuralları uygulanır);
   * liste bittiyse ve tekrar kapalıysa null. Elle "sonraki" listenin sonunda başa sarar.
   */
  next(auto: boolean): number | null {
    if (this.items.length === 0) return null;
    if (auto && this.repeat === 'one') return this.index;
    if (this.shuffle) {
      if (this.bag.length === 0) {
        if (auto && this.repeat === 'off') return null;
        this.refillBag();
      }
      if (this.bag.length === 0) return this.index;
      const [i] = this.bag.splice(Math.floor(this.random() * this.bag.length), 1);
      this.history.push(this.index);
      this.index = i;
      return i;
    }
    if (this.index + 1 >= this.items.length) {
      if (auto && this.repeat === 'off') return null;
      this.index = 0;
      return 0;
    }
    return ++this.index;
  }

  /** Önceki parça: karıştırmada çalınma geçmişi, değilse listede bir önceki (başta sona sarar). */
  prev(): number | null {
    if (this.items.length === 0) return null;
    const back = this.shuffle ? this.history.pop() : undefined;
    this.index = back ?? (this.index - 1 + this.items.length) % this.items.length;
    return this.index;
  }

  /** Belirli bir parçaya atlar. */
  jump(i: number): number | null {
    if (i < 0 || i >= this.items.length) return null;
    if (this.shuffle && i !== this.index) {
      this.history.push(this.index);
      this.bag = this.bag.filter((x) => x !== i);
    }
    this.index = i;
    return i;
  }

  private refillBag(): void {
    this.bag = [];
    for (let i = 0; i < this.items.length; i++) if (i !== this.index) this.bag.push(i);
  }
}
