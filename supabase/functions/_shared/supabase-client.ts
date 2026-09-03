// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically into
// every deployed Edge Function's environment by Supabase — no manual secret
// setup needed for these two. The service-role key bypasses RLS entirely,
// which is intentional: every table has RLS enabled with zero policies, and
// all reads/writes are meant to go exclusively through these functions.
import { createClient } from "jsr:@supabase/supabase-js@2";

export function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false } });
}
