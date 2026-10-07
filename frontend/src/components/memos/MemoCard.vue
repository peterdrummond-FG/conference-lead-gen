<template>
  <!-- The phone's voice memo: one thin amber card with every control on it, nothing to
       open. Retry matching (only on Needs review) and Delete are icons on the top row
       so Assign and Create contacts keep full-width buttons at 320px. Amber is the
       "waiting on you" colour of the scans-need-a-conference banner; no left edge
       stripe, so it is never read as a contact's orange "Needs info". -->
  <div class="mc" :class="{ 'is-busy': busy }" role="group" :aria-label="`Voice memo, ${when}`">
    <div class="mc-r1">
      <MemoPlayer size="sm" :has-audio="memo.hasAudio" :get-url="getUrl" />
      <span class="mc-meta">{{ when }} · <b>{{ STATE_LABEL[state] }}</b><template v-if="who"> · {{ who }}</template></span>
      <q-btn
        v-if="canRetry(memo)"
        flat round dense
        icon="refresh"
        color="brown-6"
        aria-label="Retry matching"
        class="mc-ico"
        :loading="doing === 'retry'"
        @click="$emit('retry')"
      />
      <q-btn
        flat round dense
        icon="delete_outline"
        color="negative"
        aria-label="Delete voice memo"
        class="mc-ico"
        :disable="busy"
        :loading="doing === 'delete'"
        @click="$emit('delete')"
      />
    </div>

    <div class="mc-text">{{ memo.transcript }}</div>

    <ProcessingBar v-if="state === 'creating'" caption="Reading memo…" label="Reading this voice memo" class="mc-proc" />
    <template v-else>
      <div v-if="note" class="mc-note">{{ note }}</div>
      <div class="mc-actions">
        <q-btn unelevated no-caps no-wrap color="primary" label="Assign" class="mc-btn mc-assign" :disable="busy" @click="$emit('assign')" />
        <q-btn outline no-caps no-wrap color="primary" icon="person_add" label="Create contacts" class="mc-btn mc-create" :disable="!canCreate(memo)" :loading="doing === 'create'" @click="$emit('create')" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import MemoPlayer from '@/components/memos/MemoPlayer.vue';
import ProcessingBar from '@/components/contacts/ProcessingBar.vue';
import type { UnresolvedAudioMemo } from '@/types/review';
import { STATE_LABEL, canCreate, canRetry, createNote, isBusy, memoState, memoTime } from '@/utils/voiceMemos';

const props = defineProps<{
  memo: UnresolvedAudioMemo;
  // A manager's list names who sent it.
  showRep?: boolean;
  doing?: 'retry' | 'create' | 'delete' | 'assign' | undefined;
  getUrl: () => Promise<string>;
}>();
defineEmits<{ assign: []; create: []; retry: []; delete: [] }>();

const state = computed(() => memoState(props.memo));
const busy = computed(() => isBusy(props.memo) || !!props.doing);
const when = computed(() => memoTime(props.memo.receivedAt));
const who = computed(() => (props.showRep ? props.memo.repName : null));
const note = computed(() => createNote(props.memo));
</script>

<style scoped>
.mc {
  position: relative;
  margin-bottom: 8px;
  padding: 8px 10px 10px;
  background: #FFF3E0;
  border: 1px solid #FFCC80;
  border-radius: 12px;
  color: #1B2630;
}
.mc.is-busy { opacity: 0.85; }
.mc-r1 { display: flex; align-items: center; gap: 8px; min-width: 0; }
/* May wrap to two lines (an older memo also says its day): the state word is the one
   thing on this row that must never be cut off. */
.mc-meta { flex: 1; min-width: 0; font-size: 13px; line-height: 1.25; color: #6B4A1F; overflow-wrap: anywhere; }
.mc-meta b { font-weight: 500; color: #8A4B00; }
.mc-ico { flex: none; }
.mc-text {
  margin-top: 4px;
  font-size: 14px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.mc-note { margin-top: 6px; font-size: 13px; color: #6B4A1F; }
.mc-proc { margin-top: 10px; }
.mc-actions { display: flex; gap: 6px; margin-top: 8px; }
.mc-btn { min-height: 44px; padding: 0 12px; }
.mc-assign { flex: 0 0 auto; min-width: 88px; }
.mc-create { flex: 1 1 0; min-width: 0; background: #fff; }
</style>
