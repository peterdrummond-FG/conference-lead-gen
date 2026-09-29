<template>
  <q-btn flat round dense icon="more_vert" color="grey-8" aria-label="Review options">
    <q-menu auto-close anchor="bottom right" self="top right">
      <q-list dense style="min-width: 190px">
        <q-item-label header class="text-caption">View</q-item-label>
        <q-item v-for="opt in options" :key="opt.value" clickable @click="setView(opt.value)">
          <q-item-section avatar style="min-width: 32px">
            <q-icon v-if="view === opt.value" name="check" color="primary" size="18px" />
          </q-item-section>
          <q-item-section>
            <q-item-label>{{ opt.label }}</q-item-label>
            <q-item-label caption>{{ opt.hint }}</q-item-label>
          </q-item-section>
        </q-item>
      </q-list>
    </q-menu>
  </q-btn>
</template>

<script setup lang="ts">
import { useReviewView, type ReviewView } from '@/composables/useReviewView';

const { view, setView } = useReviewView();

const options: { value: ReviewView; label: string; hint: string }[] = [
  { value: 'smart', label: 'Smart', hint: 'Flags, one-tap approve, search' },
  { value: 'classic', label: 'Classic', hint: 'The original card grid' },
];
</script>
