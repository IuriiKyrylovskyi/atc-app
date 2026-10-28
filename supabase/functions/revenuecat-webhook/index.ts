// supabase/functions/revenuecat-webhook/index.ts
//
// Receives RevenueCat purchase events and creates/updates the canonical
// `accounts` row. The RC appUserID is the device's Supabase anonymous UUID
// (set during RevenueCatService.initialize()).
// User-chosen alias/password are passed as subscriber attributes BEFORE purchase
// (skm_alias, skm_secret — RevenueCat hides values named "password").
// The webhook reads them and creates the account with is_premium=true.
// If account doesn't exist, it claims the device's placeholder account (or
// creates one) with is_premium=true. If it exists, updates is_premium.
// TRANSFER events re-assign the purchase to a new device; the webhook links
// the new device to the existing account.
//
// Subscriber attributes are written by the client, so they are untrusted input:
// alias and password are re-validated here (same rule as claim-purchase), and the
// `user_id` attribute is used only when it names the RevenueCat customer itself.
// Sandbox events are accepted on purpose: App Review and TestFlight buy in the
// sandbox against the production build (decision D12).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from 'https://esm.sh/@supabase/supabase-js@^2/cors';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const webhookSecret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET')!;

const GRANT = [
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION', // RevenueCat event type — fixed from 'UNCANCEL'
  'PRODUCT_CHANGE',
  'NON_RENEWING_PURCHASE',
  'REFUND_REVERSED', // A refund was reversed — premium must be restored
  'TRANSFER', // Purchase transferred to a new appUserId (new identity now owns the entitlement)
];
const REVOKE = ['CANCELLATION', 'EXPIRATION', 'BILLING_ISSUE', 'REFUND'];

// Same rule as the client (credentialRules.ts) and claim-purchase.
const CREDENTIAL_REGEX = /^[A-Z0-9]{8,16}$/;

const db = createClient(supabaseUrl, serviceKey);

function normalizeAttribute(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toUpperCase();
  return v.length > 0 ? v : null;
}

// Compares in time independent of where the strings differ, so the secret cannot
// be guessed byte by byte from response timing.
function timingSafeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

