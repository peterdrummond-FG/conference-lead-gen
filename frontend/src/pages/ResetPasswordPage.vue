<template>
  <q-page :class="[$q.screen.lt.sm ? 'q-pa-sm' : 'q-pa-lg', 'flex', 'flex-center']">
    <q-card style="width: 360px; max-width: 100%">
      <q-card-section>
        <div class="text-h5">Choose a new password</div>
        <div v-if="state === 'ready'" class="text-caption text-grey-8 q-mt-xs">
          Use at least {{ MIN_LENGTH }} characters. You'll be signed in right after.
        </div>
      </q-card-section>

      <q-card-section v-if="state === 'checking'" class="text-center">
        <q-spinner size="32px" color="primary" />
      </q-card-section>

      <!-- Opened directly, or the emailed link is too old / already used. A reset
           link works once and only for a short while, so this is the normal
           outcome of tapping it twice or the next morning. -->
      <template v-else-if="state === 'expired'">
        <q-card-section class="q-pt-none">
          <q-banner rounded class="bg-orange-1 text-orange-10">
            This reset link has expired or was already used. Ask for a new one from the sign-in page.
          </q-banner>
        </q-card-section>
        <q-card-actions>
          <q-btn unelevated no-caps color="primary" label="Back to sign in" to="/login" class="full-width rp-btn" />
        </q-card-actions>
      </template>

      <q-card-section v-else class="q-pt-none">
        <q-form class="q-gutter-md" @submit.prevent="onSubmit">
          <q-input
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            label="New password"
            autocomplete="new-password"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            autofocus
            :rules="[(v: string) => v.length >= MIN_LENGTH || `At least ${MIN_LENGTH} characters`]"
          >
            <template #append>
              <q-icon
                :name="showPassword ? 'visibility_off' : 'visibility'"
                class="cursor-pointer"
                role="button"
                tabindex="0"
                :aria-label="showPassword ? 'Hide password' : 'Show password'"
                @click="showPassword = !showPassword"
                @keydown.enter.prevent="showPassword = !showPassword"
              />
            </template>
          </q-input>
          <q-input
            v-model="confirm"
            :type="showPassword ? 'text' : 'password'"
            label="Confirm new password"
            autocomplete="new-password"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            :rules="[(v: string) => v === password || 'The two passwords don\'t match']"
          />
          <q-btn type="submit" unelevated no-caps color="primary" label="Save password" class="full-width rp-btn" :loading="saving" />
        </q-form>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { Notify } from 'quasar';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/stores/session-store';

// Supabase's own floor is configurable per project and its error is surfaced if
// the server rejects a password; this is only the check made before asking.
const MIN_LENGTH = 8;

// The emailed link carries the recovery session in the URL fragment, and a link
// that is expired or already used carries an error there instead
// (#error=access_denied&error_code=otp_expired). supabase-js clears the fragment
// as soon as it has read it, so it has to be looked at now, at setup time.
const linkFailed = /[#&]error(_code|_description)?=/.test(window.location.hash);

const router = useRouter();
const sessionStore = useSessionStore();

const state = ref<'checking' | 'ready' | 'expired'>('checking');
const password = ref('');
const confirm = ref('');
const showPassword = ref(false);
const saving = ref(false);

let unsubscribe: (() => void) | null = null;
let giveUpTimer: ReturnType<typeof setTimeout> | undefined;

onMounted(async () => {
  if (linkFailed) {
    state.value = 'expired';
    return;
  }
  // Following the link signs the person in with a recovery session. That can land
  // a moment after this page mounts, so wait briefly for it before deciding the
  // link was no good.
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (session && (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN')) state.value = 'ready';
  });
  unsubscribe = () => data.subscription.unsubscribe();

  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    state.value = 'ready';
    return;
  }
  giveUpTimer = setTimeout(() => {
    if (state.value === 'checking') state.value = 'expired';
  }, 2500);
});

onBeforeUnmount(() => {
  unsubscribe?.();
  clearTimeout(giveUpTimer);
});

async function onSubmit() {
  if (password.value.length < MIN_LENGTH || password.value !== confirm.value) return;
  saving.value = true;
  try {
    const { error } = await supabase.auth.updateUser({ password: password.value });
    if (error) {
      // Supabase words these well ("New password should be different from the old
      // password", a project-level strength rule), so pass them through.
      Notify.create({ type: 'negative', message: error.message });
      return;
    }
    if (!sessionStore.user) await sessionStore.fetchMe();
    Notify.create({ type: 'positive', message: 'Password updated. You\'re signed in.' });
    await router.push('/contacts');
  } catch {
    Notify.create({ type: 'negative', message: 'Couldn\'t save your password. Try again.' });
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.rp-btn { min-height: 44px; }
</style>
