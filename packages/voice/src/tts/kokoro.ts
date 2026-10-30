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
}

/** The part of kokoro-js we use (typed here: its types need `bundler` resolution, the app uses `node`). */
interface KokoroModule {
  KokoroTTS: {
    from_pretrained(
      model: string,
      opts: {
        dtype: 'fp32' | 'q8';
        device: 'wasm' | 'webgpu';
        progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => void;
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
  const device = opts.device ?? 'wasm';
  // Several files download at once; report the overall share of bytes.
  const files = new Map<string, { loaded: number; total: number }>();
  const tts = await KokoroTTS.from_pretrained(KOKORO_MODEL, {
    dtype: device === 'webgpu' ? 'fp32' : 'q8',
    device,
    progress_callback: (p) => {
      if (p.status !== 'progress' || !p.file || !p.total) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      opts.onProgress?.(total ? loaded / total : 0);
    },
  });
  return async (text, voice, speed) => {
    const audio = await tts.generate(text, { voice, speed });
    return { samples: audio.audio as Float32Array<ArrayBuffer>, sampleRate: audio.sampling_rate };
  };
}

export class KokoroEngine implements SpeechEngine {
  readonly id = 'kokoro';
  private current: AudioBufferSourceNode | null = null;
  private generation = 0;

  constructor(
    private readonly ctx: AudioContext,
    private readonly synth: Synthesize,
    private readonly radio: RadioFx
  ) {}

  async speak(text: string, voice: PilotVoice): Promise<void> {
    const gen = ++this.generation;
    const pcm = await this.synth(text, voice.kokoroVoice, voice.kokoroSpeed);
    if (gen !== this.generation || pcm.samples.length === 0) return;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const buffer = this.ctx.createBuffer(1, pcm.samples.length, pcm.sampleRate);
    buffer.copyToChannel(pcm.samples, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.radio.input);
    this.current = src;
    await new Promise<void>((resolve) => {
      src.onended = () => resolve();
      this.radio.keyUp();
      src.start(this.ctx.currentTime + 0.05);
    });
    this.radio.keyDown();
    if (this.current === src) this.current = null;
  }

  cancel(): void {
    this.generation++;
    this.current?.stop();
    this.current = null;
  }
}
