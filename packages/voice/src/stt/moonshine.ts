/**
 * Moonshine base (MIT, Useful Sensors) via transformers.js: English speech-to-text
 * on the device. Built for short live utterances — its compute grows with the
 * audio length instead of Whisper's fixed 30 s window, which suits a PTT call.
 *
 * Runs in a Web Worker (`loadMoonshine`), like Kokoro: inference blocks the
 * thread it runs on. q8 ≈ 63 MB from Hugging Face once, then cached by the browser.
 *
 * PAID-ALT: Groq hosted Whisper large-v3-turbo (see index.ts) — better accuracy on
 * accented English, no download, ≈ $0.00067 per audio minute.
 */
import { byteProgress, type ModelProgressEvent } from '../download';
import { STT_SAMPLE_RATE } from './audio';
import type { Transcribe } from './recognizer';

export const MOONSHINE_MODEL = 'onnx-community/moonshine-base-ONNX';
/** Download size of the q8 encoder + merged decoder, for the settings label. */
export const MOONSHINE_DOWNLOAD_MB = 63;

export interface MoonshineLoadOptions {
  /** 'webgpu' takes fp32 (≈ 250 MB); 'wasm' takes q8. */
  device?: 'wasm' | 'webgpu';
  onProgress?: (fraction: number) => void;
}

/** The part of transformers.js we use (typed here: its types need `bundler` resolution, the app uses `node`). */
interface TransformersModule {
  pipeline(
    task: 'automatic-speech-recognition',
    model: string,
    opts: { dtype: 'fp32' | 'q8'; device: 'wasm' | 'webgpu'; progress_callback: (p: ModelProgressEvent) => void }
  ): Promise<(audio: Float32Array) => Promise<{ text: string } | { text: string }[]>>;
}

/** Loads the model and warms it up (the first inference is several times slower). Call inside a worker. */
export async function loadMoonshine(opts: MoonshineLoadOptions = {}): Promise<Transcribe> {
  // @ts-ignore — resolvable under `bundler` (this package) but not `node` (the app); typed by TransformersModule.
  const { pipeline } = (await import('@huggingface/transformers')) as unknown as TransformersModule;
  const device = opts.device ?? 'wasm';
  const asr = await pipeline('automatic-speech-recognition', MOONSHINE_MODEL, {
    dtype: device === 'webgpu' ? 'fp32' : 'q8',
    device,
    progress_callback: byteProgress(opts.onProgress),
  });
  const run = async (samples: Float32Array): Promise<string> => {
    const out = await asr(samples);
    return (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text).trim();
  };
  await run(new Float32Array(STT_SAMPLE_RATE));
  return (audio) => {
    if (audio.sampleRate !== STT_SAMPLE_RATE) throw new Error(`Moonshine takes ${STT_SAMPLE_RATE} Hz, got ${audio.sampleRate}`);
    return run(audio.samples);
  };
}
