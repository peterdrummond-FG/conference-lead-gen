<template>
  <!-- The laptop's voice memo: a thin amber row that opens in the right pane, the
       same way a contact's compact row does (the pane has the player, the full
       transcript and the four actions). It is one real button, like the contact row's
       identity block, so keyboard and screen readers get the same behaviour. -->
  <button type="button" class="mr" :class="{ 'is-active': active }" :aria-current="active ? 'true' : undefined" @click="$emit('open')">
    <span class="mr-r1">
      <span class="mr-ic" aria-hidden="true"><q-icon :name="memo.hasAudio ? 'mic' : 'mic_off'" size="18px" /></span>
      <span class="mr-meta">{{ when }} · <b>{{ STATE_LABEL[state] }}</b><template v-if="who"> · {{ who }}</template></span>
    </span>
    <span class="mr-text">{{ memo.transcript }}</span>
    <ProcessingBar v-if="state === 'creating'" caption="Reading memo…" label="Reading this voice memo" class="mr-proc" />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import ProcessingBar from '@/components/contacts/ProcessingBar.vue';
import type { UnresolvedAudioMemo } from '@/types/review';
import { STATE_LABEL, memoState, memoTime } from '@/utils/voiceMemos';

const props = defineProps<{ memo: UnresolvedAudioMemo; active?: boolean; showRep?: boolean }>();
defineEmits<{ open: [] }>();

const state = computed(() => memoState(props.memo));
const when = computed(() => memoTime(props.memo.receivedAt));
const who = computed(() => (props.showRep ? props.memo.repName : null));
</script>

<style scoped>
.mr {
  display: block;
  width: 100%;
  margin-bottom: 6px;
  padding: 8px 10px 10px;
  background: #FFF3E0;
  border: 1px solid #FFCC80;
  border-radius: 12px;
  font: inherit;
  color: #1B2630;
  text-align: left;
  cursor: pointer;
}
.mr:focus-visible { outline: 2px solid #0067AC; outline-offset: 2px; }
/* The open memo: the same blue outline an open contact row gets. */
.mr.is-active { outline: 2px solid #0067AC; outline-offset: -2px; background: #FFF0DA; }
.mr > span { display: block; }
.mr-r1 { display: flex !important; align-items: center; gap: 8px; min-width: 0; }
.mr-ic { flex: none; width: 28px; height: 28px; border-radius: 50%; background: #FFE0B2; color: #8A4B00; display: inline-flex !important; align-items: center; justify-content: center; }
.mr-meta { flex: 1; min-width: 0; font-size: 13px; color: #6B4A1F; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mr-meta b { font-weight: 500; color: #8A4B00; }
.mr-text {
  margin-top: 4px;
  font-size: 14px;
  line-height: 1.4;
  display: -webkit-box !important;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.mr-proc { margin-top: 8px; }
</style>
