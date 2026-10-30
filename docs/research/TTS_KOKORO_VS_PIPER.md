# Pilot voices: Kokoro-82M vs Piper TTS

Status: research note, 2026-10-30. atc-app speaks pilot transmissions with
**Kokoro-82M** today (VOICE KOKORO, `packages/voice/src/tts/kokoro.ts`,
`packages/app/src/workers/tts.worker.ts`), with OS voices (Web Speech) as the
zero-download fallback. This note compares Kokoro with **Piper**, the other
free on-device TTS that is often recommended as "lightweight, CPU-friendly,
Apache 2.0". Two of those claims need correcting for us; see *Licences*.

Facts were checked against GitHub, Hugging Face (`rhasspy/piper-voices`
`voices.json` and model cards), the npm registry and the sherpa-onnx model
releases on the date above. Kokoro numbers are our own measurements; Piper
speed in our app is **not measured yet**.

## Summary

| | Kokoro-82M (today) | Piper |
|---|---|---|
| Model | StyleTTS 2–style, 82 M parameters, non-autoregressive | VITS, ≈ 16 M parameters ("medium"), non-autoregressive |
| Engine licence | kokoro-js Apache-2.0, weights Apache-2.0 (trained on permissive / non-copyrighted audio) | Original `rhasspy/piper` **MIT, archived Aug 2025**; successor `OHF-Voice/piper1-gpl` is **GPL-3.0** |
| Phonemes (G2P) | espeak-ng via the `phonemizer` npm package — **GPL-3.0 code inside** (see below) | espeak-ng via piper-phonemize — **GPL-3.0** |
| Voice licences | One licence for all voices (Apache-2.0) | **Per voice**, from its dataset: CC0 / public domain / CC-BY 4.0 / BSD-style, but several are **non-commercial** |
| English voices | 28 (US 20, GB 8); we use 21 (`KOKORO_VOICES`) | 38 voice files (US 27, GB 11); multi-speaker files hold thousands of speakers |
| Download for our use | q8 ≈ 92 MB, one file for every voice | fp32 63–82 MB per voice file (136 MB "high"); **int8 ≈ 23 MB** per file (sherpa-onnx packs) |
| Accents | General American, Southern British | VCTK: 109 speakers with English, Scottish, Irish, Welsh, American, Canadian, Indian, South African, Australian accents (CC-BY 4.0); LibriTTS-R: 2,306 US speakers (CC-BY 4.0) |
| Quality | Among the best open-weight models; natural prosody | Clear but flatter, more "reader" voice; multi-speaker voices vary in quality |
| Speed in the browser | Measured: 1.6× slower than real time single-thread, 0.8× real time cross-origin isolated; first audio 3.1 s with clause streaming | Not measured; ≈ 5× fewer parameters, so expect several times faster on the same CPU |
| Speed on phones | Heavy: 82 M parameters on WASM, no WebGPU on most phones | Built for weak CPUs (runs real time on a Raspberry Pi 4) |
| Browser runtime | transformers.js + onnxruntime-web, WASM (WebGPU fp32 ≈ 326 MB optional) | onnxruntime-web ports: `piper-tts-web`, `@mintplex-labs/piper-tts-web`, `@diffusionstudio/vits-web` (MIT, small, last updated 2024) |
| Native runtime (Electron / Capacitor) | sherpa-onnx (Apache-2.0) has Kokoro int8 packs (103–147 MB) | sherpa-onnx has every Piper voice, fp16 and int8; Piper's own C++ / Python engine |
| Offline | Yes, after the first download | Yes, after the first download |

## Licences: what matters for a paid app

1. **espeak-ng is GPL-3.0, and both engines use it in the browser.**
   - The npm `phonemizer` package that kokoro-js depends on lists "Apache-2.0", but its 1.3 MB bundle is espeak-ng compiled with Emscripten, along with `espeak-ng-data`. We checked `dist/phonemizer.js` in our own `node_modules`.
   - Piper's phonemizer is espeak-ng as well.
   - So **switching to Piper does not fix this.**
   - Shipping GPL code inside a closed-source, paid app needs a legal decision. The options are to treat the WASM module as a separate program, to publish under GPL terms, or to remove espeak-ng.
