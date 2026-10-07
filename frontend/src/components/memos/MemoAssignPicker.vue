<template>
  <!-- Pick which of this rep's contacts at this conference a memo is about. The list
       is fetched once when the picker mounts and filtered on the device (the same
       "load it whole, filter it here" rule as the State / District / School pickers);
       inbound-messages-link-candidates is scoped to the rep who sent the memo.
       radio: tap a row, then confirm elsewhere (the phone sheet). inline: each row has
       its own Assign button (the laptop pane). -->
  <div class="map">
    <q-input
      v-model="query"
      dense
      outlined
      clearable
      class="map-search"
      placeholder="Search your contacts"
      aria-label="Search your contacts"
      enterkeyhint="search"
    >
      <template #prepend><q-icon name="search" size="20px" /></template>
    </q-input>

    <div v-if="loading" class="map-note"><q-spinner size="18px" color="primary" class="q-mr-sm" />Loading your contacts…</div>
    <div v-else-if="!all.length" class="map-note">No contacts captured by this rep at this conference yet. Use Create contacts instead.</div>
    <div v-else-if="!shown.length" class="map-note">No contact matches "{{ query }}".</div>

    <div v-else class="map-list" role="listbox" aria-label="Your contacts">
      <div
        v-for="c in shown"
        :key="c.id"
        class="map-row"
        :class="{ 'is-picked': mode === 'radio' && selected?.id === c.id }"
        role="option"
        :aria-selected="mode === 'radio' ? selected?.id === c.id : undefined"
        :tabindex="mode === 'radio' ? 0 : undefined"
        @click="mode === 'radio' && (selected = c)"
        @keydown.enter.prevent="mode === 'radio' && (selected = c)"
        @keydown.space.prevent="mode === 'radio' && (selected = c)"
      >
        <span v-if="mode === 'radio'" class="map-radio" aria-hidden="true" />
        <span v-else class="map-av" aria-hidden="true">{{ initials(c) }}</span>
        <span class="map-who">
          <span class="map-name">{{ candidateName(c) }}</span>
          <span v-if="c.title" class="map-sub">{{ c.title }}</span>
        </span>
        <q-btn
          v-if="mode === 'inline'"
          outline
          dense
          no-caps
          color="primary"
          label="Assign"
          class="map-assign"
          :disable="busy"
          :aria-label="`Assign this memo to ${candidateName(c)}`"
          @click.stop="$emit('assign', c)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { LinkCandidateContact } from '@/types/review';
import { candidateName, filterCandidates } from '@/utils/voiceMemos';

const props = defineProps<{ load: () => Promise<LinkCandidateContact[]>; mode: 'radio' | 'inline'; busy?: boolean }>();
defineEmits<{ assign: [c: LinkCandidateContact] }>();
const selected = defineModel<LinkCandidateContact | null>('selected', { default: null });

const all = ref<LinkCandidateContact[]>([]);
const loading = ref(true);
const query = ref<string | null>('');
const shown = computed(() => filterCandidates(all.value, query.value ?? ''));
const initials = (c: LinkCandidateContact) => `${c.firstName[0] ?? ''}${c.lastName[0] ?? ''}`.toUpperCase() || '?';

onMounted(async () => {
  try {
    all.value = await props.load();
  } catch {
    // The interceptor said why; an empty list with its own sentence is the fallback.
    all.value = [];
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.map { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.map-search :deep(.q-field__control) { height: 44px; border-radius: 10px; }
.map-search :deep(.q-field__marginal) { height: 44px; }
.map-note { display: flex; align-items: center; padding: 8px 2px; font-size: 14px; color: #5B6670; }
.map-list { display: flex; flex-direction: column; }
.map-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 6px 4px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.07);
}
.map-row[tabindex] { cursor: pointer; }
.map-row:focus-visible { outline: 2px solid #0067AC; outline-offset: -2px; border-radius: 8px; }
.map-row.is-picked { background: #F1F8FD; border-radius: 8px; }
.map-radio { flex: none; width: 20px; height: 20px; border-radius: 50%; border: 2px solid #9AA5AE; }
.is-picked .map-radio { border-color: #0067AC; background: radial-gradient(#0067AC 45%, transparent 50%); }
.map-av { flex: none; width: 36px; height: 36px; border-radius: 50%; background: #E3F1FA; color: #0B4F82; font-size: 13px; font-weight: 500; display: inline-flex; align-items: center; justify-content: center; }
.map-who { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.map-name { font-size: 15px; font-weight: 500; overflow-wrap: anywhere; }
.map-sub { font-size: 13px; color: #5B6670; overflow-wrap: anywhere; }
.map-assign { flex: none; min-height: 36px; }
</style>
