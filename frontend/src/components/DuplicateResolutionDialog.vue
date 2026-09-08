<template>
  <q-dialog :model-value="modelValue" persistent @update:model-value="(v: boolean) => $emit('update:modelValue', v)">
    <q-card style="min-width: 700px; max-width: 95vw">
      <q-card-section>
        <div class="text-h6">Resolve duplicate</div>
        <div class="text-caption text-grey">Pick which record to keep, then confirm or adjust its details. The others are rejected as duplicates.</div>
      </q-card-section>

      <q-card-section v-if="loading" class="text-center q-pa-lg">
        <q-spinner size="32px" />
      </q-card-section>

      <template v-else>
        <q-card-section class="row q-col-gutter-md">
          <div v-for="c in group" :key="c.id" class="col-12 col-sm-6 col-md-4">
            <q-card bordered flat :class="['cursor-pointer', keeperId === c.id ? 'bg-blue-1' : '']" @click="selectKeeper(c)">
              <q-img
                v-if="c.hasPhoto"
                :src="photoUrls[c.id]"
                fit="contain"
                style="height: 180px"
                class="bg-grey-2"
                @click.stop="zoomContactId = c.id"
              >
                <template #loading>
                  <div class="absolute-full flex flex-center">
                    <q-spinner color="primary" size="24px" />
                  </div>
                </template>
              </q-img>
              <div v-else class="bg-grey-2 flex flex-center text-caption text-grey" style="height: 180px">
                No photo on file
              </div>
              <q-card-section>
                <q-radio v-model="keeperId" :val="c.id" dense label="Keep this one" @click.stop />
                <div class="text-subtitle2 q-mt-xs">{{ c.firstName }} {{ c.lastName }}</div>
                <div class="text-caption">{{ c.email || 'No email' }}</div>
                <div class="text-caption">{{ c.phone || 'No phone' }}</div>
                <div class="text-caption">{{ c.title || 'No title' }}</div>
                <div class="text-caption text-grey">
                  {{ c.districtName || c.schoolDistrictNameRaw || 'No district on file' }}<span v-if="c.schoolName || c.schoolNameRaw"> · {{ c.schoolName || c.schoolNameRaw }}</span>
                </div>
                <div class="text-caption text-grey">{{ c.eventName }}<span v-if="c.state"> ({{ c.state }})</span></div>
                <div class="text-caption text-grey">{{ sourceLabel(c.source) }} · {{ formatDate(c.createdAt) }}</div>
                <div v-if="c.personVerified !== null" :class="['text-caption', c.personVerified ? 'text-green-8' : 'text-grey']">
                  Research verified: {{ c.personVerified ? 'Strong' : 'Weak' }}
                </div>
              </q-card-section>
            </q-card>
          </div>
        </q-card-section>

        <q-dialog v-model="zoomOpen">
          <q-img
            v-if="zoomContactId"
            :src="fullPhotoUrls[zoomContactId]"
            fit="contain"
            style="max-width: 90vw; max-height: 90vh"
          />
        </q-dialog>

        <q-card-section v-if="keeper">
          <div class="text-subtitle2 q-mb-sm">Merged record</div>
          <div class="row q-col-gutter-sm">
            <div class="col-6 col-sm-3">
              <q-input v-model="draft.firstName" dense outlined label="First name" />
              <div class="row q-gutter-xs q-mt-xs">
                <q-chip v-for="o in others" :key="o.id" clickable dense size="sm" @click="draft.firstName = o.firstName">{{ o.firstName }}</q-chip>
              </div>
            </div>
            <div class="col-6 col-sm-3">
              <q-input v-model="draft.lastName" dense outlined label="Last name" />
              <div class="row q-gutter-xs q-mt-xs">
                <q-chip v-for="o in others" :key="o.id" clickable dense size="sm" @click="draft.lastName = o.lastName">{{ o.lastName }}</q-chip>
              </div>
            </div>
            <div class="col-6 col-sm-3">
              <q-input v-model="draft.email" dense outlined label="Email" />
              <div class="row q-gutter-xs q-mt-xs">
                <q-chip v-for="o in othersWith('email')" :key="o.id" clickable dense size="sm" @click="draft.email = o.email ?? ''">{{ o.email }}</q-chip>
              </div>
            </div>
            <div class="col-6 col-sm-3">
              <q-input v-model="draft.phone" dense outlined label="Phone" />
              <div class="row q-gutter-xs q-mt-xs">
                <q-chip v-for="o in othersWith('phone')" :key="o.id" clickable dense size="sm" @click="draft.phone = o.phone ?? ''">{{ o.phone }}</q-chip>
              </div>
            </div>
            <div class="col-12 col-sm-6">
              <q-input v-model="draft.title" dense outlined label="Title" />
              <div class="row q-gutter-xs q-mt-xs">
                <q-chip v-for="o in othersWith('title')" :key="o.id" clickable dense size="sm" @click="draft.title = o.title ?? ''">{{ o.title }}</q-chip>
              </div>
            </div>

            <q-select
              v-model="draft.state"
              :options="stateOptions"
              option-label="name"
              use-input
              fill-input
              hide-selected
              input-debounce="0"
              class="col-6 col-sm-3"
              label="State (optional)"
              @filter="filterStates"
            />
            <q-select
              v-model="draft.district"
              :options="districtTypeahead.options.value"
              option-label="name"
              use-input
              fill-input
              hide-selected
              input-debounce="300"
              new-value-mode="add-unique"
              class="col-6 col-sm-3"
              label="School District (optional)"
              :disable="!draft.state"
              @filter="districtTypeahead.filterFn"
              @new-value="onNewDistrict"
            />
            <q-select
              v-model="draft.school"
              :options="schoolTypeahead.options.value"
              option-label="name"
              use-input
              fill-input
              hide-selected
              input-debounce="300"
              new-value-mode="add-unique"
              class="col-6"
              label="School / Campus (optional)"
              :disable="!draft.district"
              @filter="schoolTypeahead.filterFn"
              @new-value="onNewSchool"
            />
          </div>
        </q-card-section>
      </template>

      <q-card-actions align="right">
        <q-btn flat label="Cancel" @click="close" />
        <q-btn color="positive" label="Merge" :disable="!keeperId || merging" :loading="merging" @click="merge" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onUnmounted } from 'vue';
