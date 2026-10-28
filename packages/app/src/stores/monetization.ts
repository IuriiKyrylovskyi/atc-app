import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/supabase';
import { USER_ALIAS_STORAGE_KEY, USER_PASSWORD_STORAGE_KEY } from '@/lib/supabase';
import { RevenueCatService, RC_ENTITLEMENT_ID, addPaymentLog } from '@/services/revenueCatService';
import { AdMobService } from '@/services/adMobService';
import { Capacitor } from '@capacitor/core';
import { safeStorage } from '@/lib/safeStorage';
import { useDebugStore } from '@/stores/debug';
import { NetworkTimeoutError } from '@/utils/fetchWithTimeout';

// ─── Constants ────────────────────────────────────────────────────────────────
// ─── Network-resilience helpers ────────────────────────────────────────────────
// A cold boot over a bad network can hang a Supabase / RPC / Edge Function
// call for minutes. Each server-bound init step is raced against a per-step
// timeout so a hung request can never stall the splash screen indefinitely.
// A hard 5s cap on the whole chain guarantees isLoading flips false no matter
// what. On timeout we keep whatever local state we already have and land the
// user on the main screen — a degraded launch is always better than a frozen
// one.
function timeout<T>(ms: number): Promise<T> {
  return new Promise((_, reject) =>
    setTimeout(
      () => reject(new NetworkTimeoutError(`monetization call timed out after ${ms}ms`)),
      ms
    )
  );
}

/**
 * supabase-js reports every non-2xx Edge Function response as a generic
 * FunctionsHttpError ("Edge Function returned a non-2xx status code"). The real
 * HTTP status and JSON body live on `error.context` (the Response). Read them so the
 * debug log shows WHY a call failed instead of just "network error".
 */
async function describeInvokeError(
  error: unknown
): Promise<{ message: string; status: number | null; body: unknown }> {
  const message = error instanceof Error ? error.message : String(error);
  const res = (error as { context?: Response } | null)?.context;
  if (!res || typeof res.status !== 'number') return { message, status: null, body: null };
  let body: unknown = null;
  try {
    const text = await res.clone().text();
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 200);
    }
  } catch {
    /* body already consumed; status is still useful */
  }
  return { message, status: res.status, body };
}

/**
 * Some deployed Edge Functions answer business outcomes (not_found, not_paid,
 * already_linked, invalid_format) with a 4xx status and a JSON `{ success:false, error }`
 * body. supabase-js hides that behind a generic FunctionsHttpError, which the callers
 * below used to misread as a network failure (so e.g. the claim-purchase fallback never
 * ran). Recover the business result from the response body; return null for real
 * transport/gateway failures (401 JWT, 5xx, no response).
 */
async function asBusinessBody(
  error: unknown
): Promise<{ success: false; error: string; retry_after_seconds?: number } | null> {
  const detail = await describeInvokeError(error);
  const body = detail.body as { error?: unknown; retry_after_seconds?: unknown } | null;
  if (
    detail.status !== null &&
    detail.status >= 400 &&
    detail.status < 500 &&
    body &&
    typeof body === 'object' &&
    typeof body.error === 'string'
  ) {
    const code = body.error;
    return {
      success: false,
      error: code === 'invalid_format' ? 'invalid' : code,
      // recover-account answers 429 rate_limited with the wait in seconds.
      ...(typeof body.retry_after_seconds === 'number'
        ? { retry_after_seconds: body.retry_after_seconds }
        : {}),
    };
  }
  return null;
}

