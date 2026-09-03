<template>
  <q-card bordered class="q-mb-md">
    <q-card-section class="row items-start q-gutter-sm">
      <q-checkbox v-model="selected" dense class="q-mt-xs" />

      <div v-if="contact.source === 'card_photo'" class="q-mr-sm" style="width: 220px">
        <div class="text-caption text-grey q-mb-xs">Original card</div>
        <q-img
          v-if="contact.hasPhoto"
          :src="thumbnailPhotoUrl ?? undefined"
          fit="contain"
          style="width: 220px; height: 220px; cursor: zoom-in"
          class="rounded-borders bg-grey-2"
          @click="showFullImage = true"
        >
          <template #loading>
            <div class="absolute-full flex flex-center">
              <q-spinner color="primary" size="32px" />
            </div>
          </template>
          <template #error>
            <div class="absolute-full flex flex-center text-caption text-grey">Image failed to load</div>
          </template>
        </q-img>
        <div
          v-else
          class="rounded-borders bg-grey-2 flex flex-center text-caption text-grey"
          style="width: 220px; height: 220px"
        >
          No photo on file
        </div>
        <div v-if="contact.hasCroppedPhoto" class="text-caption q-mt-xs">
          <a href="#" @click.prevent="showFullSheet = true">View full sheet</a>
        </div>
      </div>

      <q-dialog v-model="showFullImage">
        <q-img
          :src="thumbnailPhotoUrl ?? undefined"
          fit="contain"
          style="max-width: 90vw; max-height: 90vh"
        />
      </q-dialog>

      <q-dialog v-model="showFullSheet">
        <q-img
          :src="fullPhotoUrl ?? undefined"
          fit="contain"
          style="max-width: 90vw; max-height: 90vh"
        />
      </q-dialog>

      <div class="col">
        <div class="row items-center q-gutter-xs">
          <span class="text-subtitle1">{{ contact.firstName }} {{ contact.lastName }}</span>

          <q-chip dense size="sm" :class="['tag-chip', `tone-${sourceTone}`]">
            {{ sourceLabel(contact.source) }}
            <q-tooltip>Import source — where this contact signed up</q-tooltip>
          </q-chip>

          <q-chip v-if="contact.extractionConfidence" dense size="sm" :class="['tag-chip', `tone-${confidenceTone(contact.extractionConfidence)}`]">
            Import confidence: {{ capitalize(contact.extractionConfidence) }}
            <q-tooltip>
              How confident the card scan was when reading this contact's details.
              <template v-if="contact.extractionConfidence === 'failed'">The scan failed — type the details in from the original photo.</template>
            </q-tooltip>
          </q-chip>

          <q-chip v-if="contact.personVerified !== null" dense size="sm" :class="['tag-chip', contact.personVerified ? 'tone-green' : 'tone-grey']">
            Research verified: {{ contact.personVerified ? 'Strong' : 'Weak' }}
            <q-tooltip>
              <template v-if="contact.personVerified">Research confirmed this person works at this school/district.</template>
              <template v-else>Research could not independently confirm this person at this school/district.</template>
            </q-tooltip>
          </q-chip>

          <q-chip dense size="sm" :class="['tag-chip', `tone-${matchStatusTone}`]">
            {{ matchStatusLabel }}
            <q-tooltip>Whether this school/district — and this contact — already exist in the CRM</q-tooltip>
          </q-chip>

          <q-chip v-if="contact.matchConfidence" dense size="sm" :class="['tag-chip', `tone-${confidenceTone(contact.matchConfidence)}`]">
            Match confidence: {{ capitalize(contact.matchConfidence) }}
            <q-tooltip>How confident the CRM match itself is</q-tooltip>
          </q-chip>

          <q-chip v-if="contact.matchedZohoAccountId && contact.hasActiveOpportunity !== null" dense size="sm" :class="['tag-chip', contact.hasActiveOpportunity ? 'tone-green' : 'tone-grey']">
            {{ contact.hasActiveOpportunity ? 'Active opportunity' : 'No active opportunity' }}
            <q-tooltip>
              <template v-if="contact.hasActiveOpportunity">{{ contact.activeOpportunityName || 'This account has an open or signed opportunity in Zoho.' }}</template>
              <template v-else>Existing account, but no active opportunity currently open.</template>
            </q-tooltip>
          </q-chip>

          <q-chip v-if="isStuck" dense size="sm" class="tag-chip tone-red">Stuck — needs manual retry</q-chip>
        </div>
        <div class="text-caption text-grey">
          {{ contact.eventName }} · {{ contact.districtName }}<span v-if="contact.schoolName"> · {{ contact.schoolName }}</span>
        </div>
        <div v-if="contact.matchStatus === 'pending' && contact.matchAttempts >= 1" class="text-caption text-grey">
          Match attempt {{ contact.matchAttempts }} of {{ maxAutoAttempts }}
          <q-btn dense flat size="sm" color="primary" label="Retry match" class="q-ml-sm" @click="$emit('retryMatch', contact.id)" />
        </div>

        <q-banner v-if="contact.localDuplicateOfContactName" dense class="bg-orange-1 text-orange-10 q-mt-sm">
          <div class="row items-center q-gutter-sm">
            <span>Possible duplicate of {{ contact.localDuplicateOfContactName }} — likely the same person scanned or submitted twice.</span>
            <q-btn dense flat size="sm" color="orange-10" label="Resolve duplicate" @click="showDuplicateDialog = true" />
          </div>
          <div v-if="contact.matchStatus === 'existing_contact'" class="text-caption q-mt-xs">
            Resolve the duplicate above before confirming this match.
          </div>
        </q-banner>

        <q-banner v-else-if="contact.matchStatus === 'existing_contact'" dense class="bg-green-1 text-green-10 q-mt-sm">
          <div class="text-weight-medium">Potential Match Found</div>
          <div class="q-mt-xs">
            <div>{{ contact.matchedZohoContactName }}<span v-if="contact.matchedZohoContactTitle"> — {{ contact.matchedZohoContactTitle }}</span></div>
            <div class="text-caption">
              {{ contact.matchedZohoContactEmail || 'No email on file' }} · {{ contact.matchedZohoContactPhone || 'No phone on file' }}
            </div>
            <div class="text-caption">{{ contact.matchedZohoAccountName }}</div>
          </div>
          <div class="q-mt-sm row q-gutter-sm">
            <q-btn dense color="positive" size="sm" label="Confirm match" @click="$emit('approve', contact.id)" />
            <q-btn dense flat size="sm" color="grey-8" label="Not a match" @click="notAMatch" />
          </div>
        </q-banner>

        <DuplicateResolutionDialog
          v-model="showDuplicateDialog"
          :contact-id="contact.id"
          @resolved="$emit('duplicatesResolved')"
        />

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

          <q-input
            v-model="draft.interactionNotes"
            dense
            outlined
            type="textarea"
            autogrow
            class="col-12"
            label="Interaction notes (from voice memos)"
            hint="Reviewer-editable — separate from the match reasoning below"
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

        <div v-if="contact.notes" class="text-caption text-grey q-mt-sm">
          <a href="#" @click.prevent="showNotes = !showNotes">{{ showNotes ? 'Hide match reasoning' : 'Show match reasoning' }}</a>
          <div v-if="showNotes" class="q-mt-xs">{{ contact.notes }}</div>
        </div>

        <div class="q-mt-sm row q-gutter-sm">
          <q-btn
            color="positive"
            label="Approve"
            size="sm"
            :disable="contact.matchStatus === 'pending' ||
              ((contact.matchStatus === 'ambiguous' || contact.matchStatus === 'new_account') &&
                !contact.matchedZohoAccountId && !contact.matchedZohoContactId)"
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
import { reactive, computed, ref, watch } from 'vue';
import { api } from '@/boot/axios';
import { useTypeahead, type TypeaheadOption } from '@/composables/useTypeahead';
import { useContactPhoto } from '@/composables/useContactPhoto';
import DuplicateResolutionDialog from '@/components/DuplicateResolutionDialog.vue';
import type { CandidateMatch, ContactListItem, UpdateContactPayload } from '@/types/review';