import { api } from '@/boot/axios';
import { useTypeahead, type TypeaheadOption } from '@/composables/useTypeahead';
import { US_STATES, filterStateOptions, type UsStateOption } from '@/constants/usStates';
import { stateOptionFor, districtOptionFor, schoolOptionFor } from '@/utils/contactOptions';
import type { ContactListItem } from '@/types/review';

const props = defineProps<{ modelValue: boolean; contactId: string }>();
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  resolved: [];
}>();

const loading = ref(false);
const merging = ref(false);
const group = ref<ContactListItem[]>([]);
const keeperId = ref<string | null>(null);
const zoomContactId = ref<string | null>(null);
const zoomOpen = computed({
  get: () => zoomContactId.value !== null,
  set: (v: boolean) => { if (!v) zoomContactId.value = null; },
});

// Stage 15: contacts-photo needs an authenticated request (staff PIN +
// anon-key bearer), which a plain <img src> can't send — same reasoning
// as useContactPhoto.ts, but this dialog renders a *list* of photos
// (one per card in the duplicate group) plus one zoomed one, so it keeps
// its own small id -> blob-URL maps rather than one fixed composable
// instance.
const photoUrls = reactive<Record<string, string>>({});
const fullPhotoUrls = reactive<Record<string, string>>({});

function revokeAllPhotoUrls() {
  for (const url of Object.values(photoUrls)) URL.revokeObjectURL(url);
  for (const url of Object.values(fullPhotoUrls)) URL.revokeObjectURL(url);
  for (const key of Object.keys(photoUrls)) delete photoUrls[key];
  for (const key of Object.keys(fullPhotoUrls)) delete fullPhotoUrls[key];
}

async function loadPhotoUrl(id: string, full: boolean) {
  const store = full ? fullPhotoUrls : photoUrls;
  if (store[id]) return;
  try {
    const { data } = await api.get<Blob>('/contacts-photo', {
      params: { id, full: full ? 'true' : undefined },
      responseType: 'blob',
    });
    store[id] = URL.createObjectURL(data);
  } catch {
    // leave unset — the q-img's default/error slot covers a missing photo
  }
}

