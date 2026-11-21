// Ortalama penceresi kare sayısıyla değil süreyle tanımlıdır: 60 Hz ve 144 Hz ekranda aynı davranır
// (eski 50 kare / 12 kare sınırları 60 Hz'de ~0,82 sn / 0,2 sn'ye denk geliyordu).
const WINDOW_SEC = 0.82;
const MIN_SPAN_SEC = 0.2;
const CAPACITY = 1024;
const MIN_INTERVAL = 0.25;
const THRESHOLD_FACTOR = 1.35;
const MIN_ENERGY = 0.1;
const DECAY_PER_SEC = 2.2;

export class BeatDetector {
  // Halka tampon: (zaman, enerji) örnekleri, en eskisi `head`'de.
  private times = new Float64Array(CAPACITY);
  private energies = new Float64Array(CAPACITY);
  private head = 0;
  private count = 0;
  private sum = 0;
  private lastBeat = -Infinity;
  pulse = 0;

  update(energy: number, time: number, dt: number): boolean {
    if (this.count === CAPACITY) this.dropOldest();
    const idx = (this.head + this.count) % CAPACITY;
    this.times[idx] = time;
    this.energies[idx] = energy;
    this.count++;
    this.sum += energy;
    while (this.count > 1 && time - this.times[this.head] > WINDOW_SEC) this.dropOldest();
    const avg = this.sum / this.count;

    let beat = false;
    if (
      time - this.times[this.head] >= MIN_SPAN_SEC &&
      energy > avg * THRESHOLD_FACTOR &&
      energy > MIN_ENERGY &&
      time - this.lastBeat > MIN_INTERVAL
    ) {
      beat = true;
      this.lastBeat = time;
      this.pulse = 1;
    }
    this.pulse = Math.max(0, this.pulse - DECAY_PER_SEC * dt);
    return beat;
  }

  private dropOldest(): void {
    this.sum -= this.energies[this.head];
    this.head = (this.head + 1) % CAPACITY;
    this.count--;
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
    this.sum = 0;
    this.lastBeat = -Infinity;
    this.pulse = 0;
  }
}
