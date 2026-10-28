/**
 * packages/app/src/services/playSession.ts
 *
 * Single active device enforcement for premium accounts.
 *
 * A paid account may be played on ONE device at a time. The playing device owns
 * the account's session (`accounts.active_device_id`) and keeps it alive with a
 * heartbeat; the server drops the session 3 minutes after the last heartbeat, so
 * a crash, a force-close or a network drop releases it automatically.
 *
 * Any other device that wants to play finds the session taken and must wait on
 * the /waiting screen until it expires.
 *
 * The three RPCs are the whole protocol:
 *   check_and_claim_play_session — claim (or refresh) the session
 *   heartbeat_play_session       — keep-alive; never claims
 *   release_play_session         — free it immediately on app background
 */

import { supabase, supabaseUrl, supabaseAnonKey } from '@/lib/supabase';

const HEARTBEAT_INTERVAL_MS = 60_000;
/** Server-side grace window; mirrored here so the UI countdown matches. */
const SESSION_TTL_MS = 3 * 60_000;

export interface PlaySessionState {
  /** True when this device may play (owns the session, or nobody does). */
  canPlay: boolean;
  /** True when this call is what took the session (false = already ours). */
  claimed: boolean;
  /** When the current holder's session dies. null for free users. */
  sessionExpiresAt: string | null;
}

function normalizeRow(row: unknown): PlaySessionState {
  const r = (row ?? {}) as Record<string, unknown>;
  return {
    canPlay: r.can_play === true,
    claimed: r.claimed === true,
    sessionExpiresAt: typeof r.session_expires_at === 'string' ? r.session_expires_at : null,
  };
}

class PlaySessionService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private userId: string | null = null;
  private held = false;
  /** Fired when a heartbeat discovers the session was taken by another device. */
  private onLost: (() => void) | null = null;
  /**
   * Cached access token. `supabase.auth.getSession()` is async and will not
   * resolve once Android has paused the WebView, so the token is refreshed
   * while we are still in the foreground and reused by the background release.
   */
  private accessToken: string | null = null;

  /** Absolute expiry of the session we currently hold (local bookkeeping). */
  private heldUntil = 0;

  setLostHandler(handler: (() => void) | null): void {
    this.onLost = handler;
  }

  /**
   * Ask the server whether we may play, claiming the session when it is free or
   * already ours. Free users (no account row) always pass — there is nothing to
   * synchronise, so gating them would only add a failure mode.
   *
   * Never throws: a network failure resolves to "cannot play" so the caller
   * shows the waiting screen rather than letting the player in unguarded.
   */
  async checkAndClaim(userId: string | null): Promise<PlaySessionState> {
    if (!userId) {
      this.held = false;
      return { canPlay: true, claimed: false, sessionExpiresAt: null };
    }

    void this.cacheAccessToken();

    const { data, error } = await supabase.rpc('check_and_claim_play_session', {
      current_user_id: userId,
    });

    if (error) {
      console.warn('⚠️ Play session check failed:', error.message);
      return { canPlay: false, claimed: false, sessionExpiresAt: null };
    }

    const row = Array.isArray(data) ? data[0] : data;
    const state = normalizeRow(row);
    this.userId = userId;
    this.held = state.canPlay;
    this.heldUntil = state.sessionExpiresAt ? new Date(state.sessionExpiresAt).getTime() : 0;
    return state;
  }

  /**
   * Start the 60s keep-alive. Safe to call repeatedly — a second call while a
   * heartbeat is already running is a no-op. Only starts for premium accounts
   * (a device without an account row has nothing to keep alive).
   */
  startHeartbeat(userId: string, isPremium: boolean): void {
    this.userId = userId;
    if (this.timer) return;
    if (!isPremium) return;

    const beat = async () => {
      if (!this.userId) return;
      void this.cacheAccessToken();
      const { data, error } = await supabase.rpc('heartbeat_play_session', {
        current_user_id: this.userId,
      });
      if (error) {
        // A dropped beat is not fatal: the session still lives for up to 3 min.
        console.warn('⚠️ Play session heartbeat failed:', error.message);
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      const ok = (row as Record<string, unknown> | undefined)?.ok === true;
      if (!ok) {
        // Another device claimed the session while we were playing (typically:
        // our own session expired during a long background stretch). Stop and
        // let the UI send the player to the waiting screen.
        console.warn('⚠️ Play session lost to another device');
        this.held = false;
        this.stopHeartbeat();
        this.onLost?.();
        return;
      }
      const expires = (row as Record<string, unknown>).session_expires_at;
      if (typeof expires === 'string') this.heldUntil = new Date(expires).getTime();
    };

    this.timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Refresh the cached access token. Called from the foreground paths only.
   */
  private async cacheAccessToken(): Promise<void> {
    try {
      const { data } = await supabase.auth.getSession();
      this.accessToken = data.session?.access_token ?? null;
    } catch {
      // Non-fatal: the release falls back to the plain client call.
    }
  }

  /**
   * Hand the session back so the other device does not have to sit out the
   * 3 min timeout.
   *
   * Uses a `keepalive` fetch rather than the Supabase client: a normal request
   * is dropped when Android pauses the WebView, which is precisely the moment we
   * need it to survive. `keepalive` lets it outlive the suspension. Without a
   * cached token we fall back to the client call, which at least works when the
   * app is merely transitioning rather than fully backgrounded.
   */
  private releaseSession(userId: string): void {
    const token = this.accessToken;
    if (!token) {
      void supabase.rpc('release_play_session', { current_user_id: userId });
      return;
    }

    void fetch(`${supabaseUrl}/rest/v1/rpc/release_play_session`, {
      method: 'POST',
      keepalive: true,
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ current_user_id: userId }),
    }).catch(() => {
      // Best effort. The session also expires on its own after 3 min.
    });
  }

  /**
   * Stop the keep-alive and hand the session back. Fire-and-forget on purpose:
   * this runs on app background, where there is no time to await a round trip.
   */
  stopHeartbeat(release = true): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const userId = this.userId;
    this.held = false;
    this.heldUntil = 0;
    if (release && userId) this.releaseSession(userId);
  }

  /** True while this device believes it owns the session. */
  get isHolding(): boolean {
    return this.held;
  }

  /** Local view of the session deadline, for the waiting screen countdown. */
  get expiresAt(): number {
    return this.heldUntil;
  }

  /** Milliseconds until the session we hold runs out (0 when unknown/free). */
  get msRemaining(): number {
    if (!this.held || !this.heldUntil) return 0;
    return Math.max(0, this.heldUntil - Date.now());
  }

  get ttlMs(): number {
    return SESSION_TTL_MS;
  }
}

export const playSessionService = new PlaySessionService();
export { HEARTBEAT_INTERVAL_MS, SESSION_TTL_MS };
