<template>
  <!-- One editor, two homes: the right-hand pane on a desktop and a bottom
       sheet on a phone (ReviewSmart decides). It fills whatever height its
       parent gives it — header and footer stay put, only the middle scrolls —
       so Approve / Reject are always on screen however long the form is (the
       Classic card is ~900px tall on a phone and needed a sticky-footer patch
       to get there).

       Sized by its own width via a container query, not the viewport's, for
       the same reason the Classic card is: the pane is ~700px wide on a
       desktop and the sheet ~375px on a phone. -->
  <div class="le">
    <div class="le-head">
      <div class="le-head-top">
        <div class="le-head-id">
          <div class="le-name">{{ name }}</div>
          <div class="le-chips">
            <LeadChip tone="grey">{{ sourceLabel(contact.source) }}</LeadChip>
            <LeadChip v-if="contact.qrChannel" tone="blue">{{ contact.qrChannel === 'booth' ? 'Booth' : 'Breakout session' }}</LeadChip>
            <LeadChip v-if="!isSales" tone="grey">{{ contact.eventName }}</LeadChip>
            <LeadChip v-if="!isSales && contact.repName" tone="grey">{{ contact.repName }}</LeadChip>
            <!-- Reps get plain "New district / Existing school"; admin and
                 Solutions Success keep the wording they know from Classic. -->
            <LeadChip v-if="contact.reviewStatus === 'needs_review' && ready" tone="green"><q-icon name="check" size="14px" />{{ READY_LABEL }}</LeadChip>
            <LeadChip v-if="!isSales" :tone="badge?.tone ?? 'grey'">{{ accountDetailLabel(contact) }}</LeadChip>
            <LeadChip v-else-if="badge" :tone="badge.tone">{{ badge.label }}</LeadChip>
          </div>
        </div>
        <div class="le-nav">
          <span v-if="position" class="le-pos">{{ position.index }} of {{ position.total }}</span>
          <q-btn v-if="position" flat round dense icon="expand_less" aria-label="Previous lead" :disable="position.index <= 1" @click="$emit('prev')" />
          <q-btn v-if="position" flat round dense icon="expand_more" aria-label="Next lead" :disable="position.index >= position.total" @click="$emit('next')" />
          <q-btn v-if="closable" flat round dense icon="close" aria-label="Close" @click="$emit('close')" />
        </div>
      </div>

    </div>

    <div class="le-scroll">
      <div class="le-intent" role="group" aria-label="How the conversation went">
        <span class="le-intent-label">Heat</span>
        <div class="le-intent-seg">
          <button
            v-for="opt in intentOptions"
            :key="opt.value"
            type="button"
            class="le-intent-btn"
            :class="[`is-${opt.value}`, { 'is-on': contact.contactIntent === opt.value }]"
            :aria-pressed="contact.contactIntent === opt.value"
            @click="setIntent(contact.contactIntent === opt.value ? null : opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>
        <!-- Beside Heat, not down in the footer: a rep who was quick on the
             follow-up marks it here with the other "how did it go" answers.
             Saves as you tap, like Heat. -->
        <q-checkbox
          v-if="contact.reviewStatus !== 'rejected'"
          :model-value="contact.followedUp"
          label="Followed up"
          class="le-follow"
          @update:model-value="toggleFollowedUp"
        />
      </div>
      <!-- What "ready to approve" means, line by line. Phone/email and school are
           always listed, ticked or crossed with the fix on that line; the Zoho and
           duplicate lines appear only when they are the problem (or, for Zoho,
           still processing). Replaces the old list of problems, which only ever
           named what was wrong and left the rep to guess what right looked like.
           Same rules as the chip and the button (readinessChecklist). -->
      <ul v-if="contact.reviewStatus === 'needs_review'" class="le-check" aria-label="What this lead needs before it can be approved">
        <li v-for="item in shownChecklist" :key="item.key" class="le-check-item" :class="`is-${item.state}`">
          <q-icon :name="checkIcon(item.state)" size="18px" class="le-check-icon" />
          <span class="le-check-text">
            <span class="le-check-label">{{ item.label }}</span>
            <span v-if="item.fix" class="le-check-fix">{{ item.fix }}</span>
          </span>
          <q-btn v-if="item.key === 'match' && item.state === 'todo'" dense flat no-caps color="primary" label="Retry match" class="le-issue-act" @click="$emit('retryMatch', contact.id)" />
          <q-btn v-if="item.key === 'duplicate' && item.state === 'todo'" dense flat no-caps color="orange-10" label="Resolve" class="le-issue-act" @click="showDuplicateDialog = true" />
        </li>
      </ul>

      <div v-if="contact.glanceSummary" class="ai-research-box">
        <q-icon name="travel_explore" size="18px" color="purple-8" class="q-mt-xs" />
        <div class="col">
          <span class="text-weight-medium text-purple-10">AI guess, unverified. </span>
          <span>{{ contact.glanceSummary }}</span>
          <span class="le-ai-note"> From a web search during intake, not checked against Zoho.</span>
        </div>
      </div>

      <q-banner v-if="contact.matchStatus === 'existing_contact'" dense rounded class="le-banner bg-green-1 text-green-10">
        <div class="text-weight-medium">
          Already in Zoho: {{ contact.matchedZohoContactName }}<span v-if="contact.matchedZohoContactTitle"> — {{ contact.matchedZohoContactTitle }}</span>
        </div>
        <div class="text-caption">
          {{ contact.matchedZohoContactEmail || 'No email on file' }} · {{ contact.matchedZohoContactPhone || 'No phone on file' }}
        </div>
        <div class="text-caption">{{ contact.matchedZohoAccountName }}<template v-if="!isSales && opportunityLine"> · {{ opportunityLine }}</template></div>
        <template v-if="contact.reviewStatus === 'needs_review'" #action>
          <q-btn dense flat no-caps color="grey-8" label="Not a match" @click="notAMatch" />
          <q-btn dense unelevated no-caps color="positive" label="Confirm match" :loading="busy" @click="approveClick" />
        </template>
      </q-banner>

      <q-banner v-else-if="contact.matchStatus === 'new_contact_existing_account' && contact.matchedZohoAccountName" dense rounded class="le-banner bg-blue-1 text-blue-10">
        <div class="text-weight-medium">
          {{ isSales ? (badge?.label ?? 'Existing account') + ': ' : 'Matched account: ' }}{{ contact.matchedZohoAccountName }}<span v-if="!isSales && contact.matchedZohoAccountLevel"> · {{ capitalize(contact.matchedZohoAccountLevel) }}</span>
        </div>
        <div v-if="!isSales && opportunityLine" class="text-caption">{{ opportunityLine }}</div>
        <div class="text-caption">{{ contact.firstName }} {{ contact.lastName }} isn't in Zoho yet, so they'd be added as a new contact.</div>
      </q-banner>

      <div v-else-if="contact.matchStatus === 'ambiguous'" class="le-banner">
        <template v-if="contact.candidateMatches?.length">
          <div class="text-caption text-weight-medium q-mb-xs">Pick the closest match</div>
          <q-list bordered dense class="rounded-borders bg-white">
            <q-item v-for="c in contact.candidateMatches" :key="c.zohoId" clickable class="le-cand" @click="resolveCandidate(c)">
              <q-item-section>
                <q-item-label>{{ c.name }}</q-item-label>
                <q-item-label caption>
                  {{ c.type === 'contact' ? 'Contact' : 'Account' }}<span v-if="c.level"> ({{ c.level }})</span><span v-if="!isSales"> · score {{ c.score.toFixed(2) }}</span>
                </q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </template>
        <div v-else class="text-caption text-grey-8">No close match found. Approving sends this as a new lead.</div>
      </div>

      <DuplicateResolutionDialog v-model="showDuplicateDialog" :contact-id="contact.id" @resolved="$emit('duplicatesResolved')" />

      <q-dialog v-model="showFullImage">
        <q-img v-if="!thumbnailPhotoError" :src="thumbnailPhotoUrl ?? undefined" fit="contain" style="max-width: 90vw; max-height: 90vh" />
        <q-card v-else class="q-pa-md text-grey">Photo failed to load</q-card>
      </q-dialog>
      <q-dialog v-model="showFullSheet">
        <q-img v-if="!fullPhotoError" :src="fullPhotoUrl ?? undefined" fit="contain" style="max-width: 90vw; max-height: 90vh" />
        <q-card v-else class="q-pa-md text-grey">Photo failed to load</q-card>
      </q-dialog>

      <div class="le-body">
        <div v-if="isPhotoSourced" class="le-photo">
          <q-img
            v-if="contact.hasPhoto && !thumbnailPhotoError"
            :src="thumbnailPhotoUrl ?? undefined"
            fit="contain"
            class="le-thumb"
            role="button"
            aria-label="Enlarge original photo"
            @click="showFullImage = true"
          >
            <template #loading>
              <div class="absolute-full flex flex-center"><q-spinner color="primary" size="24px" /></div>
            </template>
            <template #error>
              <div class="absolute-full flex flex-center text-caption text-grey">Failed to load</div>
            </template>
          </q-img>
          <div v-else class="le-thumb le-thumb-empty">{{ contact.hasPhoto ? 'Photo failed to load' : 'No photo on file' }}</div>
          <div class="le-photo-cap">
            <div class="text-caption text-grey-8">{{ contact.source === 'directory_photo' ? 'Original directory page' : 'Original card' }}</div>
            <a v-if="contact.hasCroppedPhoto" href="#" class="text-caption" @click.prevent="showFullSheet = true">View full sheet</a>
          </div>
        </div>

        <div class="le-form">
          <q-input v-model="draft.firstName" dense outlined class="le-s3" label="First name" />
          <q-input v-model="draft.lastName" dense outlined class="le-s3" label="Last name" />
          <q-input v-model="draft.email" dense outlined type="email" class="le-s4" label="Email" />
          <q-input v-model="draft.phone" dense outlined type="tel" class="le-s2" label="Phone" />
          <q-input v-model="draft.title" dense outlined class="le-s6" label="Title" />

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
            class="le-s2"
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
            class="le-s4"
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
            class="le-s6"
            label="School / campus"
            :disable="!draft.district"
            @filter="schoolTypeahead.filterFn"
            @new-value="onNewSchool"
            @input-value="(val) => (schoolInputText = val)"
            @blur="onSchoolBlur"
          />
          <div v-if="isPhotoSourced" class="le-s6 text-caption text-grey le-suggest">
            State and district are suggested from the conference. Confirm or change.
          </div>

          <q-input
            v-model="draft.interactionNotes"
            dense
            outlined
            type="textarea"
            class="le-s6 le-notes"
            label="Notes"
            stack-label
            placeholder="Add a note about your conversation…"
            input-style="height: 84px; min-height: 64px; max-height: 220px"
          >
            <template #append>
              <q-icon name="info_outline" size="18px" color="grey-7" tabindex="0" aria-label="About notes">
                <q-tooltip anchor="top middle" self="bottom middle" max-width="260px">Everything in Notes, including voice memos, is included in the Zoho import so Sales can see it.</q-tooltip>
              </q-icon>
            </template>
          </q-input>
          <!-- Not the field's own hint: Quasar positions that absolutely under a
               fixed 20px, so a hint that wraps to two lines on a phone printed over
               whatever came next. In the flow, it pushes the next row down instead. -->
          <div class="le-s6 le-notes-cap">Typed notes and voice memos both land here. Included in the Zoho import.</div>
          <div class="le-s6 le-notes-actions">
            <q-btn flat no-caps dense color="primary" icon="note_add" label="Add note" class="le-note-btn" @click="showNoteDialog = true" />
            <span class="le-notes-hint">Adds a dated line and saves right away.</span>
          </div>
          <AddNoteDialog v-model="showNoteDialog" :name="name" @save="appendNote" />
        </div>
      </div>
    </div>

    <div class="le-foot">
      <!-- While the pipeline is still working the lead has nothing to approve or
           reject yet, so the two buttons are replaced by a notice rather than
           disabled (a disabled button tells a phone user nothing). The notice
           takes the buttons' place, so the footer doesn't change height when the
           match lands. ReviewSmart reloads on its own while any lead is in this
           state, which is what swaps the buttons back in. -->
      <div v-if="processing" class="le-proc" role="status">
        <ProcessingBar caption="" label="Processing this contact" />
        <div class="le-proc-body">You can approve or reject once it finishes.</div>
      </div>
      <div v-else-if="footNote" class="le-foot-note" role="status">{{ footNote }}</div>
      <div class="le-foot-row">
        <q-space />
        <q-btn v-if="isDirty" outline no-caps color="primary" label="Save changes" class="le-btn" :loading="busy" @click="save" />
        <q-btn v-if="contact.reviewStatus !== 'rejected' && !processing" flat no-caps color="negative" label="Reject" class="le-btn" :disable="busy" @click="rejectClick" />
        <q-btn v-if="contact.reviewStatus === 'needs_review' && !processing && contact.matchStatus !== 'pending'" unelevated no-caps color="positive" label="Approve" class="le-btn le-approve" :loading="busy" @click="approveClick" />
        <q-btn v-if="contact.reviewStatus === 'rejected'" outline no-caps color="primary" icon="undo" label="Restore to Needs Review" class="le-btn" :loading="busy" @click="$emit('restore', contact.id)" />
      </div>
      <div v-if="showKeys && contact.reviewStatus === 'needs_review' && !processing" class="le-keys">J / K move · A approve · R reject</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed, ref, watch } from 'vue';
