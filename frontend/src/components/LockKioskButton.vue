<template>
  <!-- Locks THIS device to the attendee form, for a shared booth iPad or laptop.
       It lives on the Kiosk page itself, beside the form it locks, rather than in
       the app header: it is only meaningful here, and next to Log out in the bar
       it was one stray tap from handing a device over by accident. Doesn't sign
       anyone out; see kiosk-mode-store.ts. -->
  <q-btn flat dense no-caps icon="lock" color="grey-8" label="Lock kiosk" class="lk-btn" aria-label="Lock kiosk" @click="onLock">
    <q-tooltip>Hand this device to attendees. You'll unlock it with your kiosk PIN.</q-tooltip>
  </q-btn>

  <!-- Shown instead of locking immediately when the caller has never set a
       kiosk PIN -- without one, locking the device would leave no way to
       unlock it again at the booth. Setting it here means never having to
       send the rep away to Setup mid-lock. -->
  <q-dialog v-model="showSetPin" @hide="newPin = ''; setPinError = ''">
    <q-card style="width: 320px">
      <q-card-section>
        <div class="text-h6">Set a kiosk PIN</div>
        <div class="text-caption text-grey">
          You'll need this to unlock the device again — separate from your login password.
        </div>
      </q-card-section>
      <q-card-section class="q-pt-none">
        <q-input
          v-model="newPin"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          autofocus
          label="New kiosk PIN"
          hint="At least 4 characters"
          :error="!!setPinError"
          :error-message="setPinError"
          @keyup.enter="onSetPinAndLock"
        />
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat label="Cancel" v-close-popup />
        <q-btn color="primary" label="Set PIN & lock" :disable="newPin.length < 4" :loading="settingPin" @click="onSetPinAndLock" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { api } from '@/boot/axios';
import { useSessionStore } from '@/stores/session-store';
import { useKioskModeStore } from '@/stores/kiosk-mode-store';

const sessionStore = useSessionStore();
const kioskModeStore = useKioskModeStore();

const showSetPin = ref(false);
const newPin = ref('');
const setPinError = ref('');
const settingPin = ref(false);

function onLock() {
  if (sessionStore.user?.hasKioskPin) {
    kioskModeStore.lock();
    return;
  }
  showSetPin.value = true;
}

async function onSetPinAndLock() {
  if (newPin.value.length < 4) return;
  settingPin.value = true;
  setPinError.value = '';
  try {
    await api.post('/kiosk-set-code', { code: newPin.value });
    if (sessionStore.user) sessionStore.user.hasKioskPin = true;
    showSetPin.value = false;
    kioskModeStore.lock();
  } catch {
    setPinError.value = 'Could not set your PIN — try again.';
  } finally {
    settingPin.value = false;
  }
}
</script>

<style scoped>
.lk-btn { min-height: 44px; }
</style>
