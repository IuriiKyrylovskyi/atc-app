/**
 * Microphone recording for push-to-talk. The microphone opens on the first press
 * (the permission prompt) and stays open while the scope is: a short pre-roll
 * keeps the first syllable when speech starts with the key, and a tail keeps the
 * last one when the key comes up early.
 *
 * Uses a ScriptProcessorNode: deprecated but supported everywhere (Safari,
 * WKWebView, Electron) and needs no separate worklet module under the CSP; at
 * 2048 frames it only collects buffers, nothing time-critical runs on it.
 */
import type { PcmAudio } from '../tts/kokoro';
import type { AudioSource } from './recognizer';

export interface MicCaptureOptions {
  /** Audio kept from before the press, ms. */
  prerollMs?: number;
  /** Recording continues this long after the release, ms. */
  tailMs?: number;
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
}

const BUFFER_FRAMES = 2048;

export class MicCapture implements AudioSource {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private opening: Promise<void> | null = null;
  private recording = false;
  private chunks: Float32Array[] = [];
  private preroll: Float32Array[] = [];
  private readonly prerollMs: number;
  private readonly tailMs: number;
  private readonly getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>;

  constructor(opts: MicCaptureOptions = {}) {
    this.prerollMs = opts.prerollMs ?? 300;
    this.tailMs = opts.tailMs ?? 250;
    this.getUserMedia = opts.getUserMedia ?? ((c) => navigator.mediaDevices.getUserMedia(c));
  }

  static available(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  /** Asks for the microphone (once). Rejects when it is blocked or missing. */
  open(): Promise<void> {
    this.opening ??= this.openMic().catch((err: unknown) => {
      this.opening = null;
      throw err;
    });
    return this.opening;
  }

  start(): void {
    this.chunks = [...this.preroll];
    this.recording = true;
    // First press: recording starts once the microphone is open (after the prompt).
    void this.open().catch(() => (this.recording = false));
  }

  async stop(): Promise<PcmAudio> {
    await this.opening?.catch(() => undefined);
    if (this.recording) await new Promise((r) => setTimeout(r, this.tailMs));
    this.recording = false;
    const length = this.chunks.reduce((n, c) => n + c.length, 0);
    const samples = new Float32Array(length);
    let at = 0;
    for (const c of this.chunks) {
      samples.set(c, at);
      at += c.length;
    }
    this.chunks = [];
    return { samples, sampleRate: this.ctx?.sampleRate ?? 48000 };
  }

  cancel(): void {
    this.recording = false;
    this.chunks = [];
  }

  /** Releases the microphone (the browser's recording indicator goes off). */
  close(): void {
    this.cancel();
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    void this.ctx?.close();
    this.ctx = null;
    this.opening = null;
    this.preroll = [];
  }

  private async openMic(): Promise<void> {
    const stream = await this.getUserMedia({
      audio: {
        channelCount: 1,
        // Pilots speak from the speakers: keep them out of the controller's transmission.
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(BUFFER_FRAMES, 1, 1);
    const prerollChunks = Math.ceil((this.prerollMs / 1000) * ctx.sampleRate / BUFFER_FRAMES);
    proc.onaudioprocess = (e) => {
      const chunk = new Float32Array(e.inputBuffer.getChannelData(0));
      if (this.recording) this.chunks.push(chunk);
      this.preroll.push(chunk);
      if (this.preroll.length > prerollChunks) this.preroll.shift();
    };
    source.connect(proc);
    // A processor only runs connected to the output; it writes silence there.
    proc.connect(ctx.destination);
    this.stream = stream;
    this.ctx = ctx;
  }
}
