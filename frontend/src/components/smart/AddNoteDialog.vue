<template>
  <q-dialog :model-value="modelValue" @update:model-value="(v: boolean) => $emit('update:modelValue', v)" @show="onShow">
    <q-card class="an-card">
      <q-card-section>
        <div class="text-subtitle1">Add a note</div>
        <div v-if="name" class="text-caption text-grey-8">{{ name }}</div>
      </q-card-section>
      <q-card-section class="q-pt-none">
        <q-input
          ref="inputRef"
          v-model="text"
          type="textarea"
          outlined
          autogrow
          :maxlength="MAX_NEW_NOTE_LENGTH"
          counter
          placeholder="What happened? For example: left a voicemail, sending the proposal Friday."
          :error="!!error"
          :error-message="error"
          input-style="min-height: 88px"
          @update:model-value="error = ''"
          @keydown.enter.ctrl.prevent="save"
          @keydown.enter.meta.prevent="save"
        />
        <div class="text-caption text-grey-7 q-mt-xs">Saved right away, with today's date. Included in the Zoho import.</div>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat no-caps label="Cancel" class="an-btn" v-close-popup />
        <q-btn unelevated no-caps color="primary" label="Add note" class="an-btn" @click="save" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { MAX_NEW_NOTE_LENGTH } from '@/utils/reviewSmart';

defineProps<{ modelValue: boolean; name?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; save: [text: string] }>();

const text = ref('');
const error = ref('');
const inputRef = ref<{ focus: () => void } | null>(null);

// Reset every time it opens, so a note added to one lead never shows up
// pre-filled on the next.
function onShow() {
  text.value = '';
  error.value = '';
  inputRef.value?.focus();
}

function save() {
  if (!text.value.trim()) {
    error.value = 'Write a note first';
    return;
  }
  emit('save', text.value);
  emit('update:modelValue', false);
}
</script>

<style scoped>
.an-card { width: 460px; max-width: 94vw; }
.an-btn { min-height: 44px; }
</style>
