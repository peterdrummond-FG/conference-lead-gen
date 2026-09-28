<template>
  <!-- Folded up by default so a reviewer can see many contacts at once.
       ReviewPage positions every card (collapsed or expanded) with
       useMasonryGrid.ts, which measures each card's real offsetHeight —
       offsetHeight excludes margin, so this can't carry its own
       q-mb-md-style bottom margin without silently doubling up on top of
       the masonry gap. Spacing between cards comes entirely from that
       composable's `gap` option. The `expanded` model is just an
       open/closed flag driven by the parent (ReviewPage owns which single
       contact, if any, is expanded).

       The expanded layout responds to the CARD's width (a container query on
       .rc), not the viewport's: the masonry grid makes the same card ~700px
       wide on a desktop (spanning two columns) and ~340px on a phone, and a
       viewport media query can't tell those apart. Before this, the expanded
       card was a fixed flex row (checkbox | 220px photo | fields) — on a
       375px phone that left the fields column 45px wide (each input 27px)
       and the page scrolled sideways. -->
  <q-card bordered class="rc">
    <q-card-section v-if="!isExpanded" class="rc-collapsed cursor-pointer" @click="isExpanded = true">
      <div class="row items-start no-wrap q-gutter-sm">
        <q-checkbox v-model="selected" dense class="q-mt-xs" @click.stop />
        <div class="col overflow-hidden">
          <div class="row items-center no-wrap q-gutter-xs">
            <span class="col ellipsis text-subtitle2 text-weight-medium">{{ contact.firstName }} {{ contact.lastName }}</span>
            <q-chip v-if="contact.contactIntent" dense size="sm" :class="['tag-chip', intentTone(contact.contactIntent)]">
              {{ capitalize(contact.contactIntent) }}
            </q-chip>
          </div>
          <div class="text-caption text-grey-8 ellipsis">
            {{ contact.districtName || contact.schoolDistrictNameRaw || 'No district on file' }}<span v-if="contact.schoolName || contact.schoolNameRaw"> · {{ contact.schoolName || contact.schoolNameRaw }}</span>
          </div>
          <div class="text-caption ellipsis" :class="{ 'text-grey': !contact.email }">{{ contact.email || 'No email' }}</div>
          <div class="text-caption" :class="{ 'text-grey': !contact.phone }">{{ contact.phone || 'No phone' }}</div>
          <div class="row items-center no-wrap justify-between q-mt-xs">
            <q-chip dense size="sm" class="tag-chip q-ma-none" :class="`tone-${matchStatusTone}`">{{ matchStatusLabel }}</q-chip>
            <q-checkbox
              :model-value="contact.followedUp"
              dense
              size="sm"
              label="Followed up"
              class="text-caption"
              @click.stop
              @update:model-value="toggleFollowedUp"
            />
          </div>
        </div>
      </div>
    </q-card-section>

    <q-card-section v-else class="rc-expanded">
      <div class="rc-head">
        <q-checkbox v-model="selected" dense class="rc-head-check" aria-label="Select contact" />

        <div class="rc-head-id">
          <div class="rc-name">{{ contact.firstName }} {{ contact.lastName }}</div>
          <div class="rc-chips">
            <q-chip dense size="sm" :class="['tag-chip', `tone-${sourceTone}`]">
              {{ sourceLabel(contact.source) }}
              <q-tooltip>Import source — where this contact signed up</q-tooltip>
            </q-chip>

            <q-chip v-if="contact.qrChannel" dense size="sm" class="tag-chip tone-blue">
              {{ contact.qrChannel === 'booth' ? 'Booth' : 'Breakout session' }}
              <q-tooltip>Which QR code this lead scanned</q-tooltip>
            </q-chip>

            <q-chip v-if="contact.repName" dense size="sm" class="tag-chip tone-teal">
              {{ contact.repName }}
              <q-tooltip>Rep credited with this lead</q-tooltip>
            </q-chip>

            <q-chip dense size="sm" :class="['tag-chip', `tone-${matchStatusTone}`]">
              {{ matchStatusLabel }}
              <q-tooltip>Whether this school/district — and this contact — already exist in the CRM</q-tooltip>
            </q-chip>

            <q-chip v-if="isStuck" dense size="sm" class="tag-chip tone-red">Stuck — needs manual retry</q-chip>
          </div>
          <div class="rc-meta">{{ contact.eventName }}</div>
        </div>

        <div class="rc-intent" role="group" aria-label="Contact intent">
          <button
            v-for="opt in intentOptions"
            :key="opt.value"
            type="button"
            class="rc-intent-btn"
            :class="[`is-${opt.value}`, { 'is-on': contact.contactIntent === opt.value }]"
            :aria-pressed="contact.contactIntent === opt.value"
            @click="setContactIntent(contact.contactIntent === opt.value ? null : opt.value)"
          >
            {{ opt.label }}
          </button>
          <q-tooltip>Optional — how the conversation went. Auto-suggested from voice-memo notes unless set here. Tap the selected one again to clear it.</q-tooltip>
        </div>

        <q-btn class="rc-head-collapse" flat round dense icon="expand_less" aria-label="Collapse" @click="isExpanded = false">
          <q-tooltip>Collapse</q-tooltip>
        </q-btn>
      </div>

      <div v-if="contact.glanceSummary" class="ai-research-box">
        <q-icon name="travel_explore" size="18px" color="purple-8" class="q-mt-xs" />
        <div class="col">
          <span class="text-weight-medium text-purple-10">AI guess, unverified. </span>
          <span>{{ contact.glanceSummary }}</span>
        </div>
        <q-tooltip anchor="top middle" self="bottom middle">
          Generated from a web search during intake. Not checked against Zoho or any authoritative
          source (a directory listing, a card scan) — treat it as a hint to verify, not a fact.
        </q-tooltip>
      </div>

      <div v-if="contact.matchStatus === 'pending' && contact.matchAttempts >= 1" class="text-caption text-grey q-mt-xs">
        Match attempt {{ contact.matchAttempts }} of {{ maxAutoAttempts }}
        <q-btn dense flat no-caps size="sm" color="primary" label="Retry match" class="q-ml-sm" @click="$emit('retryMatch', contact.id)" />
      </div>

      <q-banner v-if="contact.localDuplicateOfContactName" dense rounded class="rc-banner bg-orange-1 text-orange-10">
        <div>
          <span class="text-weight-medium">Possible duplicate:</span>
          {{ contact.localDuplicateOfContactName }}<template v-if="contact.localDuplicateOfContactContext"> ({{ contact.localDuplicateOfContactContext }})</template>.
          <span v-if="contact.matchStatus === 'existing_contact'">Resolve it before confirming this match.</span>
          <q-tooltip>
            Could be the same person with conflicting info, or two different people who share a name —
            check research/match confidence on both before deciding.
          </q-tooltip>
        </div>
        <template #action>
          <q-btn dense flat no-caps size="sm" color="orange-10" label="Resolve duplicate" @click="showDuplicateDialog = true" />
        </template>
      </q-banner>

      <q-banner v-else-if="contact.matchStatus === 'existing_contact'" dense rounded class="rc-banner bg-green-1 text-green-10">
        <div class="text-weight-medium">
          Potential match: {{ contact.matchedZohoContactName }}<span v-if="contact.matchedZohoContactTitle"> — {{ contact.matchedZohoContactTitle }}</span>
        </div>
        <div class="text-caption">
          {{ contact.matchedZohoContactEmail || 'No email on file' }} · {{ contact.matchedZohoContactPhone || 'No phone on file' }}
        </div>
        <div class="text-caption">{{ contact.matchedZohoAccountName }}<template v-if="opportunityLine"> · {{ opportunityLine }}</template></div>
        <template #action>
          <q-btn dense flat no-caps size="sm" color="grey-8" label="Not a match" @click="notAMatch" />
          <q-btn dense unelevated no-caps size="sm" color="positive" label="Confirm match" @click="approveNow" />
        </template>
      </q-banner>

      <q-banner v-else-if="contact.matchStatus === 'new_contact_existing_account' && contact.matchedZohoAccountName" dense rounded class="rc-banner bg-blue-1 text-blue-10">
        <div class="text-weight-medium">
          Matched account: {{ contact.matchedZohoAccountName }}<span v-if="contact.matchedZohoAccountLevel"> · {{ capitalize(contact.matchedZohoAccountLevel) }}</span>
        </div>
        <div v-if="opportunityLine" class="text-caption">{{ opportunityLine }}</div>
        <div class="text-caption">No existing contact found here — {{ contact.firstName }} {{ contact.lastName }} would be added as new.</div>
      </q-banner>

      <DuplicateResolutionDialog
        v-model="showDuplicateDialog"
        :contact-id="contact.id"
        @resolved="$emit('duplicatesResolved')"
      />

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

      <div class="rc-body">
        <div v-if="isPhotoSourced" class="rc-photo">
          <q-img
            v-if="contact.hasPhoto && !thumbnailPhotoError"
            :src="thumbnailPhotoUrl ?? undefined"
            fit="contain"
            class="rc-thumb"
            role="button"
            aria-label="Enlarge original photo"
            @click="showFullImage = true"
          >
            <template #loading>
              <div class="absolute-full flex flex-center">
                <q-spinner color="primary" size="24px" />
              </div>
            </template>
            <template #error>
              <div class="absolute-full flex flex-center text-caption text-grey">Failed to load</div>
            </template>
          </q-img>
          <div v-else class="rc-thumb rc-thumb-empty">
            {{ contact.hasPhoto ? 'Photo failed to load' : 'No photo on file' }}
          </div>
          <div class="rc-photo-cap">
            <div class="text-caption text-grey-8">
              {{ contact.source === 'directory_photo' ? 'Original directory page' : 'Original card' }}
            </div>
            <a v-if="contact.hasCroppedPhoto" href="#" class="text-caption" @click.prevent="showFullSheet = true">View full sheet</a>
          </div>
        </div>

        <div class="rc-form">
          <q-input v-model="draft.firstName" dense outlined class="rc-s3" label="First name" />
          <q-input v-model="draft.lastName" dense outlined class="rc-s3" label="Last name" />
          <q-input v-model="draft.email" dense outlined type="email" class="rc-s4" label="Email" />
          <q-input v-model="draft.phone" dense outlined type="tel" class="rc-s2" label="Phone" />
          <q-input v-model="draft.title" dense outlined class="rc-s6" label="Title" />

          <q-select
            v-model="draft.state"
            :options="stateOptions"
            option-label="name"
            dense
            outlined
            use-input
            fill-input
            hide-selected
            input-debounce="0"
            class="rc-s2"
            label="State"
            @filter="filterStates"
          />
          <q-select
            v-model="draft.district"
            :options="districtTypeahead.options.value"
            option-label="name"
            dense
            outlined
            use-input
            fill-input
            hide-selected
            input-debounce="300"
            new-value-mode="add-unique"
            class="rc-s4"
            label="District"
            :disable="!draft.state"
            @filter="districtTypeahead.filterFn"
            @new-value="onNewDistrict"
            @input-value="(val) => (districtInputText = val)"
            @blur="onDistrictBlur"
          />
          <q-select
            v-model="draft.school"
            :options="schoolTypeahead.options.value"
            option-label="name"
            dense
            outlined
            use-input
            fill-input
            hide-selected
            input-debounce="300"
            new-value-mode="add-unique"
            class="rc-s6"
            label="School / campus"
            :disable="!draft.district"
            @filter="schoolTypeahead.filterFn"
            @new-value="onNewSchool"
            @input-value="(val) => (schoolInputText = val)"
            @blur="onSchoolBlur"
          />
          <div v-if="isPhotoSourced" class="rc-s6 text-caption text-grey rc-suggest">
            State and district are suggested from the conference — confirm or change.
          </div>

          <q-input
            v-model="draft.interactionNotes"
            dense
            outlined
            type="textarea"
            class="rc-s6 rc-notes"
            label="Interaction notes (from voice memos)"
            input-style="height: 84px; min-height: 64px; max-height: 220px"
          />

          <div v-if="contact.matchStatus === 'ambiguous' && contact.candidateMatches?.length" class="rc-s6">
            <div class="text-caption text-weight-medium q-mb-xs">Candidate matches — pick one:</div>
            <q-list bordered dense>
              <q-item v-for="c in contact.candidateMatches" :key="c.zohoId" clickable @click="resolveCandidate(c)">
                <q-item-section>
                  <q-item-label>{{ c.name }}</q-item-label>
                  <q-item-label caption>{{ c.type }}<span v-if="c.level"> ({{ c.level }})</span> · score {{ c.score.toFixed(2) }}</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </div>

          <div v-if="contact.matchStatus === 'new_account'" class="rc-s6 rc-link-account">
            <q-input v-model="newAccountId" dense outlined label="Zoho Account Id (once created)" />
            <q-input v-model="newAccountName" dense outlined label="Account name" />
            <q-btn dense flat no-caps color="primary" label="Link" :disable="!newAccountId || !newAccountName" @click="linkNewAccount" />
          </div>

          <div v-if="contact.notes" class="rc-s6 text-caption">
            <a href="#" @click.prevent="showNotes = !showNotes">{{ showNotes ? 'Hide match reasoning' : 'Show match reasoning' }}</a>
            <div v-if="showNotes" class="q-mt-xs text-grey-8">{{ contact.notes }}</div>
          </div>
        </div>
      </div>

      <div class="rc-foot">
        <q-checkbox
          :model-value="contact.followedUp"
          dense
          label="Followed up"
          class="rc-foot-follow"
          @update:model-value="toggleFollowedUp"
        >
          <q-tooltip>Carries through to the CSV export as its own "Follow Up Done" column.</q-tooltip>
        </q-checkbox>
        <q-btn v-if="isDirty" outline no-caps color="primary" label="Save changes" @click="save" />
        <q-btn flat no-caps color="negative" label="Reject" @click="$emit('reject', contact.id)" />
        <q-btn
          unelevated
          no-caps
          color="positive"
          label="Approve"
          class="rc-approve"
          :disable="contact.matchStatus === 'pending'"
          @click="onApproveClick"
        >
          <q-tooltip v-if="contact.matchStatus === 'pending'">Waiting for the account match to finish.</q-tooltip>
          <q-tooltip v-else-if="contact.matchStatus === 'ambiguous'">
            No confirmed Zoho match — approving exports this as a new lead, same as "new_account". Pick a candidate above first if one looks right.
          </q-tooltip>
        </q-btn>
      </div>
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import { reactive, computed, ref, watch } from 'vue';
import { Dialog, Notify } from 'quasar';
import { api } from '@/boot/axios';
import { useTypeahead, resolveTypedOption, type TypeaheadOption } from '@/composables/useTypeahead';
import { US_STATES, filterStateOptions, type UsStateOption } from '@/constants/usStates';
import { stateOptionFor, districtOptionFor, schoolOptionFor } from '@/utils/contactOptions';
import { useContactPhoto } from '@/composables/useContactPhoto';
import DuplicateResolutionDialog from '@/components/DuplicateResolutionDialog.vue';
import type { CandidateMatch, ContactListItem, UpdateContactPayload } from '@/types/review';

