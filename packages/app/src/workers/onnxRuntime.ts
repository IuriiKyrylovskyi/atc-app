/**
 * ONNX Runtime's WASM (≈ 21.6 MB) and loader for the model workers (Kokoro,
 * Moonshine), served by the app instead of transformers.js's default jsdelivr
 * CDN: the Electron CSP blocks the CDN, and the scope should work offline once
 * the models are cached. `@onnx-runtime` is a Vite alias (vite.config.ts).
 */
import type { OnnxWasmPaths } from '@atc-app/voice';
import wasm from '@onnx-runtime/ort-wasm-simd-threaded.jsep.wasm?url';
import mjs from '@onnx-runtime/ort-wasm-simd-threaded.jsep.mjs?url';

export const ONNX_WASM_PATHS: OnnxWasmPaths = { wasm, mjs };
