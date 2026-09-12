<template>
  <q-page class="q-pa-lg flex flex-center">
    <q-card style="width: 360px; max-width: 92vw">
      <q-card-section>
        <div class="text-h5">Conference Lead Gen</div>
        <div class="text-caption text-grey">Sign in to continue.</div>
      </q-card-section>

      <q-card-section>
        <q-form class="q-gutter-md" @submit.prevent="onSubmit">
          <q-input
            v-model="email"
            type="email"
            label="Email"
            autofocus
            :rules="[(v: string) => !!v || 'Required']"
          />
          <q-input
            v-model="password"
            type="password"
            label="Password"
            :rules="[(v: string) => !!v || 'Required']"
          />

          <div class="text-right">
            <q-btn flat dense color="primary" label="Forgot password?" no-caps @click="onForgotPassword" />
          </div>

          <q-btn
            type="submit"
            color="primary"
            label="Sign in"
            class="full-width"
            :loading="loading"
          />
        </q-form>
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

const email = ref('');
const password = ref('');
const loading = ref(false);

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

async function onForgotPassword() {
  if (!email.value) {
    Notify.create({ type: 'negative', message: 'Enter your email first.' });
    return;
  }
  await supabase.auth.resetPasswordForEmail(email.value);
  Notify.create({ type: 'positive', message: 'Check your email for a password reset link.' });
}
</script>
