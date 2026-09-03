import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set — copy local-agent/.env.example to local-agent/.env and fill in the service-role key from the Supabase dashboard (Project Settings -> API).',
  );
  process.exit(1);
}

export const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
