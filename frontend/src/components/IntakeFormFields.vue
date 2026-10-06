<template>
  <q-form ref="formRef" class="intake-form" :class="{ 'is-phone': phone }" @submit.prevent="$emit('submit')" @focusin="onFocusIn">
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
      <q-btn flat no-caps color="primary" label="Edit" class="intake-summary-edit" aria-label="Edit your name and contact details" @click="$emit('unfold')" />
    </div>

    <div v-show="!folded" ref="identityEl" class="intake-identity">
      <div class="intake-name-row">
        <q-input
      :readonly="readonly"
          ref="firstNameRef"
          v-model="form.firstName"
          label="First name *"
          :autocomplete="ac('given-name')"
          borderless
          :rules="[(v: string) => !!v || 'Required']"
        />
        <q-input
      :readonly="readonly"
          v-model="form.lastName"
          label="Last name *"
          :autocomplete="ac('family-name')"
          borderless
          :rules="[(v: string) => !!v || 'Required']"
        />
      </div>

      <q-input
      :readonly="readonly"
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
      :readonly="readonly"
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
    <q-input v-model="form.title" :readonly="readonly" label="Title" :autocomplete="ac('organization-title')" borderless />

    <!-- A booth or breakout-session QR already says how they found us. -->
    <q-select
      :readonly="readonly"
      v-if="showChannel"
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

    <!-- State, District and School: the same fields the lead editor and the merge dialog
         use (InstitutionFields), so the lists, the "Use '<typed>'" entry and the clearing
         rules are one piece of code. -->
    <InstitutionFields :model="form" variant="form" hints :readonly="readonly" />

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
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { QForm } from 'quasar';
import type { UsStateOption } from '@/constants/usStates';
import type { TypeaheadOption } from '@/utils/institutionPicker';
import InstitutionFields from '@/components/InstitutionFields.vue';

// The attendee form's fields and the fold-up, with nothing about where the
// answers go: IntakePage owns the data (typeahead requests, validation, the
// submit) and hands it in; the onboarding tour renders this same component
// read-only with sample answers. `form` is the page's own reactive object and the
// fields write straight into it, as they did before this was split out.
export interface IntakeFormModel {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  title: string;
  state: UsStateOption | null;
  district: TypeaheadOption | null;
  school: TypeaheadOption | null;
  channel: 'booth' | 'session' | null;
}

const props = defineProps<{
  form: IntakeFormModel;
  folded: boolean;
  // A booth or breakout-session QR already says how they found us.
  showChannel: boolean;
  // Browser autofill is off on a shared device (see IntakePage).
  autofill: boolean;
  submitting?: boolean;
  previewing?: boolean;
  // The tour shows the form being filled in without letting anyone touch it.
  readonly?: boolean;
  // Phone sizing even when the browser window is wide (the tour's phone screen).
  phone?: boolean;
}>();

const emit = defineEmits<{
  submit: [];
  unfold: [];
  // Focus moved to a field outside the name-and-contact block.
  focusOutside: [];
}>();

const form = props.form;
const formRef = ref<QForm | null>(null);
const identityEl = ref<HTMLElement | null>(null);
const firstNameRef = ref<{ focus: () => void } | null>(null);

const CHANNEL_OPTIONS = [
  { label: 'At the booth', value: 'booth' as const },
  { label: 'In a breakout session', value: 'session' as const },
];

function ac(token: string) {
  return props.autofill ? token : 'off';
}

// Required at submit time (server enforces this too) rather than trusting the
// client alone. Attached to both email/phone fields so either one satisfying it
// clears the error on both.
function contactMethodRule() {
  return (!!form.email || !!form.phone) || 'Add an email or a phone number';
}

// Fold when focus ENTERS a field outside the block, not when it leaves the block:
// someone who dismisses the keyboard first and then taps Title has already left
// the block without a focus change to catch. Never while they are typing in it,
// which would shift the screen under their thumb. (The page decides whether the
// block is complete enough to fold.)
function onFocusIn(event: FocusEvent) {
  const target = event.target as Node | null;
  if (!target || identityEl.value?.contains(target)) return;
  emit('focusOutside');
}
defineExpose({
  validate: () => formRef.value?.validate() ?? Promise.resolve(true),
  resetValidation: () => formRef.value?.resetValidation(),
  focusFirstName: () => firstNameRef.value?.focus(),
});
</script>

<style scoped>
/* From IntakePage.vue's styles, with the phone sizes also available as a class
   (.is-phone) so the tour's phone-sized screen looks right on a laptop browser. */
.intake-form :deep(.q-field) { font-size: 20px; margin-bottom: 8px; }
.intake-form :deep(.q-field__control) { height: 56px; }
.intake-form :deep(.q-field__label) {
  font-size: 18px;
  /* Was #9a9a9a on #fafafa (about 2.7:1), hard to read at a booth. */
  color: #5f6368;
}
.intake-form :deep(.q-field--borderless .q-field__control::before) {
  /* Was #d8d8d8 (about 1.4:1): the field edges barely showed. */
  border-bottom: 2px solid #8b95a1;
}
.intake-form :deep(.q-field--focused .q-field__control::before) { border-bottom-color: var(--q-primary); }

/* First and last name share a row; on the narrowest phones they stack again. */
.intake-name-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 339px) {
  .intake-name-row { grid-template-columns: 1fr; gap: 0; }
}

.intake-summary { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 14px; margin-bottom: 8px; background: #E9F5EC; border-radius: 12px; }
.intake-summary-text { flex: 1; min-width: 0; }
.intake-summary-name { font-size: 16px; font-weight: 600; color: #1E5E2C; }
.intake-summary-contact { font-size: 14px; color: #2F6B3B; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.intake-summary-edit { min-height: 44px; }

/* One line of guidance under the phone field, and a plain divider label above
   the fields that can be skipped, so nine boxes don't all read as required. */
.intake-hint { font-size: 14px; color: #5f6368; margin: -4px 0 20px; }
.intake-optional { font-size: 13px; font-weight: 600; letter-spacing: 0.02em; color: #5f6368; margin: 8px 0 0; }

.intake-submit-row { margin-top: 40px; }
.intake-submit-btn { width: 100%; font-size: 18px; font-weight: 600; padding: 16px 0; text-transform: none; }

@media (max-width: 599px) {
  .intake-form :deep(.q-field) { font-size: 18px; margin-bottom: 4px; }
  .intake-form :deep(.q-field__control) { height: 52px; }
  .intake-submit-row { margin-top: 24px; }
}
.intake-form.is-phone :deep(.q-field) { font-size: 18px; margin-bottom: 4px; }
.intake-form.is-phone :deep(.q-field__control) { height: 52px; }
.intake-form.is-phone .intake-submit-row { margin-top: 24px; }
</style>
