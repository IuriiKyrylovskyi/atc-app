// supabase/functions/delete-account/index.ts
//
// Deletes the calling user's account and all associated data.
// Required by Apple App Store guidelines.
//
// Security:
//   - Requires a valid Supabase JWT (the user's own session token)
//   - Extracts user ID from the JWT — user can only delete their own account
//   - Uses service_role key to perform the deletion
//
// If the user's profile is linked to an account, the entire account is deleted
// (cascade removes account_progress + account_scores) and every auth.users row
// linked to that account is removed. If the profile has no account, only that
// single profile + auth user is deleted.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from 'https://esm.sh/@supabase/supabase-js@^2/cors';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

const adminDb = createClient(supabaseUrl, serviceKey);

// Shared headers: supabase-js also sends `apikey` and `x-client-info`, which a
// hand-written allow-list would reject on web/Electron preflights.
const CORS = { ...corsHeaders, 'Access-Control-Allow-Methods': 'POST, OPTIONS' };

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS });
  }

  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401, headers: CORS });
  }

  const userJwt = authHeader.replace('Bearer ', '');

  const userDb = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  });

  const {
    data: { user },
    error: authError,
  } = await userDb.auth.getUser();

  if (authError || !user) {
    console.error('Invalid JWT:', authError?.message);
    return new Response('Unauthorized', { status: 401, headers: CORS });
  }

  const userId = user.id;
  console.log(`Deleting account for user ${userId.slice(0, 8)}...`);

  try {
    const { data: profile, error: profileError } = await adminDb
      .from('profiles')
      .select('account_id')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) {
      console.error('Profile lookup failed:', profileError.message);
      return new Response(JSON.stringify({ error: profileError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    const accountId = profile?.account_id;

    if (accountId) {
      // Fetch all linked device profiles BEFORE deleting the account
      // (ON DELETE SET NULL on profiles.account_id nulls the FK on delete)
      const { data: linkedProfiles, error: linkedError } = await adminDb
        .from('profiles')
        .select('id')
        .eq('account_id', accountId);

      if (linkedError) {
        console.error('Linked profiles lookup failed:', linkedError.message);
        return new Response(JSON.stringify({ error: linkedError.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...CORS },
        });
      }

      // Delete the account — cascade removes account_progress + account_scores
      const { error: accountError } = await adminDb.from('accounts').delete().eq('id', accountId);

      if (accountError) {
        console.error('Account deletion failed:', accountError.message);
        return new Response(JSON.stringify({ error: accountError.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...CORS },
        });
      }

      // Delete every auth.users row linked to this account
      for (const p of linkedProfiles || []) {
        const { error: userDeleteError } = await adminDb.auth.admin.deleteUser(p.id);
        if (userDeleteError) {
          console.error(
            `Failed to delete auth user ${p.id.slice(0, 8)}...:`,
            userDeleteError.message
          );
        }
      }
    } else {
      // No account linked — delete just this profile + auth user
      const { error: profileDelError } = await adminDb.from('profiles').delete().eq('id', userId);

      if (profileDelError) {
        console.error('Profile deletion failed:', profileDelError.message);
      }

      const { error: deleteError } = await adminDb.auth.admin.deleteUser(userId);
      if (deleteError) {
        console.error('Failed to delete auth user:', deleteError.message);
        return new Response(JSON.stringify({ error: deleteError.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...CORS },
        });
      }
    }

    console.log(`Account deleted for user ${userId.slice(0, 8)}...`);
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    return new Response('Internal server error', { status: 500, headers: CORS });
  }
});
