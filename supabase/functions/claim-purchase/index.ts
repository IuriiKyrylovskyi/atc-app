// supabase/functions/claim-purchase/index.ts
//
// Recovers a purchase that RevenueCat / the store already recorded but that never
// became an `accounts` row (webhook returned `no_match`, was rejected with 401, or
// the player reinstalled and got a new anonymous uid, so the store answers
// "This product is already active for the user").
//
// Proof of ownership is the RevenueCat entitlement itself, NOT anything the client
// says: the caller's identity comes from the verified JWT (never the request body),
// and that identity is the RevenueCat appUserID on this device. The function asks the
// RevenueCat REST API whether that appUserID currently holds `pro_access`.
//
//   - Entitlement active + an account already exists for this purchase
//       -> link this device to it (same effect as a TRANSFER) and return its alias.
//   - Entitlement active + no account yet
//       -> create it from the alias/password the player typed, link this device.
//   - Entitlement not active -> `not_entitled`. Nothing is written.
//
// The password is never returned. After success the client calls loadAccount(),
// whose get_account_for_device RPC already returns it to a linked device.
//
// Business outcomes are returned as HTTP 200 with { success: false, error }.
// supabase-js turns every non-2xx into a FunctionsHttpError with no parsed body, so
// non-2xx is reserved for auth failures, a bad request and upstream/DB faults.
//
// Secrets required:  REVENUECAT_SECRET_API_KEY  (RevenueCat -> API keys -> Secret key, "sk_...")
// JWT verification:  leave ON (default). Do NOT add this function to config.toml with
//                    verify_jwt = false.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from 'https://esm.sh/@supabase/supabase-js@^2/cors';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const rcSecretKey = Deno.env.get('REVENUECAT_SECRET_API_KEY')!;
const db = createClient(supabaseUrl, serviceKey);

