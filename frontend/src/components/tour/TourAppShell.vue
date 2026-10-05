<template>
  <!-- The app as it looks around any page: MainLayout's top bar, its phone
       menu, and the page underneath. Scenes put a page in the slot and switch
       it when the finger "navigates". Anything a page draws over the whole app
       (Review's edit panel, the QR code) goes in the overlay slot, so it covers
       the top bar the way the real dialogs do. -->
  <div class="tas">
    <TourAppBar :manager="manager" :active="active" :menu-open="menuOpen" @menu="$emit('menu')" @go="(p) => $emit('go', p)" />
    <div class="tas-page"><slot /></div>
    <slot name="overlay" />
  </div>
</template>

<script setup lang="ts">
import TourAppBar from './TourAppBar.vue';

defineProps<{ manager: boolean; active: string; menuOpen?: boolean }>();
defineEmits<{ menu: []; go: [page: string] }>();
</script>

<style scoped>
.tas { position: absolute; inset: 0; display: flex; flex-direction: column; background: #F5F7FA; font-size: 14px; }
.tas-page { flex: 1; min-height: 0; overflow: hidden; }
</style>
