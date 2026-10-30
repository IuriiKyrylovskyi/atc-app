/**
 * transformers.js progress events (kokoro-js passes them through) → one overall
 * fraction: several model files download at once, so report the share of bytes.
 */
export interface ModelProgressEvent {
  status: string;
  file?: string;
  loaded?: number;
  total?: number;
}

export function byteProgress(onProgress?: (fraction: number) => void): (p: ModelProgressEvent) => void {
  const files = new Map<string, { loaded: number; total: number }>();
  return (p) => {
    if (p.status !== 'progress' || !p.file || !p.total) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    onProgress?.(total ? loaded / total : 0);
  };
}
