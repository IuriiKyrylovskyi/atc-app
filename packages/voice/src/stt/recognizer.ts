/**
 * Speech-to-text for controller transmissions, push-to-talk shaped: `start` when
 * the PTT goes down, `stop` when it comes up and the transcript follows.
 *
 * Two kinds of engine:
 * - Engines that take PCM (Moonshine, Whisper — on the device or on our server):
 *   `PcmRecognizer` = a microphone `AudioSource` + a `Transcribe` function.
 * - Engines that capture on their own (Web Speech recognition): implement
 *   `SpeechToText` directly (stt/webspeech.ts).
 */
import type { PcmAudio } from '../tts/kokoro';
import { STT_SAMPLE_RATE, resample, trimSilence } from './audio';

export interface Transcript {
  /** Best first; engines with n-best results give several. */
  alternatives: string[];
  engine: string;
}

export interface SpeechToText {
  readonly id: string;
  /** PTT down. */
  start(): void;
  /** PTT up: what was said, or null when nothing was. */
  stop(): Promise<Transcript | null>;
  /** PTT up without transmitting (scope closed, mode changed). */
  cancel(): void;
}

/** 16 kHz mono speech → text. */
export type Transcribe = (audio: PcmAudio) => Promise<string>;

/** Microphone (or a test double) recording between start and stop. */
export interface AudioSource {
  start(): void;
  stop(): Promise<PcmAudio>;
  cancel(): void;
}

/** Text with no letter or digit is a model's reading of noise (".", "…"). */
const saysSomething = (text: string): boolean => /[a-z0-9]/i.test(text);

export class PcmRecognizer implements SpeechToText {
  constructor(
    readonly id: string,
    private readonly source: AudioSource,
    private readonly transcribe: Transcribe
  ) {}

  start(): void {
    this.source.start();
  }

  async stop(): Promise<Transcript | null> {
    const pcm = await this.source.stop();
    const speech = trimSilence({
      samples: resample(pcm.samples, pcm.sampleRate) as Float32Array<ArrayBuffer>,
      sampleRate: STT_SAMPLE_RATE,
    });
    if (!speech) return null;
    const text = (await this.transcribe(speech)).trim();
    return saysSomething(text) ? { alternatives: [text], engine: this.id } : null;
  }

  cancel(): void {
    this.source.cancel();
  }
}

/**
 * Grammar re-scoring of an n-best list: the first alternative the phraseology
 * parser understands, else the engine's best guess (it then gets "say again").
 */
export function pickTranscript(t: Transcript, understood: (text: string) => boolean): string {
  return t.alternatives.find(understood) ?? t.alternatives[0] ?? '';
}
