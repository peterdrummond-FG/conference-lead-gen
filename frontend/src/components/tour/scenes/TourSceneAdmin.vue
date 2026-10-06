<template>
  <!-- Managers: where Admin is, and its three jobs (activate a conference, end
       one, and say which conference each rep is working at), then Contacts'
       amber banner for scans that couldn't be placed under a conference. -->
  <TourAppShell :manager="manager" :active="page" :menu-open="menuOpen">
    <TourAdminScreen v-if="page === 'admin'" />
    <TourContactsScreen v-else :manager="manager" :leads="leads" :scans-waiting="manager" :scans-expanded="scansOpen" @toggle-scans="scansOpen = !scansOpen" />
  </TourAppShell>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useQuasar } from 'quasar';
import TourAppShell from '../TourAppShell.vue';
import TourContactsScreen from '../TourContactsScreen.vue';
import TourAdminScreen from '../screens/TourAdminScreen.vue';
import { contactsLeads } from '../tourSampleData';
import { goToPage } from '../tourNav';
import type { TourRun } from '../useTourScript';

defineProps<{ manager: boolean }>();
const emit = defineEmits<{ size: [s: { w: number; h: number }] }>();
const $q = useQuasar();
const isPhone = computed(() => $q.screen.lt.sm);

const page = ref('contacts');
const menuOpen = ref(false);
const scansOpen = ref(false);
const leads = ref(contactsLeads());

function reset() {
  page.value = 'contacts';
  menuOpen.value = false;
  scansOpen.value = false;
  emit('size', isPhone.value ? { w: 375, h: 600 } : { w: 1280, h: 800 });
}

async function run(t: TourRun) {
  await t.wait(800);
  await goToPage(t, { phone: isPhone.value, page: 'admin', setMenu: (v) => (menuOpen.value = v), setPage: (p) => (page.value = p) });
  t.hideFinger();
  await t.ring(t.findText('Activate a conference', '.admin-btn *'), 1800);
  await t.ring(t.find('[aria-label^="End "]'), 1800);
  const scroller = t.find('.tad');
  await t.scrollTo(scroller, t.findText('Team', '.text-h6').closest<HTMLElement>('.q-card') ?? t.find('.q-card'), 10);
  await t.ring(t.findText('Add person', '.admin-btn *'), 1800);
  await t.ring(t.field('Working at').closest<HTMLElement>('.q-field') ?? t.field('Working at'), 2200);

  // Where scans that couldn't be placed under a conference wait for a manager.
  await goToPage(t, { phone: isPhone.value, page: 'contacts', setMenu: (v) => (menuOpen.value = v), setPage: (p) => (page.value = p) });
  await t.wait(500);
  await t.ring(t.find('.usb'), 1800);
  await t.tap(t.findText('Show', '.usb *'));
  await t.wait(500);
  await t.ring(t.find('.usb-item'), 2600);
  t.hideFinger();
}

defineExpose({ run, reset });
reset();
</script>
