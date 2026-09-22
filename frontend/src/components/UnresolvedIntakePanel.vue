<template>
  <!-- Nothing to show is the common case — render nothing rather than an
       empty banner every time Review loads clean. -->
  <q-banner v-if="audio.length || failedIntake.length" dense class="bg-grey-2 q-mb-md unresolved-banner">
    <div class="row items-center q-gutter-sm">
      <q-icon name="warning" color="orange-8" size="20px" />
      <span class="text-weight-medium">
        {{ summaryText }}
      </span>
      <q-space />
      <q-btn flat dense no-caps size="sm" color="primary" :label="expanded ? 'Hide' : 'Show'" @click="expanded = !expanded" />
    </div>

    <div v-if="expanded" class="q-mt-sm">
      <div v-if="audio.length" class="q-mb-sm">
        <div class="text-caption text-grey q-mb-xs">
          Voice memos not yet linked to a contact — still being retried automatically unless marked "needs review".
        </div>
        <q-list bordered separator dense class="rounded-borders bg-white">
          <q-item v-for="m in audio" :key="m.id">
            <q-item-section>
              <q-item-label class="text-body2">{{ m.transcript || '(no transcript)' }}</q-item-label>
              <q-item-label caption>
                {{ formatWhen(m.receivedAt) }} · {{ m.fromPhone }}<template v-if="m.eventName"> · {{ m.eventName }}</template>
                · {{ m.linkAttempts }} attempt{{ m.linkAttempts === 1 ? '' : 's' }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-chip dense size="sm" class="tag-chip" :class="m.linkStatus === 'no_candidate_found' ? 'tone-red' : 'tone-orange'">
                {{ m.linkStatus === 'no_candidate_found' ? 'Needs review' : 'Still trying' }}
              </q-chip>
            </q-item-section>
          </q-item>
        </q-list>
      </div>

      <div v-if="failedIntake.length">
        <div class="text-caption text-grey q-mb-xs">
          Failed to process — a photo that couldn't be OCR'd or a memo that couldn't be transcribed.
        </div>
        <q-list bordered separator dense class="rounded-borders bg-white">
          <q-item v-for="m in failedIntake" :key="m.id">
            <q-item-section>
              <q-item-label class="text-body2">
                {{ m.kind === 'photo' ? 'Card photo' : 'Voice memo' }} — {{ m.error || 'unknown error' }}
              </q-item-label>
              <q-item-label caption>
                {{ formatWhen(m.receivedAt) }} · {{ m.fromPhone }}<template v-if="m.eventName"> · {{ m.eventName }}</template>
                · {{ m.processingAttempts }} attempt{{ m.processingAttempts === 1 ? '' : 's' }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <div class="row items-center q-gutter-xs">
                <q-chip dense size="sm" class="tag-chip" :class="m.errorClass === 'terminal' ? 'tone-red' : 'tone-orange'">
                  {{ m.errorClass === 'terminal' ? 'Needs manual retry' : 'Retrying automatically' }}
                </q-chip>
                <q-btn dense flat size="sm" color="primary" label="Retry" :loading="retrying[m.id]" @click="retry(m.id)" />
              </div>
            </q-item-section>
          </q-item>
        </q-list>
      </div>
    </div>
  </q-banner>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted, watch } from 'vue';
import { date } from 'quasar';
import { api } from '@/boot/axios';
import type { UnresolvedAudioMemo, FailedIntakeMessage } from '@/types/review';

// Optional — mirrors ReviewPage's own admin "view as" preview so this panel
// shows exactly what the previewed rep would see, same as the contacts
// grid already does.
const props = defineProps<{ viewAsRepId?: string | null }>();

const audio = ref<UnresolvedAudioMemo[]>([]);
const failedIntake = ref<FailedIntakeMessage[]>([]);
const expanded = ref(false);
const retrying = reactive<Record<string, boolean>>({});

const summaryText = computed(() => {
  const parts: string[] = [];
  if (audio.value.length) parts.push(`${audio.value.length} voice memo${audio.value.length === 1 ? '' : 's'} not yet linked`);
  if (failedIntake.value.length) parts.push(`${failedIntake.value.length} failed to process`);
  return parts.join(' · ');
});

function formatWhen(iso: string): string {
  return date.formatDate(iso, 'MMM D, h:mm A');
}

async function load() {
  const params: Record<string, string> = {};
  if (props.viewAsRepId) params.viewAsRepId = props.viewAsRepId;
  const { data } = await api.get<{ audio: UnresolvedAudioMemo[]; failedIntake: FailedIntakeMessage[] }>(
    '/inbound-messages-unresolved-list',
    { params },
  );
  audio.value = data.audio;
  failedIntake.value = data.failedIntake;
}

async function retry(id: string) {
  retrying[id] = true;
  try {
    await api.post('/inbound-messages-retry', undefined, { params: { id } });
    failedIntake.value = failedIntake.value.filter((m) => m.id !== id);
  } finally {
    retrying[id] = false;
  }
}

defineExpose({ load });
watch(() => props.viewAsRepId, load);
onMounted(load);
</script>

<style scoped>
.unresolved-banner {
  border-radius: 8px;
}

.tag-chip {
  font-weight: 500;
}

.tone-red {
  background: #FBEAEA;
  color: #B23B3B;
}

.tone-orange {
  background: #FDEEE3;
  color: #B35A00;
}
</style>
