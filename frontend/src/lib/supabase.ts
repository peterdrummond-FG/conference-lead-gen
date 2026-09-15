// The Supabase Auth browser client — the one thing in this app that talks
// to Supabase directly rather than through an Edge Function. Everything
// else (data reads/writes) still goes through boot/axios.ts's calls to the
// Edge Functions; this client exists only to run the login/session/
// password-reset flows Supabase Auth provides, and to hand boot/axios.ts a
// live access token to attach to every request.
import { createClient } from '@supabase/supabase-js';

// Audit S8. No production fallback: a missing or misspelled env var must fail
// the build, not silently point a dev or staging bundle at the live project.
export function requireEnv(name: string): string {
  const value = import.meta.env[name] as string | undefined;
  if (!value) {
    throw new Error(
      `${name} is not set. Copy frontend/.env.example to frontend/.env for local ` +
      `development, or set it in the Vercel project settings for a deployed build.`,
    );
  }
  return value;
}

const SUPABASE_URL = requireEnv('VITE_SUPABASE_URL');
const SUPABASE_ANON_KEY = requireEnv('VITE_SUPABASE_ANON_KEY');

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Kept in sync via onAuthStateChange (fires on sign-in/out and on token
// refresh) so boot/axios.ts's request interceptor can attach the live
// access token synchronously on every call, rather than awaiting
// supabase.auth.getSession() per request. ES module bindings are live, so
// importers reading `currentAccessToken` always see the latest value.
export let currentAccessToken: string | null = null;

supabase.auth.onAuthStateChange((_event, session) => {
  currentAccessToken = session?.access_token ?? null;
});
