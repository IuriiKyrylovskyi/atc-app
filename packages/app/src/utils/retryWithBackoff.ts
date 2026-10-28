/**
 * packages/app/src/utils/retryWithBackoff.ts
 *
 * Retry an async function with jittered exponential backoff.
 *
 * WHY THIS EXISTS
 * ----------------
 * Fire-and-forget writes (score flush, passed-levels sync) must not silently
 * vanish when the network flaps. A single attempt that times out on 2G loses
 * the run; a naive fixed retry can stampede. This helper gives a bounded,
 * growing pause between attempts so a transient 5xx / timeout recovers on its
 * own without hammering the server.
 *
 * SCOPE — fire-and-forget WRITES ONLY. Never purchase, restore, or any other
 * user-visible action: a retry must never turn one failed attempt into a
 * surprise second charge. Callers gate accordingly.
 */

export interface RetryWithBackoffOptions {
  /** Maximum number of attempts (including the first). Default 3. */
  attempts?: number;
  /** Base delay in ms, doubled after each failure. Default 1000. */
  baseMs?: number;
  /** Hard cap on the delay between attempts. Default 30000. */
  maxMs?: number;
  /** Optional predicate: retry only when it returns true. */
  retryOnError?: (err: unknown) => boolean;
  /** Optional label for log lines. */
  label?: string;
}

/**
 * Run `fn` until it resolves, retrying on failure with jittered backoff.
 * Throws the last error if every attempt fails.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryWithBackoffOptions = {}
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseMs = Math.max(0, options.baseMs ?? 1000);
  const maxMs = Math.max(baseMs, options.maxMs ?? 30000);
  const retryOnError = options.retryOnError ?? (() => true);
  const label = options.label ? `[${options.label}]` : '';

  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isLast = i === attempts - 1;
      if (isLast || !retryOnError(err)) break;

      // Jittered exponential backoff: base * 2^i, capped, ±25% jitter.
      const power = Math.min(Math.pow(2, i), maxMs / Math.max(1, baseMs));
      const base = Math.min(baseMs * power, maxMs);
      const jitter = base * (0.5 + Math.random());
      const delay = Math.min(jitter, maxMs);

      console.warn(
        `⚠️ ${label} attempt ${i + 1}/${attempts} failed — retrying in ${Math.round(delay)}ms:`,
        err instanceof Error ? err.message : err
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}