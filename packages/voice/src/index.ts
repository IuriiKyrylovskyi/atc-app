/**
 * @atc-app/voice — phraseology, readback, speech engines.
 *
 * Phases 2–3 (see TODO.md). Free stack used by the first implementation:
 *
 * - Parser: Chevrotain grammar (Apache-2.0) built from ICAO Doc 4444 / Doc 9432.
 * - Speech-to-text, embedded: Moonshine English models (MIT) and Whisper
 *   base/small/large-v3-turbo (MIT) via transformers.js (WebGPU/WASM) in the browser
 *   and whisper.cpp (MIT) in Electron. Low-end fallback: Vosk (Apache-2.0).
 * - Speech-to-text, online: the same open models self-hosted on our server
 *   (faster-whisper, MIT) — infrastructure cost only, no per-minute licence.
 * - Text-to-speech: Kokoro-82M (Apache-2.0) via kokoro-js; zero-download fallback:
 *   Web Speech API / OS voices.
 *
 * PAID-ALT: Groq hosted Whisper large-v3-turbo.
 *   Why better: no GPU server to run, very low latency, scales instantly.
 *   Price: ≈ $0.00067 per audio minute (≈ $0.09 per subscriber-month at 135 min).
 *
 * PAID-ALT: Deepgram Nova-3 streaming STT.
 *   Why better: true streaming results while the controller is still speaking.
 *   Price: ≈ $0.0043–0.0077 per audio minute.
 *
 * PAID-ALT: OpenAI transcription (gpt-4o-mini-transcribe / successor).
 *   Why better: strong accuracy on accented English without fine-tuning.
 *   Price: ≈ $0.003 per audio minute (model deprecation reported — verify).
 *
 * PAID-ALT: Google Cloud TTS (Neural2 $16, Chirp 3 HD $30 per 1 M chars) or
 *   Azure Neural TTS (≈ $15 per 1 M chars).
 *   Why better: more natural, more accents, no model download.
 *   Price: ≈ $1.8–3.6 per subscriber-month at ~120 k chars — too costly as default.
 */
export {};
