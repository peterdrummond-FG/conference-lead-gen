<template>
  <!-- Managers: where Export is (☰ on a phone, the tab on a laptop), the
       Export button, and the "Did the file download?" confirmation that keeps
       the same leads out of the next file. -->
  <TourAppShell :manager="manager" :active="page" :menu-open="menuOpen">
    <TourExportScreen v-if="page === 'export'" :phase="phase" />
    <TourReviewScreen v-else :manager="manager" :leads="leads" :approved-base="8" />
  </TourAppShell>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useQuasar } from 'quasar';
import TourAppShell from '../TourAppShell.vue';
import TourReviewScreen from '../TourReviewScreen.vue';
import TourExportScreen from '../screens/TourExportScreen.vue';
import { reviewLeads } from '../tourSampleData';
import { goToPage } from '../tourNav';
import type { TourRun } from '../useTourScript';

defineProps<{ manager: boolean }>();
const emit = defineEmits<{ size: [s: { w: number; h: number }] }>();
const $q = useQuasar();
const isPhone = computed(() => $q.screen.lt.sm);

const page = ref('review');
const menuOpen = ref(false);
const phase = ref<'ready' | 'pending' | 'done'>('ready');
const leads = ref(reviewLeads());

function reset() {
  page.value = 'review';
  menuOpen.value = false;
  phase.value = 'ready';
  emit('size', isPhone.value ? { w: 375, h: 600 } : { w: 1280, h: 800 });
}

async function run(t: TourRun) {
  await t.wait(800);
  await goToPage(t, { phone: isPhone.value, page: 'export', setMenu: (v) => (menuOpen.value = v), setPage: (p) => (page.value = p) });
  await t.tap(t.find('.ex-btn'), { press: true });
  phase.value = 'pending';
  await t.wait(1600);
  await t.tap(t.findText('Yes, it downloaded'), { press: true });
  phase.value = 'done';
  t.hideFinger();
  await t.wait(2600);
}

defineExpose({ run, reset });
reset();
</script>
