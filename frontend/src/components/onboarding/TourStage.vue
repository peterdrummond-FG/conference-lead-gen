<template>
  <div class="st-root">
    <!-- Same click-catcher as the spotlight: the page behind is not for using. -->
    <div class="st-blocker" @click.stop.prevent />
    <div class="st-dim" />

    <!-- A self-contained card. On a phone it is a bottom sheet: the picture takes
         the room above and scrolls if it must, while the words and buttons stay
         pinned where a thumb reaches them. On a larger screen the picture sits
         beside the words. Nothing here measures the page behind, so nothing
         can end up pointing at the wrong place. -->
    <div
      :key="step.id"
      class="st-panel"
      :class="{ 'st-phone': phone }"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      aria-describedby="tour-body"
    >
      <div class="st-visual">
        <component :is="visual.comp" v-bind="visual.props" />
      </div>
      <TourCard
        class="st-card"
        :step="step"
        :index="index"
        :total="total"
        :is-last="isLast"
        flat
        @skip="$emit('skip')"
        @back="$emit('back')"
        @next="$emit('next')"
        @skip-to="(id: string) => $emit('skipTo', id)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useQuasar } from 'quasar';
import TourCard from '@/components/onboarding/TourCard.vue';
import TourMockConnectForm from '@/components/onboarding/mocks/TourMockConnectForm.vue';
import TourMockSampleLead from '@/components/onboarding/mocks/TourMockSampleLead.vue';
import TourMockText from '@/components/onboarding/mocks/TourMockText.vue';
import type { TourStep, TourVisual } from '@/utils/onboardingTour';

const props = defineProps<{ step: TourStep; index: number; total: number; isLast: boolean }>();
defineEmits<{ skip: []; back: []; next: []; skipTo: [id: string] }>();

const $q = useQuasar();
const phone = computed(() => $q.screen.lt.sm);

const VISUALS: Record<TourVisual, { comp: unknown; props?: Record<string, unknown> }> = {
  'connect-form': { comp: TourMockConnectForm },
  'sms-setup': { comp: TourMockText, props: { variant: 'setup' } },
  'sms-media': { comp: TourMockText, props: { variant: 'media' } },
  'sample-lead': { comp: TourMockSampleLead },
};

const visual = computed(() => {
  const v = VISUALS[props.step.visual as TourVisual];
  return { comp: v.comp as never, props: v.props ?? {} };
});
</script>

<style scoped>
.st-root { position: fixed; inset: 0; }
.st-blocker { position: fixed; inset: 0; }
.st-dim { position: fixed; inset: 0; background: rgba(15, 30, 50, 0.62); pointer-events: none; }

.st-panel {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  width: min(780px, calc(100vw - 48px));
  max-height: calc(100dvh - 48px);
  background: #fff;
  border-radius: 20px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.32);
  overflow: hidden;
}
.st-visual {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  padding: 20px;
  overflow-y: auto;
  background: linear-gradient(180deg, #EAF3FA 0%, #F6F9FC 100%);
}
.st-card { align-self: center; overflow-y: auto; max-height: calc(100dvh - 48px); }

/* Phone: a bottom sheet, up to 92% of the screen. */
.st-panel.st-phone {
  left: 0;
  top: auto;
  right: 0;
  bottom: 0;
  transform: none;
  display: flex;
  flex-direction: column;
  width: auto;
  max-height: 92dvh;
  border-radius: 20px 20px 0 0;
  padding-bottom: env(safe-area-inset-bottom);
}
.st-phone .st-visual { flex: 1 1 auto; min-height: 0; align-items: flex-start; padding: 16px 16px 8px; }
.st-phone .st-card { flex: none; align-self: stretch; max-height: none; border-top: 1px solid #E4EAF0; }
</style>
