<template>
  <!-- One line under the status bar while the rest of a long list is still arriving, or
       when it could not all be shown. Its words are in utils/contactsPaging.ts. The page
       draws nothing here once every contact is in, so a short list looks as it always did.
       Kinds: loading (info), failed (some pages did not arrive), too-many (over the ceiling). -->
  <div class="ls" :class="`ls-${kind}`" :role="kind === 'loading' ? 'status' : 'alert'" :aria-live="kind === 'loading' ? 'polite' : 'assertive'">
    <q-spinner v-if="kind === 'loading'" size="16px" color="primary" class="ls-ic" />
    <q-icon v-else name="error_outline" size="18px" class="ls-ic" />
    <span class="ls-text">{{ text }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { TOO_MANY_LINE, loadingLine } from '@/utils/contactsPaging';

const props = defineProps<{ kind: 'loading' | 'failed' | 'too-many'; loaded?: number; total?: number }>();

const text = computed(() => {
  if (props.kind === 'too-many') return TOO_MANY_LINE;
  if (props.kind === 'failed') return "Some contacts didn't load. Reload the page to try again.";
  return loadingLine(props.loaded ?? 0, props.total ?? 0);
});
</script>

<style scoped>
.ls { display: flex; align-items: center; gap: 8px; min-width: 0; margin: 0 0 8px; padding: 6px 10px; border-radius: 8px; font-size: 13px; line-height: 1.3; }
.ls-loading { background: #E8F1F8; color: #004F85; }
.ls-failed, .ls-too-many { background: #FBEAEA; color: #8C1D18; }
.ls-ic { flex: none; }
.ls-text { min-width: 0; overflow-wrap: anywhere; }
</style>
