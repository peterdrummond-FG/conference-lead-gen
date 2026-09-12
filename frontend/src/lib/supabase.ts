// The Supabase Auth browser client — the one thing in this app that talks
// to Supabase directly rather than through an Edge Function. Everything
// else (data reads/writes) still goes through boot/axios.ts's calls to the
// Edge Functions; this client exists only to run the login/session/
// password-reset flows Supabase Auth provides, and to hand boot/axios.ts a
// live access token to attach to every request.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://yrvppufkerbjpvrxniot.supabase.co';
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlydnBwdWZrZXJianB2cnhuaW90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzODA4NzYsImV4cCI6MjEwMzk1Njg3Nn0.PZADuNtJi-N9wq95t-nolGblWaYVKCLeB9q5-V8e394';

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
