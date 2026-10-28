// supabase/functions/validate-credentials/index.ts
//
// Unified server-side validation for alias, password, and recovery word.
// The client sends credentials; the server validates format, availability,
// and business rules, returning structured responses for UI rendering.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from 'https://esm.sh/@supabase/supabase-js@^2/cors';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(supabaseUrl, serviceKey);

const ALIAS_REGEX = /^[A-Z0-9]{8,16}$/;
const PASSWORD_REGEX = /^[A-Z0-9]{8,16}$/;
const WORD_REGEX = /^[A-Z0-9]{4,16}$/;
const WORD_MIN_LEN = 4;
const WORD_MAX_LEN = 16;

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function validateAlias(alias: string): { valid: boolean; error?: string } {
  if (!alias) return { valid: false, error: 'alias_required' };
  if (alias.length < 8) return { valid: false, error: 'alias_too_short' };
  if (alias.length > 16) return { valid: false, error: 'alias_too_long' };
  if (!ALIAS_REGEX.test(alias)) return { valid: false, error: 'alias_invalid_chars' };
  return { valid: true };
}

function validatePassword(password: string): { valid: boolean; error?: string } {
  if (!password) return { valid: false, error: 'password_required' };
  if (password.length < 8) return { valid: false, error: 'password_too_short' };
  if (password.length > 16) return { valid: false, error: 'password_too_long' };
  if (!PASSWORD_REGEX.test(password)) return { valid: false, error: 'password_invalid_chars' };
  return { valid: true };
}

function validateWord(word: string): { valid: boolean; error?: string } {
  if (!word) return { valid: false, error: 'word_required' };
  if (!WORD_REGEX.test(word)) return { valid: false, error: 'word_invalid_format' };
  return { valid: true };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  let body: {
    alias?: unknown;
    password?: unknown;
    word?: unknown;
    check_availability?: boolean;
    exclude_alias?: unknown; // alias to exclude from availability check (for editing own alias)
  };
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: 'invalid_json' }, 400);
  }

  const alias = normalize(body.alias);
  const password = normalize(body.password);
  const word = normalize(body.word);
  const checkAvailability = body.check_availability === true;
  const excludeAlias = normalize(body.exclude_alias);

  // --- Format validation ---
  if (alias) {
    const aliasCheck = validateAlias(alias);
    if (!aliasCheck.valid) {
      return json({ success: false, field: 'alias', error: aliasCheck.error }, 400);
    }
  }

  if (password) {
    const passCheck = validatePassword(password);
    if (!passCheck.valid) {
      return json({ success: false, field: 'password', error: passCheck.error }, 400);
    }
  }

  if (word) {
    const wordCheck = validateWord(word);
    if (!wordCheck.valid) {
      return json({ success: false, field: 'word', error: wordCheck.error }, 400);
    }
  }

  // --- Cross-field validation ---
  if (alias && password && alias === password) {
    return json({ success: false, field: 'password', error: 'password_equals_alias' }, 400);
  }
  if (alias && word && alias === word) {
    return json({ success: false, field: 'word', error: 'word_equals_alias' }, 400);
  }
  if (password && word && password === word) {
    return json({ success: false, field: 'word', error: 'word_equals_password' }, 400);
  }

  // --- Alias availability check (if requested) ---
  if (checkAvailability && alias) {
    try {
      const { data, error } = await db.rpc('check_alias_availability', {
        candidate: alias,
      });

      if (error) {
        console.error('check_alias_availability failed:', error.message);
        // Don't fail hard - let the purchase/restore handle it
      } else if (data && data.length > 0 && data[0].alias !== excludeAlias) {
        const row = data[0];
        if (!row.is_available) {
          return json(
            { success: false, field: 'alias', error: 'alias_taken', is_premium: row.is_premium },
            409
          );
        }
      }
    } catch (err) {
      console.warn('Availability check failed:', err);
    }
  }

  // All validations passed
  return json({
    success: true,
    alias: alias || null,
    password: password || null,
    word: word || null,
  });
});
