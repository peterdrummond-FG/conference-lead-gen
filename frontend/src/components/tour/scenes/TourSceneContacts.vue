<template>
  <!-- "Check it, then confirm it", a while after the contacts came in (so the Zoho
       match has finished). The story: open Priya, whose pasted note had no phone, see
       she has already been checked against Zoho, tick Followed up, add her phone and
       confirm (she turns green and STAYS where she is), tick another contact and she
       slides to the bottom. Then the status bar (what the colours mean, Ready, Confirm
       all) and the conference line, which opens Filter at Conference. -->
  <TourAppShell :manager="manager" active="contacts">
    <TourContactsScreen
      :manager="manager"
      :leads="leads"
      :active-id="activeId"
      :sheet-open="sheetOpen"
      :held="held"
      :sliding="sliding"
      @open="open"
      @update="(p) => patch(p.id, p.payload)"
      @followed-up="onFollowedUp"
      @approve="onApprove"
      @confirm-all="onConfirmAll"
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
// Confirmed one at a time and still where they were (ContactsPage's `held`).
const held = ref<string[]>([]);
const sliding = ref(false);
let slideTimer: ReturnType<typeof setTimeout> | null = null;

function patch(id: string, payload: UpdateContactPayload | Partial<ContactListItem>) {
  leads.value = patchLead(leads.value, id, payload);
}

// Going on to another contact settles the confirmed ones: they slide down to the
// confirmed group (the list animates only while `sliding`). Same rule as the page.
function settleOthers(keepId: string | null) {
  const stay = held.value.filter((id) => id === keepId);
  if (stay.length === held.value.length) return;
  sliding.value = true;
  if (slideTimer !== null) clearTimeout(slideTimer);
  slideTimer = setTimeout(() => { sliding.value = false; slideTimer = null; }, 600);
  held.value = stay;
}

function open(id: string) {
  settleOthers(id);
  activeId.value = id;
  if (isPhone.value) sheetOpen.value = true;
}

function onFollowedUp(id: string, value: boolean) {
  settleOthers(id);
  patch(id, { followedUp: value });
}

function onApprove(p: { id: string; edits?: UpdateContactPayload | undefined }) {
  if (p.edits) patch(p.id, p.edits);
  settleOthers(p.id);
  patch(p.id, { reviewStatus: 'approved' });
  held.value = [...held.value, p.id];
  sheetOpen.value = false;
  if (isPhone.value) {
    activeId.value = null;
  } else {
    // On a laptop Confirm moves on to the next contact still to do, which is what
    // settles this one, as it does on the real page.
    const next = leads.value.find((l) => l.reviewStatus === 'needs_review')?.id ?? null;
    activeId.value = next;
    settleOthers(next);
  }
}

// "Confirm all N" settles right away: nothing is held, nothing slides.
function onConfirmAll(ids: string[]) {
  const set = new Set(ids);
  leads.value = leads.value.map((l) => (set.has(l.id) ? { ...l, reviewStatus: 'approved' } : l));
  held.value = [];
}

function reset() {
  leads.value = contactsLeads();
  sheetOpen.value = false;
  held.value = [];
  sliding.value = false;
  activeId.value = isPhone.value ? null : 'tour-grace';
}

async function run(t: TourRun) {
  const where = isPhone.value ? '.tsr-sheet' : '.tsr-pane';
  const scroller = t.find('.tsr-scroll');
  await t.wait(600);
  // 1. Open the contact that needs something: Priya's note had no phone or email.
  const priya = t.findText('Priya Shah', '.lr-name');
  await t.scrollTo(scroller, priya, 140);
  await t.tap(priya);
  await t.wait(500);
  // 2. She has already been checked against Zoho: the edit panel's own banner says
  // her district is there and she'd be added as a new contact.
  t.hideFinger();
  await t.ring(t.find(`${where} .le-banner`), 1000);
  // 3. Already been in touch? Followed up.
  await t.tap(t.find(`${where} .le-follow`));
  await t.wait(300);
  // 4. Fix what's missing: her note said she wants a call, so add her phone.
  const editor = t.find(`${where} .le-scroll`);
  const phone = t.field('Phone');
  await t.scrollTo(editor, phone);
  await t.tap(phone.closest('.q-field') ?? phone, { press: true });
  await t.type(phone, '(512) 555-0176');
  await t.wait(300);
  // 5. Confirm. She turns confirmed where she stands...
  await t.tap(t.findText('Confirm', `${where} .le-foot button`));
  t.hideFinger();
  await t.wait(500);
  // 6. ...and slides to the bottom once you go on to another contact. On a phone
  // that is ticking Followed up on another card; on a laptop Confirm already moved
  // on, so the slide is already running.
  if (isPhone.value) {
    const sam = t.findText('Sam Ortiz', '.lr-name').closest<HTMLElement>('.lr');
    await t.scrollTo(scroller, priya, 140);
    await t.tap(sam?.querySelector<HTMLElement>('.lr-follow') ?? priya);
  }
  await t.wait(600);
  // 7. The status bar: green ready, orange needs info, blue processing and the soft
  // green confirmed are the same colours as the left edge of every card.
  await t.scrollTo(scroller, t.find('.rs-seg'), 20);
  await t.ring(t.find('.rs-seg'), 1200);
  // 8. Tap Ready, then Confirm all. Then back to everything.
  await t.tap(t.find('.rs-sgm-ready'));
  await t.wait(400);
  await t.tap(t.find('.rs-confirm-all'));
  await t.wait(600);
  await t.tap(t.find('.rs-sgm-ready'));
  await t.wait(300);
  // 9. The conference line opens Filter at Conference; Rejected is at the top of it.
  await t.tap(t.find('.rs-cline'));
  await t.wait(500);
  await t.ring(t.find('.tsr-filter [data-sec="conference"]'), 800);
  await t.scrollTo(t.find('.tsr-filter .cf-body'), t.findText('Show', '.tsr-filter .cf-lab'), 8);
  await t.ring(t.findIncl('Rejected', '.tsr-filter .cf-tog button'), 800);
  await t.tap(t.find('.tsr-filter .cf-show'));
  t.hideFinger();
  await t.wait(300);
}

defineExpose({ run, reset });
reset();
</script>