2. **We can remove espeak-ng.** What we speak comes only from `phraseology.ts`, so the vocabulary is closed:
   - digits, NATO letters, phraseology keywords
   - the radio names of airlines (`telephony.ts`) and fixes spelled out
   - A pronunciation dictionary (CMUdict is BSD-2-Clause) plus hand entries for airline names would cover it.
   - Both models take phonemes as input, so either one could run without espeak-ng.
3. **Piper's engine licence changed.**
   - `rhasspy/piper` (MIT) is archived, so there will be no fixes.
   - Its maintained successor, `piper1-gpl`, is GPL-3.0.
   - The browser ports (MIT) run the ONNX voice files without either, but they are small one-maintainer projects.
   - sherpa-onnx (Apache-2.0, very active) runs Piper voices on Android, iOS, desktop and WASM.
4. **Piper voices each carry their dataset's licence.** For commercial use:

   | Status | Voices |
   |---|---|
   | Usable | `en_GB-vctk` (CC-BY 4.0, 109 speakers), `en_US-libritts_r` (CC-BY 4.0, 2,306 speakers), `en_US-libritts-high` (CC-BY 4.0), `en_GB-aru` (CC-BY 4.0), `en_GB-alba` (CC-BY 4.0), `en_GB-cori` / `en_US-ljspeech` / `en_US-john` / `en_US-bryce` / `en_US-kristin` / `en_US-norman` (public domain), `en_US-joe` / `en_US-mike` / `en_US-kathleen` / `en_US-reza_ibrahim` (CC0), `en_US-sam` (Apache-2.0) |
   | Share-alike (output OK, check terms) | `en_GB-northern_english_male`, `en_GB-southern_english_female` (CC-BY-SA 4.0) |
   | Not for a paid app | `en_US-ryan`, `en_US-hfc_female`, `en_US-hfc_male`, `en_GB-semaine` (CC BY-NC-SA 4.0), `en_US-l2arctic` (CC BY-NC 4.0; a pity, these are non-native accents), `en_US-lessac` (Blizzard 2013 licence, research use) |
   | Check the linked licence | `en_GB-alan`, `en_GB-jenny_dioco`, `en_US-amy`, `en_US-danny`, `en_US-kusal`, `en_US-arctic` (CMU Arctic, BSD-style) |

   - CC-BY voices need attribution in the app's credits.
   - Kokoro needs no per-voice checks.

## Kokoro-82M

**Pros**
- Best voice quality of the free on-device options. Pilots sound like people, which matters for immersion.
- One Apache-2.0 licence for model and voices, trained on permissive data, so there is no per-voice licence work.
- Already built in and measured:
  - clause streaming, plus cross-origin isolation of the scope (`?coi=1`)
  - a worker, so the scope never stalls
  - per-callsign voice and speed through the VHF filter
- One 92 MB download covers all 28 English voices.
- WebGPU path for strong desktops; sherpa-onnx int8 for native builds.
- Shares the onnxruntime-web WASM (21.6 MB) with Moonshine speech recognition.

**Cons**
- Heavy for weak devices. Single-threaded it runs slower than real time even on a 10-core Mac. Phones and Safari (no COEP credentialless, so single-thread) will lag.
- 92 MB first download; 103–147 MB for native int8 packs.
- Only two accents (US, GB), and 21 voices in our pool, so on a busy frequency pilots repeat voices.
- espeak-ng (GPL-3.0) hidden inside `phonemizer` (see *Licences*).

## Piper

