<template>
  <!-- The photo behind a failed card. Fetched as bytes with the page's token and shown from a
       blob: URL (img-src allows blob:, not the Storage host), revoked when it closes. -->
  <q-dialog :model-value="!!photoId" @update:model-value="(v: boolean) => !v && $emit('close')" @hide="release">
    <q-card class="mpd">
      <q-card-section class="row items-center no-wrap q-pb-none">
        <div class="mpd-title">Photo</div>
        <q-space />
        <q-btn flat round dense icon="close" aria-label="Close" @click="$emit('close')" />
      </q-card-section>
      <q-card-section class="mpd-body">
        <q-spinner v-if="loading" size="32px" color="primary" />
        <div v-else-if="failed" class="mpd-fail">This photo is no longer available. Photos are deleted after 90 days.</div>
        <img v-else-if="url" :src="url" alt="The card photo that failed to process" class="mpd-img">
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{ photoId: string | null; load: (id: string) => Promise<Blob> }>();
defineEmits<{ close: [] }>();

const url = ref<string | null>(null);
const loading = ref(false);
const failed = ref(false);

function release() {
  if (url.value) URL.revokeObjectURL(url.value);
  url.value = null;
}

watch(() => props.photoId, async (id) => {
  release();
  failed.value = false;
  if (!id) return;
  loading.value = true;
  try {
    const blob = await props.load(id);
    // A different photo may have been asked for while this one loaded.
    if (props.photoId === id) url.value = URL.createObjectURL(blob);
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.mpd { width: 560px; max-width: calc(100vw - 32px); }
.mpd-title { font-size: 17px; font-weight: 500; }
.mpd-body { display: flex; justify-content: center; align-items: center; min-height: 160px; }
.mpd-img { max-width: 100%; max-height: 70vh; border-radius: 8px; }
.mpd-fail { font-size: 14px; color: #5B6670; text-align: center; }
</style>
