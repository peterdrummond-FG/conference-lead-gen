<template>
  <div class="cf" :class="desktop ? 'cf-menu' : 'cf-sheet'" role="dialog" aria-label="Filter contacts">
    <div v-if="!desktop" class="cf-grab" aria-hidden="true" />
    <div class="cf-head">
      <h2 class="cf-title">Filter</h2>
      <button type="button" class="cf-reset" @click="reset">Reset</button>
      <button type="button" class="cf-close" aria-label="Close filter" @click="$emit('close')"><q-icon name="close" size="24px" /></button>
    </div>

    <div ref="bodyEl" class="cf-body">
      <section class="cf-sec">
        <div class="cf-lab">Show</div>
        <div class="cf-tog" role="group" aria-label="Show">
          <button type="button" :class="{ 'is-on': model.show === 'contacts' }" :aria-pressed="model.show === 'contacts'" @click="set('show', 'contacts')">Contacts</button>
          <button type="button" :class="{ 'is-on': model.show === 'rejected' }" :aria-pressed="model.show === 'rejected'" @click="set('show', 'rejected')">Rejected ({{ rejectedCount }})</button>
        </div>
      </section>

      <!-- Conference and Sort share a row for a manager (two short dropdowns); a rep's
           Conference is three radio rows, so the pair stacks. -->
      <div class="cf-pair" :class="{ 'is-stack': isSales }">
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
              <q-icon :name="model.scope === o.value ? 'radio_button_checked' : 'radio_button_unchecked'" size="22px" />
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
        </section>
      </div>
      <div class="cf-hint cf-hint-sort">Sort applies to contacts you haven't confirmed yet.</div>

      <section class="cf-sec">
        <div class="cf-lab">Followed up</div>
        <div class="cf-tog" role="group" aria-label="Followed up">
          <button v-for="o in FOLLOW_OPTIONS" :key="o.value" type="button" :class="{ 'is-on': model.follow === o.value }" :aria-pressed="model.follow === o.value" @click="set('follow', o.value)">{{ o.label }}</button>
        </div>
      </section>

      <!-- One short row per kind of source (SOURCE_GROUPS) instead of ten pills in a
           heap. The chip says "Scan" under "QR"; its accessible name is the full
           label, and the contact cards keep the full label too. -->
      <section class="cf-sec">
        <div class="cf-lab">Source</div>
        <div v-for="g in sourceGroups" :key="g.label" class="cf-gp" role="group" :aria-label="`Source: ${g.label}`">
          <div class="cf-gl" aria-hidden="true">{{ g.label }}</div>
          <div class="cf-chips">
            <button
              v-for="o in g.items"
              :key="o.value"
              type="button"
              class="cf-chip"
              :class="{ 'is-on': model.source === o.value }"
              :aria-pressed="model.source === o.value"
              :aria-label="o.label"
              @click="set('source', model.source === o.value ? null : o.value)"
            >{{ o.short }}</button>
          </div>
        </div>
      </section>

      <div v-if="!isSales" class="cf-pair">
        <section class="cf-sec">
          <div class="cf-lab">Rep</div>
          <q-select
            :model-value="model.repId"
            :options="repOptions"
            dense
            outlined
            emit-value
            map-options
            aria-label="Rep"
            @update:model-value="(v: string | null) => set('repId', v)"
          />
        </section>
        <section class="cf-sec">
          <div class="cf-lab">Sent to Zoho</div>
          <q-select
            :model-value="model.synced"
            :options="SYNCED_OPTIONS"
            dense
            outlined
            emit-value
            map-options
            aria-label="Sent to Zoho"
            @update:model-value="(v: string | null) => set('synced', v)"
          />
        </section>
      </div>
    </div>

    <div class="cf-foot">
      <button type="button" class="cf-show" @click="$emit('close')">Show {{ shownCount }} {{ model.show === 'rejected' ? 'rejected' : '' }} contact{{ shownCount === 1 ? '' : 's' }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import {
  DEFAULT_FILTERS, SORT_OPTIONS, SOURCE_GROUPS, homeRadioLabel,
  type ConferenceScope, type ContactFilters, type FollowFilter, type HomeConference, type SortKey, type SourceKey,
} from '@/utils/contactsList';

// The Filter panel's content, with no dialog or menu around it. ContactsFilter.vue puts
// it in a bottom sheet or a dropdown; the onboarding tour draws it inside its own
// phone frame (a real q-dialog would escape the frame), so both show the same panel.
const model = defineModel<ContactFilters>({ required: true });

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
  focusSection?: 'conference' | null | undefined;
}>();
defineEmits<{ close: [] }>();

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
// Each group lists only the sources the panel was given (Other appears only when a lead
// needs it). A source no group names goes under "Other" rather than losing its chip.
const sourceGroups = computed(() => {
  const byValue = new Map(sourceChoices.value.map((o) => [o.value, o.label]));
  const placed = new Set<SourceKey>(SOURCE_GROUPS.flatMap((g) => g.items.map((i) => i.value)));
  const groups = SOURCE_GROUPS.map((g) => ({
    label: g.label,
    items: g.items.filter((i) => byValue.has(i.value)).map((i) => ({ value: i.value, short: i.short, label: byValue.get(i.value) as string })),
  }));
  const strays = sourceChoices.value.filter((o) => !placed.has(o.value)).map((o) => ({ value: o.value, short: o.label, label: o.label }));
  if (strays.length) groups[groups.length - 1]!.items.push(...strays);
  return groups.filter((g) => g.items.length);
});

