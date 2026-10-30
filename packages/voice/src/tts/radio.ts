/**
 * VHF radio effect (Web Audio): what a pilot sounds like through an aircraft
 * transmitter and a controller's headset.
 *
 *   input → high-pass 300 Hz ×2 → low-pass 3 kHz ×2 → soft clip → volume → out
 *   noise (band-passed white noise) ─────────────────────────────↗
 *
 * `keyUp` opens the carrier (a click and a low hiss under the voice), `keyDown`
 * closes it with a short squelch tail. Synthesised speech (Kokoro) goes through
 * `input`; system voices (Web Speech) cannot be routed into Web Audio, so they
 * get only the carrier and squelch around them.
 */

export interface RadioOptions {
  /** Output volume, 0–1. Default 0.9. */
  volume?: number;
  /** Hiss level under the voice, 0–1. Default 0.04. */
  hiss?: number;
  /** Clipping drive, 1 = clean. Default 3. */
  drive?: number;
}

const NOISE_SECONDS = 2;

/** tanh soft-clip curve, normalised so full scale stays full scale. */
export function softClipCurve(drive: number, n = 1024): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / norm;
  }
  return curve;
}

export class RadioFx {
  /** Connect speech here. */
  readonly input: GainNode;
  private readonly master: GainNode;
  private readonly hissGain: GainNode;
  private readonly noise: AudioBuffer;
  private readonly band: BiquadFilterNode;
  private hissSource: AudioBufferSourceNode | null = null;
  private readonly hiss: number;

  constructor(
    private readonly ctx: BaseAudioContext,
    out: AudioNode = ctx.destination,
    opts: RadioOptions = {}
  ) {
    this.hiss = opts.hiss ?? 0.04;
    this.input = ctx.createGain();
    this.master = ctx.createGain();
    this.master.gain.value = opts.volume ?? 0.9;

    const filter = (type: BiquadFilterType, frequency: number) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = frequency;
      f.Q.value = 0.707;
      return f;
    };
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve(opts.drive ?? 3);
    shaper.oversample = '2x';
    const chain: AudioNode[] = [
      this.input,
      filter('highpass', 300),
      filter('highpass', 300),
      filter('lowpass', 3000),
      filter('lowpass', 3000),
      shaper,
      this.master,
      out,
    ];
    for (let i = 0; i + 1 < chain.length; i++) chain[i]!.connect(chain[i + 1]!);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * NOISE_SECONDS, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1800;
    band.Q.value = 0.6;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    band.connect(this.hissGain).connect(this.master);
    this.band = band;
  }

  set volume(v: number) {
    this.master.gain.value = Math.max(0, Math.min(1, v));
  }

  /** Carrier on: click, then hiss under the voice. */
  keyUp(): void {
    this.ensureHiss();
    const t = this.ctx.currentTime;
    const g = this.hissGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(this.hiss * 6, t);
    g.exponentialRampToValueAtTime(this.hiss, t + 0.04);
  }

  /** Carrier off: squelch tail, then silence. */
  keyDown(): void {
    const t = this.ctx.currentTime;
    const g = this.hissGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(this.hiss * 5, t);
    g.exponentialRampToValueAtTime(this.hiss * 2, t + 0.12);
    g.linearRampToValueAtTime(0, t + 0.16);
  }

  /** The noise loop runs for the life of the radio, gated by `hissGain`. */
  private ensureHiss(): void {
    if (this.hissSource) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.connect(this.band);
    src.start();
    this.hissSource = src;
  }

  dispose(): void {
    this.hissSource?.stop();
    this.hissSource = null;
    this.master.disconnect();
  }
}