async function generated(fn: 'generate_alias' | 'generate_password'): Promise<string> {
  const { data, error } = await db.rpc(fn);
  if (error || typeof data !== 'string') {
    throw new Error(`${fn} failed: ${error?.message ?? 'no value'}`);
  }
  return data;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (!webhookSecret) {
    console.error('REVENUECAT_WEBHOOK_SECRET is not set; refusing every request');
    return new Response('Server misconfigured', { status: 500, headers: corsHeaders });
  }
  if (!timingSafeEqual(req.headers.get('authorization') ?? '', `Bearer ${webhookSecret}`)) {
    console.error('Unauthorized webhook request');
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }

  try {
    const { event } = await req.json();

    // The app_user_id from RevenueCat is now the Supabase anonymous UUID (device ID)
    // set during RevenueCatService.initialize(). TRANSFER events have transferred_to.
    let appUserId: string | null = event?.app_user_id ?? null;
    if (!appUserId && event?.transferred_to?.length > 0) {
      appUserId = event.transferred_to[0];
    }
    if (!appUserId) {
      return new Response('Missing app_user_id', { status: 400, headers: corsHeaders });
    }

    // The RC app_user_id is the device UUID (Supabase anon id). This becomes
    // the unique rc_customer_id. The password is a separate user-chosen field.
    const rcCustomerId = String(appUserId).trim();
    const eventType = event.type as string;
    // RevenueCat sends `entitlement_ids` (array). `entitlement_id` is null/deprecated.
    const entitlementIds: string[] = Array.isArray(event.entitlement_ids)
      ? (event.entitlement_ids as string[])
      : event.entitlement_id
      ? [event.entitlement_id as string]
      : [];

    // Read alias/password/device from subscriber attributes (set client-side before purchase).
    // RevenueCat delivers them as `event.subscriber_attributes` (map of name -> { value, ... }).
    // `event.subscriber.attributes` is the REST API shape, not the webhook shape; kept as a fallback.
    // Prefer new attribute names (skm_alias, skm_secret) — RevenueCat hides values named "password".
    const attributes = (event.subscriber_attributes ??
      (event.subscriber as Record<string, unknown> | undefined)?.attributes) as
      | Record<string, { value: string }>
      | undefined;
    const alias =
      normalizeAttribute(attributes?.skm_alias?.value) ??
      normalizeAttribute(attributes?.alias?.value);
    const password =
      normalizeAttribute(attributes?.skm_secret?.value) ??
      normalizeAttribute(attributes?.password?.value);
    // The Supabase anonymous id of the device that pressed "buy". Used to link
    // the profile to the new account and to hand it the first play session.
    // RevenueCat is bound to the device uid on every platform (D3), so a genuine
    // user_id always equals the customer id (or, for a TRANSFER, one of
    // transferred_to). Anything else is a tampered attribute and is ignored.
    const claimedDeviceId =
      typeof attributes?.user_id?.value === 'string' ? attributes.user_id.value.trim() : '';
    const transferredTo: string[] = Array.isArray(event.transferred_to)
      ? (event.transferred_to as unknown[]).map((v) => String(v).trim())
      : [];
    const deviceId =
      claimedDeviceId &&
      (claimedDeviceId === rcCustomerId || transferredTo.includes(claimedDeviceId))
        ? claimedDeviceId
        : null;
    if (claimedDeviceId && !deviceId) {
      console.warn(
        `user_id attribute ${claimedDeviceId.slice(0, 8)}... does not match the RevenueCat ` +
          `customer; not linking it`
      );
    }

    console.log(
      `Webhook: ${eventType} for rc_customer_id ${rcCustomerId.slice(0, 8)}... ` +
        `alias=${alias?.slice(0, 4)}... password=${password ? 'present' : 'null'} ` +
        `deviceId=${deviceId ? deviceId.slice(0, 8) + '...' : 'null'} ` +
        `env=${event.environment ?? '?'} attrs=[${Object.keys(attributes ?? {}).join(', ')}]`
    );

    if (entitlementIds.length > 0 && !entitlementIds.includes('pro_access')) {
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    let isPremium: boolean | null = null;
    if (GRANT.includes(eventType)) isPremium = true;
    if (REVOKE.includes(eventType)) isPremium = false;

    if (isPremium === null) {
      console.log(`Unhandled event type: ${eventType}`);
      return new Response(JSON.stringify({ success: true, action: 'ignored' }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const now = new Date().toISOString();
    // purchased_at is the FIRST purchase time: set on creation, and on an existing
    // account only while it is still empty (renewals and transfers keep it).
    const update: Record<string, unknown> = {
      is_premium: isPremium,
      rc_customer_id: rcCustomerId,
      updated_at: now,
    };

    // Find account by rc_customer_id (the device UUID) FIRST.
    // This is the primary unique key. Password is only used for manual restore.
    const { data: rcRows, error: rcError } = await db
      .from('accounts')
      .select('id')
      .eq('rc_customer_id', rcCustomerId)
      .limit(1);

    if (rcError) {
      console.error('Account rc_customer_id lookup failed:', rcError.message);
      return new Response('DB Error', { status: 500, headers: corsHeaders });
    }

    let accountId = rcRows && rcRows.length > 0 ? rcRows[0].id : null;

    // TRANSFER: account exists under the old device's rc_customer_id (transferred_from).
    // The new device's rc_customer_id (transferred_to / app_user_id) won't have a row yet.
    // RevenueCat lists EVERY customer the purchase came from, so look at all of them,
    // not only the first (the first one may be an anonymous id that never had an account).
    if (!accountId && eventType === 'TRANSFER' && Array.isArray(event.transferred_from)) {
      const oldIds = (event.transferred_from as unknown[])
        .map((v) => String(v).trim())
        .filter((v) => v.length > 0 && v !== rcCustomerId);
      if (oldIds.length > 0) {
        const { data: oldRows } = await db
          .from('accounts')
          .select('id, rc_customer_id')
          .in('rc_customer_id', oldIds)
          .limit(1);
        accountId = oldRows && oldRows.length > 0 ? oldRows[0].id : null;
        console.log(
          `TRANSFER: ${accountId ? `found account ${accountId.slice(0, 8)}...` : 'no account'} ` +
            `among ${oldIds.length} old rc_customer_id(s) [${oldIds
              .map((v) => v.slice(0, 8))
              .join(', ')}]`
        );
      }
    }

    if (!accountId) {
      // A revoking event for a customer with no account must not create one.
      if (!isPremium) {
        console.log(`No account for ${eventType}; nothing to revoke`);
        return new Response(JSON.stringify({ success: true, action: 'no_account_to_revoke' }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      // No account matched the RC customer id yet. This is the first purchase
      // of a user who chose their credentials in the paywall.
      if (!alias || !password) {
        console.warn(
          `No account matched rc_customer_id=${rcCustomerId.slice(
            0,
            8
          )}... and no alias/password attributes to create one. ` +
            `type=${eventType} env=${event.environment ?? '?'} ` +
            `attribute keys: [${Object.keys(attributes ?? {}).join(', ')}]`
        );
        return new Response(JSON.stringify({ success: true, action: 'no_match' }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // The attributes come from the client, so re-check them. A paying customer
      // must never be left without an account: a bad password is replaced by a
      // generated one (the linked device reads it back through
      // get_account_for_device and shows it on the Profile screen), and a bad
      // alias, or one equal to the password, by a generated alias.
      let finalPassword = password;
      if (!CREDENTIAL_REGEX.test(finalPassword)) {
        finalPassword = await generated('generate_password');
        console.warn('skm_secret has an invalid format; assigned a generated password');
      }

      // The alias must be free. If taken, generate a unique one so the paying
      // customer is never left without an account.
      // Allow the same rc_customer_id to reuse their own alias (re-purchase).
      let finalAlias = alias;
      if (!CREDENTIAL_REGEX.test(finalAlias) || finalAlias === finalPassword) {
        finalAlias = await generated('generate_alias');
        console.warn(`skm_alias is invalid or equals the password; assigned ${finalAlias}`);
      }
      const { data: existingAlias } = await db
        .from('accounts')
        .select('id, rc_customer_id')
        .eq('alias', finalAlias)
        .limit(1);

      if (existingAlias && existingAlias.length > 0) {
        const existing = existingAlias[0];
        if (existing.rc_customer_id !== rcCustomerId) {
          const taken = finalAlias;
          finalAlias = await generated('generate_alias');
          console.warn(`Alias ${taken} taken by another user, assigned ${finalAlias}`);
        }
      }

      // Devices that signed up under the previous implementation already own an
      // empty placeholder account, so the purchase lands on that row instead of
      // creating a duplicate. A device that signed up under the current
      // trigger has no account yet and falls through to the insert below.
      let placeholderAccountId: string | null = null;
      if (deviceId) {
        const { data: deviceProfile } = await db
          .from('profiles')
          .select('account_id')
          .eq('id', deviceId)
          .limit(1);

        const candidateId = deviceProfile?.[0]?.account_id ?? null;
        if (candidateId) {
          const { data: candidate } = await db
            .from('accounts')
            .select('id, alias, is_premium')
            .eq('id', candidateId)
            .limit(1);

          const existing = candidate?.[0];
          if (existing && !existing.alias && !existing.is_premium) {
            placeholderAccountId = existing.id;
          }
        }
      }

      const claimValues = {
        alias: finalAlias,
        password: finalPassword,
        is_premium: isPremium,
        rc_customer_id: rcCustomerId,
        purchased_at: isPremium ? now : null,
        updated_at: now,
      };

      if (placeholderAccountId) {
        const { error: claimError } = await db
          .from('accounts')
          .update(claimValues)
          .eq('id', placeholderAccountId);

        if (claimError) {
          console.error('Account claim failed:', claimError.message);
          return new Response('DB Error', { status: 500, headers: corsHeaders });
        }
        accountId = placeholderAccountId;
        console.log(
          `Claimed placeholder account ${accountId.slice(0, 8)}... for the purchasing device`
        );
      } else {
        let insertError: unknown = null;
        let newAccount: { id: string } | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          const result = await db.from('accounts').insert(claimValues).select('id').single();
          insertError = result.error;
          newAccount = result.data;
          if (!insertError) break;
          if (
            result.error &&
            typeof result.error === 'object' &&
            'code' in result.error &&
            (result.error as { code: string }).code === '23505'
          ) {
            claimValues.alias = await generated('generate_alias');
            console.warn(
              `Insert failed with unique violation, retrying with generated alias ${claimValues.alias}`
            );
            continue;
          }
          break;
        }

        if (insertError) {
          console.error('Account creation failed:', insertError);
          return new Response('DB Error', { status: 500, headers: corsHeaders });
        }
        accountId = newAccount!.id;
        console.log(
          `Created new account ${accountId.slice(0, 8)}... for rc_customer_id ${rcCustomerId.slice(
            0,
            8
          )}...`
        );
      }
    } else {
      // Account exists — update it
      // rc_customer_id is immutable after creation (only set on first purchase)
      // EXCEPTION: TRANSFER events reassign the purchase to a new device,
      // so we update rc_customer_id to the new device's ID.
      const isTransfer = eventType === 'TRANSFER';
      let updateForExisting = update;
      if (!isTransfer) {
        // Remove rc_customer_id from update for existing accounts (non-TRANSFER)
        const { rc_customer_id: _unused, ...rest } = update;
        updateForExisting = rest;
      }

      // If valid alias/password provided and account doesn't have them yet, update.
      // Invalid attributes are never written (the account keeps what it has).
      if (
        alias &&
        password &&
        CREDENTIAL_REGEX.test(alias) &&
        CREDENTIAL_REGEX.test(password) &&
        alias !== password
      ) {
        const { data: currentAccount } = await db
          .from('accounts')
          .select('alias, password')
          .eq('id', accountId)
          .limit(1)
          .single();

        if (currentAccount && (!currentAccount.alias || !currentAccount.password)) {
          await db
            .from('accounts')
            .update({ alias, password, updated_at: now })
            .eq('id', accountId);
        }
      }

      const { error: accountError } = await db
        .from('accounts')
        .update(updateForExisting)
        .eq('id', accountId);

      if (accountError) {
        console.error('Account update failed:', accountError.message);
        return new Response('DB Error', { status: 500, headers: corsHeaders });
      }

      if (isPremium) {
        await db
          .from('accounts')
          .update({ purchased_at: now })
          .eq('id', accountId)
          .is('purchased_at', null);
      }
    }

    // Sync the is_premium cache on every linked profile
    const { error: profileError } = await db
      .from('profiles')
      .update({ is_premium: isPremium, updated_at: now })
      .eq('account_id', accountId);

    if (profileError) {
      console.error('Profile cache update failed:', profileError.message);
    }

    // Link the device that bought to the account and hand it the first play
    // session. Without this the buying device keeps its own placeholder account
    // and never sees the alias/password, so it cannot restore anywhere.
    // Use upsert (transitional — Phase 4 removes the device link from profiles).
    if (deviceId) {
      const { error: linkError } = await db
        .from('profiles')
        .upsert(
          { id: deviceId, account_id: accountId, is_premium: isPremium, updated_at: now },
          { onConflict: 'id' }
        );

      if (linkError) {
        console.error('Purchasing device link failed:', linkError.message);
      } else if (isPremium) {
        // Only hand the session over when nobody holds a live one — a renewal
        // event fired from a second device must not steal the session from the
        // device that is actually playing.
        const { data: current } = await db
          .from('accounts')
          .select('active_device_id, session_expires_at')
          .eq('id', accountId)
          .limit(1);

        const holder = current?.[0];
        const sessionFree =
          !holder?.active_device_id ||
          holder.active_device_id === deviceId ||
          !holder.session_expires_at ||
          new Date(holder.session_expires_at).getTime() <= Date.now();

        if (sessionFree) {
          const { error: sessionError } = await db
            .from('accounts')
            .update({
              active_device_id: deviceId,
              last_heartbeat: now,
              session_expires_at: new Date(Date.now() + 90 * 1000).toISOString(),
              updated_at: now,
            })
            .eq('id', accountId);

          if (sessionError) {
            console.error('Play session hand-off failed:', sessionError.message);
          } else {
            console.log(`Granted first play session to device ${deviceId.slice(0, 8)}...`);
          }
        } else {
          console.log('Play session already held by another device — not stealing it');
        }
      }
    }

    console.log(`Set is_premium=${isPremium} for account ${accountId.slice(0, 8)}...`);
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    return new Response('Bad Request', { status: 400, headers: corsHeaders });
  }
});
