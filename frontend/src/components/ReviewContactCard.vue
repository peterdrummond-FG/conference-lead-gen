<template>
  <q-card bordered class="q-mb-md">
    <q-card-section class="row items-start q-gutter-sm">
      <q-checkbox v-model="selected" dense class="q-mt-xs" />

      <div v-if="contact.source === 'card_photo'" class="q-mr-sm" style="width: 220px">
        <div class="text-caption text-grey q-mb-xs">Original card</div>
        <q-img
          v-if="contact.hasPhoto && !thumbnailPhotoError"
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
          v-else-if="contact.hasPhoto && thumbnailPhotoError"
          class="rounded-borders bg-grey-2 flex flex-center text-caption text-grey"
          style="width: 220px; height: 220px"
        >
          Photo failed to load
        </div>
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
          v-if="!thumbnailPhotoError"
          :src="thumbnailPhotoUrl ?? undefined"
          fit="contain"
          style="max-width: 90vw; max-height: 90vh"
        />
        <q-card v-else class="q-pa-md text-grey">Photo failed to load</q-card>
      </q-dialog>

      <q-dialog v-model="showFullSheet">
        <q-img
          v-if="!fullPhotoError"
          :src="fullPhotoUrl ?? undefined"
          fit="contain"
          style="max-width: 90vw; max-height: 90vh"
        />
        <q-card v-else class="q-pa-md text-grey">Photo failed to load</q-card>
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
          {{ contact.eventName }} · {{ contact.districtName || contact.schoolDistrictNameRaw || 'No district on file' }}<span v-if="contact.schoolName || contact.schoolNameRaw"> · {{ contact.schoolName || contact.schoolNameRaw }}</span>
        </div>
        <div v-if="contact.matchStatus === 'pending' && contact.matchAttempts >= 1" class="text-caption text-grey">
          Match attempt {{ contact.matchAttempts }} of {{ maxAutoAttempts }}
          <q-btn dense flat size="sm" color="primary" label="Retry match" class="q-ml-sm" @click="$emit('retryMatch', contact.id)" />
        </div>

        <q-banner v-if="contact.localDuplicateOfContactName" dense class="bg-orange-1 text-orange-10 q-mt-sm">
          <div class="row items-center q-gutter-sm">
            <span>
              Possible duplicate — another contact named {{ contact.localDuplicateOfContactName }} already exists<template v-if="contact.localDuplicateOfContactContext"> ({{ contact.localDuplicateOfContactContext }})</template>.
              Could be the same person with conflicting info, or two different people who share a name — check research/match confidence on both before deciding.
            </span>
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
            v-model="draft.state"
            :options="stateOptions"
            option-label="name"
            use-input
            fill-input
            hide-selected
            input-debounce="0"
            class="col-6 col-sm-3"
            label="State (optional)"
            :hint="contact.source === 'card_photo' ? 'Suggested from district/conference — confirm or change' : undefined"
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
import { US_STATES, filterStateOptions, type UsStateOption } from '@/constants/usStates';
import { stateOptionFor, districtOptionFor, schoolOptionFor } from '@/utils/contactOptions';
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

const { url: thumbnailPhotoUrl, error: thumbnailPhotoError } = useContactPhoto(() => props.contact.id, { enabled: () => props.contact.hasPhoto });
const { url: fullPhotoUrl, error: fullPhotoError } = useContactPhoto(() => props.contact.id, { full: () => true, enabled: () => showFullSheet.value });

const stateOptions = ref<UsStateOption[]>(US_STATES);

const draft = reactive({
  firstName: props.contact.firstName,
  lastName: props.contact.lastName,
  email: props.contact.email ?? '',
  phone: props.contact.phone ?? '',
  title: props.contact.title ?? '',
  state: stateOptionFor(props.contact.state),
  district: districtOptionFor(props.contact),
  school: schoolOptionFor(props.contact),
  interactionNotes: props.contact.interactionNotes ?? '',
});

// State gates district, district gates school — changing an upstream field
// invalidates whatever was picked downstream of it.
watch(() => draft.state, () => {
  draft.district = null;
});
watch(() => draft.district, () => {
  draft.school = null;
});

const newAccountId = ref('');
const newAccountName = ref('');

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

// A typed value with no match in the list is kept as plain text on save
// (schoolDistrictNameRaw/schoolNameRaw) rather than becoming a new
// school_districts/schools row — see contacts-patch.
function onNewDistrict(val: string, done: (item?: TypeaheadOption, mode?: 'add-unique') => void) {
  done({ id: null, name: val }, 'add-unique');
}

function onNewSchool(val: string, done: (item?: TypeaheadOption, mode?: 'add-unique') => void) {
  done({ id: null, name: val }, 'add-unique');
}

const isDirty = computed(() => {
  const currentDistrict = districtOptionFor(props.contact);
  const currentSchool = schoolOptionFor(props.contact);
  return (
    draft.firstName !== props.contact.firstName ||
    draft.lastName !== props.contact.lastName ||
    draft.email !== (props.contact.email ?? '') ||
    draft.phone !== (props.contact.phone ?? '') ||
    draft.title !== (props.contact.title ?? '') ||
    (draft.state?.name ?? null) !== props.contact.state ||
    (draft.district?.id ?? null) !== (currentDistrict?.id ?? null) ||
    (draft.district?.name ?? null) !== (currentDistrict?.name ?? null) ||
    (draft.school?.id ?? null) !== (currentSchool?.id ?? null) ||
    (draft.school?.name ?? null) !== (currentSchool?.name ?? null) ||
    draft.interactionNotes !== (props.contact.interactionNotes ?? '')
  );
});

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
  draft.state = stateOptionFor(newContact.state);
  draft.district = districtOptionFor(newContact);
  draft.school = schoolOptionFor(newContact);
  draft.interactionNotes = newContact.interactionNotes ?? '';
});

function save() {
  emit('update', props.contact.id, {
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
  const hasSchoolMatch = Boolean(props.contact.schoolName || props.contact.schoolNameRaw);
  switch (props.contact.matchStatus) {
    case 'pending':
      return 'Account: Matching…';
    case 'existing_contact':
      return 'Account: Existing contact';
    case 'new_contact_existing_account':
      return hasSchoolMatch ? 'Account: New contact, existing school' : 'Account: New contact, existing district';
    case 'new_account':
      return hasSchoolMatch ? 'Account: New school' : 'Account: New district';
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
