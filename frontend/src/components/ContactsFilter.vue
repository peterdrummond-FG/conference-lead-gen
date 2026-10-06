<template>
  <!-- A bottom sheet under 1024px, a dropdown panel under the Filter button on a
       laptop. Same content either way; every choice applies as it is made, and
       "Show N contacts" is just the way out (with the count the list will have). -->
  <component
    :is="desktop ? QMenu : QDialog"
    v-bind="wrapperProps"
    :model-value="open"
    @update:model-value="(v: boolean) => (open = v)"
    @show="onShow"
  >
    <div class="cf" :class="desktop ? 'cf-menu' : 'cf-sheet'" role="dialog" aria-label="Filter contacts">
      <div v-if="!desktop" class="cf-grab" aria-hidden="true" />
      <div class="cf-head">
        <h2 class="cf-title">Filter</h2>
        <button type="button" class="cf-reset" @click="reset">Reset</button>
        <button type="button" class="cf-close" aria-label="Close filter" @click="open = false"><q-icon name="close" size="24px" /></button>
      </div>

      <div ref="bodyEl" class="cf-body">
        <section class="cf-sec">
          <div class="cf-lab">Show</div>
          <div class="cf-tog" role="group" aria-label="Show">
            <button type="button" :class="{ 'is-on': model.show === 'contacts' }" :aria-pressed="model.show === 'contacts'" @click="set('show', 'contacts')">Contacts</button>
            <button type="button" :class="{ 'is-on': model.show === 'rejected' }" :aria-pressed="model.show === 'rejected'" @click="set('show', 'rejected')">Rejected ({{ rejectedCount }})</button>
          </div>
        </section>

        <section class="cf-sec" :class="{ 'is-hl': focusSection === 'conference' }" data-sec="conference">
          <div class="cf-lab">Conference</div>
          <!-- A rep chooses between their conference, the ones before it, and all of
               them (the last two keep the list grouped by conference). A manager
               picks any one conference, or all. -->
          <template v-if="isSales">
            <button
              v-for="o in scopeOptions"
              :key="o.value"
              type="button"
              class="cf-radio"
              role="radio"
              :aria-checked="model.scope === o.value"
              @click="set('scope', o.value)"
            >
              <q-icon :name="model.scope === o.value ? 'radio_button_checked' : 'radio_button_unchecked'" size="24px" />
              <span>{{ o.label }}</span>
            </button>
          </template>
          <q-select
            v-else
            :model-value="model.eventId"
            :options="eventSelectOptions"
            dense
            outlined
            emit-value
            map-options
            aria-label="Conference"
            @update:model-value="(v: string | null) => set('eventId', v)"
          />
        </section>

        <section class="cf-sec">
          <div class="cf-lab">Followed up</div>
          <div class="cf-tog" role="group" aria-label="Followed up">
            <button v-for="o in FOLLOW_OPTIONS" :key="o.value" type="button" :class="{ 'is-on': model.follow === o.value }" :aria-pressed="model.follow === o.value" @click="set('follow', o.value)">{{ o.label }}</button>
          </div>
        </section>

        <section class="cf-sec">
          <div class="cf-lab">Source</div>
          <div class="cf-chips" role="group" aria-label="Source">
            <button
              v-for="o in sourceChoices"
              :key="o.value"
              type="button"
              class="cf-chip"
              :class="{ 'is-on': model.source === o.value }"
              :aria-pressed="model.source === o.value"
              @click="set('source', model.source === o.value ? null : o.value)"
            >{{ o.label }}</button>
          </div>
        </section>

        <section class="cf-sec">
          <div class="cf-lab">Sort</div>
          <q-select
            :model-value="model.sort"
            :options="SORT_OPTIONS.needs_review"
            option-value="value"
            option-label="label"
            dense
            outlined
            emit-value
            map-options
            aria-label="Sort"
            @update:model-value="(v: SortKey) => set('sort', v)"
          />
          <div class="cf-hint">Sorts contacts that aren't confirmed yet. Confirmed ones follow, in their own order.</div>
        </section>

        <section v-if="!isSales" class="cf-sec">
          <div class="cf-lab">Team</div>
          <q-select
            :model-value="model.repId"
            :options="repOptions"
            dense
            outlined
            emit-value
            map-options
            label="Rep"
            class="cf-team"
            @update:model-value="(v: string | null) => set('repId', v)"
          />
          <q-select
            :model-value="model.synced"
            :options="SYNCED_OPTIONS"
            dense
            outlined
            emit-value
            map-options
            label="Sent to Zoho"
            class="cf-team"
            @update:model-value="(v: string | null) => set('synced', v)"
          />
        </section>
      </div>

      <div class="cf-foot">
        <button type="button" class="cf-show" @click="open = false">Show {{ shownCount }} {{ model.show === 'rejected' ? 'rejected' : '' }} contact{{ shownCount === 1 ? '' : 's' }}</button>
      </div>
    </div>
  </component>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { QDialog, QMenu } from 'quasar';
import {
  DEFAULT_FILTERS, SORT_OPTIONS, homeRadioLabel,
  type ConferenceScope, type ContactFilters, type FollowFilter, type HomeConference, type SortKey, type SourceKey,
} from '@/utils/contactsList';

const model = defineModel<ContactFilters>({ required: true });
const open = defineModel<boolean>('open', { default: false });

