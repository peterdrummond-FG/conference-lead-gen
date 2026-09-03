<template>
  <q-layout view="hHh lpr fFf">
    <q-header v-if="!kioskStore.locked" class="bg-white text-dark app-header" bordered>
      <q-toolbar>
        <q-toolbar-title class="app-logo">Conference Lead Intake</q-toolbar-title>
        <q-tabs class="nav-pills" indicator-color="transparent" no-caps dense>
          <q-route-tab to="/setup" label="Setup" />
          <q-route-tab to="/intake" label="Intake" />
          <q-route-tab to="/review" label="Review" />
          <q-route-tab v-if="roleStore.role === 'customerSuccess'" to="/export" label="Export" />
        </q-tabs>
        <q-separator vertical spaced />
        <q-btn-dropdown flat dense no-caps icon="switch_account" color="primary" :label="roleLabel">
          <q-tooltip>Switch view</q-tooltip>
          <q-list>
            <q-item clickable v-close-popup :active="roleStore.role === 'sales'" @click="roleStore.setRole('sales')">
              <q-item-section>Sales</q-item-section>
            </q-item>
            <q-item clickable v-close-popup :active="roleStore.role === 'customerSuccess'" @click="roleStore.setRole('customerSuccess')">
              <q-item-section>Customer Success</q-item-section>
            </q-item>
          </q-list>
        </q-btn-dropdown>
        <q-separator vertical spaced />
        <q-btn flat dense icon="lock" round color="grey-7" @click="lockAndGoToIntake">
          <q-tooltip>Lock kiosk</q-tooltip>
        </q-btn>
      </q-toolbar>
    </q-header>

    <q-page-container :class="{ 'kiosk-page-container': kioskStore.locked }">
      <router-view />
    </q-page-container>

    <q-btn
      v-if="kioskStore.locked"
      round
      flat
      icon="settings"
      class="kiosk-settings-btn"
      color="grey-6"
      @click="showPinDialog = true"
    />

    <q-dialog v-model="showPinDialog" @hide="pinInput = ''; pinError = ''">
      <q-card style="width: 320px">
        <q-card-section>
          <div class="text-h6">Enter PIN</div>
          <div class="text-caption text-grey">Unlock to change setup or view Review/Export.</div>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <q-input
            v-model="pinInput"
            type="password"
            inputmode="numeric"
            autofocus
            label="PIN"
            :error="!!pinError"
            :error-message="pinError"
            @keyup.enter="submitPin"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="primary" label="Unlock" :loading="unlocking" @click="submitPin" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-layout>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useKioskStore } from '@/stores/kiosk-store';
import { useRoleStore } from '@/stores/role-store';
import type { Role } from '@/stores/role-store';

const router = useRouter();
const route = useRoute();
const kioskStore = useKioskStore();
const roleStore = useRoleStore();

const roleLabel = computed(() => (roleStore.role === 'customerSuccess' ? 'Customer Success' : 'Sales'));

// The nav tab for a now-disallowed route (e.g. Export, Customer-Success-only)
// disappears immediately via v-if above, but switching roles doesn't itself
// navigate — without this, a rep could switch to Sales while sitting on
// /export and be left on a page with no tab pointing back to it.
watch(() => roleStore.role, (role: Role) => {
  const allowedRoles = route.meta.roles as Role[] | undefined;
  if (allowedRoles && !allowedRoles.includes(role)) {
    void router.push('/intake');
  }
});

const showPinDialog = ref(false);
const pinInput = ref('');
const pinError = ref('');
const unlocking = ref(false);

async function submitPin() {
  if (!pinInput.value) return;
  unlocking.value = true;
  pinError.value = '';
  try {
    const ok = await kioskStore.unlock(pinInput.value);
    if (ok) {
      showPinDialog.value = false;
    } else {
      pinError.value = 'Incorrect PIN';
    }
  } finally {
    unlocking.value = false;
  }
}

function lockAndGoToIntake() {
  kioskStore.lock();
  void router.push('/intake');
}

// A rep who unlocks the kiosk to fix something and then walks away from the
// Intake screen shouldn't leave the full nav exposed indefinitely — auto
// re-lock after a stretch of no interaction. Scoped to the Intake screen
// only: on Setup/Review/Export someone may sit reading (a report, a batch
// of contacts) without touching the mouse or keyboard for a while, and
// getting kicked back to Intake mid-review would be actively disruptive.
const IDLE_LOCK_MS = 90_000;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  if (kioskStore.locked || route.path !== '/intake') return;
  idleTimer = setTimeout(lockAndGoToIntake, IDLE_LOCK_MS);
}

const idleEvents = ['pointerdown', 'keydown', 'wheel'] as const;

watch(() => kioskStore.locked, (locked) => {
  if (locked && idleTimer) {
    clearTimeout(idleTimer);
  } else if (!locked) {
    resetIdleTimer();
  }
});

watch(() => route.path, () => {
  resetIdleTimer();
});

onMounted(() => {
  idleEvents.forEach((evt) => window.addEventListener(evt, resetIdleTimer));
});

onUnmounted(() => {
  idleEvents.forEach((evt) => window.removeEventListener(evt, resetIdleTimer));
  if (idleTimer) clearTimeout(idleTimer);
});
</script>

<style scoped>
.app-header {
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

.app-logo {
  font-weight: 700;
  color: var(--q-primary);
  flex: 0 0 auto;
  margin-right: 24px;
}

.nav-pills {
  background: #EEF3F8;
  border-radius: 12px;
  padding: 4px;
  min-height: auto;
}

.nav-pills :deep(.q-tab) {
  border-radius: 8px;
  min-height: 36px;
  color: #5b7185;
  font-weight: 500;
  padding: 0 16px;
}

.nav-pills :deep(.q-tab--active) {
  background: white;
  color: var(--q-primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.kiosk-page-container {
  min-height: 100vh;
}

.kiosk-settings-btn {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2000;
  opacity: 0.45;
}

.kiosk-settings-btn:hover {
  opacity: 1;
}
</style>
