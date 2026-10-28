/**
 * packages/app/src/lib/redact.ts
 *
 * Masks secrets before a debug view shows them. Passwords are stored in plain
 * text (decision D11), so a screenshot or a pasted debug dump must never carry
 * one, nor the Supabase session: its refresh token signs in as the device, and
 * the device can read its account's password (FIX_PREMIUM.md 5.11).
 */

/** A secret as a debug view may show it: whether it is set, never the value. */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return '—';
  return `set (${value.length} chars)`;
}

const SECRET_KEY_RE = /password|secret|token|recovery/i;

/** A localStorage value as the debug panel may show it. */
export function redactStorageValue(key: string, raw: string): string {
  if (!raw) return '(empty)';
  // supabase-js keeps the whole session (access + refresh token) under
  // `sb-<project>-auth-token`.
  if (key.endsWith('-auth-token')) {
    try {
      const session = JSON.parse(raw) as { expires_at?: number; user?: { id?: string } };
      const uid = session.user?.id ? `${session.user.id.slice(0, 8)}…` : '?';
      const expires = session.expires_at ? new Date(session.expires_at * 1000).toISOString() : '?';
      return `session for ${uid}, expires ${expires} (tokens hidden)`;
    } catch {
      return maskSecret(raw);
    }
  }
  return SECRET_KEY_RE.test(key) ? maskSecret(raw) : raw;
}
