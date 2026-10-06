<template>
  <q-dialog
    :model-value="modelValue"
    persistent
    :maximized="isPhone"
    :transition-show="isPhone ? 'slide-up' : undefined"
    :transition-hide="isPhone ? 'slide-down' : undefined"
    @update:model-value="(v: boolean) => $emit('update:modelValue', v)"
  >
    <!-- A column: header and action bar stay put, only the middle scrolls. The
         old card scrolled as one block, so on a phone Merge and Cancel sat
         ~1800px down and the title scrolled away. -->
    <q-card class="dup-card">
      <div class="dup-head">
        <q-btn flat round dense icon="close" aria-label="Close without changing anything" @click="close" />
        <div class="dup-head-text">
          <div class="dup-title">Resolve duplicate</div>
          <div v-if="group[0]" class="dup-sub">{{ group.length }} leads named {{ group[0].firstName }} {{ group[0].lastName }}</div>
        </div>
      </div>

      <div class="dup-scroll">
        <div v-if="loading" class="text-center q-pa-lg"><q-spinner size="32px" /></div>

        <div v-else-if="group.length < 2" class="dup-note">This lead has no other duplicates any more. Close this and refresh Contacts.</div>

        <template v-else>
          <div class="dup-hint">Pick the record that looks right. It becomes the lead, and the others are rejected as duplicates.</div>

          <div class="dup-recs" role="radiogroup" aria-label="Which record to keep">
            <div
              v-for="c in group"
              :key="c.id"
              :class="['dup-rec', { 'dup-rec--on': keeperId === c.id }]"
              @click="selectKeeper(c)"
            >
              <div class="dup-rec-top">
                <q-radio v-model="keeperId" :val="c.id" dense :aria-label="`Keep ${c.firstName} ${c.lastName}, ${sourceInfo(c.source).label}`" @click.stop />
                <div class="dup-rec-name">
                  <span :class="{ 'dup-df': differs.has('firstName') }">{{ c.firstName }}</span>
                  <span :class="{ 'dup-df': differs.has('lastName') }"> {{ c.lastName }}</span>
                </div>
                <span v-if="c.id === suggested" class="dup-suggested">Suggested</span>
              </div>

              <div class="dup-src">
                <q-icon :name="sourceInfo(c.source).icon" size="16px" aria-hidden="true" />
                <span class="dup-src-text">{{ sourceInfo(c.source).label }} · {{ shortDate(c.createdAt) }}<template v-if="c.repName"> · {{ c.repName }}</template></span>
              </div>

              <dl class="dup-kv">
                <dt>Email</dt>
                <dd :class="{ 'dup-df': differs.has('email') && c.email, 'dup-none': !c.email }">{{ c.email || 'Not on this record' }}</dd>
                <dt>Phone</dt>
                <dd :class="{ 'dup-df': differs.has('phone') && c.phone, 'dup-none': !c.phone }">{{ c.phone || 'Not on this record' }}</dd>
                <dt>Title</dt>
                <dd :class="{ 'dup-df': differs.has('title') && c.title, 'dup-none': !c.title }">{{ c.title || 'Not on this record' }}</dd>
                <dt>School</dt>
                <dd :class="{ 'dup-df': differs.has('org') && orgText(c), 'dup-none': !orgText(c) }">{{ orgText(c) || 'Not on this record' }}</dd>
              </dl>

              <button v-if="c.hasPhoto && !photoErrors[c.id]" type="button" class="dup-photo" :aria-label="`See the photo for ${c.firstName} ${c.lastName}`" @click.stop="zoomContactId = c.id">
                <q-img v-if="photoUrls[c.id]" :src="photoUrls[c.id]" fit="cover" class="dup-photo-img" />
                <q-spinner v-else color="primary" size="20px" />
                <span class="dup-photo-cap"><q-icon name="zoom_in" size="16px" aria-hidden="true" /> Tap to see the card</span>
              </button>
              <div v-else-if="c.hasPhoto" class="dup-none dup-photo-fail">Photo failed to load</div>

              <div v-if="tagsFor(c).length" class="dup-tags">
                <span v-for="t in tagsFor(c)" :key="t.label" :class="['dup-tag', `dup-tag--${t.tone}`]">
                  <q-icon v-if="t.tone === 'good'" name="check" size="12px" aria-hidden="true" />{{ t.label }}
                </span>
              </div>
            </div>
          </div>

          <q-dialog v-model="zoomOpen">
            <q-img
              v-if="zoomContactId && !fullPhotoErrors[zoomContactId]"
              :src="fullPhotoUrls[zoomContactId]"
              fit="contain"
              style="max-width: 90vw; max-height: 90vh"
            />
            <q-card v-else-if="zoomContactId" class="q-pa-md text-grey">Photo failed to load</q-card>
          </q-dialog>

          <div v-if="keeper" class="dup-merged">
            <div class="dup-merged-title">Merged record</div>
            <div class="dup-merged-sub">Starts from the record you picked. Change anything that's wrong.</div>

            <div class="row q-col-gutter-md">
              <div v-for="f in textFields" :key="f.key" :class="f.cols">
                <q-input v-model="draft[f.key]" outlined :dense="!isPhone" :label="f.label" :inputmode="f.inputmode" />
                <div v-if="alts(f.key).length" class="dup-alts">
                  <span class="dup-alts-label">Other records say</span>
                  <button v-for="v in alts(f.key)" :key="v" type="button" class="dup-chip" @click="draft[f.key] = v">{{ v }}</button>
                </div>
              </div>

              <!-- The same State / District / School fields as the attendee form and the lead editor. -->
              <InstitutionFields
                :model="draft" variant="editor" :dense="!isPhone"
                state-label="State (optional)" district-label="School district (optional)" school-label="School or campus (optional)"
                state-class="col-12 col-sm-6" district-class="col-12 col-sm-6" school-class="col-12"
              />
            </div>
          </div>
        </template>
      </div>

      <div class="dup-foot">
        <q-btn outline no-caps color="primary" class="dup-foot-btn" label="Not a duplicate" :disable="group.length < 2 || merging || separating" @click="confirmSeparate = true" />
        <q-btn
          unelevated
          no-caps
          color="positive"
          class="dup-foot-btn dup-foot-merge"
          :label="others.length > 1 ? `Merge ${others.length} into 1` : 'Merge 2 into 1'"
          :disable="!keeperId || others.length === 0 || separating"
          :loading="merging"
          @click="confirmMerge"
        />
      </div>

      <!-- Bottom sheet on a phone, centred on desktop. Not a duplicate is a
           one-way change (nothing re-flags these rows), so it asks first. -->
      <q-dialog v-model="confirmSeparate" :position="isPhone ? 'bottom' : 'standard'">
        <q-card class="dup-sheet">
          <div class="dup-sheet-title">Keep these as separate leads?</div>
          <p class="dup-sheet-body">
            All {{ group.length }} stay in Contacts as their own leads and no longer show as possible duplicates. Use this when they're different people who share a name.
          </p>
          <q-btn unelevated no-caps color="primary" class="full-width dup-foot-btn" label="Keep separate" :loading="separating" @click="keepSeparate" />
          <q-btn flat no-caps class="full-width dup-foot-btn q-mt-xs" label="Cancel" :disable="separating" @click="confirmSeparate = false" />
        </q-card>
      </q-dialog>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onUnmounted } from 'vue';
