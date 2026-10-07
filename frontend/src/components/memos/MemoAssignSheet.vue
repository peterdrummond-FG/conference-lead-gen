<template>
  <!-- Phone: the bottom sheet Assign opens (the same shape a contact opens in). The full
       transcript first, so the rep can check it before attaching it, then the picker.
       Tapping a row only selects it; the button at the bottom does the attaching. -->
  <q-dialog :model-value="!!memo" position="bottom" full-width persistent @escape-key="$emit('close')">
    <q-card v-if="memo" class="mas">
      <div class="mas-grab" aria-hidden="true" />
      <div class="mas-head">
        <h2 class="mas-title">Assign to a contact</h2>
        <q-btn flat round dense icon="close" aria-label="Close" @click="$emit('close')" />
      </div>
      <div class="mas-body">
        <div class="mas-tx">{{ memo.transcript }}</div>
        <MemoAssignPicker v-model:selected="picked" :load="load" mode="radio" />
      </div>
      <div class="mas-foot">
        <q-btn
          unelevated no-caps color="primary" class="mas-go full-width"
          :label="picked ? `Add to ${picked.firstName || 'this contact'}'s notes` : 'Choose a contact'"
          :disable="!picked || saving"
          :loading="saving"
          @click="go"
        />
        <div class="mas-hint">{{ ASSIGN_HINT }}</div>
      </div>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import MemoAssignPicker from '@/components/memos/MemoAssignPicker.vue';
import type { LinkCandidateContact, UnresolvedAudioMemo } from '@/types/review';
import { ASSIGN_HINT, candidateName } from '@/utils/voiceMemos';

const props = defineProps<{ memo: UnresolvedAudioMemo | null; load: () => Promise<LinkCandidateContact[]>; saving?: boolean }>();
const emit = defineEmits<{ assign: [contactId: string, name: string]; close: [] }>();

const picked = ref<LinkCandidateContact | null>(null);
// A fresh choice every time a different memo opens; the picker itself remounts with the
// dialog, so its list is also fetched fresh.
watch(() => props.memo?.id, () => { picked.value = null; });

function go() {
  if (picked.value) emit('assign', picked.value.id, candidateName(picked.value));
}
</script>

<style scoped>
.mas { display: flex; flex-direction: column; max-height: 88vh; max-height: 88dvh; border-radius: 16px 16px 0 0; }
.mas-grab { width: 36px; height: 4px; margin: 8px auto 0; border-radius: 2px; background: #C9D1D8; }
.mas-head { display: flex; align-items: center; gap: 8px; padding: 4px 8px 8px 16px; border-bottom: 1px solid rgba(0, 0, 0, 0.08); }
.mas-title { flex: 1; margin: 0; font-size: 17px; font-weight: 500; }
.mas-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; }
.mas-tx { padding: 10px 12px; background: #F6F8FA; border-radius: 10px; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.mas-foot { padding: 10px 16px 14px; border-top: 1px solid rgba(0, 0, 0, 0.08); display: flex; flex-direction: column; gap: 6px; }
.mas-go { min-height: 48px; }
.mas-hint { font-size: 12px; color: #5B6670; text-align: center; }
</style>
