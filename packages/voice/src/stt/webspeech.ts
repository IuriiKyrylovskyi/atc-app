/**
 * The browser's own speech recognition (Web Speech API): no download, n-best
 * results. Chrome and Edge send the audio to their vendor's servers; Safari
 * recognises on Apple's. Firefox has none, and Electron's Chromium has no
 * Google key, so it fails there ("network") — the app offers it only where it works.
 */
import type { SpeechToText, Transcript } from './recognizer';

/** The part of SpeechRecognition we use (lib.dom has no prefixed constructor). */
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type RecognitionConstructor = new () => Recognition;

export function recognitionConstructor(win: object = globalThis): RecognitionConstructor | null {
  const w = win as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Errors that mean "nothing was said", not a broken engine. */
const SILENT = new Set(['no-speech', 'aborted']);

/**
 * Alternatives for a transmission recognised in several segments (continuous
 * mode splits at pauses): the best of each joined, then each lower-ranked
 * alternative of one segment with the best of the others.
 */
export function joinSegments(segments: readonly (readonly string[])[]): string[] {
  const best = segments.map((s) => s[0] ?? '');
  const out = [best.join(' ').trim()];
  segments.forEach((alts, i) => {
    for (const alt of alts.slice(1)) out.push(best.map((b, j) => (j === i ? alt : b)).join(' ').trim());
  });
  return [...new Set(out)].filter(Boolean);
}

export class WebSpeechRecognizer implements SpeechToText {
  readonly id = 'browser';
  private rec: Recognition | null = null;
  private segments: string[][] = [];
  private error: string | null = null;
  private ended: Promise<void> = Promise.resolve();

  constructor(
    private readonly Ctor: RecognitionConstructor,
    private readonly lang = 'en-US'
  ) {}

  start(): void {
    this.rec?.abort();
    const rec = new this.Ctor();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 5;
    this.segments = [];
    this.error = null;
    rec.onresult = (e) => {
      this.segments = Array.from(e.results, (r) => Array.from(r, (a) => a.transcript.trim()));
    };
    rec.onerror = (e) => {
      if (!SILENT.has(e.error)) this.error = e.error;
    };
    this.ended = new Promise((resolve) => (rec.onend = () => resolve()));
    this.rec = rec;
    rec.start();
  }

  async stop(): Promise<Transcript | null> {
    const rec = this.rec;
    if (!rec) return null;
    rec.stop();
    await this.ended;
    if (this.rec === rec) this.rec = null;
    if (this.error) throw new Error(`speech recognition: ${this.error}`);
    const alternatives = joinSegments(this.segments);
    return alternatives.length ? { alternatives, engine: this.id } : null;
  }

  cancel(): void {
    this.rec?.abort();
    this.rec = null;
  }
}