export const useMonetizationStore = defineStore('monetization', () => {
  // ── State ──────────────────────────────────────────────────────────────────
  const userId = ref<string | null>(null);
  const accountId = ref<string | null>(null);
  const isPremium = ref(false);
  const platform = ref<Profile['platform']>('web');
  const isLoading = ref(false);
  const isInitialized = ref(false);
  const purchaseError = ref<string | null>(null);
  // Public 8-char handle shown on the leaderboard (anyone can see it).
  // Owned by the canonical `accounts` row, not the device profile.
  const userAlias = ref<string | null>(null);
  // Private 8-16 char recovery password shown once before purchase — the secret
  // that proves ownership. Used as the RevenueCat appUserID.
  const userPassword = ref<string | null>(null);
  const needsRestore = ref(false);

  const lastCheckedAt = ref<number>(0);
  const THROTTLE_MS = 60_000;

  // ── Strong Platform Detection ──────────────────────────────────────────────
  function getPlatform(): Profile['platform'] {
    if (typeof window === 'undefined') return 'web';

    // Electron
    if (window.navigator.userAgent.includes('Electron')) {
      return 'electron';
    }

    // Capacitor native (most reliable for published apps)
    if (Capacitor.isNativePlatform()) {
      const p = Capacitor.getPlatform();
      return p === 'ios' ? 'ios' : 'android';
    }

    // Fallback
    return 'web';
  }

  /** True only on native mobile where the native RevenueCat SDK is available. */
  function isNativeMobileForRc(): boolean {
    return Capacitor.isNativePlatform();
  }

  /**
   * Initializes RevenueCat for the current platform.
   * - Native mobile: the native SDK (Capacitor) with the platform API key,
   *   using the device Supabase uid as appUserID until Phase 4.
   * - Web / Electron: the Web SDK (Paddle Billing) bound to the device
   *   Supabase uid until Phase 4.
   */
  async function initRevenueCat(uid: string, stableAppUserID?: string): Promise<void> {
    if (isNativeMobileForRc()) {
      await RevenueCatService.initialize(uid, stableAppUserID);
      const hasEntitlement = await RevenueCatService.hasActiveEntitlement();
      if (hasEntitlement) isPremium.value = true;
      return;
    }

    // Web / Electron: bind the Web SDK to the device Supabase uid until Phase 4.
    await RevenueCatService.initWeb(uid);
    // Check for existing entitlement without re-binding to password
    const customerInfo = await RevenueCatService.getCustomerInfoWeb();
    if (customerInfo?.entitlements?.active?.[RC_ENTITLEMENT_ID]) {
      isPremium.value = true;
    }
  }

  // ── Auth ───────────────────────────────────────────────────────────────────
  function loadStoredAlias(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return safeStorage.getItem(USER_ALIAS_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function storeAlias(alias: string): void {
    if (typeof window === 'undefined') return;
    try {
      safeStorage.setItem(USER_ALIAS_STORAGE_KEY, alias);
    } catch {
      // Non-fatal
    }
  }

  function clearStoredAlias(): void {
    if (typeof window === 'undefined') return;
    try {
      safeStorage.removeItem(USER_ALIAS_STORAGE_KEY);
    } catch {
      // Non-fatal
    }
  }

  function loadStoredPassword(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return safeStorage.getItem(USER_PASSWORD_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function storePassword(password: string): void {
    if (typeof window === 'undefined') return;
    try {
      safeStorage.setItem(USER_PASSWORD_STORAGE_KEY, password);
    } catch {
      // Non-fatal
    }
  }

  function clearStoredPassword(): void {
    if (typeof window === 'undefined') return;
    try {
      safeStorage.removeItem(USER_PASSWORD_STORAGE_KEY);
    } catch {
      // Non-fatal
    }
  }

  /**
   * Free-text recovery word, set on the Premium screen. Stored normalized
   * (upper + btrim) by the server and read back from `get_account_for_device`
   * on every launch — it is intentionally NOT cached in localStorage, so the
   * server is the only place it ever exists on this device.
   */
  const recoveryWord = ref<string | null>(null);

  /**
   * Load the canonical account linked to this device's profile.
   * Runs during init() so isPremium / alias / password resolve before render.
   */
  async function loadAccount(): Promise<void> {
    if (!userId.value) return;
    try {
      const { data, error } = await supabase.rpc('get_account_for_device', {
        current_user_id: userId.value,
      });

      if (error) {
        console.warn('get_account_for_device failed:', error.message);
        return;
      }
      if (!data || (Array.isArray(data) && data.length === 0)) {
        accountId.value = null;
        return;
      }

      const row = Array.isArray(data) ? data[0] : data;
      accountId.value = row.account_id ?? null;
      if (row.alias) {
        userAlias.value = row.alias;
        storeAlias(row.alias);
      }
      // RevenueCat stays bound to this device's own uid (decision D13): premium
      // comes from the account row, so a restored device never logs in as the
      // buyer's RevenueCat customer.
      if (row.password) {
        userPassword.value = row.password;
        storePassword(row.password);
      }
      if (row.recovery_word) {
        recoveryWord.value = row.recovery_word;
      }
      if (row.is_premium) isPremium.value = true;
    } catch (err) {
      console.warn('get_account_for_device error:', err);
    }
  }

  /**
   * Public leaderboard. Anyone (free or paid, logged in or not) can read this.
   * The password column is deliberately excluded.
   */
  interface LeaderboardEntry {
    alias: string;
    is_premium: boolean;
    max_score: number;
  }

  async function getLeaderboard(limit = 50): Promise<LeaderboardEntry[]> {
    const { data, error } = await supabase.rpc('get_leaderboard', {
      limit_count: limit,
    });

    if (error) {
      console.warn('Could not load leaderboard:', error.message);
      return [];
    }

    return (data ?? []) as LeaderboardEntry[];
  }

  /**
   * Live availability probe for the alias input (3rd-char onward).
   * Exact-match only: '111' and '1111' are distinct aliases and never
   * conflict. Returns the alias + availability + premium status.
   */
  async function checkAliasAvailability(
    candidate: string
  ): Promise<{ alias: string | null; available: boolean; isPremium: boolean }> {
    const normalized = candidate.trim().toUpperCase();
    if (!/^[A-Z0-9]{8,16}$/.test(normalized)) {
      return { alias: null, available: false, isPremium: false };
    }

    try {
      const { data, error } = await supabase.rpc('check_alias_availability', {
        candidate: normalized,
      });

      if (error || !data || data.length === 0) {
        return { alias: null, available: true, isPremium: false };
      }

      return {
        alias: data[0].alias,
        available: data[0].is_available,
        isPremium: data[0].is_premium,
      };
    } catch {
      return { alias: null, available: true, isPremium: false };
    }
  }

  /**
   * Full local logout. Triggered when a restore attempt fails with
   * "not_found" — the user typed an alias that does not belong to any paid
   * account, so this device must not keep pretending to be premium. Nothing
   * is sent to the server (no downgrade, no data leak).
   */
  function logoutLocally(reason: string): void {
    console.warn(`⚠️ Local logout (${reason}) — clearing all premium state`);

    isPremium.value = false;
    accountId.value = null;
    userAlias.value = null;
    userPassword.value = null;
    recoveryWord.value = null;
    needsRestore.value = false;
    clearStoredAlias();
    clearStoredPassword();
  }

  async function ensureAuth(): Promise<string> {
    const { data: session } = await supabase.auth.getSession();
    if (session.session?.user) {
      userId.value = session.session.user.id;
      return session.session.user.id;
    }

    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.user) {
      throw new Error(`Auth failed: ${error?.message ?? 'unknown'}`);
    }

    userId.value = data.user.id;
    return data.user.id;
  }

  // ── Server sync ────────────────────────────────────────────────────────────
  async function syncFromServer(forceCheck = false): Promise<void> {
    if (!userId.value) return;

    const now = Date.now();
    if (!forceCheck && lastCheckedAt.value > 0 && now - lastCheckedAt.value < THROTTLE_MS) {
      return;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('is_premium, account_id')
      .eq('id', userId.value)
      .maybeSingle();

    if (error) {
      console.warn('Could not sync profile:', error.message);
      return;
    }

    if (data) {
      isPremium.value = data.is_premium;
      if (data.account_id) accountId.value = data.account_id;
      lastCheckedAt.value = Date.now();
    }
  }

  /**
   * Cross-device restore. The anonymous user.id is device-local, so a purchase
   * confirmed on another device is invisible here. The user copies their
   * alias AND password (shown after purchase) into these fields and we copy
   * premium status + every score row onto the current device's anonymous id via
   * the service-role `restore-key` Edge Function (which bypasses RLS).
   *
   * The alias alone is public (it appears on the leaderboard) — only the
   * password proves ownership, so pasting an alias without the password grants
   * nothing. This is what stops user B from impersonating.
   *
   * On `not_found` the caller must log out locally — the alias/password pair does
   * not belong to any paid account, so this device must not keep pretending to
   * be premium. Nothing is sent to the server (no downgrade, no data leak).
   */

  /**
   * Validate stored alias/password against the server without doing a full restore.
   * Returns:
   * - { valid: true } if credentials correspond to a premium account (server would restore)
   * - { valid: false, clearStorage: true } if credentials are invalid (not_found, not_paid, invalid)
   * - { valid: false, clearStorage: false } if network error or already_linked (keep for retry)
   */
  async function validateStoredCredentials(
    alias: string,
    password: string
  ): Promise<{ valid: boolean; clearStorage: boolean; reason: string }> {
    useDebugStore().info('monetization: validateStoredCredentials called', {
      hasAlias: !!alias,
      hasPassword: !!password,
    });
    if (!userId.value) {
      useDebugStore().warn('monetization: validateStoredCredentials no userId');
      return { valid: false, clearStorage: false, reason: 'no_user_id' };
    }

    const normalizedAlias = alias.trim().toUpperCase();
    const normalizedPassword = password.trim().toUpperCase();
    if (!/^[A-Z0-9]{8,16}$/.test(normalizedAlias) || !/^[A-Z0-9]{8,16}$/.test(normalizedPassword)) {
      console.log('[validateStoredCredentials] invalid format, clearing storage');
      return { valid: false, clearStorage: true, reason: 'invalid_format' };
    }

    try {
      const { data, error } = await supabase.functions.invoke('restore-key', {
        body: { alias: normalizedAlias, password: normalizedPassword, currentUserId: userId.value },
      });

      const businessBody = error ? await asBusinessBody(error) : null;
      const result: { success?: boolean; error?: string } | null = businessBody ?? data;

      if (error && !businessBody) {
        const detail = await describeInvokeError(error);
        console.warn('[validateStoredCredentials] network error encountered:', error.message);
        useDebugStore().warn('monetization: validateStoredCredentials network error', {
          error: error.message,
          status: detail.status,
          body: detail.body,
          isPremium: isPremium.value,
        });
        // On fresh install, localStorage has stale credentials but server is unreachable
        // If isPremium is already false (no active entitlement), clear storage and DON'T set needsRestore
        if (!isPremium.value) {
          console.log(
            '[validateStoredCredentials] network error but no local premium entitlement; clearing stale credentials'
          );
          useDebugStore().info(
            'monetization: validateStoredCredentials network error with no premium -> clearing storage',
            {
              reason: 'network',
            }
          );
          return { valid: false, clearStorage: true, reason: 'network' };
        }
        console.log(
          '[validateStoredCredentials] network error but local premium exists; keeping storage for retry'
        );
        useDebugStore().info(
          'monetization: validateStoredCredentials network error with premium -> keeping storage',
          {
            reason: 'network',
          }
        );
        return { valid: false, clearStorage: false, reason: 'network' };
      }

      if (result?.success) {
        console.log('[validateStoredCredentials] valid premium credentials found');
        return { valid: true, clearStorage: false, reason: 'valid' };
      }

      const err = result?.error ?? 'not_found';
      if (err === 'not_found' || err === 'not_paid' || err === 'invalid') {
        console.log(
          '[validateStoredCredentials] credentials not valid (',
          err,
          '), clearing storage'
        );
        return { valid: false, clearStorage: true, reason: err };
      }

      if (err === 'already_linked') {
        console.log(
          '[validateStoredCredentials] device already linked to different account, keeping storage'
        );
        return { valid: false, clearStorage: false, reason: 'already_linked' };
      }

      console.warn('[validateStoredCredentials] unknown error, keeping storage:', err);
      return { valid: false, clearStorage: false, reason: 'unknown' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[validateStoredCredentials] error:', message);
      return { valid: false, clearStorage: false, reason: 'network' };
    }
  }

  async function restoreAccount(
    alias: string,
    password: string
  ): Promise<{
    success: boolean;
    // `already_linked` is the server refusing because this device already
    // belongs to a DIFFERENT real account. It is a distinct outcome from
    // "not_found" and must never trigger a local logout: the device's own
    // account is perfectly valid, it is just not this one.
    // `rate_limited` (too many failed guesses for this alias, network or device)
    // must not log out either; `retryAfterSeconds` says how long to wait.
    error?:
      | 'not_found'
      | 'not_paid'
      | 'invalid'
      | 'already_linked'
      | 'network'
      | 'rate_limited'
      | 'unknown';
    retryAfterSeconds?: number;
  }> {
    if (!userId.value) return { success: false, error: 'invalid' };

    const normalizedAlias = alias.trim().toUpperCase();
    const normalizedPassword = password.trim().toUpperCase();
    if (!/^[A-Z0-9]{8,16}$/.test(normalizedAlias) || !/^[A-Z0-9]{8,16}$/.test(normalizedPassword)) {
      return { success: false, error: 'invalid' };
    }

    try {
      const { data, error } = await supabase.functions.invoke('restore-key', {
        body: { alias: normalizedAlias, password: normalizedPassword, currentUserId: userId.value },
      });

      addPaymentLog('restoreAccount:restore-key', {
        ok: !error,
        success: data?.success ?? null,
        error: error?.message ?? data?.error ?? null,
      });

      const businessBody = error ? await asBusinessBody(error) : null;
      const result: { success?: boolean; error?: string; retry_after_seconds?: number } | null =
        businessBody ?? data;

      if (error && !businessBody) {
        const detail = await describeInvokeError(error);
        addPaymentLog('restoreAccount:restore-key:http-error', {
          status: detail.status,
          body: detail.body,
        });
        console.error('restore-key failed:', error.message);
        return { success: false, error: 'network' };
      }

      if (data?.success) {
        isPremium.value = data.is_premium ?? true;
        if (data.account_id) accountId.value = data.account_id;
        userAlias.value = data.alias ?? normalizedAlias;
        userPassword.value = data.password ?? normalizedPassword;
        storeAlias(userAlias.value ?? '');
        storePassword(userPassword.value ?? '');
        needsRestore.value = false;
        // After restore, load the full account (alias, password, recovery word).
        await loadAccount();
        // The restore RPC links the device to the canonical account (no row
        // copying), so re-sync to pick up account-level state.
        await syncFromServer(true);
        return { success: true };
      }

      const serverError = result?.error ?? 'not_found';

      // Too many failed guesses: never log out; the player just has to wait.
      if (serverError === 'rate_limited') {
        return {
          success: false,
          error: 'rate_limited',
          retryAfterSeconds:
            typeof result?.retry_after_seconds === 'number'
              ? result.retry_after_seconds
              : undefined,
        };
      }

      // No claim-purchase fallback here. claim-purchase ignores the typed pair when
      // this store account's purchase already has an account and links the device to
      // that one, so a wrong pair (or a device that just used "Switch to another
      // account") landed silently on the purchase's account. It also ran a store
      // restore on every wrong guess. A purchase with no matching pair is claimed by
      // the paywall's automatic restore and the "already active" path of Unlock.
      const known = ['not_found', 'not_paid', 'invalid', 'already_linked'] as const;
      return {
        success: false,
        error: (known as readonly string[]).includes(serverError)
          ? (serverError as (typeof known)[number])
          : 'unknown',
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('restore-key error:', message);
      return { success: false, error: 'network' };
    }
  }

  /**
   * Validate a candidate recovery word with the same rule the RPC enforces, so
   * an obviously-bad word never costs a round trip. The word is free text:
   * 4-16 characters after trim + upper, and never equal to the account's alias
   * or password (the alias is public, so a word equal to it would prove
   * nothing).
   */
  function validateRecoveryWord(candidate: string): { ok: true; value: string } | { ok: false } {
    const normalized = candidate.trim().toUpperCase();
    if (normalized.length < 4 || normalized.length > 16) return { ok: false };
    if (normalized === (userAlias.value ?? '').toUpperCase()) return { ok: false };
    if (normalized === (userPassword.value ?? '').toUpperCase()) return { ok: false };
    return { ok: true, value: normalized };
  }

  /**
   * Set (or change) the recovery word for this device's premium account. This
   * is the only place the word is ever written, and it is only reachable from
   * the Premium screen — the server re-validates every rule, so a tampered
   * client gains nothing. The word is never cached locally: it comes back from
   * `get_account_for_device` on every launch.
   */
  async function setRecoveryWord(candidate: string): Promise<{
    success: boolean;
    error?: 'invalid_format' | 'no_account' | 'unauthorized' | 'network';
  }> {
    if (!userId.value) return { success: false, error: 'no_account' };

    const check = validateRecoveryWord(candidate);
    if (!check.ok) return { success: false, error: 'invalid_format' };

    try {
      const { data, error } = await supabase.rpc('set_recovery_word', {
        current_user_id: userId.value,
        candidate: check.value,
      });

      if (error) {
        console.error('set_recovery_word failed:', error.message);
        return { success: false, error: 'network' };
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.success) {
        const reason = row?.error;
        if (reason === 'invalid_format' || reason === 'no_account' || reason === 'unauthorized') {
          return { success: false, error: reason };
        }
        return { success: false, error: 'no_account' };
      }

      // Trust the server's normalized value over ours.
      recoveryWord.value = row.recovery_word ?? check.value;
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('set_recovery_word error:', message);
      return { success: false, error: 'network' };
    }
  }

  /**
   * Recover access when the password (and possibly the whole device) is lost.
   *
   * The service-role `recover-account` function looks the account up by alias +
   * recovery word and hands back the EXISTING password. We feed that straight
   * into the ordinary `restoreAccount()` path, so linking the device, re-binding
   * RevenueCat, reloading scores and re-syncing progress all go through the one
   * code path that already knows how to do them — there is no second, slightly
   * different restore to keep in sync.
   *
   * Unlike the alias+password restore in `Paywall.vue`, a failure here must NOT
   * call `logoutLocally()`: the player is free on this device, so there is no
   * premium state to clear.
   */
  async function recoverWithWord(
    alias: string,
    word: string
  ): Promise<{
    success: boolean;
    error?:
      | 'not_found'
      | 'no_recovery_word'
      | 'not_paid'
      | 'invalid'
      | 'already_linked'
      | 'network'
      | 'rate_limited'
      | 'unknown';
    retryAfterSeconds?: number;
  }> {
    const normalizedAlias = alias.trim().toUpperCase();
    const normalizedWord = word.trim().toUpperCase();

    if (!/^[A-Z0-9]{8,16}$/.test(normalizedAlias)) return { success: false, error: 'invalid' };
    if (normalizedWord.length < 4 || normalizedWord.length > 16) {
      return { success: false, error: 'invalid' };
    }

    let password: string;
    try {
      const { data, error } = await supabase.functions.invoke('recover-account', {
        body: { alias: normalizedAlias, recovery_word: normalizedWord },
      });

      // The deployed recover-account answers not_found / no_recovery_word with 404, which
      // supabase-js reports as a generic error. Read the real outcome from the body.
      const businessBody = error ? await asBusinessBody(error) : null;
      if (error && !businessBody) {
        console.error('recover-account failed:', error.message);
        return { success: false, error: 'network' };
      }
      const result: {
        success?: boolean;
        error?: string;
        password?: unknown;
        retry_after_seconds?: number;
      } | null = businessBody ?? data;
      if (!result?.success || typeof result.password !== 'string') {
        const reason = result?.error;
        if (reason === 'no_recovery_word' || reason === 'not_paid') {
          return { success: false, error: reason };
        }
        if (reason === 'rate_limited') {
          return {
            success: false,
            error: 'rate_limited',
            retryAfterSeconds:
              typeof result?.retry_after_seconds === 'number'
                ? result.retry_after_seconds
                : undefined,
          };
        }
        return { success: false, error: 'not_found' };
      }
      password = result.password;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('recover-account error:', message);
      return { success: false, error: 'network' };
    }

    return restoreAccount(normalizedAlias, password);
  }

  // ── Purchase (Hardened) ────────────────────────────────────────────────────
  async function purchase(
    pkg?: unknown,
    alias?: string,
    password?: string,
    htmlTarget?: HTMLElement
  ): Promise<{ success: boolean; error?: string; key?: string }> {
    purchaseError.value = null;
    const currentPlatform = getPlatform();

    // === STRONG NATIVE CHECK - Never allow web billing on real mobile ===
    const isNativeMobile = Capacitor.isNativePlatform();

    if (isNativeMobile) {
      // Force RevenueCat path
      if (!pkg) {
        return { success: false, error: 'No package provided for mobile purchase' };
      }

      let result: any = null;
      // Support passing either a package object or a platform product identifier string
      if (typeof pkg === 'string') {
        result = await RevenueCatService.purchaseProduct(pkg);
      } else {
        result = await RevenueCatService.purchasePackage(pkg);
      }

      if (!result.success) {
        if ('cancelled' in result && result.cancelled) {
          return { success: false, error: 'Purchase cancelled' };
        }
        const message = result.error ?? 'Unknown purchase error';
        purchaseError.value = message;
        return { success: false, error: message };
      }

      // Immediately unlock in UI based on entitlement in the returned customerInfo
      if (result.customerInfo?.entitlements?.active?.[RC_ENTITLEMENT_ID]) {
        isPremium.value = true;
      } else {
        // Fallback: set premium anyway to provide immediate unlock, server will verify
        isPremium.value = true;
      }

      // Sync server state; keep a short delay to let backend webhooks process but don't block UI
      setTimeout(
        () =>
          syncFromServer(true).catch(() => {}),
        1500
      );

      return { success: true };
    }

    // === Desktop / Web → RevenueCat Web SDK (Paddle Billing) ===
    // The checkout renders inline into the paywall's container element; the
    // Paddle flow completes in-app and the webhook (revenuecat-webhook) creates
    // the canonical `accounts` row from subscriber attributes. After the
    // purchase returns we sync the server and poll for the alias.
    if (!pkg) {
      return { success: false, error: 'No package provided for web purchase' };
    }

    const webReady = await RevenueCatService.isWebConfigured();
    if (!webReady) {
      return {
        success: false,
        error:
          'RevenueCat Web Billing is not configured. Connect Paddle under RC dashboard → Web → Billing.',
      };
    }

    // Initialize RC Web SDK with the device Supabase uid (until Phase 4).
    // Set attributes BEFORE purchase so the webhook receives them.
    await RevenueCatService.initWeb(userId.value ?? '');
    if (alias && password) {
      await RevenueCatService.setAttributes({
        skm_alias: alias,
        skm_secret: password,
        user_id: userId.value ?? '',
      });
    }

    const result = await RevenueCatService.purchasePackageWeb(pkg, htmlTarget);
    if (!result.success) {
      if (result.cancelled) return { success: false, error: 'Purchase cancelled' };
      purchaseError.value = result.error ?? 'Purchase failed';
      return { success: false, error: purchaseError.value };
    }

    // Immediate unlock based on the entitlement in the returned customerInfo.
    if (result.customerInfo?.entitlements?.active?.[RC_ENTITLEMENT_ID]) {
      isPremium.value = true;
    } else {
      isPremium.value = true;
    }

    // Sync server state; keep a short delay to let the backend webhook process
    // but don't block the UI.
    setTimeout(
      () =>
        syncFromServer(true).catch(() => {}),
      1500
    );

    return { success: true };
  }

  /**
   * Link a purchase the store already owns to an account.
   *
   * Used when buying fails with "This product is already active for the user": the
   * player HAS paid (possibly on an earlier install with a different anonymous uid,
   * or when the webhook never created an account), so retrying the payment can never
   * work. The `claim-purchase` Edge Function asks RevenueCat whether this device's
   * appUserID holds `pro_access` and, if so, creates/links the account.
   *
   * The alias and password are only used when no account exists for the purchase yet.
   * Business outcomes come back as `{ success: false, error }`; `network` means the
   * request itself failed (offline, 5xx, RevenueCat unreachable) and is safe to retry.
   */
  async function claimPurchase(
    alias: string,
    password: string
  ): Promise<{
    success: boolean;
    alias?: string | null;
    error?:
      | 'not_entitled'
      | 'alias_taken'
      | 'credentials_unavailable'
      | 'invalid_credentials'
      | 'already_linked'
      | 'network'
      | 'unknown';
  }> {
    if (!userId.value) return { success: false, error: 'network' };

    try {
      // After a reinstall the RC appUserID changed. Restore from the store
      // first so Google Play's cached purchase is visible on the new uid,
      // otherwise claim-purchase sees no entitlement and refuses.
      addPaymentLog('claimPurchase:start', { native: Capacitor.isNativePlatform() });
      if (Capacitor.isNativePlatform()) {
        await RevenueCatService.restorePurchases();
      }

      addPaymentLog('claimPurchase:invoke claim-purchase');
      const { data, error } = await supabase.functions.invoke('claim-purchase', {
        body: { alias: alias.trim().toUpperCase(), password: password.trim().toUpperCase() },
      });
      addPaymentLog('claimPurchase:response', {
        transportError: error?.message ?? null,
        success: data?.success ?? null,
        error: data?.error ?? null,
      });

      // supabase-js reports every non-2xx (401, 502 rc_unavailable, 500) as `error`.
      if (error) {
        const detail = await describeInvokeError(error);
        addPaymentLog('claimPurchase:http-error', { status: detail.status, body: detail.body });
        console.error('claim-purchase failed:', error.message);
        return { success: false, error: 'network' };
      }

      if (!data?.success) {
        const known = [
          'not_entitled',
          'alias_taken',
          'credentials_unavailable',
          'invalid_credentials',
          'already_linked',
        ] as const;
        const reason = (known as readonly string[]).includes(data?.error)
          ? (data.error as (typeof known)[number])
          : 'unknown';
        return { success: false, error: reason };
      }

      isPremium.value = true;
      if (data.account_id) accountId.value = data.account_id;
      if (data.alias) {
        userAlias.value = data.alias;
        storeAlias(data.alias);
      }

      // The function never returns the password. loadAccount() reads it (and the
      // recovery word) through get_account_for_device, which only a linked device may call.
      await loadAccount();
      await syncFromServer(true);

      return { success: true, alias: userAlias.value };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('claim-purchase error:', message);
      return { success: false, error: 'network' };
    }
  }

  // ── Unlink device ────────────────────────────────────────────────────────────
  /**
   * Unlinks the current device from its account without deleting anything.
   * Used when a user wants to switch to a different premium account or
   * start fresh after forgetting all credentials.
   */
  async function unlinkDevice(): Promise<{ success: boolean; wasLinked: boolean }> {
    const uid = userId.value;
    if (!uid) return { success: false, wasLinked: false };
    try {
      const { data, error } = await supabase.rpc('unlink_device', { p_user_id: uid });
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row) {
        console.error('unlink_device failed:', error?.message);
        return { success: false, wasLinked: false };
      }
      if (row.success) {
        // Full local wipe (not just credentials): also clears this device's cached
        // scores and progress. Otherwise the old account's scores could later be
        // flushed into whichever account the player links next.
        logoutLocally('device unlinked');

        // loadAccount() may have bound RevenueCat to the old account's customer id.
        // Re-bind to this device's own id so the next purchase is attributed to it.
        if (isNativeMobileForRc()) {
          RevenueCatService.logIn(uid).catch(() => {});
        } else {
          RevenueCatService.initWeb(uid).catch(() => {});
        }
      }
      // The RPC column is snake_case (`was_linked`).
      return { success: !!row.success, wasLinked: !!row.was_linked };
    } catch (err) {
      console.error('unlink_device error:', err);
      return { success: false, wasLinked: false };
    }
  }

  // ── Restore ────────────────────────────────────────────────────────────────
  async function restorePurchases(): Promise<{ success: boolean; isPremium: boolean }> {
    purchaseError.value = null;

    const isNative = Capacitor.isNativePlatform();

    if (isNative) {
      const customerInfo = await RevenueCatService.restorePurchases();
      const hasRCEntitlement = customerInfo?.entitlements?.active?.[RC_ENTITLEMENT_ID];
      if (hasRCEntitlement) {
        // RC says there's a purchase — now sync with Supabase to confirm account exists
        await syncFromServer(true);
        // Load the full account (alias, password, recovery word).
        await loadAccount();
      }
    } else {
      // Web / Electron: initialize RC with device uid, then restore.
      await RevenueCatService.initWeb(userId.value ?? '');
      await RevenueCatService.restorePurchasesWeb().catch(() => null);
      await syncFromServer(true);
      // Load the full account (alias, password, recovery word).
      await loadAccount();
    }

    await syncFromServer(true);

    return { success: true, isPremium: isPremium.value };
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  async function init(): Promise<void> {
    if (isInitialized.value) return;
    isLoading.value = true;

    try {
      platform.value = getPlatform();
      const uid = await ensureAuth();

      // Read the locally-stored alias + password pair BEFORE the server-bound
      // chain. These are what let us flag the manual restore modal if RC
      // restore + server sync still did not make this device premium despite
      // a stored pair — i.e. the purchase lives on a different RC customer id.
      // `loadStoredAlias` / `loadStoredPassword` are the only readers; the
      // variables are local so a failure here can never corrupt state.
      const storedAlias = loadStoredAlias();
      const storedPassword = loadStoredPassword();

      // Initialize RC with the device Supabase uid (until Phase 4). It stays on
      // that uid after a restore too (D13); premium comes from the account row.
      await initRevenueCat(uid);
      await AdMobService.initialize();
      // Resolve the canonical account linked to this device (sets isPremium,
      // alias, password, accountId). Runs after the RC bind above for the
      // first-launch case; for returning devices it confirms server state.
      // Each server round-trip is bounded so a hung Supabase / RPC / Edge
      // Function can never stall the splash screen indefinitely. On timeout
      // we keep whatever local state we already have and land the user on the
      // main screen — a degraded launch is always better than a frozen one.
      const safe = <T>(p: Promise<T>, ms: number) =>
        Promise.race([p, timeout<T>(ms)]).catch((err) => {
          if (err instanceof NetworkTimeoutError) {
            console.warn(
              `⚠️ monetization init step timed out (${ms}ms) — continuing with local state`
            );
            return; // timeout: degraded launch is fine
          }
          // A real error (not a timeout) must still surface — rethrow so
          // the outer catch logs it instead of silently dropping it.
          throw err;
        });

      // Hard cap on the whole server-bound chain. Even if several steps each
      // approach their own 8s timeout, this guarantees isLoading flips false
      // within 5s on any network condition. The cap wraps only the serial
      // server-bound section — RC bind / AdMob init
      // above are local or native and run outside the race.
      await Promise.race([
        (async () => {
          await safe(loadAccount(), 8000);
          await safe(syncFromServer(true), 8000);

          // If RC restore + server sync still did not make this device premium
          // despite a stored alias+password pair, the purchase is on another RC
          // customer id — validate the credentials against the server before
          // showing the manual restore modal.
          useDebugStore().info('monetization: checking stored credentials for restore', {
            hasStoredAlias: !!storedAlias,
            hasStoredPassword: !!storedPassword,
            isPremium: isPremium.value,
            needsRestore: needsRestore.value,
          });
          if (storedAlias && storedPassword && !isPremium.value) {
            const validation = await validateStoredCredentials(storedAlias, storedPassword);
            if (validation.valid) {
              console.log(
                '[init] validateStoredCredentials: valid credentials, restore would succeed, needsRestore=false'
              );
              // The restore-key call would have restored the account, so isPremium should be true now.
              // If not, the next syncFromServer will pick it up.
            } else if (validation.clearStorage) {
              console.log(
                '[init] validateStoredCredentials: clearing stale credentials, reason=',
                validation.reason
              );
              clearStoredAlias();
              clearStoredPassword();
              useDebugStore().info(
                'monetization: validateStoredCredentials setting needsRestore=false',
                { reason: validation.reason }
              );
              needsRestore.value = false;
            } else {
              useDebugStore().info('monetization: validateStoredCredentials result', {
                valid: validation.valid,
                clearStorage: validation.clearStorage,
                reason: validation.reason,
              });
              console.log(
                '[init] validateStoredCredentials: keeping credentials for retry, reason=',
                validation.reason
              );
              useDebugStore().info(
                'monetization: validateStoredCredentials setting needsRestore=true',
                { reason: validation.reason }
              );
              needsRestore.value = true;
            }
          }
        })(),
        timeout<void>(5000),
      ]).catch((err) => {
        if (err instanceof NetworkTimeoutError) {
          console.warn(
            '⚠️ monetization init chain hit the 5s hard cap — launching with local state'
          );
        } else {
          throw err;
        }
      });

      useDebugStore().info('monetization: init complete', {
        isInitialized: true,
        isPremium: isPremium.value,
        needsRestore: needsRestore.value,
      });
      isInitialized.value = true;
      console.log(
        `✅ Monetization ready | platform: ${platform.value} | premium: ${isPremium.value}`
      );
    } catch (err) {
      console.error('❌ Monetization init error:', err);
    } finally {
      isLoading.value = false;
    }
  }

  // ── Ad helpers ─────────────────────────────────────────────────────────────
  async function preloadAd(): Promise<void> {
    await AdMobService.preload(isPremium.value);
  }

  async function showAdIfReady(): Promise<boolean> {
    return AdMobService.showIfReady(isPremium.value);
  }

  async function requestTrackingTransparency(): Promise<void> {
    await AdMobService.requestTrackingTransparency();
  }

  function reset(): void {
    userId.value = null;
    isPremium.value = false;
    platform.value = 'web';
    isLoading.value = false;
    isInitialized.value = false;
    purchaseError.value = null;
    userAlias.value = null;
    userPassword.value = null;
    recoveryWord.value = null;
    needsRestore.value = false;
    accountId.value = null;
    clearStoredAlias();
    clearStoredPassword();
    AdMobService.reset();
  }

  return {
    userId,
    accountId,
    isPremium,
    platform,
    isLoading,
    isInitialized,
    purchaseError,
    userAlias,
    userPassword,
    recoveryWord,
    needsRestore,
    init,
    reset,
    loadAccount,
    syncFromServer,
    purchase,
    claimPurchase,
    unlinkDevice,
    restorePurchases,
    restoreAccount,
    setRecoveryWord,
    recoverWithWord,
    getLeaderboard,
    checkAliasAvailability,
    logoutLocally,
    loadStoredAlias,
    loadStoredPassword,
    preloadAd,
    showAdIfReady,
    requestTrackingTransparency,
  };
});