import { Dialog, Notify } from 'quasar';
import { api } from '@/boot/axios';
import LeadChip from '@/components/smart/LeadChip.vue';
import ProcessingBar from '@/components/smart/ProcessingBar.vue';
import AddNoteDialog from '@/components/smart/AddNoteDialog.vue';
import DuplicateResolutionDialog from '@/components/DuplicateResolutionDialog.vue';
import { useTypeahead, resolveTypedOption, type TypeaheadOption } from '@/composables/useTypeahead';
import { useContactPhoto } from '@/composables/useContactPhoto';
import { US_STATES, filterStateOptions, type UsStateOption } from '@/constants/usStates';
import { stateOptionFor, districtOptionFor, schoolOptionFor } from '@/utils/contactOptions';
import type { DisplayPatch } from '@/composables/useSmartReview';
import type { CandidateMatch, ContactListItem, UpdateContactPayload } from '@/types/review';
import { accountBadge, accountDetailLabel, appendNote as appendNoteText, fullName, isProcessing, isReady, READY_LABEL, readinessChecklist } from '@/utils/reviewSmart';

const props = defineProps<{
  contact: ContactListItem;
  // True when the view is scoped to a Sales rep (a real rep, or an admin
  // previewing one): plain-language account wording, no Zoho plumbing.
  isSales: boolean;
  busy?: boolean;
  closable?: boolean;
  showKeys?: boolean;
  position?: { index: number; total: number } | null;
}>();