const props = defineProps<{ contact: ContactListItem }>();
const emit = defineEmits<{
  approve: [id: string, pendingEdits?: UpdateContactPayload];
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
// Controlled by ReviewPage (which decides which single contact, if any, is
// the one rendered outside the grid) rather than owned locally — see the
// comment at the top of the template.
const isExpanded = defineModel<boolean>('expanded', { default: false });
const showFullImage = ref(false);
const showFullSheet = ref(false);
const showDuplicateDialog = ref(false);
const showNotes = ref(false);

const { url: thumbnailPhotoUrl, error: thumbnailPhotoError } = useContactPhoto(() => props.contact.id, { enabled: () => props.contact.hasPhoto });
const { url: fullPhotoUrl, error: fullPhotoError } = useContactPhoto(() => props.contact.id, { full: () => true, enabled: () => showFullSheet.value });

// Approve isn't hard-disabled by an unresolved duplicate — a reviewer who's
// already checked the two records may know more than the system does — but
// it does interrupt with an explicit choice rather than silently letting the
// click through past the banner's own "resolve this first" warning above.
function onApproveClick() {
  if (props.contact.localDuplicateOfContactName) {
    Dialog.create({
      title: 'Unresolved duplicate',
      message: `Another contact named ${props.contact.localDuplicateOfContactName} looks like a possible match. Resolve it above, or approve anyway if you've already checked.`,
      cancel: { label: 'Resolve the duplicate above', flat: true },
      ok: { label: 'Approve anyway', color: 'positive' },
    }).onOk(() => approveNow());
    return;
  }
  approveNow();
}

// Approve used to send only { reviewStatus: 'approved' }, so a reviewer who
// fixed a typo and clicked Approve without first clicking Save exported the
// OLD value — the edit was dropped without a word. The pending edits now ride
// along on the same request (see ReviewPage.approve), which is one PATCH
// rather than a save-then-approve pair that could land out of order.
function approveNow() {
  emit('approve', props.contact.id, isDirty.value ? draftPayload() : undefined);
}

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
watch(() => draft.state, (_newState, oldState) => {
  if (oldState) draft.district = null;
});
watch(() => draft.district, (_newDistrict, oldDistrict) => {
  if (oldDistrict) draft.school = null;
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

// Backstop for onNewDistrict/onNewSchool: those only fire on Enter/Tab
// (Quasar's own new-value gate), so a reviewer who types a name and clicks
// straight to Save without pressing Enter would otherwise have it silently
// dropped — see resolveTypedOption's own comment for the QSelect source
// this was verified against.
const districtInputText = ref('');
const schoolInputText = ref('');

function onDistrictBlur() {
  draft.district = resolveTypedOption(districtInputText.value, draft.district, districtTypeahead.options.value);
}

function onSchoolBlur() {
  draft.school = resolveTypedOption(schoolInputText.value, draft.school, schoolTypeahead.options.value);
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

function draftPayload(): UpdateContactPayload {
  return {
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
  };
}

function save() {
  emit('update', props.contact.id, draftPayload());
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
          matchedZohoAccountLevel: candidate.level ?? null,
          matchStatus: 'new_contact_existing_account',
          matchConfidence: 'high',
        };
  emit('update', props.contact.id, payload);
}

const intentOptions: { value: 'hot' | 'warm' | 'cold'; label: string; color: string }[] = [
  { value: 'hot', label: 'Hot', color: 'red' },
  { value: 'warm', label: 'Warm', color: 'orange' },
  { value: 'cold', label: 'Cold', color: 'blue-8' },
];

function setContactIntent(value: 'hot' | 'warm' | 'cold' | null) {
  emit('update', props.contact.id, { contactIntent: value });
}

function toggleFollowedUp(value: boolean) {
  emit('update', props.contact.id, { followedUp: value });
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
  Notify.create({
    type: 'info',
    message: payload.matchStatus === 'ambiguous'
      ? 'Match cleared — this contact now needs review.'
      : 'Match cleared — kept the matched account, no specific contact.',
  });
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

// A directory-page photo (see process-cards SKILL.md Step 1) still has a
// stored/cropped image behind it the same way a card photo does — the two
// only differ in what the photo was *of* — so anywhere the review card shows
// or hints at the original photo, both sources apply.
const isPhotoSourced = computed(
  () => props.contact.source === 'card_photo' || props.contact.source === 'directory_photo',
);

const sourceTone = computed(() => {
  switch (props.contact.source) {
    case 'card_photo':
      return 'purple';
    case 'directory_photo':
      return 'purple';
    case 'note':
      return 'blue';
    case 'voice_memo':
      return 'blue';
    default:
      return 'slate';
  }
});

function sourceLabel(source: string) {
  switch (source) {
    case 'form':
      return 'Form';
    case 'card_photo':
      return 'Card';
    case 'directory_photo':
      return 'Directory';
    case 'note':
      return 'Note';
    case 'voice_memo':
      return 'Voice memo';
    case 'qr_code':
      return 'QR Code';
    default:
      return capitalize(source);
  }
}

const matchStatusLabel = computed(() => {
  // Only 'new_account' has no matched Zoho record to check — for that case
  // alone, the contact's own claimed school/district is the best available
  // signal. Every other status has a real matched account, so its actual
  // level (not a guess from the contact's own fields) drives the wording.
  const hasSchoolMatch = Boolean(props.contact.schoolName || props.contact.schoolNameRaw);
  switch (props.contact.matchStatus) {
    case 'pending':
      return 'Account: Matching…';
    case 'existing_contact':
      return 'Account: Existing contact';
    case 'new_contact_existing_account':
      // matchedZohoAccountLevel is null on rows matched before this field
      // existed — fall back to the old (less reliable) heuristic for those.
      return (props.contact.matchedZohoAccountLevel ?? (hasSchoolMatch ? 'school' : 'district')) === 'school'
        ? 'Account: New contact, existing school'
        : 'Account: New contact, existing district';
    case 'new_account':
      return hasSchoolMatch ? 'Account: New school' : 'Account: New district';
    case 'ambiguous':
      return 'Account: Needs review';
    default:
      return `Account: ${capitalize(props.contact.matchStatus)}`;
  }
});

// hasActiveOpportunity is only ever meaningful once an account is matched
// (see match-contact's own null-together rule) — a null value at that point
// means the check was skipped, not that there's confidently no opportunity,
// so it gets its own wording rather than silently looking the same as "no".
const opportunityLine = computed(() => {
  if (!props.contact.matchedZohoAccountId) return null;
  if (props.contact.hasActiveOpportunity === true) {
    return `Active opportunity — ${props.contact.activeOpportunityName || 'unnamed'}`;
  }
  if (props.contact.hasActiveOpportunity === false) return 'No active opportunity';
  return 'Opportunity status not yet checked';
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

function intentTone(intent: 'hot' | 'warm' | 'cold' | null) {
  switch (intent) {
    case 'hot':
      return 'tone-red';
    case 'warm':
      return 'tone-orange';
    case 'cold':
      return 'tone-blue';
    default:
      return 'tone-grey';
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

.tone-teal {
  background: #E0F2F1;
  color: #00695C;
}

.tone-grey {
  background: #EEF0F2;
  color: #5B6670;
}

/* Deliberately distinct from every fact on the card (title input, matched-CRM
   banners, chips) — an AI-derived guess must never look like confirmed data.
   Jordan (2026-09) flagged that a hedged sentence like "likely director of
   schools" rendered as plain body text reads as the system being unsure of
   something a reliable source already settled. Boxing it, labeling it, and
   giving it its own (purple, matching the card/directory source chips) color
   makes "this is AI research, not verified" visible without reading the
   words. */
.ai-research-box {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 10px;
  background: #F7F3FC;
  border: 1px solid #E0D0F5;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 13px;
  line-height: 1.45;
}

/* ── Expanded card layout ────────────────────────────────────────────────
   Sized by the card's own width (see the note atop the template). Wide (the
   card spans two masonry columns on a desktop): identity + intent on one
   row, photo in a left column, fields in a 6-track grid. Narrow (a phone, or
   any single-column grid): everything stacks, the photo shrinks to a strip,
   and the action bar pins to the bottom of the screen. */
.rc {
  container: rc / inline-size;
}

.rc-expanded {
  padding: 14px 16px;
}

.rc-head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  grid-template-areas: 'check id intent collapse';
  align-items: start;
  gap: 4px 10px;
}
.rc-head-check { grid-area: check; margin-top: 2px; }
.rc-head-id { grid-area: id; min-width: 0; }
.rc-intent { grid-area: intent; }
.rc-head-collapse { grid-area: collapse; margin: -2px -6px 0 0; }

.rc-name {
  font-size: 17px;
  font-weight: 500;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.rc-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.rc-chips :deep(.q-chip) {
  margin: 0;
}
.rc-meta {
  margin-top: 4px;
  font-size: 12px;
  color: #5B6670;
}

/* Segmented Hot / Warm / Cold. Clicking the selected one clears it, which
   replaces the separate "Clear" button. Each unselected segment stays
   neutral so the row doesn't read as three coloured buttons at rest. */
.rc-intent {
  display: inline-flex;
  border: 1px solid rgba(0, 0, 0, 0.24);
  border-radius: 8px;
  overflow: hidden;
}
.rc-intent-btn {
  border: 0;
  background: transparent;
  color: #5B6670;
  font: inherit;
  font-size: 13px;
  padding: 0 12px;
  height: 30px;
  cursor: pointer;
}
.rc-intent-btn + .rc-intent-btn {
  border-left: 1px solid rgba(0, 0, 0, 0.12);
}
.rc-intent-btn:focus-visible {
  outline: 2px solid #0067AC;
  outline-offset: -2px;
}
.rc-intent-btn.is-on.is-hot { background: #FBEAEA; color: #B23B3B; font-weight: 500; }
.rc-intent-btn.is-on.is-warm { background: #FDEEE3; color: #B35A00; font-weight: 500; }
.rc-intent-btn.is-on.is-cold { background: #E3F1FA; color: #0067AC; font-weight: 500; }

.rc-banner {
  margin-top: 10px;
}

.rc-body {
  display: grid;
  grid-template-columns: 148px minmax(0, 1fr);
  gap: 16px;
  margin-top: 12px;
}
.rc-body:not(:has(.rc-photo)) {
  grid-template-columns: minmax(0, 1fr);
}

.rc-photo {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rc-thumb {
  width: 148px;
  height: 168px;
  border-radius: 8px;
  background: #F1F3F5;
  cursor: zoom-in;
}
.rc-thumb-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 12px;
  color: #5B6670;
  cursor: default;
}

.rc-form {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
  align-content: start;
}
.rc-s2 { grid-column: span 2; }
.rc-s3 { grid-column: span 3; }
.rc-s4 { grid-column: span 4; }
.rc-s6 { grid-column: span 6; }
.rc-suggest { margin-top: -6px; }
.rc-link-account {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 8px;
  align-items: center;
}

.rc-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
}
.rc-foot-follow {
  margin-right: auto;
}
.rc-approve {
  min-width: 96px;
}

@container rc (max-width: 560px) {
  .rc-expanded { padding: 12px; }

  .rc-head {
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas:
      'check id collapse'
      '. intent intent';
  }
  .rc-intent {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    margin-top: 6px;
  }
  .rc-intent-btn { height: 44px; font-size: 14px; }

  .rc-body { grid-template-columns: minmax(0, 1fr); gap: 12px; }

  /* The photo becomes a one-line strip: enough to tap open, and the fields
     keep the full card width. */
  .rc-photo {
    flex-direction: row;
    align-items: center;
    gap: 12px;
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: 8px;
    padding: 8px;
  }
  .rc-thumb { width: 64px; height: 64px; flex: none; }
  .rc-photo-cap a { display: inline-block; padding: 6px 0; }

  /* Email, phone, state and district each take a full row: at 2-4 tracks of a
     ~317px form, State was ~98px and clipped "Tennessee" to "Tennes". */
  .rc-s2, .rc-s4 { grid-column: span 6; }
  .rc-form :deep(.q-field--dense .q-field__control),
  .rc-form :deep(.q-field--dense .q-field__marginal) { height: 44px; }

  .rc-link-account { grid-template-columns: 1fr; }

  /* Pinned so Approve / Reject are always one thumb-reach away on a card
     that is ~900px tall on a phone. Bleeds to the card edges to cover the
     fields scrolling underneath. */
  .rc-foot {
    position: sticky;
    bottom: 0;
    z-index: 1;
    margin: 14px -12px -12px;
    padding: 10px 12px 12px;
    background: #fff;
    border-radius: 0 0 14px 14px;
    box-shadow: 0 -4px 8px -6px rgba(0, 0, 0, 0.18);
  }
  .rc-foot-follow { flex: 1 0 100%; margin-right: 0; }
  .rc-foot :deep(.q-btn) { min-height: 44px; }
  .rc-approve { flex: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .rc-intent-btn { transition: none; }
}
</style>
