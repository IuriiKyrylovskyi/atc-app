/**
 * packages/app/src/stubs/filesystem.stub.ts
 *
 * Empty stub for @capacitor/filesystem on web/Electron.
 * Vite aliases the real package to this file when bundling for non-mobile.
 * The real package is only installed in @atc-app/mobile.
 *
 * On web, localStorage is used instead (see levelManager.ts, backgroundAssetService.ts).
 * This stub just satisfies the bundler's import resolution.
 */

export const Directory = {
  Documents: 'DOCUMENTS',
  Data: 'DATA',
  Library: 'LIBRARY',
  Cache: 'CACHE',
  External: 'EXTERNAL',
  ExternalStorage: 'EXTERNAL_STORAGE',
};

export const Encoding = {
  UTF8: 'utf8',
  ASCII: 'ascii',
  UTF16: 'utf16',
};

export const Filesystem = {
  readFile: (_options: { path: string; directory?: string; encoding?: string }) =>
    Promise.reject(new Error('Filesystem not available on web')),
  writeFile: (_options: { path: string; data: string; directory?: string; encoding?: string; recursive?: boolean }) =>
    Promise.resolve({ uri: '' }),
  appendFile: (_options: { path: string; data: string; directory?: string; encoding?: string }) =>
    Promise.resolve({ uri: '' }),
  deleteFile: (_options: { path: string; directory?: string }) =>
    Promise.resolve(),
  mkdir: (_options: { path: string; directory?: string; recursive?: boolean }) =>
    Promise.resolve({ uri: '' }),
  rmdir: (_options: { path: string; directory?: string; recursive?: boolean }) =>
    Promise.resolve(),
  readdir: (_options: { path: string; directory?: string }) =>
    Promise.resolve({ files: [] }),
  getUri: (_options: { path: string; directory?: string }) =>
    Promise.resolve({ uri: '' }),
  stat: (_options: { path: string; directory?: string }) =>
    Promise.reject(new Error('Filesystem not available on web')),
  rename: (_options: { from: string; to: string; directory?: string }) =>
    Promise.resolve(),
  copy: (_options: { from: string; to: string; directory?: string; toDirectory?: string }) =>
    Promise.resolve(),
  checkPermissions: () => Promise.resolve({ publicStorage: 'unknown' }),
  requestPermissions: () => Promise.resolve({ publicStorage: 'unknown' }),
};

export type FileInfo = {
  name: string;
  type: 'file' | 'directory';
  size: number;
  ctime: number;
  mtime: number;
  uri: string;
};