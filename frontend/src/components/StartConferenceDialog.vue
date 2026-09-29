<template>
  <q-dialog
    :model-value="modelValue"
    :maximized="isPhone"
    :transition-show="isPhone ? 'slide-up' : 'fade'"
    :transition-hide="isPhone ? 'slide-down' : 'fade'"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
    @show="onShow"
    @hide="reset"
  >
    <q-card class="conf-sheet" :class="{ 'conf-sheet--phone': isPhone }">
      <div class="row items-center no-wrap q-pa-xs q-pr-sm">
        <q-btn v-if="step === 'confirm'" flat round icon="arrow_back" aria-label="Back to results" @click="step = 'list'" />
        <div class="col text-h6" :class="step === 'confirm' ? 'q-pl-xs' : 'q-pl-md'">
          {{ step === 'list' ? 'Start a conference' : 'Start this conference?' }}
        </div>
        <q-btn flat round icon="close" aria-label="Close" v-close-popup />
      </div>

      <!-- Step 1: find it. One sheet with a plain scrolling list. This used to be
           two searchable q-selects, which on a phone Quasar turns into a
           full-screen popup each -- a popup on top of the dialog, with the field
           bleeding through underneath and a half-clipped last row. -->
      <template v-if="step === 'list'">
        <div class="q-px-md q-pb-sm">
          <!-- No autofocus: the keyboard would cover the list before they've seen
               what's coming up. type=search + inputmode/enterkeyhint give the phone
               a search keyboard with a Search key. -->
          <q-input
            v-model="query"
            outlined
            type="search"
            inputmode="search"
            enterkeyhint="search"
            placeholder="Search by name"
            aria-label="Search conferences"
            clearable
            :debounce="300"
            @update:model-value="load"
            @keyup.enter="($event.target as HTMLInputElement).blur()"
          >
            <template #prepend><q-icon name="search" /></template>
          </q-input>
        </div>

        <div class="col scroll conf-results">
          <div v-if="loading && !results.length" class="q-px-md">
            <q-skeleton v-for="n in 5" :key="n" type="rect" height="64px" class="q-mb-sm" />
          </div>

          <div v-else-if="loadError" class="q-pa-md">
            <div class="text-body2 q-mb-sm">Couldn't load conferences.</div>
            <q-btn outline no-caps color="primary" label="Try again" @click="load(query ?? '')" />
          </div>

          <template v-else>
            <div class="text-caption text-grey q-px-md q-pb-xs" aria-live="polite">
              {{ hasQuery ? `${results.length} ${results.length === 1 ? 'match' : 'matches'}` : 'Coming up, nearest first' }}
            </div>

            <div v-if="!results.length" class="text-body2 text-grey-8 q-px-md q-py-md">
              {{ hasQuery
                ? `No conferences match "${query}". Try fewer words.`
                : 'No conferences coming up. Try searching by name.' }}
            </div>

            <q-list v-else separator>
              <q-item
                v-for="c in results"
                :key="c.id"
                clickable
                v-ripple
                class="conf-row"
                @click="pick(c)"
              >
                <q-item-section>
                  <q-item-label class="conf-name">{{ cleanConferenceName(c.name) }}</q-item-label>
                  <q-item-label caption>
                    {{ conferenceDateLabel(c.startsOn, c.endsOn) ?? 'Date not in name' }}<template v-if="c.state"> · {{ c.state }}</template>
                  </q-item-label>
                </q-item-section>
                <q-item-section side>
                  <div v-if="c.liveEventId" class="row items-center no-wrap q-gutter-x-sm">
                    <q-badge color="positive" label="Live" />
                    <q-btn
                      unelevated no-caps color="primary" label="Join"
                      :loading="joiningId === c.id"
                      @click.stop="join(c)"
                    />
                  </div>
                  <q-badge v-else-if="conferenceTiming(c.startsOn, c.endsOn)" color="primary" outline :label="conferenceTiming(c.startsOn, c.endsOn) ?? ''" />
                  <q-icon v-else name="chevron_right" color="grey-6" />
                </q-item-section>
              </q-item>
            </q-list>

            <div class="text-caption text-grey q-pa-md">
              Not listed? It may not be set up in Zoho yet. Ask an admin.
            </div>
          </template>
        </div>
      </template>

      <!-- Step 2: confirm. The exact campaign name is shown because it is what
           becomes the Zoho Lead Source; the list above shows a tidied title. -->
      <template v-else-if="selected">
        <div class="col scroll q-px-md">
          <div class="conf-summary q-pa-md q-mb-md">
            <div class="text-subtitle1">{{ selected.name }}</div>
            <div class="text-body2 text-grey-8 q-mt-xs">
              {{ conferenceDateLabel(selected.startsOn, selected.endsOn) ?? 'Date not in name' }}
            </div>
          </div>

          <!-- Zoho campaigns carry no state, so it's read from the name's "(ST)"
               code. Shown for confirmation with a way to change it; asked for
               outright only when the name has no usable code (absent, or a
               regional one like "(TW)" that isn't a real postal abbreviation).
               Zoho's own data is why this exists at all: conference location is
               only a fallback signal when resolving card-photo contacts. -->
          <label class="text-body2 text-grey-8" for="conf-state">Where is it?</label>
          <div v-if="selected.state && !changingState" class="conf-state-chip q-mt-xs">
            <div class="col">
              {{ selected.state }}
              <span class="text-caption text-grey"> from the name</span>
            </div>
            <q-btn flat dense no-caps color="primary" label="Change" @click="changingState = true" />
          </div>
          <!-- The phone's own picker (the wheel on iOS, a list on Android) rather
               than a Quasar select: no keyboard, no nested popup, one tap. -->
          <select v-else id="conf-state" v-model="stateName" class="conf-native-select q-mt-xs" :aria-invalid="!!stateError">
            <option value="">Choose a state</option>
            <option v-for="s in US_STATES" :key="s.name" :value="s.name">{{ s.name }}</option>
          </select>
          <div v-if="stateError" class="text-negative text-body2 q-mt-xs" role="alert">{{ stateError }}</div>
        </div>

        <div class="conf-footer q-pa-md">
          <q-btn
            unelevated
            no-caps
            size="lg"
            color="primary"
            class="full-width"
            label="Start conference"
            :loading="activating"
            @click="start"
          />
          <div class="text-caption text-grey text-center q-mt-sm">
            You'll be joined to it. Others can join from their own Setup page.
          </div>
        </div>
      </template>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useQuasar } from 'quasar';
