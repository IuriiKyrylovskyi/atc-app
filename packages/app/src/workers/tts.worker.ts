/**
 * Kokoro worker: loads the model and synthesises pilot transmissions off the UI
 * thread (inference would otherwise stall the scope). See services/radioVoice.ts.
 */
import { loadKokoro, type Synthesize } from '@atc-app/voice';

export type TtsRequest =
  | { op: 'load'; device: 'wasm' | 'webgpu' }
  | { op: 'say'; id: number; text: string; voice: string; speed: number };

export type TtsReply =
  | { type: 'progress'; fraction: number }
  | { type: 'ready' }
  | { type: 'load-failed'; error: string }
  | { type: 'audio'; id: number; samples: Float32Array<ArrayBuffer>; sampleRate: number }
  | { type: 'say-failed'; id: number; error: string };

// The app compiles against the DOM lib; a dedicated worker's global has the same
// postMessage / message-event surface as a Worker object.
const scope = self as unknown as Worker;
const reply = (r: TtsReply, transfer: Transferable[] = []) => scope.postMessage(r, transfer);

let synth: Promise<Synthesize> | null = null;

scope.addEventListener('message', async (e: MessageEvent<TtsRequest>) => {
  const req = e.data;
  if (req.op === 'load') {
    synth ??= loadKokoro({
      device: req.device,
      onProgress: (fraction) => reply({ type: 'progress', fraction }),
    });
    synth.then(
      () => reply({ type: 'ready' }),
      (err: unknown) => {
        synth = null;
        reply({ type: 'load-failed', error: String(err) });
      }
    );
    return;
  }
  try {
    if (!synth) throw new Error('model not loaded');
    const pcm = await (await synth)(req.text, req.voice, req.speed);
    reply({ type: 'audio', id: req.id, samples: pcm.samples, sampleRate: pcm.sampleRate }, [
      pcm.samples.buffer,
    ]);
  } catch (err) {
    reply({ type: 'say-failed', id: req.id, error: String(err) });
  }
});
