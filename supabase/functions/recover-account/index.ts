// supabase/functions/recover-account/index.ts
//
// Self-service credential recovery: alias + recovery word -> the account's
// existing password.
//
// A player who has lost every device has no linked profile, so they can only
// reach the paywall — and the paywall is the only place that offers this. They
// type their alias and the recovery word they set on the Premium screen; this
// function (service role, so it bypasses RLS) calls recover_by_word() and hands
// back the account's password. The client then feeds that password into the
// ordinary restoreAccount() path, which links the device, re-binds RevenueCat
// and reloads progress. Nothing is linked here: this endpoint only ever reads.
//
// The password is returned UNCHANGED, never rotated: the product shows it to the
// player and recovery hands it back (decision D11, plain-text passwords).
//
// Rate limiting: the alias is public and a word can be as short as 4 characters,
// and the answer is the password, so guesses are limited (recover_by_word_limited,
// sql rate_limits.sql): too many failed words per alias, network address or device
// answer 429 `rate_limited` with `retry_after_seconds`.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from 'https://esm.sh/@supabase/supabase-js@^2/cors';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(supabaseUrl, serviceKey);

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

// The caller's network address as a keyed hash (the service-role key is the key), so
// the attempt limit can count per address without the database ever holding an IP.
async function networkHash(req: Request): Promise<string | null> {
  const forwarded = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
  const ip = forwarded || (req.headers.get('cf-connecting-ip') ?? '').trim();
  if (!ip) return null;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(serviceKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

// The signed-in device, when the request carries a user JWT (the current client
// does). Only used to count attempts per device; a missing one is not an error.
async function callerId(req: Request): Promise<string | null> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  return data?.user?.id ?? null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  let body: { alias?: unknown; recovery_word?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: 'not_found' }, 400);
  }

  const alias = normalize(body.alias);
  const word = normalize(body.recovery_word);

  // The word is free text, so it is length-checked, never regex-checked — the
  // `^[A-Z0-9]{8,16}$` rule belongs to the alias only.
  if (!alias || word.length < 4) {
    return json({ success: false, error: 'not_found' }, 400);
  }

  const { data, error } = await db.rpc('recover_by_word_limited', {
    p_alias: alias,
    p_word: word,
    p_caller: await callerId(req),
    p_ip_hash: await networkHash(req),
  });

  if (error) {
    console.error('recover_by_word_limited failed:', error.message);
    return json({ success: false, error: 'not_found' }, 500);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (row?.error === 'rate_limited') {
    console.log(`recover-account: rate_limited, retry in ${row.retry_after_seconds}s`);
    return json(
      { success: false, error: 'rate_limited', retry_after_seconds: row.retry_after_seconds },
      429
    );
  }
  if (!row || !row.success) {
    // `not_found` covers both an unknown alias and a wrong word, so the
    // endpoint cannot be used to probe which aliases exist. `no_recovery_word`
    // is deliberately distinct: the player has to be told that recovery is
    // impossible for their account rather than being told to retype a word
    // they never set.
    const reason = row?.error === 'no_recovery_word' ? 'no_recovery_word' : 'not_found';
    return json({ success: false, error: reason }, 404);
  }

  return json({ success: true, alias: row.alias, password: row.password });
});
