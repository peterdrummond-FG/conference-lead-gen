<template>
  <!-- A text conversation with our number, for the "Set up your phone" steps.
       The reply is what twilio-webhook really sends a rep who is already linked
       to a conference; a test checks the wording against that function. -->
  <div class="mt" role="img" :aria-label="label">
    <div class="mt-frame" aria-hidden="true">
      <div class="mt-notch" />
      <div class="mt-screen">
        <div class="mt-head">
          <q-icon name="chevron_left" size="22px" color="primary" />
          <div class="mt-head-mid">
            <div class="mt-avatar"><q-icon name="sms" size="16px" color="white" /></div>
            <div class="mt-head-num">{{ TWILIO_NUMBER_DISPLAY }}</div>
          </div>
          <span class="mt-head-gap" />
        </div>

        <div class="mt-thread">
          <template v-if="variant === 'setup'">
            <div class="mt-bubble mt-out">{{ SMS_MOCK.out }}</div>
            <div class="mt-bubble mt-in">{{ SMS_MOCK.replyPrefix }}{{ SMS_MOCK.conference }}{{ SMS_MOCK.replyRest }}</div>
          </template>
          <template v-else>
            <div class="mt-bubble mt-out mt-photo">
              <svg viewBox="0 0 120 76" class="mt-card-svg" focusable="false">
                <rect x="1" y="1" width="118" height="74" rx="7" fill="#fff" stroke="#C5D3DF" />
                <rect x="10" y="12" width="46" height="7" rx="3" fill="#0067AC" />
                <rect x="10" y="26" width="70" height="5" rx="2.5" fill="#C5D3DF" />
                <rect x="10" y="36" width="58" height="5" rx="2.5" fill="#C5D3DF" />
                <rect x="10" y="58" width="40" height="5" rx="2.5" fill="#DDE6EE" />
                <circle cx="96" cy="54" r="12" fill="#E6F1F9" />
              </svg>
            </div>
            <div class="mt-bubble mt-out mt-voice">
              <q-icon name="play_arrow" size="20px" />
              <span class="mt-wave">
                <i v-for="n in 16" :key="n" :style="{ height: `${6 + ((n * 7) % 13)}px` }" />
              </span>
              <span class="mt-len">{{ SMS_MOCK.voiceLength }}</span>
            </div>
          </template>
        </div>
      </div>
    </div>
    <p v-if="variant === 'media'" class="mt-caption">{{ SMS_MOCK.caption }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { SMS_MOCK } from '@/utils/onboardingTour';
import { TWILIO_NUMBER_DISPLAY } from '@/utils/smsNumber';

const props = defineProps<{ variant: 'setup' | 'media' }>();

const label = computed(() => (props.variant === 'setup'
  ? `Picture of a text message: you send ${SMS_MOCK.out}, and we reply that you're set up for your conference.`
  : 'Picture of a text message: you send a photo of a business card, then a voice note.'));
</script>

<style scoped>
.mt { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 4px 0; }
.mt-frame {
  width: 264px;
  padding: 10px 8px 12px;
  background: #1F2933;
  border-radius: 34px;
  box-shadow: 0 8px 24px rgba(15, 30, 50, 0.22);
}
.mt-notch { width: 64px; height: 6px; margin: 0 auto 8px; border-radius: 3px; background: #3E4C59; }
.mt-screen { min-height: 300px; background: #fff; border-radius: 26px; overflow: hidden; }

.mt-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 10px 8px; border-bottom: 1px solid #E4EAF0; background: #F6F8FA; }
.mt-head-mid { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.mt-head-gap { width: 22px; }
.mt-avatar { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: #9AA5B1; }
.mt-head-num { font-size: 11px; color: #3E4C59; }

.mt-thread { display: flex; flex-direction: column; gap: 8px; padding: 14px 12px 18px; }
.mt-bubble { max-width: 84%; padding: 8px 12px; border-radius: 18px; font-size: 13.5px; line-height: 1.35; }
.mt-out { align-self: flex-end; background: var(--q-primary); color: #fff; border-bottom-right-radius: 6px; font-weight: 500; }
.mt-in { align-self: flex-start; background: #E9EDF1; color: #1F2933; border-bottom-left-radius: 6px; }

.mt-photo { padding: 6px; }
.mt-card-svg { display: block; width: 148px; height: auto; border-radius: 12px; background: #F6F8FA; }
.mt-voice { display: flex; align-items: center; gap: 8px; padding: 8px 12px; }
.mt-wave { display: inline-flex; align-items: center; gap: 2px; height: 20px; }
.mt-wave i { display: block; width: 3px; border-radius: 2px; background: rgba(255, 255, 255, 0.85); }
.mt-len { font-size: 12px; opacity: 0.9; }

.mt-caption { margin: 0; max-width: 264px; text-align: center; font-size: 13px; color: #3F4A54; }
</style>
