<template>
  <!-- Thin switch between the two Review views. Each view owns its own state
       and data loading, so flipping the menu re-mounts the other one rather
       than sharing half-loaded state between them. -->
  <ReviewSmart v-if="view === 'smart'" />
  <ReviewClassic v-else />
</template>

<script setup lang="ts">
import ReviewSmart from '@/pages/ReviewSmart.vue';
import ReviewClassic from '@/pages/ReviewClassic.vue';
import { useReviewView } from '@/composables/useReviewView';

const { view } = useReviewView();
</script>