type Option<V> = { label: string; value: V };
const props = defineProps<{
  desktop: boolean;
  isSales: boolean;
  home: HomeConference;
  eventOptions: Option<string>[];
  sourceOptions: Option<SourceKey | null>[];
  repOptions: Option<string | null>[];
  rejectedCount: number;
  // What the list will hold with these settings (before folding), for the button.
  shownCount: number;
  // Set when the panel is opened from the conference line, so it scrolls there.
  focusSection?: 'conference' | null;
}>();

const FOLLOW_OPTIONS: Option<FollowFilter>[] = [
  { label: 'Any', value: 'any' },
  { label: 'Not yet', value: 'todo' },
  { label: 'Done', value: 'done' },
];
const SYNCED_OPTIONS: Option<string | null>[] = [
  { label: 'Any', value: null },
  { label: 'Not yet sent', value: 'false' },
  { label: 'Already sent', value: 'true' },
];

const scopeOptions = computed<Option<ConferenceScope>[]>(() => [
  { label: homeRadioLabel(props.home), value: 'current' },
  { label: 'Earlier conferences', value: 'earlier' },
  { label: 'All conferences', value: 'all' },
]);
const eventSelectOptions = computed(() => [{ label: 'All conferences', value: null as string | null }, ...props.eventOptions]);
const sourceChoices = computed(() => props.sourceOptions.filter((o): o is Option<SourceKey> => o.value !== null));

// A sheet on a phone, a menu on a laptop; the props differ, the content does not.
const wrapperProps = computed(() => (props.desktop
  ? { target: '#cf-filter-btn', anchor: 'bottom right', self: 'top right', offset: [0, 6], maxHeight: '80vh', noParentEvent: true }
  : { position: 'bottom', fullWidth: true, maxHeight: '94vh' }));

function set<K extends keyof ContactFilters>(key: K, value: ContactFilters[K]) {
  model.value = { ...model.value, [key]: value };
}
function reset() {
  model.value = { ...DEFAULT_FILTERS };
}

// Opened from the conference line: bring Conference into view.
const bodyEl = ref<HTMLElement | null>(null);
async function onShow() {
  if (props.focusSection !== 'conference') return;
  await nextTick();
  bodyEl.value?.querySelector('[data-sec="conference"]')?.scrollIntoView({ block: 'start' });
}
</script>

<style scoped>
.cf { display: flex; flex-direction: column; background: #fff; color: #2F3A44; min-height: 0; }
.cf-sheet { border-radius: 16px 16px 0 0; max-height: 94vh; max-height: 94dvh; box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.2); }
.cf-menu { width: 360px; max-height: 80vh; }
.cf-grab { flex: none; width: 36px; height: 4px; border-radius: 2px; background: #CBD2D8; margin: 8px auto 0; }
.cf-head { flex: none; display: flex; align-items: center; gap: 4px; padding: 4px 4px 4px 16px; border-bottom: 1px solid rgba(0, 0, 0, 0.08); }
.cf-title { flex: 1; margin: 0; font-size: 18px; font-weight: 600; }
.cf-reset { min-height: 44px; padding: 0 12px; border: 0; background: none; color: #0067AC; font: inherit; font-size: 15px; font-weight: 500; cursor: pointer; }
.cf-close { width: 44px; height: 44px; border: 0; background: none; color: #2F3A44; display: grid; place-items: center; cursor: pointer; }
.cf button:focus-visible { outline: 2px solid #0067AC; outline-offset: 2px; }
.cf-body { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 16px 8px; }
.cf-sec { padding: 12px 0; border-bottom: 1px solid rgba(0, 0, 0, 0.08); scroll-margin-top: 4px; }
.cf-sec:last-child { border-bottom: 0; }
.cf-lab { margin-bottom: 8px; font-size: 13px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: #5B6670; }
.cf-sec.is-hl .cf-lab { color: #0067AC; }
.cf-hint { margin-top: 6px; font-size: 13px; color: #5B6670; }

.cf-tog { display: flex; border: 1px solid rgba(0, 0, 0, 0.2); border-radius: 10px; overflow: hidden; }
.cf-tog button { flex: 1; min-width: 0; min-height: 44px; padding: 0 6px; border: 0; border-left: 1px solid rgba(0, 0, 0, 0.1); background: #fff; font: inherit; font-size: 15px; color: #2F3A44; cursor: pointer; }
.cf-tog button:first-child { border-left: 0; }
.cf-tog button.is-on { background: #E3F1FA; color: #0067AC; font-weight: 600; }

.cf-radio { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 0; border: 0; background: none; font: inherit; font-size: 15px; text-align: left; color: #2F3A44; cursor: pointer; }
.cf-radio .q-icon { color: #0067AC; flex: none; }

.cf-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.cf-chip { min-height: 40px; padding: 0 14px; border: 1px solid rgba(0, 0, 0, 0.25); border-radius: 20px; background: #fff; font: inherit; font-size: 14px; color: #2F3A44; cursor: pointer; }
.cf-chip.is-on { background: #E3F1FA; border-color: #0067AC; color: #0067AC; font-weight: 600; }

.cf-team + .cf-team { margin-top: 12px; }

.cf-foot { flex: none; padding: 12px 16px; border-top: 1px solid rgba(0, 0, 0, 0.08); background: #fff; }
.cf-show { width: 100%; height: 48px; border: 0; border-radius: 10px; background: #0067AC; color: #fff; font: inherit; font-size: 16px; font-weight: 600; cursor: pointer; }
</style>
