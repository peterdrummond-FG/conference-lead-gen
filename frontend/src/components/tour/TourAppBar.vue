<template>
  <!-- The app's top bar and phone menu, inside a TourDevice: the app's own AppHeader
       and AppMenu with sample names, set to plain tabs (`active`) so nothing here
       can navigate the real app. The role decides which bar it is: an admin has the
       View as switcher, Solutions Success shows their name, a rep has the QR icon. -->
  <div class="tab-header">
    <AppHeader
      :role="role" :name="name" :is-phone="isPhone"
      :can-see-setup="true" :can-see-export="manager" :can-see-admin="manager"
      :has-qr="!manager" viewing-as-label="Myself (Admin)" :profiles="[]"
      :active="active || 'contacts'" @menu="$emit('menu')"
    />
  </div>

  <template v-if="isPhone">
    <div class="tab-scrim" :class="{ 'is-on': menuOpen }" />
    <div class="tab-drawer" :class="{ 'is-on': menuOpen }">
      <AppMenu :name="name" :can-see-setup="true" :can-see-export="manager" :can-see-admin="manager" :active="active" @go="(p) => $emit('go', p)" />
    </div>
  </template>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue';
import { useQuasar } from 'quasar';
import AppHeader from '@/components/AppHeader.vue';
import AppMenu from '@/components/AppMenu.vue';
import { TOUR_ROLE } from './tourRole';

const props = defineProps<{ manager: boolean; active: string; menuOpen?: boolean }>();
defineEmits<{ menu: []; go: [page: string] }>();

const $q = useQuasar();
// Same breakpoint as MainLayout's isPhone. The tour shows the layout of the
// device it is playing on, because that is the layout the rep will use.
const isPhone = computed(() => $q.screen.lt.sm);
const role = inject(TOUR_ROLE, computed(() => (props.manager ? 'solutionsSuccess' : 'sales')));
const name = computed(() => (props.manager ? 'Alex Morgan' : 'Jamie Cole'));
</script>

<style scoped>
.tab-header { background: #fff; color: #1d1d1d; border-bottom: 1px solid rgba(0, 0, 0, 0.08); position: relative; z-index: 2; }

/* The drawer as Quasar draws it (right side, 280 wide, over a scrim), placed
   inside the device instead of the real page. */
.tab-scrim { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.4); opacity: 0; transition: opacity 0.3s; z-index: 30; }
.tab-scrim.is-on { opacity: 1; }
.tab-drawer { position: absolute; top: 0; right: 0; bottom: 0; width: 280px; background: #fff; transform: translateX(100%); transition: transform 0.3s ease; z-index: 31; }
.tab-drawer.is-on { transform: none; }
</style>
