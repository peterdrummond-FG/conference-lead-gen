<template>
  <q-page :class="[$q.screen.lt.sm ? 'q-pa-sm' : 'q-pa-lg', 'flex', 'flex-center']">
    <q-card style="width: 360px; max-width: 100%">
      <q-card-section>
        <div class="text-h5">CKH Connect</div>
        <div class="text-caption text-grey-8">Sign in to continue.</div>
      </q-card-section>

      <q-card-section>
        <q-form class="q-gutter-md" @submit.prevent="onSubmit">
          <q-input
            ref="emailRef"
            v-model="email"
            type="email"
            inputmode="email"
            label="Email"
            autocomplete="username"
            autocapitalize="off"
            autofocus
            :error="!!emailError"
            :error-message="emailError"
            :rules="[(v: string) => !!v || 'Required']"
            @update:model-value="emailError = ''"
          />
          <q-input
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            label="Password"
            autocomplete="current-password"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            :rules="[(v: string) => !!v || 'Required']"
          >
            <!-- Typing a password on a phone with no way to see it is how people end
                 up locked out and reaching for "Forgot password?". -->
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

          <div class="text-right">
            <q-btn flat dense color="primary" label="Forgot password?" no-caps class="login-link" :loading="sendingReset" @click="onForgotPassword" />
          </div>

          <q-btn
            type="submit"
            color="primary"
            label="Sign in"
            class="full-width login-submit"
            :loading="loading"
          />
        </q-form>
      </q-card-section>

      <q-card-section class="text-center text-caption text-grey-8 q-pt-none">
        <router-link to="/privacy">Privacy Policy</router-link>
        &nbsp;&middot;&nbsp;
        <router-link to="/terms">Terms &amp; Conditions</router-link>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Notify } from 'quasar';
import { useSessionStore } from '@/stores/session-store';
import { supabase } from '@/lib/supabase';

const route = useRoute();
const router = useRouter();
const sessionStore = useSessionStore();

const emailRef = ref<{ focus: () => void } | null>(null);
const email = ref('');
const password = ref('');
const showPassword = ref(false);
const loading = ref(false);
const sendingReset = ref(false);
const emailError = ref('');

async function onSubmit() {
  if (!email.value || !password.value) return;
  loading.value = true;
  try {
    await sessionStore.login(email.value, password.value);
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/review';
    await router.push(redirect);
  } catch {
    Notify.create({ type: 'negative', message: 'Incorrect email or password.' });
  } finally {
    loading.value = false;
  }
}

// Password reset used to be broken end to end. It sent the email, but with no
// redirectTo the link dropped the person on the site root, where nothing let them
// choose a new password (they were just signed in by the link's recovery session
// and still had the password they'd forgotten). It also ignored the response, so a
// rate-limited or failed request still said "Check your email". The link now goes
// to /reset-password, which sets the password, and failures are reported.
async function onForgotPassword() {
  emailError.value = '';
  const address = email.value.trim();
  if (!address) {
    emailError.value = 'Enter your email above, then tap "Forgot password?" again.';
    emailRef.value?.focus();
    return;
  }
  if (sendingReset.value) return;
  sendingReset.value = true;
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(address, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      Notify.create({
        type: 'negative',
        message: error.status === 429 || /rate limit/i.test(error.message)
          ? 'Please wait a minute before asking for another link.'
          : 'Couldn\'t send the reset email. Try again in a minute.',
      });
      return;
    }
    // Same wording whether or not the address has an account, so this can't be used
    // to find out who does.
    Notify.create({
      type: 'positive',
      timeout: 8000,
      message: 'If that email has an account, a reset link is on its way. Check your spam folder too.',
    });
  } catch {
    Notify.create({ type: 'negative', message: 'Couldn\'t send the reset email. Try again in a minute.' });
  } finally {
    sendingReset.value = false;
  }
}
</script>

<style scoped>
.login-submit { min-height: 44px; }
.login-link { min-height: 40px; }
</style>
