/**
 * Kokoro-82M (Apache-2.0) via kokoro-js: natural voices, synthesised on the
 * device, played through the full VHF radio filter.
 *
 * Split in two because inference blocks the thread it runs on:
 * - `loadKokoro` runs in a Web Worker: lazy-imports kokoro-js, downloads the
 *   model once (q8 ≈ 92 MB from Hugging Face, then cached by the browser) and
 *   returns a `Synthesize` function.
 * - `KokoroEngine` runs on the page: asks a `Synthesize` (usually a worker
 *   proxy) for PCM and plays it through `RadioFx`.
 */
import { byteProgress, type ModelProgressEvent } from '../download';
import { useOnnxWasm, type OnnxWasmPaths } from '../onnx';
import type { SpeechEngine } from './channel';
import type { RadioFx } from './radio';
import type { PilotVoice } from './voices';

export const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
/** Download size of the q8 model, for the settings label. */
export const KOKORO_DOWNLOAD_MB = 92;

export interface PcmAudio {
  samples: Float32Array<ArrayBuffer>;
  sampleRate: number;
}

export type Synthesize = (text: string, voice: string, speed: number) => Promise<PcmAudio>;

export interface KokoroLoadOptions {
  /** 'webgpu' where available (fp32), else 'wasm' (q8). */
  device?: 'wasm' | 'webgpu';
  /** Download / load progress, 0–1. */
  onProgress?: (fraction: number) => void;
  /** ONNX Runtime files served by the app (default: transformers.js's CDN). */
  wasmPaths?: OnnxWasmPaths;
}

/** The part of kokoro-js we use (typed here: its types need `bundler` resolution, the app uses `node`). */
interface KokoroModule {
  KokoroTTS: {
    from_pretrained(
      model: string,
      opts: {
        dtype: 'fp32' | 'q8';
        device: 'wasm' | 'webgpu';
        progress_callback: (p: ModelProgressEvent) => void;
      }
    ): Promise<{
      generate(text: string, opts: { voice: string; speed: number }): Promise<{ audio: Float32Array; sampling_rate: number }>;
    }>;
  };
}

/** Loads the model. Call inside a worker. */
export async function loadKokoro(opts: KokoroLoadOptions = {}): Promise<Synthesize> {
  // @ts-ignore — resolvable under `bundler` (this package) but not `node` (the app); typed by KokoroModule.
  const { KokoroTTS } = (await import('kokoro-js')) as unknown as KokoroModule;
  await useOnnxWasm(opts.wasmPaths);
  const device = opts.device ?? 'wasm';
  const tts = await KokoroTTS.from_pretrained(KOKORO_MODEL, {
    dtype: device === 'webgpu' ? 'fp32' : 'q8',
    device,
    progress_callback: byteProgress(opts.onProgress),
  });
  return async (text, voice, speed) => {
    const audio = await tts.generate(text, { voice, speed });
    return { samples: audio.audio as Float32Array<ArrayBuffer>, sampleRate: audio.sampling_rate };
  };
}

/** Pause between clauses, s (a comma in the readback). */
const CLAUSE_PAUSE_S = 0.12;

/**
 * Splits a transmission at commas so the first clause can play while the rest
 * is synthesised. Pieces shorter than `minChars` ("unable") join the next one.
 */
export function clauses(text: string, minChars = 12): string[] {
  const out: string[] = [];
  let carry = '';
  for (const piece of text.split(/,\s*/)) {
    const p = carry ? `${carry}, ${piece}` : piece;
    if (p.trim().length < minChars) carry = p;
    else {
      out.push(p.trim());
      carry = '';
    }
  }
  if (carry.trim()) {
    if (out.length) out[out.length - 1] += `, ${carry.trim()}`;
    else out.push(carry.trim());
  }
  return out;
}

export class KokoroEngine implements SpeechEngine {
  readonly id = 'kokoro';
  private playing: AudioBufferSourceNode[] = [];
  private generation = 0;

  constructor(
    private readonly ctx: AudioContext,
    private readonly synth: Synthesize,
    private readonly radio: RadioFx
  ) {}

  /**
   * Streams clause by clause: synthesise clause 1, start it, synthesise clause 2
   * while 1 plays, queue it on the audio clock right after, and so on. One
   * synthesis at a time (the worker runs one model).
   */
  async speak(text: string, voice: PilotVoice): Promise<void> {
    const gen = ++this.generation;
    const parts = clauses(text);
    const say = (t: string) => {
      const p = this.synth(t, voice.kokoroVoice, voice.kokoroSpeed);
      p.catch(() => undefined); // a cancelled look-ahead must not surface as unhandled
      return p;
    };
    let next = parts.length ? say(parts[0]!) : null;
    let at = 0;
    let ended: Promise<void> | null = null;
    for (let i = 0; next; i++) {
      const pcm = await next;
      if (gen !== this.generation) return;
      next = i + 1 < parts.length ? say(parts[i + 1]!) : null;
      if (pcm.samples.length === 0) continue;
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      const buffer = this.ctx.createBuffer(1, pcm.samples.length, pcm.sampleRate);
      buffer.copyToChannel(pcm.samples, 0);
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.radio.input);
      if (!ended) {
        this.radio.keyUp();
        at = this.ctx.currentTime + 0.05;
      } else {
        // Synthesis slower than speech: carry on as soon as it is ready (a hesitation, carrier still up).
        at = Math.max(at, this.ctx.currentTime + 0.02);
      }
      ended = new Promise<void>((resolve) => (src.onended = () => resolve()));
      src.start(at);
      at += buffer.duration + CLAUSE_PAUSE_S;
      this.playing.push(src);
    }
    if (ended) await ended;
    if (gen !== this.generation) return;
    this.radio.keyDown();
    this.playing = [];
  }

  cancel(): void {
    this.generation++;
    for (const src of this.playing) src.stop();
    if (this.playing.length) this.radio.keyDown();
    this.playing = [];
  }
}