import { Dialog, Notify, useQuasar } from 'quasar';
import { api } from '@/boot/axios';
import InstitutionFields from '@/components/InstitutionFields.vue';
import type { TypeaheadOption } from '@/utils/institutionPicker';
import type { UsStateOption } from '@/constants/usStates';
import { stateOptionFor, districtOptionFor, schoolOptionFor } from '@/utils/contactOptions';
import { alternativeValues, differingFields, evidenceTags, orgText, shortDate, sourceInfo, suggestedId, type FieldKey } from '@/utils/duplicateEvidence';
import type { ContactListItem } from '@/types/review';

const props = defineProps<{ modelValue: boolean; contactId: string }>();
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  resolved: [];
}>();

const $q = useQuasar();
const isPhone = computed(() => $q.screen.lt.sm);

const loading = ref(false);
const merging = ref(false);
const separating = ref(false);
const confirmSeparate = ref(false);
const group = ref<ContactListItem[]>([]);
const keeperId = ref<string | null>(null);
const zoomContactId = ref<string | null>(null);
const zoomOpen = computed({
  get: () => zoomContactId.value !== null,
  set: (v: boolean) => { if (!v) zoomContactId.value = null; },
});

// Stage 15: contacts-photo needs an authenticated request (the caller's own
// bearer token), which a plain <img src> can't send — same reasoning
// as useContactPhoto.ts, but this dialog renders a *list* of photos
// (one per card in the duplicate group) plus one zoomed one, so it keeps
// its own small id -> blob-URL maps rather than one fixed composable
// instance.
const photoUrls = reactive<Record<string, string>>({});
const fullPhotoUrls = reactive<Record<string, string>>({});
// Tracks a fetch failure per contact/mode separately from "no photo" (an
// unset entry) — neither <q-img> here has an #error slot, and even if they
// did, a falsy :src never triggers a real <img> load attempt for it to fire
// on. This is what lets the template render an explicit "failed to load"
// state instead of silently falling back to the "no photo on file" one.
const photoErrors = reactive<Record<string, boolean>>({});
const fullPhotoErrors = reactive<Record<string, boolean>>({});

