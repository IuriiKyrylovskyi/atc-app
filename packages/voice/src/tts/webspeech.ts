/**
 * System voices through the Web Speech API — zero download, works in browsers,
 * Electron and iOS WKWebView (Android WebView support varies).
 *
 * The browser plays the speech itself, so it cannot go through the radio
 * filter; the radio adds only the carrier click, hiss and squelch tail around it.
 */
import type { SpeechEngine } from './channel';
import type { RadioFx } from './radio';
import { pickSystemVoice, type PilotVoice } from './voices';

export class WebSpeechEngine implements SpeechEngine {
  readonly id = 'system';

  constructor(
    private readonly synth: SpeechSynthesis,
    private readonly radio: RadioFx | null = null
  ) {}

  static available(): boolean {
    return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  /** English system voices (the list fills in asynchronously in some browsers). */
  voices(): SpeechSynthesisVoice[] {
    return this.synth.getVoices().filter((v) => /^en([-_]|$)/i.test(v.lang));
  }

  speak(text: string, voice: PilotVoice): Promise<void> {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const v = pickSystemVoice(this.synth.getVoices(), voice);
      if (v) u.voice = v;
      u.lang = v?.lang ?? voice.lang;
      u.pitch = voice.pitch;
      u.rate = voice.rate;
      const done = () => {
        this.radio?.keyDown();
        resolve();
      };
      u.onend = done;
      u.onerror = done;
      this.radio?.keyUp();
      this.synth.speak(u);
    });
  }

  cancel(): void {
    this.synth.cancel();
  }
}
