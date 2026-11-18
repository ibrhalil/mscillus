const HISTORY_SIZE = 50;
const MIN_HISTORY = 12;
const MIN_INTERVAL = 0.25;
const THRESHOLD_FACTOR = 1.35;
const MIN_ENERGY = 0.1;
const DECAY_PER_SEC = 2.2;

export class BeatDetector {
  private history: number[] = [];
  private lastBeat = -Infinity;
  pulse = 0;

  update(energy: number, time: number, dt: number): boolean {
    this.history.push(energy);
    if (this.history.length > HISTORY_SIZE) this.history.shift();
    let sum = 0;
    for (const e of this.history) sum += e;
    const avg = sum / this.history.length;

    let beat = false;
    if (
      this.history.length >= MIN_HISTORY &&
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

  reset(): void {
    this.history = [];
    this.lastBeat = -Infinity;
    this.pulse = 0;
  }
}
