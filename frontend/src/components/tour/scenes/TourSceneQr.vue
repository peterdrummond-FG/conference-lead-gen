<template>
  <!-- "Or let them add themselves". A rep: the QR icon in the top bar shows
       their code, an attendee scans it and fills in the form, and the lead
       lands in the rep's Review. A manager has no code of their own: they save
       a rep's from Admin, under Team. -->
  <TourIntakeScreen v-if="part === 'attendee'" :form="form" :folded="folded" :submitted="submitted" />
  <TourAppShell v-else :manager="manager" :active="page" :menu-open="menuOpen">
    <TourAdminScreen v-if="page === 'admin'" />
    <TourReviewScreen v-else :manager="manager" :leads="leads" />
    <template #overlay>
      <TourQrOverlay v-if="!manager" :open="qrOpen" />
    </template>
  </TourAppShell>
</template>

<script setup lang="ts">
import { ref, reactive, computed, nextTick } from 'vue';
import { useQuasar } from 'quasar';
import TourAppShell from '../TourAppShell.vue';
import TourReviewScreen from '../TourReviewScreen.vue';
import TourAdminScreen from '../screens/TourAdminScreen.vue';
import TourIntakeScreen from '../screens/TourIntakeScreen.vue';
import type { IntakeFormModel } from '@/components/IntakeFormFields.vue';
import TourQrOverlay from '../screens/TourQrOverlay.vue';
import { tourLeads, SAMPLE_LEAD_FORM } from '../tourSampleData';
import { goToPage } from '../tourNav';
import type { TourRun } from '../useTourScript';

const props = defineProps<{ manager: boolean }>();
const emit = defineEmits<{ size: [s: { w: number; h: number }] }>();
const $q = useQuasar();
const isPhone = computed(() => $q.screen.lt.sm);

const part = ref<'app' | 'attendee'>('app');
const page = ref('review');
const menuOpen = ref(false);
const qrOpen = ref(false);
// The leads from earlier in the story are matched by now; Grace's is the new one.
const earlierLeads = () => tourLeads(['dana', 'sam', 'priya', 'tom', 'ana']);
const blankForm = (): IntakeFormModel => ({ firstName: '', lastName: '', email: '', phone: '', title: '', state: null, district: null, school: null, channel: null });
const leads = ref(earlierLeads());
const form: IntakeFormModel = reactive(blankForm());
const folded = ref(false);
const submitted = ref(false);

const phoneSize = { w: 375, h: 600 };
function appSize() { return isPhone.value ? phoneSize : { w: 1280, h: 800 }; }

function reset() {
  part.value = 'app';
  page.value = 'review';
  menuOpen.value = false;
  qrOpen.value = false;
  leads.value = earlierLeads();
  Object.assign(form, blankForm());
  folded.value = false;
  submitted.value = false;
  emit('size', appSize());
}

// Types into a text field, or into a picker (State, School district), one character
// at a time. A picker holds an option, so the partly typed text is the option's name.
async function fill(t: TourRun, key: 'firstName' | 'lastName' | 'email' | 'title' | 'state' | 'district', text: string) {
  for (let i = 1; i <= text.length; i++) {
    const so_far = text.slice(0, i);
    if (key === 'state') form.state = { code: 'TX', name: so_far };
    else if (key === 'district') form.district = { id: null, name: so_far };
    else form[key] = so_far;
    await t.wait(40);
  }
}

// A field of the attendee form (IntakeFormFields), found by its label, as a person would.
function box(t: TourRun, label: string): HTMLElement {
  const input = t.field(label);
  return input.closest<HTMLElement>('.q-field') ?? input;
}

async function runRep(t: TourRun) {
  await t.wait(800);
  const qr = t.find('[aria-label="Show my QR code"]');
  await t.ring(qr, 1000);
  await t.tap(qr, { press: true });
  qrOpen.value = true;
  t.hideFinger();
  await t.wait(800);
  await t.ring(t.find('.rq-foot'), 2000);

  // What the person who scans it sees, on their own phone.
  part.value = 'attendee';
  emit('size', phoneSize);
  await nextTick();
  await t.wait(800);
  await t.tap(box(t, 'First name *'), { press: true });
  await fill(t, 'firstName', SAMPLE_LEAD_FORM.firstName);
  await fill(t, 'lastName', SAMPLE_LEAD_FORM.lastName);
  await t.tap(box(t, 'Email'), { press: true });
  await fill(t, 'email', SAMPLE_LEAD_FORM.email);
  // Moving on to another field folds name and contact into the green summary
  // row, as the real form does, which keeps Submit on the screen.
  await t.tap(box(t, 'Title'), { press: true });
  folded.value = true;
  await nextTick();
  await t.wait(500);
  await fill(t, 'title', SAMPLE_LEAD_FORM.title);
  await t.tap(box(t, 'State'), { press: true });
  await fill(t, 'state', SAMPLE_LEAD_FORM.state);
  await t.tap(box(t, 'School district'), { press: true });
  await fill(t, 'district', SAMPLE_LEAD_FORM.district);
  await t.wait(300);
  await t.tap(t.find('.intake-submit-btn'), { press: true });
  submitted.value = true;
  t.hideFinger();
  await t.wait(1600);

  // And it's in the rep's Review, credited to them. It has only just arrived, so
  // it is still being matched against Zoho: the real "Checking match…" state.
  part.value = 'app';
  qrOpen.value = false;
  emit('size', appSize());
  leads.value = tourLeads(['dana', 'sam', 'priya', 'tom', 'ana', 'grace'], { processing: ['grace'] });
  await nextTick();
  await t.wait(700);
  await t.ring(t.findText(`${SAMPLE_LEAD_FORM.firstName} ${SAMPLE_LEAD_FORM.lastName}`, '.lr-name').closest('.lr') ?? t.find('.lr'), 2600);
}

async function runManager(t: TourRun) {
  await t.wait(800);
  await goToPage(t, { phone: isPhone.value, page: 'admin', setMenu: (v) => (menuOpen.value = v), setPage: (p) => (page.value = p) });
  const scroller = t.find('.tad');
  await t.scrollTo(scroller, t.findText('Team', '.text-h6').closest<HTMLElement>('.q-card') ?? t.find('.q-card'), 10);
  t.hideFinger();
  await t.ring(t.find('.admin-link'), 2600);
}

async function run(t: TourRun) {
  if (props.manager) await runManager(t);
  else await runRep(t);
}

defineExpose({ run, reset });
reset();
</script>
