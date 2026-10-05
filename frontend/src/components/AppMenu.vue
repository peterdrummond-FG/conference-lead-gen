<template>
  <!-- The phone's page menu: the pages for this person, then who they are and log
       out. MainLayout's drawer content as pure display (the tour draws it too).
       Review is first because it is the page everyone lives in. Same role checks as
       the laptop tabs. `active` is set only by the tour, which swaps the router links
       for plain rows. -->
  <div class="menu-drawer">
    <div class="menu-title">CKH Connect</div>
    <q-list>
      <template v-for="(g, gi) in groups" :key="gi">
        <q-separator v-if="gi > 0" class="q-my-sm" />
        <q-item
          v-for="p in g" :key="p.name" clickable active-class="menu-active"
          v-bind="active === undefined ? { to: p.to } : { active: active === p.name }"
          @click="$emit('go', p.name)"
        >
          <q-item-section avatar><q-icon :name="p.icon" /></q-item-section>
          <q-item-section>{{ p.label }}</q-item-section>
        </q-item>
      </template>
    </q-list>
    <div class="menu-account">
      <q-separator />
      <div class="text-caption text-grey-7 q-px-md q-pt-sm">{{ name }}</div>
      <q-list>
        <q-item clickable @click="$emit('logout')">
          <q-item-section avatar><q-icon name="logout" /></q-item-section>
          <q-item-section>Log out</q-item-section>
        </q-item>
      </q-list>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  name: string;
  canSeeSetup: boolean;
  canSeeExport: boolean;
  canSeeAdmin: boolean;
  active?: string;
}>();
// go: a row was tapped (MainLayout closes the drawer; the router does the going).
defineEmits<{ go: [page: string]; logout: [] }>();

const groups = computed(() => {
  const main = [
    { name: 'review', label: 'Review', to: '/review', icon: 'checklist' },
    { name: 'connect', label: 'Kiosk', to: '/connect', icon: 'tablet_mac' },
    ...(props.canSeeSetup ? [{ name: 'setup', label: 'Setup', to: '/setup', icon: 'tune' }] : []),
  ];
  const staff = [
    ...(props.canSeeExport ? [{ name: 'export', label: 'Export', to: '/export', icon: 'download' }] : []),
    ...(props.canSeeAdmin ? [{ name: 'admin', label: 'Admin', to: '/admin', icon: 'groups' }] : []),
  ];
  return staff.length ? [main, staff] : [main];
});
</script>

<style scoped>
.menu-drawer {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.menu-title {
  padding: 14px 16px;
  font-size: 18px;
  font-weight: 700;
  color: var(--q-primary);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

.menu-drawer .q-item {
  min-height: 52px;
  font-size: 16px;
}

.menu-drawer :deep(.menu-active) {
  background: #E7F0FB;
  color: var(--q-primary);
  font-weight: 500;
}

.menu-account {
  margin-top: auto;
  padding-bottom: env(safe-area-inset-bottom);
}
</style>
