<template>
  <!-- The app's top bar: the logo, the page tabs (laptops and tablets), the admin
       "View as" switcher or the person's name, the rep's QR button, the ? that
       replays the tour, and log out (or, on a phone, the menu button). It is
       MainLayout's header pulled out as pure display so the onboarding tour draws
       this exact bar for each role and can't drift from it. MainLayout feeds it the
       real account and routes; the tour passes `active` instead, which swaps the
       route tabs for plain ones so nothing in the tour can navigate the real app. -->
  <q-toolbar class="app-toolbar">
    <q-toolbar-title class="app-logo">CKH Connect</q-toolbar-title>
    <!-- Tablet and desktop only. Phones get the same pages in the menu drawer
         (the pills plus QR, ? and account icons did not fit one row on a 375px
         screen). -->
    <q-tabs v-if="!isPhone" :model-value="active" class="nav-pills" indicator-color="transparent" no-caps dense>
      <component :is="tabComponent" v-for="t in shownTabs" :key="t.name" v-bind="tabProps(t)" />
    </q-tabs>
    <q-separator v-if="!isPhone" vertical spaced />

    <!-- Admin only: a genuine "view as" switcher, backed by real accounts: picking
         someone previews Contacts exactly as they'd see it, but every write still
         lands under the admin's own account (see session-store's effectiveRole). -->
    <q-btn-dropdown v-if="role === 'admin'" flat dense no-caps icon="switch_account" color="primary" :label="isPhone ? undefined : viewingAsLabel" :aria-label="viewingAsLabel">
      <q-tooltip>View as</q-tooltip>
      <q-list>
        <q-item v-close-popup clickable @click="$emit('viewAs', null)">
          <q-item-section>Myself (Admin)</q-item-section>
        </q-item>
        <q-separator />
        <q-item v-for="p in profiles" :key="p.id" v-close-popup clickable @click="$emit('viewAs', p)">
          <q-item-section>{{ p.name }} ({{ roleLabel(p.role) }})</q-item-section>
        </q-item>
      </q-list>
    </q-btn-dropdown>
    <div v-else-if="!isPhone" class="text-caption text-grey q-px-sm app-username">{{ name }}</div>

    <!-- The rep's own QR on screen in one tap, so showing it to someone is not a trip
         to Setup. Only for an account that has one (Sales); an admin previewing a
         rep gets that rep's. -->
    <q-btn v-if="hasQr" flat dense round icon="qr_code_2" color="grey-7" aria-label="Show my QR code" @click="$emit('qr')">
      <q-tooltip>Show my QR code</q-tooltip>
    </q-btn>

    <!-- Replays the whole tour. Never touches what the account remembers: the first
         time set that, and a replay shouldn't undo it. -->
    <q-btn flat dense round icon="help_outline" color="grey-7" aria-label="Take the tour" @click="$emit('tour')">
      <q-tooltip>Take the tour</q-tooltip>
    </q-btn>

    <q-separator v-if="!isPhone" vertical spaced />
    <q-btn v-if="!isPhone" flat dense icon="logout" round color="grey-7" aria-label="Log out" @click="$emit('logout')">
      <q-tooltip>Log out</q-tooltip>
    </q-btn>

    <!-- Phones: the hamburger sits where the account icon was. Log out lives at
         the bottom of the drawer behind a labelled row, so it is still not one slip
         away from the QR and ? icons. -->
    <q-btn v-else flat dense round icon="menu" color="grey-9" aria-label="Open menu" @click="$emit('menu')" />
  </q-toolbar>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { QRouteTab, QTab } from 'quasar';
import type { Profile, Role } from '@/types/review';

const props = defineProps<{
  // The signed-in person's real role (an admin previewing someone still sees the
  // switcher, so they can always switch back).
  role: Role;
  name: string;
  isPhone: boolean;
  // Which page tabs this person gets; Kiosk and Contacts are for everyone.
  canSeeSetup: boolean;
  canSeeExport: boolean;
  canSeeAdmin: boolean;
  hasQr: boolean;
  viewingAsLabel: string;
  profiles: Profile[];
  // Set only by the tour: draw plain tabs with this one selected.
  active?: string;
}>();
defineEmits<{ viewAs: [profile: Profile | null]; qr: []; tour: []; logout: []; menu: [] }>();

function roleLabel(role: Role) {
  if (role === 'admin') return 'Admin';
  if (role === 'solutionsSuccess') return 'Solutions Success';
  return 'Sales';
}

const tabComponent = computed(() => (props.active === undefined ? QRouteTab : QTab));
const shownTabs = computed(() => [
  { name: 'setup', label: 'Setup', to: '/setup', show: props.canSeeSetup },
  { name: 'connect', label: 'Kiosk', to: '/connect', show: true },
  { name: 'contacts', label: 'Contacts', to: '/contacts', show: true },
  { name: 'export', label: 'Export', to: '/export', show: props.canSeeExport },
  { name: 'admin', label: 'Admin', to: '/admin', show: props.canSeeAdmin },
].filter((t) => t.show));
function tabProps(t: { name: string; label: string; to: string }) {
  return props.active === undefined ? { to: t.to, label: t.label } : { name: t.name, label: t.label };
}
</script>

<style scoped>
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

/* Phones: the logo takes the row and the icon actions (view-as, QR, ?, menu) sit
   at its right; the page links are in the drawer. The old layout wrapped logo + 4
   tabs onto two rows because they were wider than a 375px screen. */
@media (max-width: 599px) {
  .app-toolbar {
    padding: 4px 8px 4px 12px;
  }

  .app-logo {
    flex: 1 1 0;
    min-width: 0;
    margin-right: 0;
  }

  .app-toolbar > .q-btn {
    min-width: 44px;
    min-height: 44px;
  }
}
</style>
