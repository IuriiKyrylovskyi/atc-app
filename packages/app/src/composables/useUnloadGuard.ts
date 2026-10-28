/**
 * packages/app/src/composables/useUnloadGuard.ts
 *
 * The `beforeunload` warning that protects a running level from being lost
 * when the window/tab is torn down by the OS or by the user.
 *
 * It lives in its own module (instead of inline in App.vue) because the
 * close flow has to be able to remove it on demand — see `clearUnloadGuard`.
 */

let handler: ((e: BeforeUnloadEvent) => void) | null = null;

/** Warn before the browser/Electron window is torn down mid-level. */
export function setUnloadGuard(active: boolean): void {
  if (active) {
    if (handler) return;
    handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return;
  }

  if (!handler) return;
  window.removeEventListener('beforeunload', handler);
  handler = null;
}

/**
 * Remove the guard unconditionally.
 *
 * MUST be called right before a deliberate close: Electron's
 * `mainWindow.close()` runs the renderer's `beforeunload` handler, and a
 * handler that calls `preventDefault()` CANCELS the close and pops a native
 * "Leave site?" dialog instead of quitting the app.
 */
export function clearUnloadGuard(): void {
  setUnloadGuard(false);
}