function revokeAllPhotoUrls() {
  for (const url of Object.values(photoUrls)) URL.revokeObjectURL(url);
  for (const url of Object.values(fullPhotoUrls)) URL.revokeObjectURL(url);
  for (const key of Object.keys(photoUrls)) delete photoUrls[key];
  for (const key of Object.keys(fullPhotoUrls)) delete fullPhotoUrls[key];
  for (const key of Object.keys(photoErrors)) delete photoErrors[key];
  for (const key of Object.keys(fullPhotoErrors)) delete fullPhotoErrors[key];
}

async function loadPhotoUrl(id: string, full: boolean) {
  const store = full ? fullPhotoUrls : photoUrls;
  const errors = full ? fullPhotoErrors : photoErrors;
  if (store[id]) return;
  try {
    const { data } = await api.get<Blob>('/contacts-photo', {
      params: { id, full: full ? 'true' : undefined },
      responseType: 'blob',
    });
    store[id] = URL.createObjectURL(data);
  } catch {
    errors[id] = true;
  }
}

onUnmounted(revokeAllPhotoUrls);

watch(zoomContactId, (id) => {
  if (id) void loadPhotoUrl(id, true);
});

const keeper = computed(() => group.value.find((c) => c.id === keeperId.value) ?? null);
const others = computed(() => group.value.filter((c) => c.id !== keeperId.value));

const differs = computed(() => differingFields(group.value));
const suggested = computed(() => suggestedId(group.value));
const tagsFor = evidenceTags;

type TextKey = 'firstName' | 'lastName' | 'email' | 'phone' | 'title';
const textFields: { key: TextKey; label: string; cols: string; inputmode?: 'email' | 'tel' }[] = [
  { key: 'firstName', label: 'First name', cols: 'col-12 col-sm-6' },
  { key: 'lastName', label: 'Last name', cols: 'col-12 col-sm-6' },
  { key: 'email', label: 'Email', cols: 'col-12 col-sm-6', inputmode: 'email' },
  { key: 'phone', label: 'Phone', cols: 'col-12 col-sm-6', inputmode: 'tel' },
  { key: 'title', label: 'Title', cols: 'col-12' },
];
// Every record's value for a field except what's already in the merged record,
// de-duplicated — so a pick can be undone by tapping the value it replaced.
function alts(key: TextKey) {
  return alternativeValues(group.value, key as FieldKey, draft[key]);
}

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

function confirmMerge() {
  if (!keeperId.value) return;
  const count = others.value.length;
  Dialog.create({
    title: 'Merge duplicates?',
    message: `Keep ${keeper.value?.firstName ?? 'this record'} and discard ${count} duplicate${count === 1 ? '' : 's'}? This can't be undone.`,
    cancel: true,
    persistent: true,
    ok: { label: 'Merge', color: 'positive' },
  }).onOk(merge);
}

