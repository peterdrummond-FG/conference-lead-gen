<template>
  <q-page class="intake-page flex flex-center">
    <div class="intake-shell">
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

          <q-form ref="formRef" class="intake-form" @submit.prevent="onSubmit" @focusin="onFormFocusIn">
            <!-- The first block folds into a one-line summary once it's filled in and
                 the attendee moves on to another field (never while they're still
                 typing in it, which would shift the screen under their thumb). The
                 fields stay mounted (v-show) so their values and validation are
                 untouched; "Edit" just reopens them. -->
            <div v-if="folded" class="intake-summary">
              <q-icon name="check_circle" color="positive" size="22px" />
              <div class="intake-summary-text">
                <div class="intake-summary-name">{{ form.firstName.trim() }} {{ form.lastName.trim() }}</div>
                <div class="intake-summary-contact">{{ [form.email.trim(), form.phone.trim()].filter(Boolean).join(' · ') }}</div>
              </div>
              <q-btn flat no-caps color="primary" label="Edit" class="intake-summary-edit" aria-label="Edit your name and contact details" @click="unfold" />
            </div>

            <div v-show="!folded" ref="identityEl" class="intake-identity">
              <div class="intake-name-row">
                <q-input
                  ref="firstNameRef"
                  v-model="form.firstName"
                  label="First name *"
                  :autocomplete="ac('given-name')"
                  borderless
                  :rules="[(v: string) => !!v || 'Required']"
                />
                <q-input
                  v-model="form.lastName"
                  label="Last name *"
                  :autocomplete="ac('family-name')"
                  borderless
                  :rules="[(v: string) => !!v || 'Required']"
                />
              </div>

              <q-input
                v-model="form.email"
                label="Email"
                type="email"
                inputmode="email"
                :autocomplete="ac('email')"
                borderless
                :rules="[contactMethodRule]"
              />
              <!-- type="tel" + inputmode="tel" is what brings up the number pad on
                   a phone; a plain text input gave attendees the full keyboard. -->
              <q-input
                v-model="form.phone"
                label="Phone"
                type="tel"
                inputmode="tel"
                :autocomplete="ac('tel')"
                borderless
                :rules="[contactMethodRule]"
              />
              <!-- Reads as "both", but Submit still only needs one of the two. -->
              <div class="intake-hint">Add your email and phone number</div>
            </div>

            <div class="intake-optional">Optional</div>
            <q-input v-model="form.title" label="Title" :autocomplete="ac('organization-title')" borderless />

            <!-- A booth or breakout-session QR already says how they found us. -->
            <q-select
              v-if="!initialChannel"
              v-model="form.channel"
              :options="CHANNEL_OPTIONS"
              option-label="label"
              option-value="value"
              emit-value
              map-options
              clearable
              borderless
              label="How did you hear about us?"
            />

            <q-select
              v-model="form.state"
              :options="stateOptions"
              option-label="name"
              use-input
              fill-input
              hide-selected
              borderless
              input-debounce="0"
              label="State"
              @filter="filterStates"
            />

            <q-select
              v-model="form.district"
              :options="districtTypeahead.options.value"
              option-label="name"
              use-input
              fill-input
              hide-selected
              borderless
              input-debounce="300"
              new-value-mode="add-unique"
              label="School district"
              :disable="!form.state"
              :hint="!form.state ? 'Pick a state first' : undefined"
              @filter="districtTypeahead.filterFn"
              @new-value="onNewDistrict"
              @input-value="(val) => (districtInputText = val)"
              @blur="onDistrictBlur"
            />

            <q-select
              v-model="form.school"
              :options="schoolTypeahead.options.value"
              option-label="name"
              use-input
              fill-input
              hide-selected
              borderless
              input-debounce="300"
              new-value-mode="add-unique"
              label="School or campus"
              :disable="!form.district"
              :hint="!form.district ? 'Pick a district first' : undefined"
              @filter="schoolTypeahead.filterFn"
              @new-value="onNewSchool"
              @input-value="(val) => (schoolInputText = val)"
              @blur="onSchoolBlur"
            />

            <div class="intake-submit-row">
              <q-btn
                type="submit"
                unelevated
                rounded
                color="primary"
                size="lg"
                class="intake-submit-btn"
                label="Submit"
                :loading="submitting"
                :disable="submitting || previewing"
              />
            </div>
          </q-form>
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
import { useTypeahead, resolveTypedOption, type TypeaheadOption } from '@/composables/useTypeahead';
import { US_STATES, filterStateOptions, type UsStateOption } from '@/constants/usStates';
import type { QForm } from 'quasar';

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
function ac(token: string) {
  return autofillOn.value ? token : 'off';
}

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

