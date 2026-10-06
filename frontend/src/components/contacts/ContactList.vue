<template>
  <!-- TransitionGroup is here only for its move animation: a confirmed contact that
       is settled slides down to the confirmed group (~350ms) instead of jumping. It
       defines no enter / leave, so a row that appears or goes does neither. -->
  <TransitionGroup name="ll" tag="div" class="ll" role="list">
    <div v-for="c in leads" :key="c.id" role="listitem">
      <ContactRow
        :contact="c"
        :active="c.id === activeId"
        :compact="compact"
        :show-event="showEvent"
        :show-rep="showRep"
        :selectable="selectable"
        :selected="selectedIds?.has(c.id) ?? false"
        :busy="busy.has(c.id)"
        @open="$emit('open', c.id)"
        @approve="$emit('approve', c.id)"
        @reject="$emit('reject', c.id)"
        @restore="$emit('restore', c.id)"
        @add-note="$emit('addNote', c.id)"
        @followed-up="(v: boolean) => $emit('followedUp', c.id, v)"
        @update:selected="(v: boolean) => $emit('select', c.id, v)"
      />
    </div>
  </TransitionGroup>
</template>

<script setup lang="ts">
import ContactRow from '@/components/contacts/ContactRow.vue';
import type { ContactListItem } from '@/types/review';

defineProps<{
  leads: ContactListItem[];
  activeId: string | null;
  busy: Set<string>;
  compact?: boolean;
  showEvent?: boolean;
  showRep?: boolean;
  selectable?: boolean;
  selectedIds?: Set<string>;
}>();

defineEmits<{
  open: [id: string];
  approve: [id: string];
  reject: [id: string];
  restore: [id: string];
  followedUp: [id: string, value: boolean];
  addNote: [id: string];
  select: [id: string, value: boolean];
}>();
</script>

<style scoped>
/* Bordered rows in one container, not a stack of floating cards: dense, easy
   to scan, and nothing to size or reflow when a row leaves the list. */
.ll {
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  overflow: hidden;
}
.ll > div:last-child :deep(.lr) { border-bottom: 0; }

/* The slide. Instant under prefers-reduced-motion. */
.ll-move { transition: transform 0.35s ease; }
@media (prefers-reduced-motion: reduce) {
  .ll-move { transition: none; }
}

/* Phone: the rows are cards of their own (see ContactRow), so the shared
   white box around them goes, leaving a gap between cards instead. */
@media (max-width: 599px) {
  .ll { background: transparent; border: 0; border-radius: 0; overflow: visible; }
  .ll > div:last-child :deep(.lr) { border-bottom: 1px solid rgba(0, 0, 0, 0.08); }
}
</style>
