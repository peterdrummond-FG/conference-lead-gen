<template>
  <!-- Managers: where Admin is, and its three jobs (activate a conference, end
       one, and say which conference each rep is working at), then Review's
       amber banner for scans that couldn't be placed under a conference. -->
  <TourAppShell :manager="manager" :active="page" :menu-open="menuOpen">
    <TourAdminScreen v-if="page === 'admin'" />
    <TourReviewScreen v-else :manager="manager" :leads="leads" :scans-waiting="manager" :scans-expanded="scansOpen" @toggle-scans="scansOpen = !scansOpen" />
  </TourAppShell>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useQuasar } from 'quasar';
import TourAppShell from '../TourAppShell.vue';
import TourReviewScreen from '../TourReviewScreen.vue';
import TourAdminScreen from '../screens/TourAdminScreen.vue';
import { reviewLeads } from '../tourSampleData';
import { goToPage } from '../tourNav';
import type { TourRun } from '../useTourScript';

defineProps<{ manager: boolean }>();
const emit = defineEmits<{ size: [s: { w: number; h: number }] }>();
const $q = useQuasar();
const isPhone = computed(() => $q.screen.lt.sm);

const page = ref('review');
const menuOpen = ref(false);
const scansOpen = ref(false);
const leads = ref(reviewLeads());

function reset() {
  page.value = 'review';
  menuOpen.value = false;
  scansOpen.value = false;
  emit('size', isPhone.value ? { w: 375, h: 600 } : { w: 1280, h: 800 });
}

async function run(t: TourRun) {
  await t.wait(800);
  await goToPage(t, { phone: isPhone.value, page: 'admin', setMenu: (v) => (menuOpen.value = v), setPage: (p) => (page.value = p) });
  t.hideFinger();
  await t.ring(t.find('[data-tt="activate"]'), 1800);
  await t.ring(t.find('[data-tt="end"]'), 1800);
  const scroller = t.find('.tad');
  await t.scrollTo(scroller, t.find('[data-tt="team"]'), 10);
  await t.ring(t.find('[data-tt="add-person"]'), 1800);
  await t.ring(t.find('[data-tt="working-at"]'), 2200);

  // Where scans that couldn't be placed under a conference wait for a manager.
  await goToPage(t, { phone: isPhone.value, page: 'review', setMenu: (v) => (menuOpen.value = v), setPage: (p) => (page.value = p) });
  await t.wait(500);
  await t.ring(t.find('[data-tt="scans-waiting"]'), 1800);
  await t.tap(t.find('[data-tt="scans-toggle"]'));
  await t.wait(500);
  await t.ring(t.find('[data-tt="scan-row"]'), 2600);
  t.hideFinger();
}

defineExpose({ run, reset });
reset();
</script>