// Admin "View as" on the Connect tab. It used to show the admin's own
// conference under the rep's name (eventStore.activeEvent is always the
// caller's), which answered "what does this rep see?" wrongly. A QR link
// (eventSlug / repSlug) names its own conference, so only the bare tab changes.
const previewing = computed(() => !!sessionStore.viewingAs && !eventSlug && !repSlug);
const formEventName = computed(() => (
  previewing.value ? sessionStore.preview?.currentEventName ?? null : eventStore.activeEvent?.name ?? null
));

// A signed-in visitor on a bare /connect (the Connect tab) submits into their
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

const formRef = ref<QForm | null>(null);
const identityEl = ref<HTMLElement | null>(null);
const firstNameRef = ref<{ focus: () => void } | null>(null);
const folded = ref(false);
const submitting = ref(false);
const submitted = ref(false);
const stateOptions = ref<UsStateOption[]>(US_STATES);

const CHANNEL_OPTIONS = [
  { label: 'At the booth', value: 'booth' as const },
  { label: 'In a breakout session', value: 'session' as const },
];

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

// State gates district, district gates school — changing an upstream field
// invalidates whatever was picked downstream of it.
watch(() => form.state, (_newState, oldState) => {
  if (oldState) form.district = null;
});
watch(() => form.district, (_newDistrict, oldDistrict) => {
  if (oldDistrict) form.school = null;
});

// Required at submit time (server enforces this too — see
// backend/Endpoints/ContactEndpoints.cs) rather than trusting the client
// alone. Attached to both email/phone fields so either one satisfying it
// clears the error on both.
function contactMethodRule() {
  return (!!form.email || !!form.phone) || 'Add an email or a phone number';
}

// Name plus at least one way to reach them. An email that doesn't look like one
// keeps the block open so a typo is still in front of them, not tucked away.
const identityComplete = computed(() => {
  const email = form.email.trim();
  const emailOk = !email || /^\S+@\S+\.\S+$/.test(email);
  return !!form.firstName.trim() && !!form.lastName.trim() && emailOk && (!!email || !!form.phone.trim());
});

// Fold when focus ENTERS a field outside the block, not when it leaves the block:
// someone who dismisses the keyboard first and then taps Title has already left
// the block without a focus change to catch. Never while they are typing in it,
// which would shift the screen under their thumb.
function onFormFocusIn(event: FocusEvent) {
  const target = event.target as Node | null;
  if (!target || identityEl.value?.contains(target)) return;
  if (identityComplete.value) folded.value = true;
}

async function unfold() {
  folded.value = false;
  await nextTick();
  firstNameRef.value?.focus();
}

function filterStates(val: string, update: (cb: () => void) => void) {
  update(() => {
    stateOptions.value = filterStateOptions(val);
  });
}

const districtTypeahead = useTypeahead(async (search: string) => {
  if (!form.state) return [];
  const { data } = await api.get<TypeaheadOption[]>('/districts-list', {
    params: { search, state: form.state.name },
  });
  return data;
});

