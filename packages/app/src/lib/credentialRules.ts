/**
 * Local credential validation rules — no network calls.
 * Used by Paywall.vue for instant format feedback.
 */

// Alphanumeric uppercase: A-Z, 0-9
export const ALIAS_RE = /^[A-Z0-9]{8,16}$/;
export const PASSWORD_RE = /^[A-Z0-9]{8,16}$/;
// Recovery word: A-Z 0-9 only
export const WORD_RE = /^[A-Z0-9]{4,16}$/;

export const normalize = (s: string): string => s.trim().toUpperCase();

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateAlias(alias: string): ValidationResult {
  const normalized = normalize(alias);
  if (!normalized) return { valid: false, error: 'empty' };
  if (!ALIAS_RE.test(normalized)) return { valid: false, error: 'invalid_format' };
  return { valid: true };
}

export function validatePassword(password: string): ValidationResult {
  const normalized = normalize(password);
  if (!normalized) return { valid: false, error: 'empty' };
  if (!PASSWORD_RE.test(normalized)) return { valid: false, error: 'invalid_format' };
  return { valid: true };
}

export function validateConfirm(password: string, confirm: string): ValidationResult {
  const normPass = normalize(password);
  const normConf = normalize(confirm);
  if (!normConf) return { valid: false, error: 'empty' };
  if (normConf !== normPass) return { valid: false, error: 'mismatch' };
  return { valid: true };
}

export function validateWord(word: string): ValidationResult {
  const normalized = normalize(word);
  if (!normalized) return { valid: false, error: 'empty' };
  if (!WORD_RE.test(normalized)) return { valid: false, error: 'invalid_format' };
  return { valid: true };
}

// Cross-field rules
export function validateAliasVsPassword(alias: string, password: string): ValidationResult {
  const normAlias = normalize(alias);
  const normPass = normalize(password);
  if (normAlias && normPass && normAlias === normPass) {
    return { valid: false, error: 'alias_equals_password' };
  }
  return { valid: true };
}

export function validateWordVsAlias(word: string, alias: string): ValidationResult {
  const normWord = normalize(word);
  const normAlias = normalize(alias);
  if (normWord && normAlias && normWord === normAlias) {
    return { valid: false, error: 'word_equals_alias' };
  }
  return { valid: true };
}

export function validateWordVsPassword(word: string, password: string): ValidationResult {
  const normWord = normalize(word);
  const normPass = normalize(password);
  if (normWord && normPass && normWord === normPass) {
    return { valid: false, error: 'word_equals_password' };
  }
  return { valid: true };
}

/**
 * Message for a `rate_limited` answer from restore-key or recover-account (too many
 * failed guesses for this alias, network or device within an hour).
 */
export function tooManyAttemptsMessage(retryAfterSeconds?: number): string {
  if (!retryAfterSeconds || retryAfterSeconds <= 0) {
    return 'Too many attempts. Please try again later.';
  }
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}
