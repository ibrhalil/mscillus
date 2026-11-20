export type SourceType = 'tab' | 'system' | 'file' | 'mic';

export interface AudioFrame {
  freq: Uint8Array;
  wave: Uint8Array;
  bass: number;
  mid: number;
  treble: number;
  level: number;
  beat: boolean;
  beatPulse: number;
  dt: number;
  sampleRate: number;
  time: number;
}