const schoolTypeahead = useTypeahead(async (search: string) => {
  // A district the rep typed but that didn't match anything real (id: null)
  // has no schools to search — the campus field just stays free-text there.
  if (!form.district?.id) return [];
  const { data } = await api.get<TypeaheadOption[]>('/schools-list', {
    params: { search, districtId: form.district.id },
  });
  return data;
});

// A typed value with no match in the list is kept as plain text on submit
// (schoolDistrictNameRaw/schoolNameRaw) rather than becoming a new
// school_districts/schools row — see contacts-create.
function onNewDistrict(val: string, done: (item?: TypeaheadOption, mode?: 'add-unique') => void) {
  done({ id: null, name: val }, 'add-unique');
}

function onNewSchool(val: string, done: (item?: TypeaheadOption, mode?: 'add-unique') => void) {
  done({ id: null, name: val }, 'add-unique');
}

// Backstop for onNewDistrict/onNewSchool: those only fire on Enter/Tab
// (Quasar's own new-value gate), so a rep who types a name and taps Submit
// without pressing Enter first would otherwise have it silently dropped —
// see resolveTypedOption's own comment for the QSelect source this was
// verified against.
const districtInputText = ref('');
const schoolInputText = ref('');

function onDistrictBlur() {
  form.district = resolveTypedOption(districtInputText.value, form.district, districtTypeahead.options.value);
}

function onSchoolBlur() {
  form.school = resolveTypedOption(schoolInputText.value, form.school, schoolTypeahead.options.value);
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
  districtInputText.value = '';
  schoolInputText.value = '';
  formRef.value?.resetValidation();
}

async function onSubmit() {
  // Guard set synchronously, before the first await — a double-tap or a
  // native form-submit racing the button's own :disable state could
  // otherwise start a second onSubmit while the first is still awaiting
  // validate(), posting two contacts-create calls for one submission.
  if (submitting.value || previewing.value) return;
  submitting.value = true;
  try {
    const valid = await formRef.value?.validate();
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
  .intake-form :deep(.q-field) { font-size: 18px; margin-bottom: 4px; }
  .intake-form :deep(.q-field__control) { height: 52px; }
  .intake-submit-row { margin-top: 24px; }
}

/* First and last name share a row; on the narrowest phones they stack again. */
.intake-name-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 339px) {
  .intake-name-row { grid-template-columns: 1fr; gap: 0; }
}

.intake-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px 8px 14px;
  margin-bottom: 8px;
  background: #E9F5EC;
  border-radius: 12px;
}
.intake-summary-text { flex: 1; min-width: 0; }
.intake-summary-name { font-size: 16px; font-weight: 600; color: #1E5E2C; }
.intake-summary-contact {
  font-size: 14px;
  color: #2F6B3B;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.intake-summary-edit { min-height: 44px; }

.intake-shell {
  width: 100%;
  max-width: 640px;
}

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

.intake-form :deep(.q-field) {
  font-size: 20px;
  margin-bottom: 8px;
}

.intake-form :deep(.q-field__label) {
  font-size: 18px;
  /* Was #9a9a9a on #fafafa (about 2.7:1) — hard to read at a booth. */
  color: #5f6368;
}

/* One line of guidance under the phone field, and a plain divider label above
   the fields that can be skipped, so nine boxes don't all read as required. */
.intake-hint {
  font-size: 14px;
  color: #5f6368;
  margin: -4px 0 20px;
}
.intake-optional {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: #5f6368;
  margin: 8px 0 0;
}

.intake-form :deep(.q-field__control) {
  height: 56px;
}

.intake-form :deep(.q-field--borderless .q-field__control::before) {
  /* Was #d8d8d8 (about 1.4:1) — the field edges barely showed. */
  border-bottom: 2px solid #8b95a1;
}

.intake-form :deep(.q-field--focused .q-field__control::before) {
  border-bottom-color: var(--q-primary);
}

.intake-submit-row {
  margin-top: 40px;
}

.intake-submit-btn {
  width: 100%;
  font-size: 18px;
  font-weight: 600;
  padding: 16px 0;
  text-transform: none;
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