const emit = defineEmits<{
  approve: [payload: { id: string; edits?: UpdateContactPayload | undefined; display?: DisplayPatch | undefined }];
  reject: [id: string];
  restore: [id: string];
  update: [payload: { id: string; payload: UpdateContactPayload; display?: DisplayPatch | undefined; message?: string | undefined }];
  retryMatch: [id: string];
  duplicatesResolved: [];
  close: [];
  prev: [];
  next: [];
}>();

const name = computed(() => fullName(props.contact));
const processing = computed(() => isProcessing(props.contact));
const ready = computed(() => isReady(props.contact));
const checklist = computed(() => readinessChecklist(props.contact));
// "Checked against Zoho" and "Not a duplicate" are true of nearly every lead
// that reaches this pane, so a green tick for each was noise next to the two
// things a rep can actually fix. They are shown only when they are the problem
// (a stuck match with its Retry button, a flagged duplicate with Resolve).
// readinessChecklist still lists all four so its test keeps proving that "all
// ticks" and "ready" are the same thing.
const shownChecklist = computed(() => checklist.value.filter((i) => !(i.state === 'ok' && (i.key === 'match' || i.key === 'duplicate'))));
function checkIcon(state: 'ok' | 'todo' | 'wait') {
  return state === 'ok' ? 'check_circle' : state === 'wait' ? 'hourglass_empty' : 'cancel';
}
const badge = computed(() => accountBadge(props.contact));

