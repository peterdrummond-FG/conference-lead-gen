<template>
  <!-- MainLayout's header and phone menu, for use inside a TourDevice. The
       markup and styles are MainLayout's own (q-tab instead of q-route-tab, so
       nothing here can navigate the real app). PROTOTYPE: for the build, pull
       the header out of MainLayout into one component both of them render, so
       the tour can't drift from the real bar. -->
  <div class="tab-header">
    <q-toolbar class="app-toolbar">
      <q-toolbar-title class="app-logo">CKH Connect</q-toolbar-title>
      <q-tabs v-if="!isPhone" :model-value="active" class="nav-pills" indicator-color="transparent" no-caps dense>
        <q-tab name="setup" label="Setup" data-tt="nav-setup" />
        <q-tab name="connect" label="Kiosk" data-tt="nav-connect" />
        <q-tab name="review" label="Review" data-tt="nav-review" />
        <q-tab v-if="manager" name="export" label="Export" data-tt="nav-export" />
        <q-tab v-if="manager" name="admin" label="Admin" data-tt="nav-admin" />
      </q-tabs>
      <q-separator v-if="!isPhone" vertical spaced />
      <div v-if="!isPhone" class="text-caption text-grey q-px-sm">{{ name }}</div>
      <q-btn v-if="!manager" flat dense round icon="qr_code_2" color="grey-7" data-tt="qr" />
      <q-btn flat dense round icon="help_outline" color="grey-7" />
      <q-separator v-if="!isPhone" vertical spaced />
      <q-btn v-if="!isPhone" flat dense icon="logout" round color="grey-7" />
      <q-btn v-else flat dense round icon="menu" color="grey-9" data-tt="menu" @click="$emit('menu')" />
    </q-toolbar>
  </div>

  <template v-if="isPhone">
    <div class="tab-scrim" :class="{ 'is-on': menuOpen }" />
    <div class="tab-drawer" :class="{ 'is-on': menuOpen }">
      <div class="menu-drawer">
        <div class="menu-title">CKH Connect</div>
        <q-list>
          <q-item clickable :active="active === 'review'" active-class="menu-active" data-tt="menu-review" @click="$emit('go', 'review')">
            <q-item-section avatar><q-icon name="checklist" /></q-item-section>
            <q-item-section>Review</q-item-section>
          </q-item>
          <q-item clickable :active="active === 'connect'" active-class="menu-active" data-tt="menu-connect" @click="$emit('go', 'connect')">
            <q-item-section avatar><q-icon name="tablet_mac" /></q-item-section>
            <q-item-section>Kiosk</q-item-section>
          </q-item>
          <q-item clickable :active="active === 'setup'" active-class="menu-active" data-tt="menu-setup" @click="$emit('go', 'setup')">
            <q-item-section avatar><q-icon name="tune" /></q-item-section>
            <q-item-section>Setup</q-item-section>
          </q-item>
          <template v-if="manager">
            <q-separator class="q-my-sm" />
            <q-item clickable :active="active === 'export'" active-class="menu-active" data-tt="menu-export" @click="$emit('go', 'export')">
              <q-item-section avatar><q-icon name="download" /></q-item-section>
              <q-item-section>Export</q-item-section>
            </q-item>
            <q-item clickable :active="active === 'admin'" active-class="menu-active" data-tt="menu-admin" @click="$emit('go', 'admin')">
              <q-item-section avatar><q-icon name="groups" /></q-item-section>
              <q-item-section>Admin</q-item-section>
            </q-item>
          </template>
        </q-list>
        <div class="menu-account">
          <q-separator />
          <div class="text-caption text-grey-7 q-px-md q-pt-sm">{{ name }}</div>
          <q-list>
            <q-item clickable>
              <q-item-section avatar><q-icon name="logout" /></q-item-section>
              <q-item-section>Log out</q-item-section>
            </q-item>
          </q-list>
        </div>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useQuasar } from 'quasar';

const props = defineProps<{ manager: boolean; active: string; menuOpen?: boolean }>();
defineEmits<{ menu: []; go: [page: string] }>();

const $q = useQuasar();
// Same breakpoint as MainLayout's isPhone. The tour shows the layout of the
// device it is playing on, because that is the layout the rep will use.
const isPhone = computed(() => $q.screen.lt.sm);
const name = computed(() => (props.manager ? 'Alex Morgan' : 'Jamie Cole'));
</script>

<style scoped>
.tab-header { background: #fff; color: #1d1d1d; border-bottom: 1px solid rgba(0, 0, 0, 0.08); position: relative; z-index: 2; }

/* From MainLayout.vue */
.app-logo { font-weight: 700; color: var(--q-primary); flex: 0 0 auto; margin-right: 24px; }
.nav-pills { background: #EEF3F8; border-radius: 12px; padding: 4px; min-height: auto; }
.nav-pills :deep(.q-tab) { border-radius: 8px; min-height: 36px; color: #5b7185; font-weight: 500; padding: 0 16px; }
.nav-pills :deep(.q-tab--active) { background: white; color: var(--q-primary); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }
@media (max-width: 599px) {
  .app-toolbar { padding: 4px 8px 4px 12px; }
  .app-logo { flex: 1 1 0; min-width: 0; margin-right: 0; }
  .app-toolbar > .q-btn { min-width: 44px; min-height: 44px; }
}
.menu-drawer { display: flex; flex-direction: column; min-height: 100%; }
.menu-title { padding: 14px 16px; font-size: 18px; font-weight: 700; color: var(--q-primary); border-bottom: 1px solid rgba(0, 0, 0, 0.08); }
.menu-drawer .q-item { min-height: 52px; font-size: 16px; }
.menu-drawer :deep(.menu-active) { background: #E7F0FB; color: var(--q-primary); font-weight: 500; }
.menu-account { margin-top: auto; }

/* The drawer as Quasar draws it (right side, 280 wide, over a scrim), placed
   inside the device instead of the real page. */
.tab-scrim { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.4); opacity: 0; transition: opacity 0.3s; z-index: 30; }
.tab-scrim.is-on { opacity: 1; }
.tab-drawer { position: absolute; top: 0; right: 0; bottom: 0; width: 280px; background: #fff; transform: translateX(100%); transition: transform 0.3s ease; z-index: 31; }
.tab-drawer.is-on { transform: none; }
</style>
