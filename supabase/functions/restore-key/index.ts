// supabase/functions/restore-key/index.ts
//
// Cross-device restore for anonymous users.
//
// The Supabase anonymous user.id is device-local, so a purchase confirmed on
// device A is invisible to device B's anonymous id. The user enters the alias
// + password they chose before purchase on device A. This function (service
// role - bypasses RLS) calls link_account() which verifies the pair, refuses
// if the device already belongs to a different REAL account, and links the
// current device's profile to the account.
//
// Business outcomes (not_found, not_paid, already_linked, invalid) are returned as
// HTTP 200 with { success:false, error }. supabase-js turns every non-2xx into a
// FunctionsHttpError, so non-2xx is reserved for a bad request and DB faults.
//
// The play session is deliberately NOT claimed here: if the old device is still
// running, the new device lands on /waiting until its session expires.
//
// The device to link comes from the caller's verified JWT, never from the body
// (same rule as claim-purchase): the gateway accepts the public anon key as a JWT,
// so a body-supplied uid would let anyone link any device. `currentUserId` is still
// accepted from older clients but must equal the JWT's uid. `unauthorized` is a
// distinct outcome the client keeps credentials on (it never clears storage for it).
//
// Guesses are rate limited (link_account_limited, sql rate_limits.sql): the alias is
// public, so too many failed passwords per alias, network address or device answer
// `rate_limited` with `retry_after_seconds`. The client keeps credentials on it too.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from 'https://esm.sh/@supabase/supabase-js@^2/cors';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(supabaseUrl, serviceKey);

function normalize(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{8,16}$/.test(v)) return null;
  return v;
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ success: false, error: 'unauthorized' }, 401);

  const { data: userData, error: authError } = await db.auth.getUser(token);
  if (authError || !userData?.user) {
    return json({ success: false, error: 'unauthorized' }, 401);
  }
  const currentUserId = userData.user.id;

  let body: { alias?: unknown; password?: unknown; currentUserId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: 'bad_request' }, 400);
  }

  if (body.currentUserId !== undefined && body.currentUserId !== currentUserId) {
    console.warn('restore-key: body currentUserId does not match the JWT uid');
    return json({ success: false, error: 'unauthorized' }, 401);
  }

  const alias = normalize(body.alias);
  const password = normalize(body.password);

  if (!alias || !password) {
    return json({ success: false, error: 'invalid' }, 400);
  }

  const { data, error } = await db.rpc('link_account_limited', {
    p_alias: alias,
    p_password: password,
    p_current_user_id: currentUserId,
    p_ip_hash: await networkHash(req),
  });

  if (error) {
    console.error('restore-key: link_account_limited failed:', error.message);
    return json({ success: false, error: 'db_error' }, 500);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    console.log('restore-key: no row returned -> not_found');
    return json({ success: false, error: 'not_found' });
  }

  if (row.error === 'rate_limited') {
    console.log(`restore-key: rate_limited, retry in ${row.retry_after_seconds}s`);
    return json({
      success: false,
      error: 'rate_limited',
      retry_after_seconds: row.retry_after_seconds,
    });
  }

  if (!row.success) {
    // Log the outcome code only (never the alias or password).
    console.log(`restore-key: link_account -> ${row.error}`);
    const code = row.error === 'invalid_format' ? 'invalid' : row.error;
    return json({ success: false, error: code });
  }

  return json({
    success: true,
    account_id: row.account_id,
    alias: row.alias,
    password: row.password,
    is_premium: row.is_premium,
  });
});
