<template>
  <q-page class="intake-page flex flex-center">
    <div class="intake-shell">
      <transition name="fade" mode="out-in">
        <div v-if="submitted" key="thanks" class="text-center">
          <q-icon name="check_circle" color="positive" size="72px" />
          <div class="intake-thanks-title q-mt-md">Thanks — you're entered!</div>
        </div>

        <div v-else-if="eventStore.loaded && !eventStore.activeEvent" key="unset" class="text-center">
          <q-icon name="event_busy" color="grey-5" size="56px" />
          <div class="intake-thanks-title q-mt-md">No event set up yet</div>
          <div class="intake-subtitle q-mb-0">Unlock the kiosk (gear, bottom-right) and pick today's event in Setup.</div>
        </div>

        <div v-else key="form">
          <div class="intake-title">{{ eventStore.activeEvent?.name }}</div>
          <div class="intake-subtitle">Tell us a bit about yourself.</div>

          <q-form ref="formRef" class="intake-form" @submit.prevent="onSubmit">
            <q-input
              v-model="form.firstName"
              label="First name *"
              borderless
              :rules="[(v: string) => !!v || 'Required']"
            />
            <q-input
              v-model="form.lastName"
              label="Last name *"
              borderless
              :rules="[(v: string) => !!v || 'Required']"
            />

            <q-input
              v-model="form.email"
              label="Email"
              type="email"
              borderless
              :rules="[contactMethodRule]"
            />
            <q-input
              v-model="form.phone"
              label="Phone"
              borderless
              :rules="[contactMethodRule]"
            />
            <q-input v-model="form.title" label="Title" borderless />

            <q-select
              v-model="form.state"
              :options="stateOptions"
              option-label="name"
              use-input
              fill-input
              hide-selected
              borderless
              input-debounce="0"
              label="State (optional)"
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
              label="School District (optional)"
              :disable="!form.state"
              @filter="districtTypeahead.filterFn"
              @new-value="onNewDistrict"
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
              label="School / Campus (optional)"
              :disable="!form.district"
              @filter="schoolTypeahead.filterFn"
              @new-value="onNewSchool"
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
              />
            </div>
          </q-form>
        </div>
      </transition>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { reactive, ref, watch, onMounted } from 'vue';
import { api } from '@/boot/axios';
import { useEventStore } from '@/stores/event-store';
import { useTypeahead, type TypeaheadOption } from '@/composables/useTypeahead';
import { US_STATES, filterStateOptions, type UsStateOption } from '@/constants/usStates';
import type { QForm } from 'quasar';

const eventStore = useEventStore();

const formRef = ref<QForm | null>(null);
const submitting = ref(false);
const submitted = ref(false);
const stateOptions = ref<UsStateOption[]>(US_STATES);

const form = reactive({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  title: '',
  state: null as UsStateOption | null,
  district: null as TypeaheadOption | null,
  school: null as TypeaheadOption | null,
});

// State gates district, district gates school — changing an upstream field
// invalidates whatever was picked downstream of it.
watch(() => form.state, () => {
  form.district = null;
});
watch(() => form.district, () => {
  form.school = null;
});

// Required at submit time (server enforces this too — see
// backend/Endpoints/ContactEndpoints.cs) rather than trusting the client
// alone. Attached to both email/phone fields so either one satisfying it
// clears the error on both.
function contactMethodRule() {
  return (!!form.email || !!form.phone) || 'Provide an email or phone number';
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

function resetForm() {
  form.firstName = '';
  form.lastName = '';
  form.email = '';
  form.phone = '';
  form.title = '';
  form.state = null;
  form.district = null;
  form.school = null;
  formRef.value?.resetValidation();
}

async function onSubmit() {
  const valid = await formRef.value?.validate();
  if (!valid) return;

  submitting.value = true;
  try {
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
  await eventStore.fetchActive();
});
</script>

<style scoped>
.intake-page {
  min-height: 100vh;
  background: #fafafa;
  padding: 48px 24px;
}

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
  color: #9a9a9a;
}

.intake-form :deep(.q-field__control) {
  height: 56px;
}

.intake-form :deep(.q-field--borderless .q-field__control::before) {
  border-bottom: 2px solid #d8d8d8;
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