async function keepSeparate() {
  separating.value = true;
  try {
    await api.post('/contacts-mark-not-duplicate', null, { params: { id: props.contactId } });
    confirmSeparate.value = false;
    Notify.create({ type: 'positive', message: 'Kept as separate leads' });
    emit('resolved');
    close();
  } finally {
    separating.value = false;
  }
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
</script>

<style scoped>
/* One column: header and action bar pinned, the middle scrolls. Phones get the
   whole screen (q-dialog maximized); desktop keeps a centred card. */
.dup-card {
  display: flex;
  flex-direction: column;
  width: 720px;
  max-width: 100%;
  max-height: 92vh;
  max-height: 92dvh;
  overflow: hidden;
}
@media (max-width: 599px) {
  .dup-card { width: 100%; height: 100%; max-height: none; border-radius: 0; border: 0; box-shadow: none; }
}
.dup-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px 10px 8px; border-bottom: 1px solid rgba(0, 0, 0, 0.08); }
.dup-head-text { min-width: 0; }
.dup-title { font-size: 18px; font-weight: 500; line-height: 1.2; }
.dup-sub { font-size: 13px; color: #5B6670; }
.dup-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 14px 16px 20px; }
.dup-note, .dup-hint { font-size: 14px; color: #44505B; }
.dup-hint { margin-bottom: 12px; }
.dup-foot {
  display: flex;
  gap: 10px;
  padding: 10px 16px calc(12px + env(safe-area-inset-bottom));
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  background: #fff;
}
.dup-foot-btn { min-height: 44px; }
.dup-foot .dup-foot-btn { flex: 1 1 0; }
.dup-foot .dup-foot-merge { flex: 1.4 1 0; }

.dup-recs { display: flex; flex-direction: column; gap: 10px; }
@media (min-width: 600px) { .dup-recs { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); align-items: start; } }
.dup-rec { border: 1px solid rgba(0, 0, 0, 0.18); border-radius: 12px; padding: 12px; cursor: pointer; min-width: 0; }
.dup-rec--on { border: 2px solid var(--q-primary); background: #E6F1F9; padding: 11px; }
.dup-rec-top { display: flex; align-items: center; gap: 8px; }
.dup-rec-name { flex: 1; min-width: 0; font-size: 15px; font-weight: 500; overflow-wrap: anywhere; }
.dup-suggested { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 8px; background: #CFE3F3; color: #004F85; }
.dup-src { display: flex; align-items: flex-start; gap: 6px; margin: 4px 0 8px; font-size: 12px; color: #55616B; }
.dup-src-text { min-width: 0; flex: 1; }
.dup-kv { display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 3px 8px; margin: 0; font-size: 13px; line-height: 1.4; }
.dup-kv dt { color: #6B7680; }
.dup-kv dd { margin: 0; overflow-wrap: anywhere; }
.dup-none { color: #6B7680; font-style: italic; }
/* The values the records disagree about — the ones to decide. */
.dup-df { background: #FFF3D6; color: #6B4300; border-radius: 4px; padding: 0 4px; }
.dup-kv dd.dup-df { justify-self: start; }

.dup-photo {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 84px;
  margin-top: 10px;
  padding: 0;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  background: #F1F3F5;
  overflow: hidden;
  cursor: zoom-in;
}
.dup-photo-img { position: absolute; inset: 0; }
.dup-photo-cap { position: absolute; left: 6px; bottom: 6px; display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 10px; background: rgba(255, 255, 255, 0.92); font-size: 12px; color: #1B2630; }
.dup-photo-fail { margin-top: 10px; font-size: 12px; }

.dup-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.dup-tag { display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px; border-radius: 8px; font-size: 12px; background: #EEF1F4; color: #44505B; }
.dup-tag--good { background: #E3F4EB; color: #14693F; }
.dup-tag--warn { background: #FDF1DC; color: #7A4E00; }

.dup-merged { margin-top: 22px; }
.dup-merged-title { font-size: 16px; font-weight: 500; }
.dup-merged-sub { margin: 2px 0 14px; font-size: 13px; color: #5B6670; }
.dup-alts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }
.dup-alts-label { font-size: 12px; color: #5B6670; }
/* 36px tall, well under a thumb, but the chip row wraps with 6px gaps so a
   miss lands on padding, not on the neighbouring value. */
.dup-chip {
  min-height: 36px;
  max-width: 100%;
  padding: 0 12px;
  border: 1px solid rgba(0, 0, 0, 0.2);
  border-radius: 18px;
  background: #F4F6F9;
  font: inherit;
  font-size: 13px;
  color: #1B2630;
  overflow-wrap: anywhere;
  cursor: pointer;
}

.dup-sheet { width: 420px; max-width: 100%; padding: 18px 16px calc(16px + env(safe-area-inset-bottom)); }
@media (max-width: 599px) { .dup-sheet { width: 100%; border-radius: 18px 18px 0 0; } }
.dup-sheet-title { font-size: 17px; font-weight: 500; }
.dup-sheet-body { margin: 6px 0 14px; font-size: 14px; line-height: 1.5; color: #44505B; }
</style>
