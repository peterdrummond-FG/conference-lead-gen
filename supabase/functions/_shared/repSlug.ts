// Rep QR links are /connect/<rep_slug> (see routes.ts, contacts-create) --
// derived from a sales rep's first name at the moment they become one
// (profiles-create, or a profiles-update promotion into 'sales'), and
// enforced unique by profiles_rep_slug_key since profiles.name never has
// been (20260916212541_add_profiles_rep_slug.sql). Two reps sharing a first
// name would otherwise silently collide on the same QR link.
export function repSlugBase(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  const cleaned = first.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return cleaned || "rep";
}

const MAX_ATTEMPTS = 50;

interface SlugAttemptResult<T> {
  data: T | null;
  error: { code?: string; message: string } | null;
}

// Retries with a numeric suffix on a rep_slug collision -- the same
// insert-and-retry-on-collision shape events_activate() uses for
// folder_code/slug (20260917100000_event_reps_and_activation_guard.sql)
// rather than check-then-insert, which would race a concurrent
// profiles-create/-update landing on the same first name.
export async function withUniqueRepSlug<T>(
  name: string,
  attempt: (candidate: string) => Promise<SlugAttemptResult<T>>,
): Promise<{ data: T | null; error: { message: string } | null }> {
  const base = repSlugBase(name);
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const candidate = i === 0 ? base : `${base}${i}`;
    const { data, error } = await attempt(candidate);
    if (!error) return { data, error: null };
    if (error.code === "23505" && error.message.includes("rep_slug")) continue;
    return { data: null, error };
  }
  return { data: null, error: { message: `Could not generate a unique rep link after ${MAX_ATTEMPTS} attempts.` } };
}
