<template>
  <!-- A photo that couldn't be read, or a memo that couldn't be transcribed: one thin card
       with every control on it, the same shape as MemoCard in soft red. Retry only where
       the system has given up (a card still "Retrying automatically" is being retried
       already). View photo / Play show the original so the rep can tell a blurry card
       from a bug before choosing Retry or Delete. -->
  <div class="fc" :class="{ 'is-busy': !!doing }" role="group" :aria-label="`${failedKind(item)} that failed, ${when}`">
    <div class="fc-r1">
      <MemoPlayer v-if="item.kind === 'audio'" size="sm" tone="red" :has-audio="item.hasMedia" :get-url="getUrl" />
      <span v-else class="fc-ic" aria-hidden="true"><q-icon name="photo_camera" size="20px" /></span>
      <span class="fc-meta">{{ when }} · <b>{{ failedState(item) }}</b><template v-if="who"> · {{ who }}</template></span>
      <q-btn
        flat round dense
        icon="delete_outline"
        color="negative"
        aria-label="Delete"
        class="fc-ico"
        :disable="!!doing"
        :loading="doing === 'delete'"
        @click="$emit('delete')"
      />
    </div>

    <div class="fc-text">{{ failedText(item) }}</div>

    <div v-if="retryable || (item.kind === 'photo' && item.hasMedia)" class="fc-actions">
      <q-btn v-if="retryable" unelevated no-caps no-wrap color="primary" label="Retry" class="fc-btn fc-retry" :disable="!!doing" :loading="doing === 'retry'" @click="$emit('retry')" />
      <q-btn v-if="item.kind === 'photo' && item.hasMedia" outline no-caps no-wrap color="primary" icon="image" label="View photo" class="fc-btn fc-view" @click="$emit('view')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import MemoPlayer from '@/components/memos/MemoPlayer.vue';
import type { FailedIntakeMessage } from '@/types/review';
import { canRetryFailed, failedKind, failedState, failedText, memoTime } from '@/utils/voiceMemos';

const props = defineProps<{
  item: FailedIntakeMessage;
  showRep?: boolean;
  doing?: 'retry' | 'create' | 'delete' | 'assign' | undefined;
  getUrl: () => Promise<string>;
}>();
defineEmits<{ retry: []; delete: []; view: [] }>();

const when = computed(() => memoTime(props.item.receivedAt));
const who = computed(() => (props.showRep ? props.item.repName : null));
const retryable = computed(() => canRetryFailed(props.item));
</script>

<style scoped>
.fc {
  margin-bottom: 8px;
  padding: 8px 10px 10px;
  background: #FDF0F0;
  border: 1px solid #F0B8B8;
  border-radius: 12px;
  color: #1B2630;
}
.fc.is-busy { opacity: 0.85; }
.fc-r1 { display: flex; align-items: center; gap: 8px; min-width: 0; }
.fc-ic { flex: none; width: 36px; height: 36px; border-radius: 50%; background: #F7D4D4; color: #8E2B2B; display: inline-flex; align-items: center; justify-content: center; }
.fc-meta { flex: 1; min-width: 0; font-size: 13px; line-height: 1.25; color: #6E3B3B; overflow-wrap: anywhere; }
.fc-meta b { font-weight: 500; color: #8E2B2B; }
.fc-ico { flex: none; }
.fc-text { margin-top: 4px; font-size: 14px; line-height: 1.4; overflow-wrap: anywhere; }
.fc-actions { display: flex; gap: 6px; margin-top: 8px; }
.fc-btn { min-height: 44px; padding: 0 12px; }
.fc-retry { flex: 0 0 auto; min-width: 88px; }
.fc-view { flex: 1 1 0; min-width: 0; background: #fff; }
</style>
