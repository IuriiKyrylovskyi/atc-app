/**
 * Controller audio between the microphone and a speech-to-text model:
 * resampling to the model rate and trimming silence (speech models invent words
 * in silence — Whisper's "Thank you." — and long silence costs inference time).
 */
import type { PcmAudio } from '../tts/kokoro';

/** Speech models (Moonshine, Whisper) take 16 kHz mono. */
export const STT_SAMPLE_RATE = 16000;

/**
 * Resamples mono PCM. Downsampling averages each output step's input span (a box
 * low-pass, enough against aliasing for speech recognition); upsampling interpolates.
 */
export function resample(samples: Float32Array, fromRate: number, toRate = STT_SAMPLE_RATE): Float32Array {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  if (ratio > 1) {
    for (let i = 0; i < out.length; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = start; j < end; j++) sum += samples[j]!;
      out[i] = end > start ? sum / (end - start) : 0;
    }
  } else {
    for (let i = 0; i < out.length; i++) {
      const x = i * ratio;
      const j = Math.floor(x);
      const a = samples[j] ?? 0;
      const b = samples[j + 1] ?? a;
      out[i] = a + (b - a) * (x - j);
    }
  }
  return out;
}

export interface TrimOptions {
  /** Analysis frame, s. */
  frameS?: number;
  /** Speech threshold above the quietest frames, dB. */
  marginDb?: number;
  /** Frames below this RMS are never speech (dBFS). */
  floorDbfs?: number;
  /** Frames above this RMS are always speech, even with no quiet frame to measure noise by (dBFS). */
  ceilingDbfs?: number;
  /** Less speech than this is a key click / breath, not a transmission (s). */
  minSpeechS?: number;
  /** Kept around the speech so word edges are not clipped (s). */
  padS?: number;
}

const rmsDb = (s: Float32Array, start: number, end: number): number => {
  let sum = 0;
  for (let i = start; i < end; i++) sum += s[i]! * s[i]!;
  return 10 * Math.log10(sum / Math.max(1, end - start) + 1e-12);
};

/**
 * The part of a push-to-talk recording that holds speech (energy VAD: frames
 * louder than the noise floor by `marginDb`), or null when there is none.
 */
export function trimSilence(audio: PcmAudio, opts: TrimOptions = {}): PcmAudio | null {
  const { samples, sampleRate } = audio;
  const frame = Math.max(1, Math.round((opts.frameS ?? 0.02) * sampleRate));
  const frames: number[] = [];
  for (let i = 0; i + frame <= samples.length; i += frame) frames.push(rmsDb(samples, i, i + frame));
  if (!frames.length) return null;
  // Noise floor: the 10th percentile frame (a PTT press is mostly speech, rarely all of it).
  const floor = [...frames].sort((a, b) => a - b)[Math.floor(frames.length * 0.1)]!;
  const threshold = Math.min(
    opts.ceilingDbfs ?? -35,
    Math.max(opts.floorDbfs ?? -50, floor + (opts.marginDb ?? 12))
  );
  const first = frames.findIndex((db) => db >= threshold);
  if (first < 0) return null;
  let last = frames.length - 1;
  while (frames[last]! < threshold) last--;
  let voiced = 0;
  for (let i = first; i <= last; i++) if (frames[i]! >= threshold) voiced++;
  if (voiced * frame < (opts.minSpeechS ?? 0.25) * sampleRate) return null;
  const pad = Math.round((opts.padS ?? 0.15) * sampleRate);
  const start = Math.max(0, first * frame - pad);
  const end = Math.min(samples.length, (last + 1) * frame + pad);
  return { samples: samples.slice(start, end), sampleRate };
}
