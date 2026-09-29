<template>
  <!-- Two artworks from one rep QR: the 16:9 slide (PowerPoint / booth iPad) and
       the 9:16 phone-screen code a rep holds up for someone to scan. Dense
       callers (list rows) get a dropdown so two buttons don't overflow a phone. -->
  <q-btn-dropdown
    v-if="dense"
    outline dense no-caps color="primary" class="q-px-sm" :icon="icon" :label="mobile ? 'Save QR' : 'Download QR'"
    :loading="busy !== null"
  >
    <q-list>
      <q-item v-close-popup clickable @click="save('slide')">
        <q-item-section>QR slide</q-item-section>
      </q-item>
      <q-item v-close-popup clickable @click="save('phone')">
        <q-item-section>QR code for phone screen</q-item-section>
      </q-item>
    </q-list>
  </q-btn-dropdown>

  <div v-else class="row q-gutter-sm">
    <q-btn
      outline no-caps color="primary" :icon="icon" :label="mobile ? 'Save QR slide' : 'Download QR slide'"
      :loading="busy === 'slide'" :disable="busy !== null" @click="save('slide')"
    />
    <q-btn
      outline no-caps color="primary" icon="smartphone" :label="mobile ? 'Save QR code' : 'Download QR code'"
      :loading="busy === 'phone'" :disable="busy !== null" @click="save('phone')"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Platform } from 'quasar';
import { downloadRepConnectSlide, type QrArtwork } from '@/utils/generateConnectSlide';

const props = defineProps<{
  rep: { name: string; repSlug: string };
  dense?: boolean;
}>();

const mobile = Platform.is.mobile === true;
const icon = mobile ? 'photo_library' : 'download';
const busy = ref<QrArtwork | null>(null);

async function save(kind: QrArtwork) {
  if (busy.value) return;
  busy.value = kind;
  try {
    await downloadRepConnectSlide(props.rep, kind);
  } finally {
    busy.value = null;
  }
}
</script>
