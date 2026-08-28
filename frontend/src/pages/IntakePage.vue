<template>
  <q-page class="q-pa-lg flex flex-center">
    <q-card style="width: 520px; max-width: 92vw">
      <transition name="fade" mode="out-in">
        <div v-if="submitted" key="thanks" class="q-pa-xl text-center">
          <q-icon name="check_circle" color="positive" size="64px" />
          <div class="text-h5 q-mt-md">Thanks — you're entered!</div>
        </div>

        <q-card-section v-else key="form">
          <div class="text-h5">{{ eventStore.activeEvent?.name }}</div>
          <div class="text-caption text-grey q-mb-md">
            {{ eventStore.activeEvent?.city }}, {{ eventStore.activeEvent?.state }}
          </div>

          <q-form ref="formRef" class="q-gutter-md" @submit.prevent="onSubmit">
            <div class="row q-col-gutter-md">
              <q-input
                v-model="form.firstName"
                class="col"
                label="First name *"
                :rules="[(v: string) => !!v || 'Required']"
              />
              <q-input
                v-model="form.lastName"
                class="col"
                label="Last name *"
                :rules="[(v: string) => !!v || 'Required']"
              />
            </div>

            <q-input
              v-model="form.email"
              label="Email"
              type="email"
              :rules="[contactMethodRule]"
            />
            <q-input
              v-model="form.phone"
              label="Phone"
              :rules="[contactMethodRule]"
            />
            <q-input v-model="form.title" label="Title" />

            <q-select
              v-model="form.district"
              :options="districtTypeahead.options.value"
              option-label="name"
              use-input
              fill-input
              hide-selected
              input-debounce="300"
              new-value-mode="add-unique"
              label="School District *"
              :rules="[(v: TypeaheadOption | null) => !!v || 'Required']"
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
              input-debounce="300"
              new-value-mode="add-unique"
              label="School (optional)"
              :disable="!form.district"
              @filter="schoolTypeahead.filterFn"
              @new-value="onNewSchool"
            />

            <div class="text-right">
              <q-btn type="submit" color="primary" label="Submit" :loading="submitting" />
            </div>
          </q-form>
        </q-card-section>
      </transition>
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/boot/axios';
import { useEventStore } from '@/stores/event-store';
import { useTypeahead, type TypeaheadOption } from '@/composables/useTypeahead';
import type { QForm } from 'quasar';

const router = useRouter();
const eventStore = useEventStore();

const formRef = ref<QForm | null>(null);
const submitting = ref(false);
const submitted = ref(false);

const form = reactive({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  title: '',
  district: null as TypeaheadOption | null,
  school: null as TypeaheadOption | null,
});

// Required at submit time (server enforces this too — see
// backend/Endpoints/ContactEndpoints.cs) rather than trusting the client
// alone. Attached to both email/phone fields so either one satisfying it
// clears the error on both.
function contactMethodRule() {
  return (!!form.email || !!form.phone) || 'Provide an email or phone number';
}

const districtTypeahead = useTypeahead(async (search: string) => {
  const state = eventStore.activeEvent?.state;
  if (!state) return [];
  const { data } = await api.get<TypeaheadOption[]>('/districts', { params: { search, state } });
  return data;
});

const schoolTypeahead = useTypeahead(async (search: string) => {
  if (!form.district) return [];
  const { data } = await api.get<TypeaheadOption[]>('/schools', {
    params: { search, districtId: form.district.id },
  });
  return data;
});

function onNewDistrict(val: string, done: (item?: TypeaheadOption, mode?: 'add-unique') => void) {
  api.post<TypeaheadOption>('/districts', { name: val }).then(({ data }) => {
    done(data, 'add-unique');
  });
}

function onNewSchool(val: string, done: (item?: TypeaheadOption, mode?: 'add-unique') => void) {
  if (!form.district) return;
  api.post<TypeaheadOption>('/schools', { districtId: form.district.id, name: val }).then(({ data }) => {
    done(data, 'add-unique');
  });
}

function resetForm() {
  form.firstName = '';
  form.lastName = '';
  form.email = '';
  form.phone = '';
  form.title = '';
  form.district = null;
  form.school = null;
  formRef.value?.resetValidation();
}

async function onSubmit() {
  const valid = await formRef.value?.validate();
  if (!valid || !form.district) return;

  submitting.value = true;
  try {
    await api.post('/contacts', {
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email || null,
      phone: form.phone || null,
      title: form.title || null,
      schoolDistrictId: form.district.id,
      schoolId: form.school?.id ?? null,
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
  if (!eventStore.activeEvent) {
    await router.replace('/setup');
  }
});
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.4s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
