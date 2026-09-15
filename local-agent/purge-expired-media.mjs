#!/usr/bin/env node
// Deletes Storage media past the retention window (audit S12).
//
// Card photos and voice memos are source media: once OCR'd or transcribed,
// their content lives in contacts/inbound_messages and the media itself is
// only re-read for a manual "view full sheet" check. They are photographs of
// identifiable people and recorded commentary about them, and nothing was
// deleting them, ever.
//
// This does NOT delete inbound_messages rows, transcripts, or the contacts
// they produced -- only the bytes in Storage, after which storage_path is
// nulled. contacts-photo already returns a clean 404 for a missing object.
//
// Lives here rather than in scripts/ because it uses the same Supabase client
// and .env as the agent, and Node resolves node_modules upward from the file.
//
// Run from cron/launchd, or by hand (from local-agent/):
//   node --env-file=.env purge-expired-media.mjs --dry-run
//   node --env-file=.env purge-expired-media.mjs
//   RETENTION_DAYS=30 node --env-file=.env purge-expired-media.mjs
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (try --env-file=local-agent/.env).');
  process.exit(1);
}

const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? 90);
const BATCH = Number(process.env.PURGE_BATCH ?? 500);
const dryRun = process.argv.includes('--dry-run');

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data: expired, error } = await supabase.rpc('expired_media', {
  p_retention_days: RETENTION_DAYS,
  p_limit: BATCH,
});
if (error) {
  console.error('could not list expired media:', error.message);
  process.exit(1);
}

if (!expired || expired.length === 0) {
  console.log(`nothing to purge (retention ${RETENTION_DAYS} days)`);
  process.exit(0);
}

// Photos and audio live in different buckets; group so each delete call is one
// round-trip per bucket rather than one per object.
const byBucket = new Map();
for (const row of expired) {
  const bucket = row.kind === 'audio' ? 'voice-memos' : 'contact-photos';
  if (!byBucket.has(bucket)) byBucket.set(bucket, []);
  byBucket.get(bucket).push(row);
}

console.log(
  `${dryRun ? '[dry run] ' : ''}${expired.length} object(s) past ${RETENTION_DAYS} days ` +
  `(oldest ${expired[0].received_at}):`,
);
for (const [bucket, rows] of byBucket) console.log(`  ${bucket}: ${rows.length}`);

if (dryRun) process.exit(0);

const purgedIds = [];
for (const [bucket, rows] of byBucket) {
  const paths = rows.map((r) => r.storage_path);
  const { error: rmError } = await supabase.storage.from(bucket).remove(paths);
  if (rmError) {
    // Leave storage_path set so the next run retries: nulling it while the
    // object still exists would orphan the bytes permanently.
    console.error(`  ${bucket}: delete failed, leaving these for the next run — ${rmError.message}`);
    continue;
  }
  purgedIds.push(...rows.map((r) => r.id));
  console.log(`  ${bucket}: ${paths.length} deleted`);
}

if (purgedIds.length > 0) {
  const { data: marked, error: markError } = await supabase.rpc('mark_media_purged', { p_ids: purgedIds });
  if (markError) {
    console.error('objects deleted but storage_path not cleared:', markError.message);
    process.exit(1);
  }
  console.log(`storage_path cleared on ${marked} row(s)`);
}