const showFullImage = ref(false);
const showFullSheet = ref(false);
const showDuplicateDialog = ref(false);
const showNoteDialog = ref(false);

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
watch(() => draft.state, (_n, old) => { if (old) draft.district = null; });
watch(() => draft.district, (_n, old) => { if (old) draft.school = null; });

function filterStates(val: string, update: (cb: () => void) => void) {
  update(() => { stateOptions.value = filterStateOptions(val); });
}

const districtTypeahead = useTypeahead(async (search: string) => {
  if (!draft.state) return [];
  const { data } = await api.get<TypeaheadOption[]>('/districts-list', { params: { search, state: draft.state.name } });
  return data;
});
const schoolTypeahead = useTypeahead(async (search: string) => {
  if (!draft.district?.id) return [];
  const { data } = await api.get<TypeaheadOption[]>('/schools-list', { params: { search, districtId: draft.district.id } });
  return data;
});

// A typed value with no match in the list is kept as plain text on save
// (schoolDistrictNameRaw / schoolNameRaw), never a new districts/schools row.
function onNewDistrict(val: string, done: (item?: TypeaheadOption, mode?: 'add-unique') => void) {
  done({ id: null, name: val }, 'add-unique');
}
function onNewSchool(val: string, done: (item?: TypeaheadOption, mode?: 'add-unique') => void) {
  done({ id: null, name: val }, 'add-unique');
}