import { api } from '@/boot/axios';
import { US_STATES } from '@/constants/usStates';
import { cleanConferenceName, conferenceDateLabel, conferenceTiming } from '@/utils/conferenceName';

// Shared by Setup (any role -- a rep on their phone can start the conference
// they're at, as they always could by texting SETUP) and Admin. One copy so the
// two can't drift apart on what starting a conference asks for.
defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  (e: 'update:modelValue', open: boolean): void;
  // Either started a new conference or joined one that was already live. Both
  // leave the caller linked to it (events-activate links the starter server-side),
  // so the parent has to refresh the session as well as its own lists.
  (e: 'started', payload: { joined: boolean; name: string }): void;
}>();

interface Conference {
  id: string;
  zohoCampaignId: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  // Read from the name's "(ST)" code by campaigns-list, or the live event's own.
  state: string | null;
  // Set when this campaign is already running -- Join instead of Start.
  liveEventId: string | null;
}

const $q = useQuasar();
const isPhone = computed(() => $q.screen.lt.sm);

const step = ref<'list' | 'confirm'>('list');
const query = ref<string | null>('');
const results = ref<Conference[]>([]);
const loading = ref(false);
const loadError = ref(false);
const hasQuery = computed(() => !!query.value?.trim());

const selected = ref<Conference | null>(null);
const changingState = ref(false);
const stateName = ref('');
const stateError = ref('');
const activating = ref(false);
const joiningId = ref<string | null>(null);

