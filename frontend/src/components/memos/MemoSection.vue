<template>
  <!-- The "Voice memos" section at the top of Contacts: memos nobody could match to a
       contact. Nothing to show is the common case, so it renders nothing then. It
       folds away for a rep who is not dealing with them. The same section holds the
       phone's full cards and the laptop's thin rows (the page says which). -->
  <section v-if="memos.length" class="ms" aria-label="Voice memos not linked to a contact">
    <button type="button" class="ms-head" :aria-expanded="open" @click="open = !open">
      <q-icon :name="open ? 'expand_more' : 'chevron_right'" size="22px" />
      <span class="ms-mic" aria-hidden="true"><q-icon name="mic" size="17px" /></span>
      <span class="ms-name">Voice memos</span>
      <span class="ms-count">{{ sectionCount(memos.length) }}</span>
    </button>
    <template v-if="open">
      <p class="ms-help">{{ sectionHelp(memos.length) }}</p>
      <template v-for="m in memos" :key="m.id">
        <MemoRow v-if="desktop" :memo="m" :active="m.id === activeId" :show-rep="showRep" @open="$emit('open', m.id)" />
        <MemoCard
          v-else
          :memo="m"
          :show-rep="showRep"
          :doing="doing[m.id]"
          :get-url="() => getUrl(m.id)"
          @assign="$emit('assign', m.id)"
          @create="$emit('create', m.id)"
          @retry="$emit('retry', m.id)"
          @delete="$emit('delete', m.id)"
        />
      </template>
    </template>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import MemoCard from '@/components/memos/MemoCard.vue';
import MemoRow from '@/components/memos/MemoRow.vue';
import type { UnresolvedAudioMemo } from '@/types/review';
import { sectionCount, sectionHelp } from '@/utils/voiceMemos';

defineProps<{
  memos: UnresolvedAudioMemo[];
  // Laptop: thin rows that open in the pane. Phone: cards with the controls on them.
  desktop: boolean;
  activeId: string | null;
  showRep: boolean;
  doing: Record<string, 'retry' | 'create' | 'delete' | 'assign' | undefined>;
  getUrl: (id: string) => Promise<string>;
}>();
defineEmits<{ open: [id: string]; assign: [id: string]; create: [id: string]; retry: [id: string]; delete: [id: string] }>();

const open = ref(true);
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
.ms-mic { flex: none; width: 26px; height: 26px; border-radius: 50%; background: #FFE0B2; color: #8A4B00; display: inline-flex; align-items: center; justify-content: center; }
.ms-name { font-size: 16px; font-weight: 500; }
.ms-count { padding: 2px 8px; border-radius: 10px; background: #FFE0B2; color: #8A4B00; font-size: 12px; font-weight: 500; }
.ms-help { margin: 0 2px 8px; font-size: 13px; color: #5B6670; }
</style>
