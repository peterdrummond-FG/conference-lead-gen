<template>
  <q-layout view="hHh lpr fFf">
    <q-header v-if="sessionStore.user && !kioskModeStore.locked" class="bg-white text-dark app-header" bordered>
      <q-toolbar>
        <q-toolbar-title class="app-logo">CKH Connect</q-toolbar-title>
        <q-tabs class="nav-pills" indicator-color="transparent" no-caps dense>
          <q-route-tab v-if="canSeeSetup" to="/setup" label="Setup" />
          <q-route-tab to="/intake" label="Intake" />
          <q-route-tab to="/review" label="Review" />
          <q-route-tab v-if="canSeeExport" to="/export" label="Export" />
        </q-tabs>
        <q-separator vertical spaced />

        <!-- Admin only: a genuine "view as" switcher, backed by real
             accounts — picking someone previews Review exactly as they'd
             see it, but every write still lands under the admin's own
             account (see session-store's effectiveRole/effectiveRepId). -->
        <q-btn-dropdown v-if="sessionStore.user.role === 'admin'" flat dense no-caps icon="switch_account" color="primary" :label="viewingAsLabel">
          <q-tooltip>View as</q-tooltip>
          <q-list>
            <q-item clickable v-close-popup @click="sessionStore.setViewingAs(null)">
              <q-item-section>Myself (Admin)</q-item-section>
            </q-item>
            <q-separator />
            <q-item v-for="p in profiles" :key="p.id" clickable v-close-popup @click="sessionStore.setViewingAs(p)">
              <q-item-section>{{ p.name }} ({{ roleLabel(p.role) }})</q-item-section>
            </q-item>
          </q-list>
        </q-btn-dropdown>
        <div v-else class="text-caption text-grey q-px-sm">{{ sessionStore.user.name }}</div>

        <!-- Locks this physical device down to just the public Intake
             screen — for a shared kiosk iPad/laptop an attendee will be
             handed. Doesn't sign anyone out; see kiosk-mode-store.ts. -->
        <q-btn flat dense no-caps icon="lock" color="grey-7" label="Lock kiosk" @click="onLockKiosk">
          <q-tooltip>Lock this device to Intake only</q-tooltip>
        </q-btn>

        <q-separator vertical spaced />
        <q-btn flat dense icon="logout" round color="grey-7" @click="onLogout">
          <q-tooltip>Log out</q-tooltip>
        </q-btn>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <router-view />
    </q-page-container>

    <q-btn
      v-if="kioskModeStore.locked"
      round
      flat
      icon="settings"
      class="kiosk-unlock-btn"
      color="grey-6"
      @click="showUnlockDialog = true"
    />

    <q-dialog v-model="showUnlockDialog" @hide="unlockCode = ''; unlockError = ''">
      <q-card style="width: 320px">
        <q-card-section>
          <div class="text-h6">Unlock kiosk</div>
          <div class="text-caption text-grey">Enter your kiosk PIN to unlock.</div>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <q-input
            v-model="unlockCode"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            autofocus
            label="Your kiosk PIN"
            :error="!!unlockError"
            :error-message="unlockError"
            @keyup.enter="onUnlockKiosk"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="primary" label="Unlock" :loading="unlocking" @click="onUnlockKiosk" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-layout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionStore } from '@/stores/session-store';
import { useKioskModeStore } from '@/stores/kiosk-mode-store';
import { api } from '@/boot/axios';
import type { Profile, Role } from '@/types/review';

const router = useRouter();
const sessionStore = useSessionStore();
const kioskModeStore = useKioskModeStore();

// effectiveRole (real role, or the admin-only "view as" preview role when
// set) rather than sessionStore.user?.role directly -- found 2026-09-16: the
// nav tabs stayed keyed to the real admin's own role no matter who they
// picked in the "View as" switcher, so previewing a sales rep still showed
// every admin-only tab (Export) instead of what that rep would actually see.
// The switcher's own visibility (below) stays on the real role regardless --
// an admin previewing someone must always be able to switch back.
const canSeeSetup = computed(() => (
  sessionStore.effectiveRole === 'admin' || sessionStore.effectiveRole === 'solutionsSuccess' || sessionStore.effectiveRole === 'sales'
));

// Matches the /export route's own meta.roles guard (router/index.ts) — sales
// could otherwise still click into the tab even though the router would
// bounce them straight back out.
const canSeeExport = computed(() => (
  sessionStore.effectiveRole === 'admin' || sessionStore.effectiveRole === 'solutionsSuccess'
));

const showUnlockDialog = ref(false);
const unlockCode = ref('');
const unlockError = ref('');
const unlocking = ref(false);

function onLockKiosk() {
  kioskModeStore.lock();
  void router.push('/intake');
}

// Kiosk-locking never signs anyone out — the same account is still the one
// logged in underneath. Unlocking checks that account's own kiosk PIN (set
// by each user in Setup), never their real login password — a device left
// unlocked shouldn't leak a real password to whoever's standing at the booth.
async function onUnlockKiosk() {
  if (!unlockCode.value) return;
  unlocking.value = true;
  unlockError.value = '';
  try {
    const { data } = await api.post<{ valid: boolean }>('/kiosk-verify-code', { code: unlockCode.value });
    if (!data.valid) {
      unlockError.value = 'Incorrect code';
      return;
    }
    kioskModeStore.unlock();
    showUnlockDialog.value = false;
  } catch {
    unlockError.value = 'Incorrect code';
  } finally {
    unlocking.value = false;
  }
}

const profiles = ref<Profile[]>([]);

function roleLabel(role: Role) {
  if (role === 'admin') return 'Admin';
  if (role === 'solutionsSuccess') return 'Solutions Success';
  return 'Sales';
}

const viewingAsLabel = computed(() => (
  sessionStore.viewingAs ? `Viewing as ${sessionStore.viewingAs.name}` : 'Myself (Admin)'
));

async function loadProfiles() {
  const { data } = await api.get<Profile[]>('/profiles-list');
  profiles.value = data;
}

watch(() => sessionStore.user?.role, (role) => {
  if (role === 'admin') void loadProfiles();
}, { immediate: true });

async function onLogout() {
  await sessionStore.logout();
  void router.push('/login');
}
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

.kiosk-unlock-btn {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2000;
  opacity: 0.45;
}

.kiosk-unlock-btn:hover {
  opacity: 1;
}
</style>
