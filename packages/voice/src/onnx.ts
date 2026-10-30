/**
 * Where ONNX Runtime (under transformers.js, kokoro-js) loads its WASM from.
 *
 * transformers.js defaults to the jsdelivr CDN: blocked by the Electron CSP,
 * missing offline, and a third party on every model load. The app passes the
 * copies it serves itself (app src/workers/onnxRuntime.ts).
 */

/** ONNX Runtime's `env.wasm.wasmPaths` file form: the .wasm binary and its .mjs loader. */
export interface OnnxWasmPaths {
  wasm: string;
  mjs: string;
}

interface TransformersEnv {
  env: { backends: { onnx: { wasm?: { wasmPaths?: unknown } } } };
}

/** Points ONNX Runtime at the given files. Call in the worker before the first model loads. */
export async function useOnnxWasm(paths: OnnxWasmPaths | undefined): Promise<void> {
  if (!paths) return;
  // @ts-ignore — resolvable under `bundler` (this package) but not `node` (the app); typed by TransformersEnv.
  const { env } = (await import('@huggingface/transformers')) as unknown as TransformersEnv;
  if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = paths;
}
