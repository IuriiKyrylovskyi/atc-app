/**
 * Speech engines and the radio channel.
 *
 * One frequency carries one transmission at a time: pilot transmissions queue
 * and are spoken in order, each after a short pause, in the pilot's own voice
 * (voices.ts). Engines: system voices (webspeech.ts) or Kokoro (kokoro.ts).
 */
import { pilotVoice, type PilotVoice } from './voices';

export interface SpeechEngine {
  readonly id: string;
  /** Resolves when the transmission has been spoken (or failed / was cancelled). */
  speak(text: string, voice: PilotVoice): Promise<void>;
  /** Stops the current transmission. */
  cancel(): void;
}

export interface Transmission {
  callsign: string;
  /** Spoken form (numbers as words). */
  text: string;
}

export interface RadioChannelOptions {
  /** Pause before each transmission, ms. Default 500. */
  gapMs?: number;
  /** Older transmissions are dropped beyond this many waiting. Default 4. */
  maxQueue?: number;
  /** Who is transmitting now (null = frequency quiet). */
  onTransmit?: (t: Transmission | null) => void;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class RadioChannel {
  private queue: Transmission[] = [];
  private running = false;
  private generation = 0;
  private readonly gapMs: number;
  private readonly maxQueue: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private engine: SpeechEngine | null,
    private readonly opts: RadioChannelOptions = {}
  ) {
    this.gapMs = opts.gapMs ?? 500;
    this.maxQueue = opts.maxQueue ?? 4;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  get busy(): boolean {
    return this.running;
  }

  get waiting(): readonly Transmission[] {
    return this.queue;
  }

  /** Swaps the engine (null = radio muted); waiting transmissions are dropped. */
  setEngine(engine: SpeechEngine | null): void {
    this.clear();
    this.engine = engine;
  }

  say(callsign: string, text: string): void {
    if (!this.engine || !text.trim()) return;
    this.queue.push({ callsign, text });
    if (this.queue.length > this.maxQueue) this.queue.splice(0, this.queue.length - this.maxQueue);
    void this.pump();
  }

  /** Silences the frequency: stops the current transmission and drops the queue. */
  clear(): void {
    this.queue = [];
    this.generation++;
    this.engine?.cancel();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const gen = this.generation;
    try {
      while (this.queue.length && gen === this.generation && this.engine) {
        await this.sleep(this.gapMs);
        const t = this.queue.shift();
        if (!t || gen !== this.generation) break;
        this.opts.onTransmit?.(t);
        try {
          await this.engine.speak(t.text, pilotVoice(t.callsign));
        } catch {
          // A failed transmission is just not heard; the log still has it.
        }
        this.opts.onTransmit?.(null);
      }
    } finally {
      this.running = false;
    }
    // Cleared while speaking and something new arrived meanwhile.
    if (this.queue.length && gen !== this.generation) void this.pump();
  }
}
