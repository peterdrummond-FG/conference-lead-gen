<template>
  <!-- "Check it, then confirm it", a while after the leads came in (so the Zoho
       match has finished): open Priya, whose pasted note had no phone, see it has
       already been checked against Zoho, tick Followed up, add her phone, confirm. -->
  <TourAppShell :manager="manager" active="contacts">
    <TourContactsScreen
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
import TourContactsScreen from '../TourContactsScreen.vue';
import { contactsLeads, patchLead } from '../tourSampleData';
import type { ContactListItem, UpdateContactPayload } from '@/types/review';
import type { TourRun } from '../useTourScript';

defineProps<{ manager: boolean }>();

const $q = useQuasar();
const isPhone = computed(() => $q.screen.lt.sm);

const leads = ref<ContactListItem[]>(contactsLeads());
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
  leads.value = contactsLeads();
  sheetOpen.value = false;
  activeId.value = isPhone.value ? null : 'tour-grace';
}

async function run(t: TourRun) {
  const where = isPhone.value ? '.tsr-sheet' : '.tsr-pane';
  await t.wait(900);
  // 1. Open the lead that needs something: Priya's note had no phone or email.
  await t.tap(t.findText('Priya Shah', '.lr-name'));
  await t.wait(700);
  // 2. It has already been checked against Zoho: the edit panel's own banner
  // says her district is there and she'd be added as a new contact.
  t.hideFinger();
  await t.ring(t.find(`${where} .le-banner`), 2200);
  // 3. Already been in touch? Followed up.
  await t.tap(t.find(`${where} .le-follow`));
  await t.wait(500);
  // 4. Fix what's missing: her note said she wants a call, so add her phone.
  const scroller = t.find(`${where} .le-scroll`);
  const phone = t.field('Phone');
  await t.scrollTo(scroller, phone);
  await t.tap(phone.closest('.q-field') ?? phone, { press: true });
  await t.type(phone, '(512) 555-0176');
  await t.wait(400);
  // 5. Confirm.
  await t.tap(t.findText('Confirm', `${where} .le-foot button`));
  await t.wait(900);
  t.hideFinger();
}

defineExpose({ run, reset });
reset();
</script>
