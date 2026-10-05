<template>
  <!-- "Check it, then approve it": open a lead, see it has already been
       checked against Zoho, fill in what's missing, tick Followed up, approve. -->
  <TourAppShell :manager="manager" active="review">
    <TourReviewScreen
      :manager="manager"
      :leads="leads"
      :active-id="activeId"
      :sheet-open="sheetOpen"
      @open="open"
      @update="(p) => patch(p.id, p.payload)"
      @approve="onApprove"
      @close="sheetOpen = false"
    />
  </TourAppShell>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useQuasar } from 'quasar';
import TourAppShell from '../TourAppShell.vue';
import TourReviewScreen from '../TourReviewScreen.vue';
import { reviewLeads, patchLead } from '../tourSampleData';
import type { ContactListItem, UpdateContactPayload } from '@/types/review';
import type { TourRun } from '../useTourScript';

defineProps<{ manager: boolean }>();

const $q = useQuasar();
const isPhone = computed(() => $q.screen.lt.sm);

const leads = ref<ContactListItem[]>(reviewLeads());
const activeId = ref<string | null>(null);
const sheetOpen = ref(false);

function open(id: string) {
  activeId.value = id;
  if (isPhone.value) sheetOpen.value = true;
}

function patch(id: string, payload: UpdateContactPayload | Partial<ContactListItem>) {
  leads.value = patchLead(leads.value, id, payload);
}

function onApprove(p: { id: string; edits?: UpdateContactPayload | undefined }) {
  if (p.edits) patch(p.id, p.edits);
  patch(p.id, { reviewStatus: 'approved' });
  sheetOpen.value = false;
  activeId.value = isPhone.value ? null : (leads.value.find((l) => l.reviewStatus === 'needs_review')?.id ?? null);
}

function reset() {
  leads.value = reviewLeads();
  sheetOpen.value = false;
  activeId.value = isPhone.value ? null : 'tour-sam';
}

async function run(t: TourRun) {
  const where = isPhone.value ? '.tsr-sheet' : '.tsr-pane';
  await t.wait(900);
  // 1. Open the lead that needs something.
  await t.tap(t.findText('Maria Lopez', '.lr-name'));
  await t.wait(700);
  // 2. It has already been checked against Zoho: the edit panel's own banner
  // says her district is there and she'd be added as a new contact.
  t.hideFinger();
  await t.ring(t.find(`${where} .le-banner`), 2200);
  // 3. Already been in touch? Followed up.
  await t.tap(t.find(`${where} .le-follow`));
  await t.wait(500);
  // 4. Fix what's missing.
  const scroller = t.find(`${where} .le-scroll`);
  const email = t.field('Email');
  await t.scrollTo(scroller, email);
  await t.tap(email.closest('.q-field') ?? email, { press: true });
  await t.type(email, 'mlopez@elmgroveisd.org');
  await t.wait(300);
  // 5. A note about the conversation. It goes to Zoho with the lead.
  const notes = t.field('Notes');
  await t.scrollTo(scroller, notes, 120);
  await t.tap(notes.closest('.q-field') ?? notes, { press: true });
  await t.type(notes, 'Wants pricing for next fall.');
  await t.wait(400);
  // 6. Approve.
  await t.tap(t.findText('Approve', `${where} .le-foot button`));
  await t.wait(900);
  t.hideFinger();
}

defineExpose({ run, reset });
reset();
</script>
