<template>
  <!-- Photos that could not be read and memos that could not be transcribed. Nothing to
       show is the common case: render nothing rather than an empty banner every time
       Contacts loads clean. Voice memos that were transcribed but not matched to a
       contact are NOT here: they are the amber "Voice memos" section (MemoSection),
       with Assign / Create contacts / Retry / Delete on each. ContactsPage owns the
       data (useVoiceMemos) and hands it in. -->
  <q-banner v-if="items.length" dense class="bg-grey-2 q-mb-md unresolved-banner">
    <div class="row items-center q-gutter-sm">
      <q-icon name="warning" color="orange-8" size="20px" />
      <span class="text-weight-medium">{{ items.length }} failed to process</span>
      <q-space />
      <q-btn flat dense no-caps size="sm" color="primary" :label="expanded ? 'Hide' : 'Show'" :aria-expanded="expanded" @click="expanded = !expanded" />
    </div>

    <div v-if="expanded" class="q-mt-sm">
      <div class="text-caption text-grey q-mb-xs">
        A photo that couldn't be OCR'd or a memo that couldn't be transcribed.
      </div>
      <q-list bordered separator dense class="rounded-borders bg-white">
        <q-item v-for="m in items" :key="m.id">
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
              <q-btn dense flat size="sm" color="primary" label="Retry" :loading="retrying[m.id] === true" @click="$emit('retry', m.id)" />
            </div>
          </q-item-section>
        </q-item>
      </q-list>
    </div>
  </q-banner>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { date } from 'quasar';
import type { FailedIntakeMessage } from '@/types/review';

defineProps<{ items: FailedIntakeMessage[]; retrying: Record<string, boolean> }>();
defineEmits<{ retry: [id: string] }>();

const expanded = ref(false);

function formatWhen(iso: string): string {
  return date.formatDate(iso, 'MMM D, h:mm A');
}
</script>

<style scoped>
.unresolved-banner { border-radius: 8px; }
.tag-chip { font-weight: 500; }
.tone-red { background: #FBEAEA; color: #B23B3B; }
.tone-orange { background: #FDEEE3; color: #B35A00; }
</style>
