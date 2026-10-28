/**
 * packages/app/src/utils/fetchWithTimeout.ts
 *
 * Wraps any fetch() in a hard wall-clock timeout using AbortController.
 *
 * WHY THIS EXISTS
 * ----------------
 * @supabase/supabase-js exposes no per-request timeout — its storage
 * .download() and .from() queries can hang for minutes on a dead or
 * slow connection. A 5 MB background image on 2G used to freeze the
 * whole level (GameScene.loadLevelBackground awaits it before render).
 *
 * This is the single chokepoint: every network call that can block the
 * UI goes through fetchWithTimeout(), including the Supabase Storage
 * download (which we re-route through a signed URL + fetch here).
 *
 * On AbortError we throw a typed NetworkTimeoutError so callers can
 * distinguish "timed out" from "5xx" and act accordingly.
 */

export class NetworkTimeoutError extends Error {
  readonly _tag = 'NetworkTimeout';
  constructor(message: string = 'Network request timed out') {
    super(message);
    this.name = 'NetworkTimeoutError';
  }
}

export interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs?: number;
}

/**
 * Fetch with a hard timeout.
 *
 * @param resource     URL or Request
 * @param options      fetch options (method, headers, body, …)
 * @param timeoutMs    wall-clock cap in ms. Default 12000 (12s).
 */
export async function fetchWithTimeout(
  resource: string | Request,
  options: FetchWithTimeoutOptions = {},
  timeoutMs = 12000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  // If the caller already passed a signal, link it so their cancel wins.
  const existingSignal = options.signal;
  if (existingSignal) {
    if (existingSignal.aborted) {
      clearTimeout(id);
      throw new DOMException('The operation was aborted', 'AbortError');
    }
    existingSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new NetworkTimeoutError(
        `Request to ${typeof resource === 'string' ? resource : '(Request)'} timed out after ${timeoutMs}ms`
      );
    }
    throw err;
  }
}

/**
 * Convenience: fetch JSON with a timeout, returns parsed body or null.
 * Used for small metadata fetches (manifests, profile selects).
 */
export async function fetchJsonWithTimeout(
  resource: string | Request,
  options: FetchWithTimeoutOptions = {},
  timeoutMs = 10000
): Promise<unknown> {
  const response = await fetchWithTimeout(resource, options, timeoutMs);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${typeof resource === 'string' ? resource : '(Request)'}`);
  }
  return response.json();
}

/**
 * Convenience: HEAD probe used by useNetwork() to classify connection quality.
 *
 * Answers "is the network physically reachable" — NOT "is the backend
 * healthy". Any HTTP response (2xx–5xx) means the server answered, so the
 * link is up; only a genuine fetch failure (timeout, DNS, refused) means
 * offline. Backend health is the per-call timeout's job (fetchWithTimeout,
 * the safe() wrappers), not the connectivity probe's: treating a 5xx as
 * offline would pop the blocking banner and halt gameplay during a
 * transient backend outage on a perfectly good network.
 *
 * CORS is the tricky case: a cross-origin fetch that fails with a CORS
 * TypeError is NOT evidence the link is down — the browser contacted the
 * server and got a response, it just won't expose it cross-origin. That's
 * exactly what happens probing the bare Supabase origin
 * (https://...supabase.co/), which returns 404 and no
 * Access-Control-Allow-Origin header while every real API path
 * (/rest/v1/...) succeeds. The probe now targets /rest/v1/ so this
 * no longer occurs, but the TypeError guard remains as defense in
 * depth. Treating that as offline pops the blocking
 * "No connection" banner on a perfectly online device. So a CORS failure
 * counts as reachable; only a timeout / DNS / connection failure means
 * offline.
 *
 * Returns true if the probe reached the server within the timeout.
 */
export async function probeReachable(
  url: string,
  timeoutMs = 8000
): Promise<boolean> {
  try {
    await fetchWithTimeout(url, { method: 'HEAD' }, timeoutMs);
    return true;
  } catch (err) {
    if (err instanceof TypeError) {
      // CORS / network-policy failure: the server answered, the browser
      // just won't share it cross-origin. The link is up.
      return true;
    }
    // NetworkTimeoutError (timeout) or any other genuine fetch failure:
    // the link is down.
    return false;
  }
}