const ENTITLEMENT_ID = 'pro_access';
const CREDENTIAL_REGEX = /^[A-Z0-9]{8,16}$/;
const RC_TIMEOUT_MS = 8000;

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function mask(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}...` : '***';
}

// ── RevenueCat ────────────────────────────────────────────────────────────────
type EntitlementResult =
  | { ok: true; active: boolean; originalAppUserId: string | null }
  | { ok: false; reason: string };

async function checkEntitlement(appUserId: string): Promise<EntitlementResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RC_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
      {
        headers: { Authorization: `Bearer ${rcSecretKey}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
      }
    );
    if (!res.ok) {
      return { ok: false, reason: `revenuecat_http_${res.status}` };
    }
    const body = await res.json();
    const subscriber = body?.subscriber;
    const ent = subscriber?.entitlements?.[ENTITLEMENT_ID];
    const now = Date.now();

    // Lifetime purchases have expires_date = null. A subscription is active until
    // expires_date, or until the grace period ends when one is running.
    let active = false;
    if (ent) {
      const expires = ent.expires_date ? Date.parse(ent.expires_date) : null;
      const grace = ent.grace_period_expires_date
        ? Date.parse(ent.grace_period_expires_date)
        : null;
      active = expires === null || expires > now || (grace !== null && grace > now);
    }

    const original =
      typeof subscriber?.original_app_user_id === 'string' ? subscriber.original_app_user_id : null;
    return { ok: true, active, originalAppUserId: original };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  // 1. Identity comes from the JWT only. The body is never trusted for it.
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ success: false, error: 'unauthorized' }, 401);

  const { data: userData, error: authError } = await db.auth.getUser(token);
  if (authError || !userData?.user) {
    return json({ success: false, error: 'unauthorized' }, 401);
  }
  const userId = userData.user.id;

  let body: { alias?: unknown; password?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: 'bad_request' }, 400);
  }
  const alias = normalize(body.alias);
  const password = normalize(body.password);

  // 2. Does RevenueCat say this device's appUserID owns the entitlement?
  //    On native and web the RC appUserID is the device Supabase uid until Phase 4.
  const rc = await checkEntitlement(userId);
  if (!rc.ok) {
    console.error(`claim-purchase: RevenueCat lookup failed for ${mask(userId)}: ${rc.reason}`);
    return json({ success: false, error: 'rc_unavailable' }, 502);
  }
  if (!rc.active) {
    console.log(`claim-purchase: ${mask(userId)} has no active ${ENTITLEMENT_ID}`);
    return json({ success: false, error: 'not_entitled' });
  }

  const now = new Date().toISOString();

  // 3. What does this device already point at?
  const { data: profileRows, error: profileError } = await db
    .from('profiles')
    .select('account_id')
    .eq('id', userId)
    .limit(1);
  if (profileError) {
    console.error('claim-purchase: profile lookup failed:', profileError.message);
    return json({ success: false, error: 'db_error' }, 500);
  }
  const linkedAccountId: string | null = profileRows?.[0]?.account_id ?? null;

  let linkedAccount: { id: string; alias: string | null; is_premium: boolean } | null = null;
  if (linkedAccountId) {
    const { data } = await db
      .from('accounts')
      .select('id, alias, is_premium')
      .eq('id', linkedAccountId)
      .limit(1);
    linkedAccount = data?.[0] ?? null;
  }
  // An empty placeholder (no alias, not premium) is not a real link and may be reused.
  const linkedIsReal = !!linkedAccount && (linkedAccount.is_premium || !!linkedAccount.alias);

  // 4. Is there already an account for this purchase? Matches the current uid, or the
  //    customer's original uid when the purchase was transferred to this device.
  const rcIds = [userId, rc.originalAppUserId].filter((v): v is string => !!v);
  const { data: existingRows, error: existingError } = await db
    .from('accounts')
    .select('id, alias')
    .in('rc_customer_id', rcIds)
    .limit(1);
  if (existingError) {
    console.error('claim-purchase: account lookup failed:', existingError.message);
    return json({ success: false, error: 'db_error' }, 500);
  }
  const existing = existingRows?.[0] ?? null;

  // Idempotent: this device is already linked to the right real account.
  if (linkedIsReal && (!existing || existing.id === linkedAccount!.id)) {
    await db
      .from('accounts')
      .update({ is_premium: true, updated_at: now })
      .eq('id', linkedAccount!.id);
    await db.from('profiles').update({ is_premium: true, updated_at: now }).eq('id', userId);
    return json({
      success: true,
      account_id: linkedAccount!.id,
      alias: linkedAccount!.alias,
      already: true,
    });
  }
  // A device belongs to one real account; refuse to silently re-point it.
  if (linkedIsReal && existing && existing.id !== linkedAccount!.id) {
    return json({ success: false, error: 'already_linked' });
  }

  let accountId: string;
  let finalAlias: string | null;

  if (existing) {
    // 4a. Purchase already has an account: re-bind it to this device (TRANSFER semantics).
    accountId = existing.id;
    finalAlias = existing.alias ?? null;
    const { error } = await db
      .from('accounts')
      .update({ is_premium: true, rc_customer_id: userId, updated_at: now })
      .eq('id', accountId);
    if (error) {
      console.error('claim-purchase: account re-bind failed:', error.message);
      return json({ success: false, error: 'db_error' }, 500);
    }
    console.log(`claim-purchase: re-linked ${mask(userId)} to existing account ${mask(accountId)}`);
  } else {
    // 4b. No account yet: create it from the credentials the player chose.
    if (!CREDENTIAL_REGEX.test(alias) || !CREDENTIAL_REGEX.test(password) || alias === password) {
      return json({ success: false, error: 'invalid_credentials' });
    }

    const { data: taken } = await db.from('accounts').select('id').eq('alias', alias).limit(1);
    if (taken && taken.length > 0) {
      return json({ success: false, error: 'alias_taken' });
    }

    const values = {
      alias,
      password,
      is_premium: true,
      rc_customer_id: userId,
      purchased_at: now,
      updated_at: now,
    };

    if (linkedAccount && !linkedIsReal) {
      const { error } = await db.from('accounts').update(values).eq('id', linkedAccount.id);
      if (error) {
        return dbFault(error);
      }
      accountId = linkedAccount.id;
    } else {
      const { data, error } = await db.from('accounts').insert(values).select('id').single();
      if (error || !data) {
        return dbFault(error);
      }
      accountId = data.id;
    }
    finalAlias = alias;
    console.log(`claim-purchase: created account ${mask(accountId)} for ${mask(userId)}`);
  }

  // 5. Link this device and refresh the cached premium flag on every linked profile.
  const { error: linkError } = await db
    .from('profiles')
    .upsert(
      { id: userId, account_id: accountId, is_premium: true, updated_at: now },
      { onConflict: 'id' }
    );
  if (linkError) {
    console.error('claim-purchase: device link failed:', linkError.message);
    return json({ success: false, error: 'db_error' }, 500);
  }
  await db
    .from('profiles')
    .update({ is_premium: true, updated_at: now })
    .eq('account_id', accountId);

  // No play-session hand-off needed: the new account has no active device, so the
  // client's first check_and_claim_play_session wins it.
  return json({ success: true, account_id: accountId, alias: finalAlias });
});

/**
 * Unique violations here mean the alias (re-checked in case of a race) or the password
 * collided. Both are business outcomes the player can fix, so they return 200.
 * `accounts.password` is unique, so a collision cannot be avoided; the message stays
 * generic so it does not confirm which password belongs to someone else.
 */
function dbFault(error: unknown): Response {
  const code =
    error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : null;
  if (code === '23505') {
    return json({ success: false, error: 'credentials_unavailable' });
  }
  console.error('claim-purchase: account write failed:', error);
  return json({ success: false, error: 'db_error' }, 500);
}
