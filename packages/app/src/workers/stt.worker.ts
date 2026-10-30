/**
 * Moonshine worker: loads the model and transcribes controller transmissions
 * off the UI thread. See services/controllerMic.ts.
 */
import { loadMoonshine, type Transcribe } from '@atc-app/voice';

export type SttRequest =
  | { op: 'load'; device: 'wasm' | 'webgpu' }
  | { op: 'transcribe'; id: number; samples: Float32Array<ArrayBuffer>; sampleRate: number };

export type SttReply =
  | { type: 'progress'; fraction: number }
  | { type: 'ready' }
  | { type: 'load-failed'; error: string }
  | { type: 'text'; id: number; text: string }
  | { type: 'transcribe-failed'; id: number; error: string };

// The app compiles against the DOM lib; a dedicated worker's global has the same
// postMessage / message-event surface as a Worker object.
const scope = self as unknown as Worker;
const reply = (r: SttReply) => scope.postMessage(r);

let transcribe: Promise<Transcribe> | null = null;

scope.addEventListener('message', async (e: MessageEvent<SttRequest>) => {
  const req = e.data;
  if (req.op === 'load') {
    transcribe ??= loadMoonshine({
      device: req.device,
      onProgress: (fraction) => reply({ type: 'progress', fraction }),
    });
    transcribe.then(
      () => reply({ type: 'ready' }),
      (err: unknown) => {
        transcribe = null;
        reply({ type: 'load-failed', error: String(err) });
      }
    );
    return;
  }
  try {
    if (!transcribe) throw new Error('model not loaded');
    const text = await (await transcribe)({ samples: req.samples, sampleRate: req.sampleRate });
    reply({ type: 'text', id: req.id, text });
  } catch (err) {
    reply({ type: 'transcribe-failed', id: req.id, error: String(err) });
  }
});
