import { onUnmounted, ref, watchEffect } from 'vue';
import { api } from '@/boot/axios';

// Stage 15: contacts-photo (the Edge Function) is staff-PIN-gated, and
// requires the Supabase anon key as a bearer token for the gateway's own
// check — neither of which a plain <img src="..."> can attach, since img
// tags can't carry custom headers. The old .NET version could just be a
// same-origin <img src> because there was no auth on it at all.
//
// Rather than put the PIN in a query string (readable in browser history/
// server logs, which the general "never put sensitive data in a URL"
// stance rules out even for a low-stakes shared PIN), this fetches the
// image via the normal authenticated axios instance and exposes it as a
// short-lived blob: URL — the standard SPA pattern for an authenticated
// image. Revokes the previous object URL on every refetch and on unmount
// so this doesn't leak memory across a long /review session.
// Returns { url, error } rather than a bare url ref: a failed fetch used to
// just clear url to null, indistinguishable from "this contact has no
// photo" — <q-img>'s own #error slot never fires for that case since a
// falsy :src never triggers an actual <img> load attempt. `error` lets a
// caller render a real "photo failed to load" state instead of a silent
// blank tile.
export function useContactPhoto(getContactId: () => string | null | undefined, options: { full?: () => boolean; enabled?: () => boolean } = {}) {
  const url = ref<string | null>(null);
  const error = ref(false);
  let currentObjectUrl: string | null = null;

  function revoke() {
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }
  }

  async function load() {
    revoke();
    url.value = null;
    error.value = false;

    const id = getContactId();
    const enabled = options.enabled ? options.enabled() : true;
    if (!id || !enabled) return;

    try {
      const { data } = await api.get<Blob>('/contacts-photo', {
        params: { id, full: options.full?.() ? 'true' : undefined },
        responseType: 'blob',
      });
      currentObjectUrl = URL.createObjectURL(data);
      url.value = currentObjectUrl;
    } catch {
      error.value = true;
    }
  }

  watchEffect(load);
  onUnmounted(revoke);

  return { url, error };
}