// Backstop: new-value only fires on Enter/Tab, so a name typed and then
// followed by a tap on Save would otherwise be dropped (see resolveTypedOption).
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

// The page re-uses this editor across list changes and reloads; without this a
// reload would leave the draft on stale values and Save would overwrite fresher
// server data. Skipped while there are unsaved edits so a reload never eats them.
watch(() => props.contact, (c) => {
  if (isDirty.value) return;
  draft.firstName = c.firstName;
  draft.lastName = c.lastName;
  draft.email = c.email ?? '';
  draft.phone = c.phone ?? '';
  draft.title = c.title ?? '';
  draft.state = stateOptionFor(c.state);
  draft.district = districtOptionFor(c);
  draft.school = schoolOptionFor(c);
  draft.interactionNotes = c.interactionNotes ?? '';
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

// What the row should show once the ids above are saved.
function draftDisplay(): DisplayPatch {
  return {
    districtName: draft.district?.id ? draft.district.name : null,
    schoolName: draft.school?.id ? draft.school.name : null,
  };
}

function save() {
  emit('update', { id: props.contact.id, payload: draftPayload(), display: draftDisplay(), message: `Saved ${name.value}` });
}

function resolveCandidate(candidate: CandidateMatch) {
  const payload: UpdateContactPayload =
    candidate.type === 'contact'
      ? { matchedZohoContactId: candidate.zohoId, matchedZohoContactName: candidate.name, matchStatus: 'existing_contact', matchConfidence: 'high' }
      : {
          matchedZohoAccountId: candidate.zohoId,
          matchedZohoAccountName: candidate.name,
          matchedZohoAccountLevel: candidate.level ?? null,
          matchStatus: 'new_contact_existing_account',
          matchConfidence: 'high',
        };
  emit('update', { id: props.contact.id, payload });
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
  emit('update', { id: props.contact.id, payload });
  Notify.create({
    type: 'info',
    message: payload.matchStatus === 'ambiguous'
      ? 'Match cleared. This contact now needs review.'
      : 'Match cleared. Kept the matched account, no specific contact.',
  });
}

const intentOptions: { value: 'hot' | 'warm' | 'cold'; label: string }[] = [
  { value: 'hot', label: 'Hot' },
  { value: 'warm', label: 'Warm' },
  { value: 'cold', label: 'Cold' },
];
function setIntent(value: 'hot' | 'warm' | 'cold' | null) {
  emit('update', { id: props.contact.id, payload: { contactIntent: value } });
}
function toggleFollowedUp(value: boolean) {
  emit('update', { id: props.contact.id, payload: { followedUp: value } });
}

// Approve stays enabled while a match is pending and answers on tap instead
// (a disabled button shows nothing on a phone). contacts-patch would refuse it
// anyway; this just says why first. A possible duplicate interrupts with an
// explicit choice rather than letting the tap through silently.
function approveClick() {
  // The A shortcut lands here too, with no button on screen to explain itself.
  if (props.contact.matchStatus === 'pending') {
    Notify.create({ type: 'warning', message: isProcessing(props.contact) ? "We're still processing this contact. Try again in a few minutes." : 'The automatic match gave up. Retry it first.' });
    return;
  }
  if (props.contact.localDuplicateOfContactName) {
    Dialog.create({
      title: 'Possible duplicate',
      message: `Another contact named ${props.contact.localDuplicateOfContactName} looks like a match. Resolve it first, or approve anyway if you've already checked.`,
      cancel: { label: 'Resolve first', flat: true },
      ok: { label: 'Approve anyway', color: 'positive' },
    }).onOk(approveNow).onCancel(() => { showDuplicateDialog.value = true; });
    return;
  }
  approveNow();
}

// Unsaved edits ride on the same PATCH as the approval — Classic once dropped
// them and exported the old value.
function approveNow() {
  emit('approve', {
    id: props.contact.id,
    edits: isDirty.value ? draftPayload() : undefined,
    display: isDirty.value ? draftDisplay() : undefined,
  });
}

// Adds a dated line to the notes and saves it immediately, like Heat and
// Followed up. It builds on the DRAFT, not the saved value, so a note the rep
// was midway through typing isn't lost — and sets the draft to the same text, so
// the notes field isn't left looking edited once the save lands.
function appendNote(text: string) {
  const combined = appendNoteText(draft.interactionNotes, text);
  draft.interactionNotes = combined;
  emit('update', { id: props.contact.id, payload: { interactionNotes: combined } });
}

function rejectClick() {
  if (processing.value) {
    Notify.create({ type: 'warning', message: "We're still processing this contact. You can reject it once that's done." });
    return;
  }
  emit('reject', props.contact.id);
}

const footNote = computed(() => {
  const c = props.contact;
  if (c.reviewStatus !== 'needs_review') return '';
  if (c.matchStatus === 'pending') return 'The automatic match gave up, so this can\'t be approved yet. Use Retry match above.';
  if (c.localDuplicateOfContactName) return "Possible duplicate. You'll be asked to confirm before approving.";
  if (c.matchStatus === 'ambiguous') return 'No confirmed match. Approving sends this as a new lead.';
  return '';
});

const opportunityLine = computed(() => {
  const c = props.contact;
  if (!c.matchedZohoAccountId) return null;
  if (c.hasActiveOpportunity === true) return `Active opportunity: ${c.activeOpportunityName || 'unnamed'}`;
  if (c.hasActiveOpportunity === false) return 'No active opportunity';
  return 'Opportunity status not yet checked';
});

const isPhotoSourced = computed(() => props.contact.source === 'card_photo' || props.contact.source === 'directory_photo');

function sourceLabel(source: string) {
  switch (source) {
    case 'form': return 'Form';
    case 'card_photo': return 'Card';
    case 'directory_photo': return 'Directory';
    case 'note': return 'Note';
    case 'voice_memo': return 'Voice memo';
    case 'qr_code': return 'QR code';
    default: return capitalize(source);
  }
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

// Read by the page: the unsaved-edits guard before switching leads, and the
// A / R keyboard shortcuts, which must take exactly the same path as a tap.
defineExpose({ isDirty, approveClick, rejectClick, appendNote });
</script>

<style scoped>
.le {
  container: le / inline-size;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #fff;
}

.le-head { padding: 12px 16px 8px; border-bottom: 1px solid rgba(0, 0, 0, 0.08); }
.le-head-top { display: flex; align-items: flex-start; gap: 8px; }
.le-head-id { flex: 1; min-width: 0; }
.le-name { font-size: 18px; font-weight: 500; line-height: 1.3; overflow-wrap: anywhere; }
.le-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.le-nav { display: flex; align-items: center; gap: 0; margin: -4px -8px 0 0; flex: none; }
.le-pos { font-size: 12px; color: #5B6670; margin-right: 4px; white-space: nowrap; }

.le-intent { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 4px 0 8px; margin-bottom: 4px; border-bottom: 1px solid rgba(0, 0, 0, 0.08); }
.le-intent-label { font-size: 13px; color: #5B6670; }
.le-intent-seg { display: inline-flex; border: 1px solid rgba(0, 0, 0, 0.24); border-radius: 8px; overflow: hidden; }
.le-intent-btn {
  border: 0;
  background: transparent;
  color: #5B6670;
  font: inherit;
  font-size: 14px;
  padding: 0 16px;
  height: 36px;
  cursor: pointer;
}
.le-intent-btn + .le-intent-btn { border-left: 1px solid rgba(0, 0, 0, 0.12); }
.le-intent-btn:focus-visible { outline: 2px solid #0067AC; outline-offset: -2px; }
.le-intent-btn.is-on.is-hot { background: #FBEAEA; color: #B23B3B; font-weight: 500; }
.le-intent-btn.is-on.is-warm { background: #FDEEE3; color: #9A4D00; font-weight: 500; }
.le-intent-btn.is-on.is-cold { background: #E3F1FA; color: #0067AC; font-weight: 500; }

.le-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 16px 16px; overscroll-behavior: contain; }

.le-check {
  list-style: none;
  margin: 4px 0 0;
  padding: 8px 10px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 12px;
  border-radius: 8px;
  background: #F7F8FA;
  font-size: 13px;
  line-height: 1.4;
}
.le-check-item { display: flex; align-items: flex-start; gap: 6px; min-width: 0; color: #3D4750; }
.le-check-icon { margin-top: 1px; flex: none; }
.le-check-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.le-check-label { overflow-wrap: anywhere; }
.le-check-fix { color: #55616B; }
.le-check-item.is-ok .le-check-icon { color: #1E8E3E; }
/* A line that needs something takes the full row, so its fix and button have room. */
.le-check-item.is-todo, .le-check-item.is-wait { grid-column: 1 / -1; font-weight: 500; }
.le-check-item.is-todo .le-check-icon { color: #B23B3B; }
.le-check-item.is-wait .le-check-icon { color: #0067AC; }
.le-check-item.is-todo .le-check-fix, .le-check-item.is-wait .le-check-fix { font-weight: 400; }
.le-issue-act { flex: none; min-height: 32px; }
@container le (max-width: 360px) {
  .le-check { grid-template-columns: minmax(0, 1fr); }
}

/* Deliberately distinct from every fact on the card: an AI-derived guess must
   never look like confirmed data (see ReviewContactCard for the incident). */
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
.le-ai-note { color: #5B6670; }

.le-banner { margin-top: 10px; }
.le-cand { min-height: 44px; }

.le-body { display: grid; grid-template-columns: 168px minmax(0, 1fr); gap: 16px; margin-top: 12px; }
.le-body:not(:has(.le-photo)) { grid-template-columns: minmax(0, 1fr); }

.le-photo { display: flex; flex-direction: column; gap: 6px; }
.le-thumb { width: 168px; height: 200px; border-radius: 8px; background: #F1F3F5; cursor: zoom-in; }
.le-thumb-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 12px;
  color: #5B6670;
  cursor: default;
}

.le-form { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; align-content: start; }
.le-s2 { grid-column: span 2; }
.le-s3 { grid-column: span 3; }
.le-s4 { grid-column: span 4; }
.le-s6 { grid-column: span 6; }
.le-suggest { margin-top: -6px; }
.le-notes-cap { margin-top: -6px; font-size: 12px; line-height: 1.4; color: #6B7680; }
.le-notes-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
.le-note-btn { min-height: 36px; }
.le-notes-hint { font-size: 12px; color: #6B7680; }

.le-foot { padding: 10px 16px 12px; border-top: 1px solid rgba(0, 0, 0, 0.08); background: #fff; }
.le-foot-note { font-size: 13px; color: #3D4750; margin-bottom: 8px; }
.le-foot-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.le-btn { min-height: 44px; }
.le-approve { min-width: 120px; }
.le-follow { min-height: 44px; margin-left: 4px; }

.le-proc { padding: 6px 0 4px; }
.le-proc-body { margin-top: 6px; font-size: 13px; line-height: 1.45; color: #55616B; }
.le-keys { margin-top: 6px; font-size: 12px; color: #6B7680; text-align: right; }

@container le (max-width: 560px) {
  .le-head { padding: 10px 12px 8px; }
  .le-scroll { padding: 8px 12px 12px; }
  .le-foot { padding: 8px 12px calc(10px + env(safe-area-inset-bottom)); }
  /* Heat label and its three choices share one line; Followed up sits under
     them. The choices are 40px tall — still a comfortable tap, and it gives the
     fields more of the sheet. */
  .le-intent { display: grid; grid-template-columns: auto 1fr; gap: 0 10px; }
  .le-intent-seg { display: grid; grid-template-columns: repeat(3, 1fr); width: 100%; }
  .le-intent-btn { height: 40px; }
  .le-follow { grid-column: 1 / -1; margin-left: 0; }

  .le-body { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  /* The photo becomes a one-line strip: enough to tap open, and the fields
     keep the full width. */
  .le-photo {
    flex-direction: row;
    align-items: center;
    gap: 12px;
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: 8px;
    padding: 8px;
  }
  .le-thumb { width: 64px; height: 64px; flex: none; }
  .le-photo-cap a { display: inline-block; padding: 6px 0; }

  /* Email, phone, state and district each take a full row: at 2-4 tracks of a
     ~317px form, State was ~98px and clipped "Tennessee" to "Tennes". */
  .le-s2, .le-s4 { grid-column: span 6; }
  /* Not the Notes textarea: pinning its control to 44px squeezed the text into a
     one-line box and let the rest spill out over the hint beneath it. */
  .le-form :deep(.q-field--dense:not(.le-notes) .q-field__control),
  .le-form :deep(.q-field--dense:not(.le-notes) .q-field__marginal) { height: 44px; }

  .le-approve { flex: 1; }
  .le-foot-row .q-btn { flex: 1 1 auto; }
}
</style>
