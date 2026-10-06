<template>
  <q-page class="intake-page flex flex-center">
    <div class="intake-shell">
      <!-- Staff only, and only on the Kiosk tab itself: not on a rep's QR link, not
           while previewing someone, and not before there is a form to hand over. -->
      <div v-if="canLock" class="intake-tools">
        <LockKioskButton />
      </div>
      <transition name="fade" mode="out-in">
        <div v-if="!eventStore.loaded || (previewing && !sessionStore.preview)" key="loading" class="text-center">
          <q-spinner size="40px" color="primary" />
        </div>

        <div v-else-if="submitted" key="thanks" class="text-center">
          <q-icon name="check_circle" color="positive" size="72px" />
          <div class="intake-thanks-title q-mt-md">Thanks — we've got your info!</div>
          <div class="intake-subtitle">Someone from our team will be in touch.</div>
        </div>

        <div v-else-if="!formEventName || needsLink" key="unset" class="text-center">
          <q-icon name="event_busy" color="grey-5" size="56px" />
          <div class="intake-thanks-title q-mt-md">{{ sessionStore.user ? 'Join a conference first' : 'No event set up yet' }}</div>
          <div class="intake-subtitle q-mb-0">
            {{ sessionStore.user
              ? 'Join today\'s conference in Setup, then come back here.'
              : 'Scan the conference QR code again, or ask the rep for their code.' }}
          </div>
        </div>

        <div v-else key="form">
          <!-- Previewing a rep: the form as it is for them, but it can't be sent.
               contacts-create resolves a signed-in call from the caller's own
               token, so a lead typed here would land in the ADMIN's conference,
               not the rep's. -->
          <q-banner v-if="previewing" dense rounded class="bg-grey-2 text-grey-9 q-mb-md">
            {{ sessionStore.viewingAs?.name }}'s form. Submitting is off while you're viewing as someone.
          </q-banner>
          <div class="intake-title">{{ formEventName }}</div>
          <div class="intake-subtitle">Tell us a bit about yourself.</div>

          <IntakeFormFields
            ref="fields"
            :form="form" :folded="folded" :show-channel="!initialChannel"
            :autofill="autofillOn" :submitting="submitting" :previewing="previewing"
            @submit="onSubmit"
            @focus-outside="onFocusOutside"
            @unfold="unfold"
          />
        </div>
      </transition>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { reactive, ref, computed, watch, nextTick, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '@/boot/axios';
import { useEventStore } from '@/stores/event-store';
import { useSessionStore } from '@/stores/session-store';
import { useKioskModeStore } from '@/stores/kiosk-mode-store';
import LockKioskButton from '@/components/LockKioskButton.vue';
import type { TypeaheadOption } from '@/utils/institutionPicker';
import type { UsStateOption } from '@/constants/usStates';
import IntakeFormFields from '@/components/IntakeFormFields.vue';

const eventStore = useEventStore();
const sessionStore = useSessionStore();
const kioskModeStore = useKioskModeStore();
const route = useRoute();

// Browser autofill helps an attendee on their own phone (the QR path), but on a
// shared booth device it would offer the device OWNER's saved name, email and
// phone to every attendee who taps a field. A locked kiosk, or any device with
// a staff member signed in (someone showing the form on their own laptop or
// phone), is a shared device, so autofill is off there.
const autofillOn = computed(() => !kioskModeStore.locked && !sessionStore.user);

// Which specific rep's QR got scanned to land here (routes.ts pulls it off
// /connect/<slug>/<repId>) — revalidated server-side against event_reps, so
// a bookmarked/typed URL or a stale value (the rep was unlinked) just means
// no rep gets credited rather than anything breaking here. A pre-Stage-19
// QR (/connect/<slug>-booth or -session) carries no repId at all.
const repId = typeof route.query.repId === 'string' ? route.query.repId : undefined;

// A pre-Stage-19 QR also still carries ?channel= directly — kept as the
// initial value of the form's own channel picker below so an old slide
// doesn't lose that signal outright, but the attendee's own selection is
// otherwise what decides it now (Stage 19: booth/session is no longer tied
// to which QR was scanned).
const initialChannel = route.query.channel === 'booth' || route.query.channel === 'session'
  ? route.query.channel
  : null;

// Which specific event's QR this was (routes.ts pulls it off
// /connect/<slug>/<repId>, pre-Stage-20) — multiple conferences can be
// active at once, so this, not "the" active event, is what both
// events-active and contacts-create resolve against. Missing for a
// bare/legacy /connect link, or for a Stage 20 rep QR (repSlug below).
const eventSlug = typeof route.query.eventSlug === 'string' ? route.query.eventSlug : undefined;

// A rep's own reusable QR (routes.ts pulls it off /connect/<repSlug>) — the
// event is whatever that rep is currently linked to, resolved server-side
// (events-active/contacts-create), never anything this page decides itself.
const repSlug = typeof route.query.repSlug === 'string' ? route.query.repSlug : undefined;

// Admin "View as" on the Kiosk tab. It used to show the admin's own
// conference under the rep's name (eventStore.activeEvent is always the
// caller's), which answered "what does this rep see?" wrongly. A QR link
// (eventSlug / repSlug) names its own conference, so only the bare tab changes.
const previewing = computed(() => !!sessionStore.viewingAs && !eventSlug && !repSlug);
const formEventName = computed(() => (
  previewing.value ? sessionStore.preview?.currentEventName ?? null : eventStore.activeEvent?.name ?? null
));

// A signed-in visitor on a bare /connect (the Kiosk tab) submits into their
// OWN linked conference -- contacts-create resolves it from their token.
// events-active still returns the most recently activated event for display
// when they have none linked, so without this the form would name a
// conference the submit will refuse (or, before contacts-create was fixed,
// silently file the lead under). Key off currentEventId, never activeEvent.
const needsLink = computed(() => {
  if (!sessionStore.user || eventSlug || repSlug) return false;
  // Admin "View as": whether the PREVIEWED person has a conference, not the admin.
  if (previewing.value) return !sessionStore.preview?.currentEventId;
  return !sessionStore.user.currentEventId;
});

const canLock = computed(() => (
  !!sessionStore.user && !kioskModeStore.locked && !eventSlug && !repSlug && !previewing.value
  && !!formEventName.value && !needsLink.value && !submitted.value
));

// The form's fields are IntakeFormFields (which the onboarding tour draws too);
// State, District and School are InstitutionFields inside it (lists, typed entries and
// clearing rules live there); this page keeps the data and the submit.
const fields = ref<{ validate: () => Promise<boolean>; resetValidation: () => void; focusFirstName: () => void } | null>(null);
const folded = ref(false);
const submitting = ref(false);
const submitted = ref(false);

const form = reactive({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  title: '',
  state: null as UsStateOption | null,
  district: null as TypeaheadOption | null,
  school: null as TypeaheadOption | null,
  // Optional — Stage 19 retired the old channel-per-QR scheme, so this is
  // the attendee's own answer rather than something inferred from which QR
  // they scanned. Left null rather than defaulted, so "didn't answer" stays
  // distinguishable from a real choice.
  channel: initialChannel as 'booth' | 'session' | null,
});

// Name plus at least one way to reach them. An email that doesn't look like one
// keeps the block open so a typo is still in front of them, not tucked away.
const identityComplete = computed(() => {
  const email = form.email.trim();
  const emailOk = !email || /^\S+@\S+\.\S+$/.test(email);
  return !!form.firstName.trim() && !!form.lastName.trim() && emailOk && (!!email || !!form.phone.trim());
});

// Fold once focus ENTERS a field outside the name-and-contact block (IntakeFormFields
// reports that), not when it leaves the block: someone who dismisses the keyboard first
// and then taps Title has already left the block without a focus change to catch. Never
// while they are typing in it, which would shift the screen under their thumb.
function onFocusOutside() {
  if (identityComplete.value) folded.value = true;
}

async function unfold() {
  folded.value = false;
  await nextTick();
  fields.value?.focusFirstName();
}

function resetForm() {
  form.firstName = '';
  form.lastName = '';
  form.email = '';
  form.phone = '';
  form.title = '';
  form.state = null;
  form.district = null;
  form.school = null;
  form.channel = initialChannel;
  folded.value = false;
  fields.value?.resetValidation();
}

async function onSubmit() {
  // Guard set synchronously, before the first await — a double-tap or a
  // native form-submit racing the button's own :disable state could
  // otherwise start a second onSubmit while the first is still awaiting
  // validate(), posting two contacts-create calls for one submission.
  if (submitting.value || previewing.value) return;
  submitting.value = true;
  try {
    const valid = await fields.value?.validate();
    if (!valid) return;

    await api.post('/contacts-create', {
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email || null,
      phone: form.phone || null,
      title: form.title || null,
      state: form.state?.name ?? null,
      schoolDistrictId: form.district?.id ?? null,
      schoolDistrictNameRaw: form.district && !form.district.id ? form.district.name : null,
      schoolId: form.school?.id ?? null,
      schoolNameRaw: form.school && !form.school.id ? form.school.name : null,
      channel: form.channel,
      repId,
      eventSlug,
      repSlug,
    });

    submitted.value = true;
    setTimeout(() => {
      resetForm();
      submitted.value = false;
    }, 2500);
  } finally {
    submitting.value = false;
  }
}

onMounted(async () => {
  await eventStore.fetchActive(eventSlug, repSlug);
});
</script>

<style scoped>
.intake-page {
  min-height: 100vh;
  background: #fafafa;
  padding: 48px 24px;
}

/* A phone doesn't need 48px of air above the first field. */
@media (max-width: 599px) {
  .intake-page { padding: 20px 16px 32px; }
  .intake-title { font-size: 24px; }
  .intake-subtitle { margin-top: 4px; margin-bottom: 12px; font-size: 16px; }
}

.intake-shell {
  width: 100%;
  max-width: 640px;
}
.intake-tools { display: flex; justify-content: flex-end; margin-bottom: 4px; }

.intake-title {
  font-size: clamp(28px, 4vw, 40px);
  font-weight: 700;
  line-height: 1.15;
  color: #262627;
}

.intake-subtitle {
  font-size: 18px;
  color: #6b6b6b;
  margin-top: 8px;
  margin-bottom: 40px;
}

.intake-thanks-title {
  font-size: clamp(24px, 4vw, 34px);
  font-weight: 700;
  color: #262627;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.4s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