function set<K extends keyof ContactFilters>(key: K, value: ContactFilters[K]) {
  model.value = { ...model.value, [key]: value };
}
function reset() {
  model.value = { ...DEFAULT_FILTERS };
}

// Opened from the conference line: bring Conference into view. The wrapper calls it
// once the dialog or menu has finished showing (layout isn't settled before that).
const bodyEl = ref<HTMLElement | null>(null);
async function scrollToFocus() {
  if (props.focusSection !== 'conference') return;
  await nextTick();
  bodyEl.value?.querySelector('[data-sec="conference"]')?.scrollIntoView({ block: 'start' });
}
function resetScroll() {
  if (bodyEl.value) bodyEl.value.scrollTop = 0;
}
defineExpose({ scrollToFocus, resetScroll });
</script>

<style scoped>
/* Compact on purpose (2026-10-19, "way too much padding"): 12px gutters, no divider
   lines between sections, 38px controls and 26px source chips. Class names the tour
   scene looks for (.cf-body, .cf-lab, .cf-tog, .cf-show, [data-sec]) are unchanged. */
.cf { display: flex; flex-direction: column; background: #fff; color: #2F3A44; min-height: 0; }
.cf-sheet { border-radius: 14px 14px 0 0; max-height: 94vh; max-height: 94dvh; box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.2); }
.cf-menu { width: 360px; max-height: 80vh; }
.cf-grab { flex: none; width: 32px; height: 4px; border-radius: 2px; background: #CBD2D8; margin: 6px auto 0; }
.cf-head { flex: none; display: flex; align-items: center; gap: 2px; padding: 2px 4px 2px 12px; border-bottom: 1px solid rgba(0, 0, 0, 0.08); }
.cf-title { flex: 1; margin: 0; font-size: 16px; font-weight: 600; }
.cf-reset { min-height: 40px; padding: 0 10px; border: 0; background: none; color: #0067AC; font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; }
.cf-close { width: 40px; height: 40px; border: 0; background: none; color: #2F3A44; display: grid; place-items: center; cursor: pointer; }
.cf button:focus-visible { outline: 2px solid #0067AC; outline-offset: 2px; }
.cf-body { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px 2px; }
.cf-sec { margin-bottom: 10px; scroll-margin-top: 4px; min-width: 0; }
.cf-lab { margin-bottom: 4px; font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: #5B6670; }
.cf-sec.is-hl .cf-lab { color: #0067AC; }
.cf-hint { font-size: 12px; color: #5B6670; }
/* Sits under the Conference / Sort pair, which it explains. */
.cf-hint-sort { margin: -4px 0 10px; }

.cf-pair { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 8px; }
.cf-pair.is-stack { grid-template-columns: minmax(0, 1fr); }

.cf-tog { display: flex; border: 1px solid rgba(0, 0, 0, 0.2); border-radius: 8px; overflow: hidden; }
.cf-tog button { flex: 1; min-width: 0; min-height: 38px; padding: 0 4px; border: 0; border-left: 1px solid rgba(0, 0, 0, 0.1); background: #fff; font: inherit; font-size: 14px; color: #2F3A44; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cf-tog button:first-child { border-left: 0; }
.cf-tog button.is-on { background: #E3F1FA; color: #0067AC; font-weight: 600; }

.cf-radio { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px; padding: 0; border: 0; background: none; font: inherit; font-size: 14px; text-align: left; color: #2F3A44; cursor: pointer; }
.cf-radio .q-icon { color: #0067AC; flex: none; }

/* Quasar's dense outlined select is 40px; 38px matches the toggles beside it. */
.cf :deep(.q-field--dense .q-field__control),
.cf :deep(.q-field--dense .q-field__marginal) { height: 38px; min-height: 38px; }
.cf :deep(.q-field__native) { font-size: 14px; min-height: 38px; padding-top: 0; padding-bottom: 0; }

.cf-gp { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.cf-gp:last-child { margin-bottom: 0; }
.cf-gl { flex: none; width: 80px; font-size: 12px; line-height: 1.2; color: #5B6670; }
.cf-chips { display: flex; flex-wrap: wrap; gap: 4px 6px; min-width: 0; }
.cf-chip { height: 26px; padding: 0 10px; border: 1px solid rgba(0, 0, 0, 0.25); border-radius: 5px; background: #fff; font: inherit; font-size: 13px; line-height: 24px; color: #2F3A44; cursor: pointer; }
.cf-chip.is-on { background: #E3F1FA; border-color: #0067AC; color: #0067AC; font-weight: 600; }

.cf-foot { flex: none; padding: 8px 12px 10px; border-top: 1px solid rgba(0, 0, 0, 0.08); background: #fff; }
.cf-show { width: 100%; height: 44px; border: 0; border-radius: 8px; background: #0067AC; color: #fff; font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; }
</style>
