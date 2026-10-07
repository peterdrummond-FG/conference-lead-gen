<template>
  <!-- "Needs attention" at the top of Contacts: voice memos nobody could match to a contact,
       and photos or memos that failed to process. Nothing to show is the common case, so it
       renders nothing then. CLOSED until the rep opens it (Peter, 2026-10-07): open by
       default it pushed every contact below it and hid them. The header stays, with its
       count, so the rep can see something is waiting. Newest first, both kinds mixed.
       Phone: every item is a card with its controls on it. Laptop: an unmatched memo is a
       thin row that opens in the right pane; a failed item is the same card as on a phone
       (there is nothing in a pane for it to show). -->
  <section v-if="items.length" class="ms" aria-label="Voice memos and photos needing attention">
    <button type="button" class="ms-head" :aria-expanded="open" @click="open = !open">
      <q-icon :name="open ? 'expand_more' : 'chevron_right'" size="22px" />
      <span class="ms-mark" aria-hidden="true"><q-icon name="priority_high" size="17px" /></span>
      <span class="ms-name">{{ SECTION_TITLE }}</span>
      <span class="ms-count">{{ sectionCount(items.length) }}</span>
    </button>
    <template v-if="open">
      <p class="ms-help">{{ sectionHelp(memos.length, failed.length) }}</p>
      <template v-for="it in items" :key="it.id">
        <template v-if="it.memo">
          <MemoRow v-if="desktop" :memo="it.memo" :active="it.id === activeId" :show-rep="showRep" @open="$emit('open', it.id)" />
          <MemoCard
            v-else
            :memo="it.memo"
            :show-rep="showRep"
            :doing="doing[it.id]"
            :get-url="() => getUrl(it.id)"
            @assign="$emit('assign', it.id)"
            @create="$emit('create', it.id)"
            @retry="$emit('retry', it.id)"
            @delete="$emit('delete', it.id)"
          />
        </template>
        <FailedCard
          v-else-if="it.fail"
          :item="it.fail"
          :show-rep="showRep"
          :doing="doing[it.id]"
          :get-url="() => getUrl(it.id)"
          @retry="$emit('retryFailed', it.fail)"
          @delete="$emit('deleteFailed', it.fail)"
          @view="$emit('viewPhoto', it.id)"
        />
      </template>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import FailedCard from '@/components/memos/FailedCard.vue';
import MemoCard from '@/components/memos/MemoCard.vue';
import MemoRow from '@/components/memos/MemoRow.vue';
import type { FailedIntakeMessage, UnresolvedAudioMemo } from '@/types/review';
import { SECTION_TITLE, sectionCount, sectionHelp } from '@/utils/voiceMemos';

const props = defineProps<{
  memos: UnresolvedAudioMemo[];
  failed: FailedIntakeMessage[];
  // Laptop: an unmatched memo is a thin row that opens in the pane. Phone: a card.
  desktop: boolean;
  activeId: string | null;
  showRep: boolean;
  doing: Record<string, 'retry' | 'create' | 'delete' | 'assign' | undefined>;
  getUrl: (id: string) => Promise<string>;
}>();
defineEmits<{
  open: [id: string]; assign: [id: string]; create: [id: string]; retry: [id: string]; delete: [id: string];
  retryFailed: [item: FailedIntakeMessage]; deleteFailed: [item: FailedIntakeMessage]; viewPhoto: [id: string];
}>();

// Closed until asked for.
const open = ref(false);

interface Item { id: string; at: number; memo?: UnresolvedAudioMemo; fail?: FailedIntakeMessage }
const items = computed<Item[]>(() => [
  ...props.memos.map((memo) => ({ id: memo.id, at: Date.parse(memo.receivedAt), memo })),
  ...props.failed.map((fail) => ({ id: fail.id, at: Date.parse(fail.receivedAt), fail })),
].sort((a, b) => b.at - a.at));
</script>

<style scoped>
.ms { margin-bottom: 8px; }
.ms-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 44px;
  padding: 0 2px;
  border: 0;
  background: transparent;
  font: inherit;
  color: #1B2630;
  text-align: left;
  cursor: pointer;
}
.ms-head:focus-visible { outline: 2px solid #0067AC; outline-offset: 2px; border-radius: 6px; }
.ms-mark { flex: none; width: 26px; height: 26px; border-radius: 50%; background: #FFE0B2; color: #8A4B00; display: inline-flex; align-items: center; justify-content: center; }
.ms-name { font-size: 16px; font-weight: 500; }
.ms-count { padding: 2px 8px; border-radius: 10px; background: #FFE0B2; color: #8A4B00; font-size: 12px; font-weight: 500; }
.ms-help { margin: 0 2px 8px; font-size: 13px; color: #5B6670; }
</style>
