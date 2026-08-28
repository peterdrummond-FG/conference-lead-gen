<template>
  <q-card bordered class="q-mb-md">
    <q-card-section class="row items-start q-gutter-sm">
      <q-checkbox v-model="selected" dense class="q-mt-xs" />

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
        </div>
        <div class="text-caption text-grey">
          {{ contact.eventName }} · {{ contact.districtName }}<span v-if="contact.schoolName"> · {{ contact.schoolName }}</span>
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
import type { CandidateMatch, ContactListItem, UpdateContactPayload } from '@/types/review';

const props = defineProps<{ contact: ContactListItem }>();
const emit = defineEmits<{
  approve: [id: string];
  reject: [id: string];
  update: [id: string, payload: UpdateContactPayload];
}>();

const selected = defineModel<boolean>('selected', { default: false });

const draft = reactive({
  firstName: props.contact.firstName,
  lastName: props.contact.lastName,
  email: props.contact.email ?? '',
  phone: props.contact.phone ?? '',
  title: props.contact.title ?? '',
});

const newAccountId = ref('');
const newAccountName = ref('');

const isDirty = computed(() =>
  draft.firstName !== props.contact.firstName ||
  draft.lastName !== props.contact.lastName ||
  draft.email !== (props.contact.email ?? '') ||
  draft.phone !== (props.contact.phone ?? '') ||
  draft.title !== (props.contact.title ?? ''));

function save() {
  emit('update', props.contact.id, {
    firstName: draft.firstName,
    lastName: draft.lastName,
    email: draft.email || null,
    phone: draft.phone || null,
    title: draft.title || null,
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
