<template>
  <!-- A bottom sheet under 1024px, a dropdown panel under the Filter button on a
       laptop. Same content either way (ContactsFilterPanel); every choice applies as it
       is made, and "Show N contacts" is just the way out (with the count the list will
       have). -->
  <component
    :is="desktop ? QMenu : QDialog"
    v-bind="wrapperProps"
    :model-value="open"
    @update:model-value="(v: boolean) => (open = v)"
    @show="panelRef?.scrollToFocus()"
  >
    <ContactsFilterPanel
      ref="panelRef"
      v-model="model"
      :desktop="desktop"
      :is-sales="isSales"
      :home="home"
      :event-options="eventOptions"
      :source-options="sourceOptions"
      :rep-options="repOptions"
      :rejected-count="rejectedCount"
      :shown-count="shownCount"
      :focus-section="focusSection"
      @close="open = false"
    />
  </component>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { QDialog, QMenu } from 'quasar';
import ContactsFilterPanel from '@/components/ContactsFilterPanel.vue';
import type { ContactFilters, HomeConference, SourceKey } from '@/utils/contactsList';

const model = defineModel<ContactFilters>({ required: true });
const open = defineModel<boolean>('open', { default: false });

type Option<V> = { label: string; value: V };
const props = defineProps<{
  desktop: boolean;
  isSales: boolean;
  home: HomeConference;
  eventOptions: Option<string>[];
  sourceOptions: Option<SourceKey | null>[];
  repOptions: Option<string | null>[];
  rejectedCount: number;
  shownCount: number;
  focusSection?: 'conference' | null | undefined;
}>();

const panelRef = ref<InstanceType<typeof ContactsFilterPanel> | null>(null);

// A sheet on a phone, a menu on a laptop; the props differ, the content does not.
const wrapperProps = computed(() => (props.desktop
  ? { target: '#cf-filter-btn', anchor: 'bottom right', self: 'top right', offset: [0, 6], maxHeight: '80vh', noParentEvent: true }
  : { position: 'bottom', fullWidth: true, maxHeight: '94vh' }));
</script>
