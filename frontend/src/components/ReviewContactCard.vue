<template>
  <q-card bordered class="q-mb-md">
    <q-card-section class="row items-start q-gutter-sm">
      <q-checkbox v-model="selected" dense class="q-mt-xs" />

      <img
        v-if="contact.hasPhoto"
        :src="`/api/contacts/${contact.id}/photo`"
        style="max-width: 160px; max-height: 160px; object-fit: contain"
        class="q-mr-sm"
        alt="Source card photo"
      />

      <div class="col">
        <div class="row items-center q-gutter-xs">
          <span class="text-subtitle1">{{ contact.firstName }} {{ contact.lastName }}</span>
          <q-chip dense size="sm" :color="sourceColor" text-color="white">{{ contact.source }}</q-chip>
          <q-chip v-if="contact.extractionConfidence" dense size="sm" :color="confidenceColor(contact.extractionConfidence)" text-color="white">
            extraction: {{ contact.extractionConfidence }}
          </q-chip>
          <q-chip dense size="sm" :color="matchStatusColor" text-color="white">{{ contact.matchStatus }}</q-chip>
          <q-chip v-if="contact.matchConfidence" dense size="sm" :color="confidenceColor(contact.matchConfidence)" text-color="white">
            match: {{ contact.matchConfidence }}
          </q-chip>
          <q-chip v-if="isStuck" dense size="sm" color="red-8" text-color="white">stuck — needs attention</q-chip>
        </div>
        <div class="text-caption text-grey">
          {{ contact.eventName }} · {{ contact.districtName }}<span v-if="contact.schoolName"> · {{ contact.schoolName }}</span>
        </div>
        <div v-if="contact.matchStatus === 'pending' && contact.matchAttempts >= 1" class="text-caption text-grey">
          Match attempt {{ contact.matchAttempts }} of {{ maxAutoAttempts }}
          <q-btn dense flat size="sm" color="primary" label="Retry match" class="q-ml-sm" @click="$emit('retryMatch', contact.id)" />
        </div>

        <q-banner v-if="contact.localDuplicateOfContactName" dense class="bg-orange-1 text-orange-10 q-mt-sm">
          Possible duplicate of {{ contact.localDuplicateOfContactName }}
        </q-banner>

        <div class="row q-col-gutter-sm q-mt-sm">
          <q-input v-model="draft.firstName" dense outlined class="col-6 col-sm-3" label="First name" />
          <q-input v-model="draft.lastName" dense outlined class="col-6 col-sm-3" label="Last name" />
          <q-input v-model="draft.email" dense outlined class="col-6 col-sm-3" label="Email" />
          <q-input v-model="draft.phone" dense outlined class="col-6 col-sm-3" label="Phone" />
          <q-input v-model="draft.title" dense outlined class="col-12 col-sm-6" label="Title" />

          <q-select
            v-model="draft.district"
            :options="districtTypeahead.options.value"
            option-label="name"
            use-input
            fill-input
            hide-selected
            input-debounce="300"
            new-value-mode="add-unique"
            class="col-6"
            label="School District"
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
            label="School (optional)"
            :disable="!draft.district"
            @filter="schoolTypeahead.filterFn"
            @new-value="onNewSchool"
          />
        </div>

        <div v-if="contact.matchStatus === 'ambiguous' && contact.candidateMatches?.length" class="q-mt-sm">
          <div class="text-caption text-weight-medium q-mb-xs">Candidate matches — pick one:</div>
          <q-list bordered dense>
            <q-item v-for="c in contact.candidateMatches" :key="c.zohoId" clickable @click="resolveCandidate(c)">
              <q-item-section>
                <q-item-label>{{ c.name }}</q-item-label>
                <q-item-label caption>{{ c.type }} · score {{ c.score.toFixed(2) }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </div>

        <div v-if="contact.matchStatus === 'new_account'" class="q-mt-sm row q-col-gutter-sm items-end">
          <q-input v-model="newAccountId" dense outlined class="col-5" label="Zoho Account Id (once created)" />
          <q-input v-model="newAccountName" dense outlined class="col-5" label="Account name" />
          <q-btn dense flat color="primary" label="Link" class="col-2" :disable="!newAccountId || !newAccountName" @click="linkNewAccount" />
        </div>

        <div v-if="contact.notes" class="text-caption text-grey q-mt-sm">{{ contact.notes }}</div>

        <div class="q-mt-sm row q-gutter-sm">
          <q-btn
            color="positive"
            label="Approve"
            size="sm"
            :disable="contact.matchStatus === 'pending'"
            @click="$emit('approve', contact.id)"
          />
          <q-btn
            color="primary"
            label="Save"
            size="sm"
            outline
            :disable="!isDirty"
            @click="save"
          />
          <q-btn color="negative" label="Reject" size="sm" outline @click="$emit('reject', contact.id)" />
        </div>
      </div>
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import { reactive, computed, ref } from 'vue';
import { api } from '@/boot/axios';
import { useTypeahead, type TypeaheadOption } from '@/composables/useTypeahead';
import type { CandidateMatch, ContactListItem, UpdateContactPayload } from '@/types/review';

const props = defineProps<{ contact: ContactListItem }>();
const emit = defineEmits<{
  approve: [id: string];
  reject: [id: string];
  update: [id: string, payload: UpdateContactPayload];
  retryMatch: [id: string];
}>();

// Mirrors MatchingRetryScanner's MaxAutoAttempts (backend/Services/MatchingRetryScanner.cs)
// — past this, the background sweep has given up and only the manual
// "Retry match" button can trigger another attempt.
const maxAutoAttempts = 3;
const isStuck = computed(() => props.contact.matchStatus === 'pending' && props.contact.matchAttempts >= maxAutoAttempts);

const selected = defineModel<boolean>('selected', { default: false });

const draft = reactive({
  firstName: props.contact.firstName,
  lastName: props.contact.lastName,
  email: props.contact.email ?? '',
  phone: props.contact.phone ?? '',
  title: props.contact.title ?? '',
  district: { id: props.contact.schoolDistrictId, name: props.contact.districtName } as TypeaheadOption | null,
  school: props.contact.schoolId
    ? ({ id: props.contact.schoolId, name: props.contact.schoolName ?? '' } as TypeaheadOption)
    : null as TypeaheadOption | null,
});

const newAccountId = ref('');
const newAccountName = ref('');

// Scoped by the CONTACT's own event state, not whichever event is currently
// active — a card-photo contact is often reviewed well after its event
// ended, possibly with a different one active by then.
const districtTypeahead = useTypeahead(async (search: string) => {
  const { data } = await api.get<TypeaheadOption[]>('/districts', {
    params: { search, state: props.contact.eventState },
  });
  return data;
});

const schoolTypeahead = useTypeahead(async (search: string) => {
  if (!draft.district) return [];
  const { data } = await api.get<TypeaheadOption[]>('/schools', {
    params: { search, districtId: draft.district.id },
  });
  return data;
});

function onNewDistrict(val: string, done: (item?: TypeaheadOption, mode?: 'add-unique') => void) {
  api.post<TypeaheadOption>('/districts', { name: val, eventId: props.contact.eventId }).then(({ data }) => {
    done(data, 'add-unique');
  });
}

function onNewSchool(val: string, done: (item?: TypeaheadOption, mode?: 'add-unique') => void) {
  if (!draft.district) return;
  api.post<TypeaheadOption>('/schools', { districtId: draft.district.id, name: val }).then(({ data }) => {
    done(data, 'add-unique');
  });
}

const isDirty = computed(() =>
  draft.firstName !== props.contact.firstName ||
  draft.lastName !== props.contact.lastName ||
  draft.email !== (props.contact.email ?? '') ||
  draft.phone !== (props.contact.phone ?? '') ||
  draft.title !== (props.contact.title ?? '') ||
  draft.district?.id !== props.contact.schoolDistrictId ||
  (draft.school?.id ?? null) !== props.contact.schoolId);

function save() {
  emit('update', props.contact.id, {
    firstName: draft.firstName,
    lastName: draft.lastName,
    email: draft.email || null,
    phone: draft.phone || null,
    title: draft.title || null,
    schoolDistrictId: draft.district?.id ?? props.contact.schoolDistrictId,
    schoolId: draft.school?.id ?? null,
  });
}

function resolveCandidate(candidate: CandidateMatch) {
  const payload: UpdateContactPayload =
    candidate.type === 'contact'
      ? {
          matchedZohoContactId: candidate.zohoId,
          matchedZohoContactName: candidate.name,
          matchStatus: 'existing_contact',
          matchConfidence: 'high',
        }
      : {
          matchedZohoAccountId: candidate.zohoId,
          matchedZohoAccountName: candidate.name,
          matchStatus: 'new_contact_existing_account',
          matchConfidence: 'high',
        };
  emit('update', props.contact.id, payload);
}

function linkNewAccount() {
  emit('update', props.contact.id, {
    matchedZohoAccountId: newAccountId.value,
    matchedZohoAccountName: newAccountName.value,
    matchStatus: 'new_contact_existing_account',
    matchConfidence: 'high',
  });
  newAccountId.value = '';
  newAccountName.value = '';
}

const sourceColor = computed(() => (props.contact.source === 'card_photo' ? 'deep-purple' : 'blue-grey'));

const matchStatusColor = computed(() => {
  switch (props.contact.matchStatus) {
    case 'existing_contact':
    case 'new_contact_existing_account':
      return 'green-8';
    case 'ambiguous':
    case 'new_account':
      return 'orange-8';
    default:
      return 'grey-7';
  }
});

function confidenceColor(level: string) {
  switch (level) {
    case 'high':
      return 'green-8';
    case 'medium':
      return 'orange-8';
    default:
      return 'red-8';
  }
}
</script>