const props = defineProps<{ contact: ContactListItem }>();
const emit = defineEmits<{
  approve: [id: string];
  reject: [id: string];
  update: [id: string, payload: UpdateContactPayload];
  retryMatch: [id: string];
  duplicatesResolved: [];
}>();

// Mirrors MatchingRetryScanner's MaxAutoAttempts (backend/Services/MatchingRetryScanner.cs)
// — past this, the background sweep has given up and only the manual
// "Retry match" button can trigger another attempt.
const maxAutoAttempts = 3;
const isStuck = computed(() => props.contact.matchStatus === 'pending' && props.contact.matchAttempts >= maxAutoAttempts);

const selected = defineModel<boolean>('selected', { default: false });
const showFullImage = ref(false);
const showFullSheet = ref(false);
const showDuplicateDialog = ref(false);
const showNotes = ref(false);

const thumbnailPhotoUrl = useContactPhoto(() => props.contact.id, { enabled: () => props.contact.hasPhoto });
const fullPhotoUrl = useContactPhoto(() => props.contact.id, { full: () => true, enabled: () => showFullSheet.value });

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
  interactionNotes: props.contact.interactionNotes ?? '',
});

// A school belongs to one district — if the reviewer changes their mind on
// district after already picking a school, the stale school (from the old
// district) must not silently survive into the saved contact.
watch(() => draft.district, () => {
  draft.school = null;
});

const newAccountId = ref('');
const newAccountName = ref('');

// Scoped by the CONTACT's own event state, not whichever event is currently
// active — a card-photo contact is often reviewed well after its event
// ended, possibly with a different one active by then.
const districtTypeahead = useTypeahead(async (search: string) => {
  const { data } = await api.get<TypeaheadOption[]>('/districts-list', {
    params: { search, state: props.contact.eventState },
  });
  return data;
});

