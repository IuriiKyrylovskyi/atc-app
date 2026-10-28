> **Historical note (2026-10-25):** this is an early design brainstorm. It is superseded by `FIX_PREMIUM.md` and `PURCHASE_FLOW_INSTRUCTIONS.md`. In particular, `logIn(password)` (step 3 and the table) was removed in task 1.4: the RevenueCat user ID is the device Supabase uid.

# the app purchase flow and main idea was only paid user becomes premium. new premuim users are created in db when they paid. we do not care about free users.

this is crossplatform app with web availability. once paid you become a premium user and can play from any device or online throuth website entering your alias and password. premium users have access to all airports, their scores, progress are stored in db and they can vote for new fitures or airport implementations.
so it doesn't make sense to store unpaid user in db. that's why purchase flow and premium user creating flow should be:

1. user opens Paywall modal
2. user enters alias and password
3. alias and password are kept to provide in case success payment (alias and password are in webhook now if i'm not wrong)
4. user push 'Unlock full access' button
5. submodal opens with info that user should store/remember alias and password
6. user push 'Roger' button on this submodal and payment should be triggered (this should be implemented), submodal closes and 'Unlock full access' button becomes in loading (proceeding) state
7. if payment is succesful the new user is created in db and user data is received in app with flag isPremium = true
8. Paywall modal is closed

//===================================
Above flow is the right design, and most of it is already in the code. I checked it step by step.

| Step                                                                                         | Status                                                                                                         |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1. Paywall modal opens                                                                       | Works                                                                                                          |
| 2. Alias and password entered, with checks for format, alias availability and password match | Works                                                                                                          |
| 3. Alias and password kept for after payment                                                 | Works. `logIn(password)` and `setAttributes({alias, password, user_id})` run **before** the purchase           |
| 4. "Unlock full access" button                                                               | Works. It opens the disclaimer first                                                                           |
| 5. Disclaimer submodal                                                                       | Works                                                                                                          |
| 6. "Roger" triggers the payment                                                              | **Missing.** It only closed the modal, so the user had to tap "Unlock full access" again                       |
| 7. Account created on payment, `isPremium` received                                          | Webhook was broken (fixed above). The app waited a fixed 1.5 s and then flipped `isPremium` to true on its own |
| 8. Paywall closes                                                                            | It closed even when the account hadn't arrived                                                                 |

**What I changed in `Paywall.vue`** (the card below has the whole file, so replace yours):

1. **Roger starts the payment.** `confirmCredentials()` now sets the flag, closes the submodal and calls `handlePrimaryAction()`. The button shows "Processing..." through the whole purchase (it already did while `isPurchasing` is set). This covers native and web.
2. **The app waits for the real account.** I removed the fixed 1.5 s delay and the hand-set `isPremium = true`. A new `waitForPremiumAccount()` polls every 1.5 s, for up to 30 s, until the account has arrived from the database with `isPremium` and the alias. The paywall closes only then. If it doesn't arrive, it stays open with "Payment received. Your account is still being set up…" and the user can tap Restore. It never closes on a purchase that has no account.
3. **Typo fix:** the button label "Disreagard" is now "Disregard".

I couldn't run the file, so type-check and test it. The poll relies on `monetization.syncFromServer(true)` and `loadAccount()` updating `isPremium` and `userAlias` from the database, which matches how they are used elsewhere in the file.

**Combined with the webhook fix, your flow now works end to end:** Roger, then payment, then the webhook creates the account from the attributes, then the app receives `isPremium = true`, then the modal closes.

**Things worth knowing**

- **`alias_taken`:** if two people pick the same alias at the same moment, the webhook refuses to create the account after the payment went through. The paywall's availability check makes this rare, but plan a refund or a manual fix for it.
- **Free users do exist in the database today.** Your Oct 4 logs show a Supabase anonymous login, a `profiles` read and `get_account_for_device` for a device with no purchase. So "unpaid users aren't stored" is true for the `accounts` table (only the webhook creates rows there), but not for anonymous auth users and `profiles`. If you want zero rows for free players, that is a separate refactor, and I'd do it after Apple. Tell me if you want me to look at it.
- **Cancelling a payment** still clears alias and password, so the user has to retype them. I left that as it was. I can keep the inputs on cancel if you prefer.
- **Disclaimer wording:** "we would like to help you if any trouble but we really don't know who you are" reads unpolished. Apple flagged "unrefined" content, so consider a cleaner sentence. I didn't change your text.

**Test checklist (TestFlight, new sandbox Apple ID, clean install)**

1. Open the paywall, type a new alias and password, tap "Unlock full access".
2. The disclaimer opens. Tap "Roger", and the Apple payment sheet should appear by itself.
3. The button shows "Processing..." and you pay. The paywall closes on its own after a few seconds.
4. Check the webhook event in RevenueCat for `{"success":true}`, and the `accounts` row (use `SUPERBASE_Define_Users_Qwery.sql`) for your alias and `is_premium = true`.
5. Relaunch: premium persists. Then restore from a second device with the alias and password.

Deploy the fixed webhook first, since without it step 4 fails again.

// supabase/functions/revenuecat-webhook/index.ts
//
// Receives RevenueCat purchase events and creates/updates the canonical
// `accounts` row. The RC appUserID is the account's private `password`
// (set client-side via RevenueCatService.logIn(password)).
// User-chosen alias/password are passed as subscriber attributes BEFORE purchase,
// so the webhook reads them from event.subscriber.attributes, together with the
// buying device's Supabase id (`user_id`) used to link the profile and hand over
// the first play session.
// If account doesn't exist, it claims the device's placeholder account (or
// creates one) with is_premium=true. If it exists, updates is_premium.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const webhookSecret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET')!;

const GRANT = [
'INITIAL_PURCHASE',
'RENEWAL',
'UNCANCELLATION',
'PRODUCT_CHANGE',
'NON_RENEWING_PURCHASE',
];
const REVOKE = ['CANCELLATION', 'EXPIRATION', 'BILLING_ISSUE'];

const db = createClient(supabaseUrl, serviceKey);

serve(async (req) => {
if (req.headers.get('authorization') !== `Bearer ${webhookSecret}`) {
console.error('Unauthorized webhook request');
return new Response('Unauthorized', { status: 401 });
}

try {
const { event } = await req.json();

    if (!event?.app_user_id) {
      return new Response('Missing app_user_id', { status: 400 });
    }

    const appUserId = event.app_user_id as string; // This is the password
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
    const attributes = (event.subscriber_attributes ??
      (event.subscriber as Record<string, unknown> | undefined)?.attributes) as
      | Record<string, { value: string }>
      | undefined;
    const alias = attributes?.alias?.value ? String(attributes.alias.value).toUpperCase() : null;
    const password = attributes?.password?.value
      ? String(attributes.password.value).toUpperCase()
      : null;
    // The Supabase anonymous id of the device that pressed "buy". Used to link
    // the profile to the new account and to hand it the first play session.
    const deviceId = attributes?.user_id?.value ? String(attributes.user_id.value) : null;

    console.log(
      `Webhook: ${eventType} for app_user_id ${appUserId.slice(0, 8)}... alias=${alias?.slice(
        0,
        4
      )}...`
    );

    if (entitlementIds.length > 0 && !entitlementIds.includes('pro_access')) {
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let isPremium: boolean | null = null;
    if (GRANT.includes(eventType)) isPremium = true;
    if (REVOKE.includes(eventType)) isPremium = false;

    if (isPremium === null) {
      console.log(`Unhandled event type: ${eventType}`);
      return new Response(JSON.stringify({ success: true, action: 'ignored' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const now = new Date().toISOString();
    const update: Record<string, unknown> = {
      is_premium: isPremium,
      rc_customer_id: appUserId,
      updated_at: now,
    };
    if (isPremium) update.purchased_at = now;

    // Find account by password (appUserId) first, then by rc_customer_id
    const { data: accountRows, error: lookupError } = await db
      .from('accounts')
      .select('id')
      .or(`password.eq.${appUserId},rc_customer_id.eq.${appUserId}`)
      .limit(1);

    if (lookupError) {
      console.error('Account lookup failed:', lookupError.message);
      return new Response('DB Error', { status: 500 });
    }

    let accountId = accountRows && accountRows.length > 0 ? accountRows[0].id : null;

    if (!accountId) {
      // No account matched the RC customer id yet. This is the first purchase
      // of a user who chose their credentials in the paywall.
      if (!alias || !password) {
        console.warn(
          `No account matched app_user_id=${appUserId.slice(
            0,
            8
          )}... and no alias/password attributes to create one. ` +
            `type=${eventType} env=${event.environment ?? '?'} ` +
            `attribute keys: [${Object.keys(attributes ?? {}).join(', ')}]`
        );
        return new Response(JSON.stringify({ success: true, action: 'no_match' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // The alias must be free. (An alias collision means two users picked the
      // same public handle — the account is NOT created, so the buyer stays
      // free and simply retries with a different alias.)
      const { data: existingAlias } = await db
        .from('accounts')
        .select('id')
        .eq('alias', alias)
        .limit(1);

      if (existingAlias && existingAlias.length > 0) {
        console.warn(`Alias ${alias} already taken`);
        return new Response(JSON.stringify({ success: true, action: 'alias_taken' }), {
          headers: { 'Content-Type': 'application/json' },
        });
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
        alias,
        password,
        is_premium: isPremium,
        rc_customer_id: appUserId,
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
          return new Response('DB Error', { status: 500 });
        }
        accountId = placeholderAccountId;
        console.log(
          `Claimed placeholder account ${accountId.slice(0, 8)}... for the purchasing device`
        );
      } else {
        const { data: newAccount, error: createError } = await db
          .from('accounts')
          .insert(claimValues)
          .select('id')
          .single();

        if (createError) {
          console.error('Account creation failed:', createError.message);
          return new Response('DB Error', { status: 500 });
        }
        accountId = newAccount.id;
        console.log(
          `Created new account ${accountId.slice(0, 8)}... for app_user_id ${appUserId.slice(
            0,
            8
          )}...`
        );
      }
    } else {
      // Account exists — update it
      // If alias/password provided and account doesn't have them yet, update
      if (alias && password) {
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

      const { error: accountError } = await db.from('accounts').update(update).eq('id', accountId);

      if (accountError) {
        console.error('Account update failed:', accountError.message);
        return new Response('DB Error', { status: 500 });
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
    if (deviceId) {
      const { error: linkError } = await db
        .from('profiles')
        .update({ account_id: accountId, is_premium: isPremium, updated_at: now })
        .eq('id', deviceId);

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
              session_expires_at: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
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
      headers: { 'Content-Type': 'application/json' },
    });

} catch (err) {
console.error('Unexpected error:', err);
return new Response('Bad Request', { status: 400 });
}
});