// Only the latest request may write results: typing fires several, and a slow
// early response must not overwrite a newer one.
let requestId = 0;

async function load(text: string | number | null) {
  const mine = ++requestId;
  loading.value = true;
  loadError.value = false;
  try {
    const { data } = await api.get<Conference[]>('/campaigns-list', { params: { search: String(text ?? '').trim() } });
    if (mine === requestId) results.value = data;
  } catch {
    if (mine === requestId) loadError.value = true;
  } finally {
    if (mine === requestId) loading.value = false;
  }
}

function onShow() {
  void load('');
}

function reset() {
  requestId++; // drop any response still in flight
  step.value = 'list';
  query.value = '';
  results.value = [];
  loadError.value = false;
  loading.value = false;
  selected.value = null;
  changingState.value = false;
  stateName.value = '';
  stateError.value = '';
}

// A live conference row joins immediately; there's nothing to confirm about
// something that's already running. Anything else goes to the confirm step.
function pick(c: Conference) {
  if (c.liveEventId) {
    void join(c);
    return;
  }
  selected.value = c;
  changingState.value = false;
  stateName.value = '';
  stateError.value = '';
  step.value = 'confirm';
}

async function join(c: Conference) {
  if (!c.liveEventId) return;
  joiningId.value = c.id;
  try {
    await api.post('/profiles-set-current-event', { eventId: c.liveEventId });
    emit('update:modelValue', false);
    emit('started', { joined: true, name: cleanConferenceName(c.name) });
  } finally {
    joiningId.value = null;
  }
}

async function start() {
  const c = selected.value;
  if (!c) return;
  const state = c.state && !changingState.value ? c.state : stateName.value;
  if (!state) {
    stateError.value = 'Choose the state this conference is in.';
    return;
  }
  stateError.value = '';
  activating.value = true;
  try {
    // `name` is sent for compatibility with a not-yet-updated events-activate
    // (which required it) but the server now ignores it and looks the name up
    // from the campaign cache by id.
    await api.post('/events-activate', { zohoCampaignId: c.zohoCampaignId, name: c.name, state });
    emit('update:modelValue', false);
    emit('started', { joined: false, name: cleanConferenceName(c.name) });
  } finally {
    activating.value = false;
  }
}
</script>

<style scoped>
/* Desktop: a fixed-size card so the list scrolls inside it and the footer never
   moves. Phone: the dialog is maximized, so the card fills it. */
.conf-sheet {
  display: flex;
  flex-direction: column;
  width: 480px;
  max-width: 100vw;
  height: min(640px, 90vh);
}
.conf-sheet--phone {
  width: 100%;
  height: 100%;
  border-radius: 0;
}
.conf-results {
  padding-bottom: 8px;
}
/* 64px+ rows: a comfortable thumb target, and room for a two-line name. */
.conf-row {
  min-height: 64px;
  padding-top: 10px;
  padding-bottom: 10px;
}
.conf-name {
  white-space: normal;
  line-height: 1.3;
  font-weight: 500;
}
.conf-summary {
  background: #f5f5f5;
  border-radius: 12px;
}
.conf-state-chip {
  display: flex;
  align-items: center;
  min-height: 48px;
  padding: 0 8px 0 14px;
  border: 1px solid rgba(0, 0, 0, 0.24);
  border-radius: 8px;
}
.conf-native-select {
  width: 100%;
  height: 48px;
  padding: 0 12px;
  border: 1px solid rgba(0, 0, 0, 0.24);
  border-radius: 8px;
  background: #fff;
  /* 16px: anything smaller makes iOS Safari zoom the page when it's focused. */
  font-size: 16px;
}
.conf-footer {
  /* Clear of the home-indicator bar on a notched phone. */
  padding-bottom: calc(16px + env(safe-area-inset-bottom));
  border-top: 1px solid rgba(0, 0, 0, 0.08);
}
/* Same iOS-zoom reason as the select: the search field must be 16px. */
.conf-sheet :deep(.q-field__native),
.conf-sheet :deep(.q-field__input) {
  font-size: 16px;
}
</style>
