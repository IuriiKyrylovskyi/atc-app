/**
 * Text-to-speech for pilot transmissions: per-callsign voices, a one-at-a-time
 * radio channel, VHF radio effect, and two engines — system voices (Web Speech,
 * no download) and Kokoro-82M (on-device, ≈ 92 MB once).
 */
export * from './voices';
export * from './radio';
export * from './channel';
export * from './webspeech';
export * from './kokoro';