**Pros**
- Light and fast: about 16 M parameters, and it runs in real time on a Raspberry Pi 4. Likely the only neural option that keeps up on mid-range phones.
- int8 voice files are about 23 MB, a quarter of Kokoro's download.
- **Many distinct pilots from one file:**
  - VCTK gives 109 speakers with a wide spread of accents, all CC-BY 4.0.
  - LibriTTS-R gives 2,306 US speakers.
  - Every callsign could have its own voice, and international operators could sound international.
- Mature native runtime (sherpa-onnx) for Capacitor and Electron, and small browser ports.

**Cons**
- Lower quality than Kokoro: flatter prosody, and some multi-speaker voices are rough. The VHF filter (300–3,000 Hz, clipping, hiss) hides part of the gap but not the flat delivery.
- Licence work per voice; several popular voices are non-commercial (ryan, hfc_*, l2arctic, lessac).
- Engine history: the MIT original is archived and the maintained successor is GPL-3.0. The browser ports are small and last updated in 2024.
- espeak-ng (GPL-3.0) for phonemes, same as Kokoro.
- Not built in; speed in our worker is not measured.

## Fit for atc-app

- **Desktop web and Electron:** keep Kokoro as the quality default. It is integrated and measured, and its latency is acceptable with streaming and isolation.
- **Mobile, Safari and weak CPUs:** Piper is the strongest candidate for a light neural tier.
  - Use the int8 VCTK file for UK, international and accented pilots, and the LibriTTS-R file for US pilots: about 46 MB together.
  - Run it through the same `Synthesize` interface in `tts.worker.ts`, so `KokoroEngine`'s streaming and the radio channel stay as they are.
  - OS voices remain the zero-download fallback.
- **Voice variety:** a Piper tier would give far more distinct pilots than Kokoro's 21 voices. Even on desktop, a mixed pool would help, for example Kokoro for home carriers and Piper VCTK for foreign operators.
- **Before any release, with either engine:** decide the espeak-ng question. Either get a legal review, or replace it with a closed-vocabulary pronunciation dictionary.

## Recommendation

1. Keep Kokoro as VOICE KOKORO, the default neural voice on desktop.
2. Benchmark Piper int8 (VCTK, LibriTTS-R) in `tts.worker.ts` on desktop Chrome, Safari and a mid-range Android phone. Adopt it as the low-end / mobile tier if it reaches real time with first audio under about 1 s.
3. Use only the voices from the commercial-use rows above, and add CC-BY credits.
4. Remove the GPL-3.0 dependency by phonemizing our closed vocabulary from a permissive dictionary. That would serve both engines.

No PAID-ALT changes: cloud TTS (Google, Azure) is already listed in `packages/voice/src/index.ts` and stays too costly as a default.

## Sources

- Kokoro: [hexgrad/Kokoro-82M model card](https://huggingface.co/hexgrad/Kokoro-82M) · [ONNX model](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) · [kokoro-js](https://www.npmjs.com/package/kokoro-js) · [phonemizer (npm)](https://www.npmjs.com/package/phonemizer)
- Piper: [rhasspy/piper (archived, MIT)](https://github.com/rhasspy/piper) · [OHF-Voice/piper1-gpl (GPL-3.0)](https://github.com/OHF-Voice/piper1-gpl) · [piper-voices (voices.json, model cards)](https://huggingface.co/rhasspy/piper-voices) · [espeak-ng (GPL-3.0)](https://github.com/espeak-ng/espeak-ng)
- Browser ports: [piper-tts-web](https://www.npmjs.com/package/piper-tts-web) · [@mintplex-labs/piper-tts-web](https://github.com/Mintplex-Labs/piper-tts-web) · [@diffusionstudio/vits-web](https://github.com/diffusionstudio/vits-web)
- Native runtime: [sherpa-onnx (Apache-2.0)](https://github.com/k2-fsa/sherpa-onnx) · [sherpa-onnx TTS model packs](https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models)
- Dictionary: [CMUdict (BSD-2-Clause)](https://github.com/cmusphinx/cmudict)
