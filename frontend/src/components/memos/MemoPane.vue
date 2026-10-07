<template>
  <!-- The laptop's right pane for a voice memo: where a contact's editor normally is.
       Player, the full transcript, who it is about (an existing contact) or a new
       person (Create contacts), with Retry matching and Delete in the footer. -->
  <div class="mp-pane">
    <header class="mp-head">
      <h2 class="mp-title">Voice memo</h2>
      <LeadChip :tone="state === 'review' ? 'orange' : 'blue'">{{ STATE_LABEL[state] }}</LeadChip>
      <span class="mp-when">{{ when }}<template v-if="who"> · {{ who }}</template></span>
    </header>

    <div class="mp-body">
      <MemoPlayer size="lg" :has-audio="memo.hasAudio" :get-url="getUrl" />

      <section>
        <div class="mp-lab">Transcript</div>
        <div class="mp-tx">{{ memo.transcript }}</div>
      </section>

      <p v-if="state === 'matching'" class="mp-hint">
        Still matching on its own (try {{ memo.linkAttempts }} of {{ AUTO_ATTEMPTS }}). You can step in now or wait.
      </p>

      <template v-if="state === 'creating'">
        <ProcessingBar caption="Reading memo. The people will appear in your list." label="Reading this voice memo" />
      </template>
      <template v-else>
        <section>
          <div class="mp-lab">Already one of your contacts?</div>
          <q-btn v-if="!finding" outline no-caps color="grey-8" icon="search" label="Find a contact" class="mp-find" :disable="busy" @click="finding = true" />
          <MemoAssignPicker v-else :load="load" mode="inline" :busy="busy" @assign="(c) => $emit('assign', c.id, candidateName(c))" />
        </section>

        <section class="mp-new">
          <q-icon name="person_add" size="26px" color="primary" aria-hidden="true" />
          <div class="mp-new-body">
            <div class="mp-new-title">New person?</div>
            <p class="mp-new-text">We'll find each person you spoke with and add them to your list to confirm. This usually takes under a minute.</p>
            <p v-if="note" class="mp-new-note">{{ note }}</p>
            <q-btn outline no-caps color="primary" icon="person_add" label="Create contacts" :disable="!canCreate(memo)" :loading="doing === 'create'" @click="$emit('create')" />
          </div>
        </section>
      </template>
    </div>

    <footer class="mp-foot">
      <template v-if="canRetry(memo)">
        <q-btn flat no-caps color="primary" icon="refresh" label="Retry matching" :loading="doing === 'retry'" @click="$emit('retry')" />
        <span class="mp-foot-hint">Looks again for who this is about</span>
      </template>
      <q-space />
      <q-btn flat no-caps color="negative" icon="delete_outline" label="Delete memo" :disable="busy" :loading="doing === 'delete'" @click="$emit('delete')" />
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import LeadChip from '@/components/contacts/LeadChip.vue';
import ProcessingBar from '@/components/contacts/ProcessingBar.vue';
import MemoAssignPicker from '@/components/memos/MemoAssignPicker.vue';
import MemoPlayer from '@/components/memos/MemoPlayer.vue';
import type { LinkCandidateContact, UnresolvedAudioMemo } from '@/types/review';
import { AUTO_ATTEMPTS, STATE_LABEL, candidateName, canCreate, canRetry, createNote, isBusy, memoState, memoTime } from '@/utils/voiceMemos';

const props = defineProps<{
  memo: UnresolvedAudioMemo;
  showRep?: boolean;
  doing?: 'retry' | 'create' | 'delete' | 'assign' | undefined;
  getUrl: () => Promise<string>;
  load: () => Promise<LinkCandidateContact[]>;
}>();
defineEmits<{ assign: [contactId: string, name: string]; create: []; retry: []; delete: [] }>();

const finding = ref(false);
const state = computed(() => memoState(props.memo));
const busy = computed(() => isBusy(props.memo) || !!props.doing);
const when = computed(() => memoTime(props.memo.receivedAt));
const who = computed(() => (props.showRep ? props.memo.repName : null));
const note = computed(() => createNote(props.memo));
</script>

<style scoped>
.mp-pane { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.mp-head { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 16px 20px 12px; border-bottom: 1px solid rgba(0, 0, 0, 0.08); }
.mp-title { margin: 0; font-size: 20px; font-weight: 500; }
.mp-when { margin-left: auto; font-size: 13px; color: #5B6670; }
.mp-body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 20px; display: flex; flex-direction: column; gap: 16px; }
.mp-lab { margin-bottom: 6px; font-size: 12px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; color: #5B6670; }
.mp-tx { padding: 12px 14px; background: #F6F8FA; border-radius: 10px; font-size: 15px; line-height: 1.55; overflow-wrap: anywhere; white-space: pre-wrap; }
.mp-hint { margin: 0; font-size: 13px; color: #5B6670; }
.mp-find { min-height: 44px; width: 100%; justify-content: flex-start; }
.mp-new { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border: 1px dashed rgba(0, 0, 0, 0.25); border-radius: 12px; }
.mp-new-body { min-width: 0; }
.mp-new-title { font-size: 15px; font-weight: 500; }
.mp-new-text { margin: 2px 0 10px; font-size: 13px; line-height: 1.45; color: #5B6670; }
.mp-new-note { margin: -4px 0 10px; font-size: 13px; color: #8A4B00; }
.mp-foot { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-top: 1px solid rgba(0, 0, 0, 0.08); }
.mp-foot-hint { font-size: 12px; color: #5B6670; }
</style>