onUnmounted(revokeAllPhotoUrls);

watch(zoomContactId, (id) => {
  if (id) void loadPhotoUrl(id, true);
});

const keeper = computed(() => group.value.find((c) => c.id === keeperId.value) ?? null);
const others = computed(() => group.value.filter((c) => c.id !== keeperId.value));

function othersWith(field: 'email' | 'phone' | 'title') {
  return others.value.filter((c) => c[field]);
}

const stateOptions = ref<UsStateOption[]>(US_STATES);

const draft = reactive({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  title: '',
  state: null as UsStateOption | null,
  district: null as TypeaheadOption | null,
  school: null as TypeaheadOption | null,
});

watch(() => draft.state, () => {
  draft.district = null;
});
watch(() => draft.district, () => {
  draft.school = null;
});

function selectKeeper(c: ContactListItem) {
  keeperId.value = c.id;
}

watch(keeperId, () => {
  if (!keeper.value) return;
  draft.firstName = keeper.value.firstName;
  draft.lastName = keeper.value.lastName;
  draft.email = keeper.value.email ?? '';
  draft.phone = keeper.value.phone ?? '';
  draft.title = keeper.value.title ?? '';
  draft.state = stateOptionFor(keeper.value.state);
  draft.district = districtOptionFor(keeper.value);
  draft.school = schoolOptionFor(keeper.value);
});

function filterStates(val: string, update: (cb: () => void) => void) {
  update(() => {
    stateOptions.value = filterStateOptions(val);
  });
}

const districtTypeahead = useTypeahead(async (search: string) => {
  if (!draft.state) return [];
  const { data } = await api.get<TypeaheadOption[]>('/districts-list', {
    params: { search, state: draft.state.name },
  });
  return data;
});

const schoolTypeahead = useTypeahead(async (search: string) => {
  if (!draft.district?.id) return [];
  const { data } = await api.get<TypeaheadOption[]>('/schools-list', {
    params: { search, districtId: draft.district.id },
  });
  return data;
});

function onNewDistrict(val: string, done: (item?: TypeaheadOption, mode?: 'add-unique') => void) {
  done({ id: null, name: val }, 'add-unique');
}

function onNewSchool(val: string, done: (item?: TypeaheadOption, mode?: 'add-unique') => void) {
  done({ id: null, name: val }, 'add-unique');
}

async function load() {
  loading.value = true;
  keeperId.value = null;
  zoomContactId.value = null;
  revokeAllPhotoUrls();
  try {
    const { data } = await api.get<ContactListItem[]>('/contacts-duplicates', { params: { id: props.contactId } });
    group.value = data;
    // Default to the current contact, if it's still part of the group.
    keeperId.value = data.find((c) => c.id === props.contactId)?.id ?? data[0]?.id ?? null;
    for (const c of data) {
      if (c.hasPhoto) void loadPhotoUrl(c.id, false);
    }
  } finally {
    loading.value = false;
  }
}

watch(() => props.modelValue, (open) => {
  if (open) void load();
});

function close() {
  emit('update:modelValue', false);
}

async function merge() {
  if (!keeperId.value) return;
  merging.value = true;
  try {
    await api.post(`/contacts-merge-duplicates`, {
      firstName: draft.firstName,
      lastName: draft.lastName,
      email: draft.email || null,
      phone: draft.phone || null,
      title: draft.title || null,
      state: draft.state?.name ?? null,
      schoolDistrictId: draft.district?.id ?? null,
      schoolDistrictNameRaw: draft.district && !draft.district.id ? draft.district.name : null,
      schoolId: draft.school?.id ?? null,
      schoolNameRaw: draft.school && !draft.school.id ? draft.school.name : null,
      discardContactIds: others.value.map((c) => c.id),
    }, { params: { id: keeperId.value } });
    emit('resolved');
    close();
  } finally {
    merging.value = false;
  }
}

function sourceLabel(source: string) {
  switch (source) {
    case 'form':
      return 'Form';
    case 'card_photo':
      return 'Card';
    case 'qr_code':
      return 'QR Code';
    default:
      return source;
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}
</script>