const schoolTypeahead = useTypeahead(async (search: string) => {
  if (!draft.district) return [];
  const { data } = await api.get<TypeaheadOption[]>('/schools-list', {
    params: { search, districtId: draft.district.id },
  });
  return data;
});

function onNewDistrict(val: string, done: (item?: TypeaheadOption, mode?: 'add-unique') => void) {
  api.post<TypeaheadOption>('/districts-create', { name: val, eventId: props.contact.eventId }).then(({ data }) => {
    done(data, 'add-unique');
  });
}

function onNewSchool(val: string, done: (item?: TypeaheadOption, mode?: 'add-unique') => void) {
  if (!draft.district) return;
  api.post<TypeaheadOption>('/schools-create', { districtId: draft.district.id, name: val }).then(({ data }) => {
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
  (draft.school?.id ?? null) !== props.contact.schoolId ||
  draft.interactionNotes !== (props.contact.interactionNotes ?? ''));

// /review re-fetches its whole contact list after every action and reuses
// this component instance keyed by contact.id — without this, an
// already-open card keeps showing whatever draft was snapshotted at mount,
// and Save would silently overwrite fresher server data with stale values.
// Skipped while the reviewer has an in-progress edit so a reload never
// clobbers unsaved changes.
watch(() => props.contact, (newContact) => {
  if (isDirty.value) return;
  draft.firstName = newContact.firstName;
  draft.lastName = newContact.lastName;
  draft.email = newContact.email ?? '';
  draft.phone = newContact.phone ?? '';
  draft.title = newContact.title ?? '';
  draft.district = { id: newContact.schoolDistrictId, name: newContact.districtName };
  draft.school = newContact.schoolId
    ? { id: newContact.schoolId, name: newContact.schoolName ?? '' }
    : null;
  draft.interactionNotes = newContact.interactionNotes ?? '';
});

function save() {
  emit('update', props.contact.id, {
    firstName: draft.firstName,
    lastName: draft.lastName,
    email: draft.email || null,
    phone: draft.phone || null,
    title: draft.title || null,
    schoolDistrictId: draft.district?.id ?? props.contact.schoolDistrictId,
    schoolId: draft.school?.id ?? null,
    interactionNotes: draft.interactionNotes || null,
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

function notAMatch() {
  const payload: UpdateContactPayload = {
    matchedZohoContactId: null,
    matchedZohoContactName: null,
    matchedZohoContactEmail: null,
    matchedZohoContactPhone: null,
    matchedZohoContactTitle: null,
    matchStatus: props.contact.matchedZohoAccountId ? 'new_contact_existing_account' : 'ambiguous',
    matchConfidence: null,
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

const sourceTone = computed(() => (props.contact.source === 'card_photo' ? 'purple' : 'slate'));

function sourceLabel(source: string) {
  switch (source) {
    case 'form':
      return 'Form';
    case 'card_photo':
      return 'Card';
    case 'qr_code':
      return 'QR Code';
    default:
      return capitalize(source);
  }
}

const matchStatusLabel = computed(() => {
  switch (props.contact.matchStatus) {
    case 'pending':
      return 'Account: Matching…';
    case 'existing_contact':
      return 'Account: Existing contact';
    case 'new_contact_existing_account':
      return 'Account: New contact, existing school';
    case 'new_account':
      return 'Account: New school/district';
    case 'ambiguous':
      return 'Account: Needs review';
    default:
      return `Account: ${capitalize(props.contact.matchStatus)}`;
  }
});

const matchStatusTone = computed(() => {
  switch (props.contact.matchStatus) {
    case 'existing_contact':
    case 'new_contact_existing_account':
      return 'green';
    case 'ambiguous':
      return 'orange';
    case 'new_account':
      return 'blue';
    default:
      return 'grey';
  }
});

function confidenceTone(level: string) {
  switch (level) {
    case 'high':
      return 'green';
    case 'medium':
      return 'orange';
    default:
      return 'red';
  }
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}
</script>

<style scoped>
/* Soft pastel badges (light fill + saturated text) read as a modern SaaS
   status tag, rather than Material's solid-fill/white-text chip default. */
.tag-chip {
  font-weight: 500;
}

.tone-purple {
  background: #EDE7F6;
  color: #5E35B1;
}

.tone-slate {
  background: #ECEFF1;
  color: #455A64;
}

.tone-green {
  background: #E6F4EA;
  color: #1E7E34;
}

.tone-orange {
  background: #FDEEE3;
  color: #B35A00;
}

.tone-red {
  background: #FBEAEA;
  color: #B23B3B;
}

.tone-blue {
  background: #E3F1FA;
  color: #0067AC;
}

.tone-grey {
  background: #EEF0F2;
  color: #5B6670;
}
</style>
