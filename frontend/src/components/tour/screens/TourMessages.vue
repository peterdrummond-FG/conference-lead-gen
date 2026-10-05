<template>
  <!-- The phone's own texting app, talking to our number. This is the one
       screen in the tour that isn't ours, so it's drawn rather than rendered
       from app code. What OUR number says back is quoted from twilio-webhook
       (see SMS_REPLIES in tourSampleData.ts; a test keeps the two the same). -->
  <div class="tm">
    <div class="tm-head">
      <q-icon name="chevron_left" size="30px" class="tm-back" />
      <div class="tm-who">
        <div class="tm-avatar"><q-icon name="person" size="26px" /></div>
        <div class="tm-num">{{ TWILIO_NUMBER_DISPLAY }} <q-icon name="chevron_right" size="12px" /></div>
      </div>
    </div>

    <div class="tm-thread">
      <TransitionGroup name="tm-pop">
        <div v-for="m in messages" :key="m.id" class="tm-row" :class="m.from === 'me' ? 'is-me' : 'is-them'">
          <div v-if="m.kind === 'card'" class="tm-photo">
            <div class="tm-card">
              <div class="tm-card-stripe" />
              <div class="tm-card-name">{{ m.card?.name }}</div>
              <div class="tm-card-line">{{ m.card?.title }}</div>
              <div class="tm-card-line">{{ m.card?.org }}</div>
              <div class="tm-card-small">{{ m.card?.email }}</div>
              <div class="tm-card-small">{{ m.card?.phone }}</div>
            </div>
          </div>
          <div v-else-if="m.kind === 'voice'" class="tm-bubble tm-voice">
            <q-icon name="play_arrow" size="22px" />
            <span class="tm-wave"><i v-for="(h, i) in WAVE" :key="i" :style="{ height: `${h}px` }" /></span>
            <span>{{ m.text }}</span>
          </div>
          <div v-else-if="m.kind === 'typing'" class="tm-bubble tm-typing"><i /><i /><i /></div>
          <div v-else class="tm-bubble">{{ m.text }}</div>
        </div>
      </TransitionGroup>
    </div>

    <div class="tm-compose">
      <q-icon name="add_circle" size="30px" color="grey-6" />
      <div class="tm-field">
        <span v-if="draft" class="tm-draft">{{ draft }}</span>
        <span v-else class="tm-placeholder">Text Message</span>
        <span class="tm-send" :class="{ 'is-on': !!draft }" data-tt="send"><q-icon name="arrow_upward" size="18px" /></span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { TWILIO_NUMBER_DISPLAY } from '@/utils/smsNumber';
import type { TourText } from '../tourSampleData';

defineProps<{ messages: TourText[]; draft: string }>();

const WAVE = [8, 14, 20, 12, 18, 9, 16, 22, 11, 7, 15, 19, 10, 6];
</script>

<style scoped>
.tm { position: absolute; inset: 0; display: flex; flex-direction: column; background: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #111; }
.tm-head { position: relative; display: flex; justify-content: center; padding: 10px 12px 8px; background: #F6F6F8; border-bottom: 1px solid #E2E2E6; }
.tm-back { position: absolute; left: 4px; top: 18px; color: #0A84FF; }
.tm-who { display: flex; flex-direction: column; align-items: center; gap: 3px; }
.tm-avatar { width: 46px; height: 46px; border-radius: 50%; background: linear-gradient(#A9AEB8, #8E939D); color: #fff; display: grid; place-items: center; }
.tm-num { font-size: 12px; color: #111; }

.tm-thread { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end; padding: 10px 12px; gap: 6px; }
.tm-row { display: flex; flex: none; }
.tm-row.is-me { justify-content: flex-end; }
.tm-bubble { max-width: 78%; white-space: pre-line; overflow-wrap: anywhere; padding: 8px 13px; border-radius: 19px; font-size: 16px; line-height: 1.3; }
.is-me .tm-bubble { background: #0A84FF; color: #fff; border-bottom-right-radius: 6px; }
.is-them .tm-bubble { background: #E9E9EB; color: #111; border-bottom-left-radius: 6px; }

.tm-voice { display: flex; align-items: center; gap: 8px; }
.tm-wave { display: inline-flex; align-items: center; gap: 2px; }
.tm-wave i { width: 3px; border-radius: 2px; background: currentColor; opacity: 0.9; }
.tm-typing { display: flex; gap: 4px; padding: 12px 14px; }
.tm-typing i { width: 8px; height: 8px; border-radius: 50%; background: #8E8E93; animation: tm-blink 1.2s infinite; }
.tm-typing i:nth-child(2) { animation-delay: 0.2s; }
.tm-typing i:nth-child(3) { animation-delay: 0.4s; }
@keyframes tm-blink { 50% { opacity: 0.3; } }

/* A photo of a business card on a table, as a rep would snap it. */
.tm-photo { width: 200px; height: 136px; border-radius: 18px; background: linear-gradient(135deg, #CDBBA3, #B9A48A); display: grid; place-items: center; overflow: hidden; }
.tm-card { width: 168px; background: #fff; border-radius: 4px; padding: 10px 12px 9px; transform: rotate(-4deg); box-shadow: 0 3px 8px rgba(0, 0, 0, 0.3); position: relative; }
.tm-card-stripe { position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: #8B1E2D; border-radius: 4px 0 0 4px; }
.tm-card-name { font-size: 13px; font-weight: 700; color: #222; }
.tm-card-line { font-size: 10px; color: #444; }
.tm-card-small { font-size: 8.5px; color: #666; }

.tm-compose { display: flex; align-items: center; gap: 8px; padding: 8px 10px 14px; }
.tm-field { flex: 1; min-height: 36px; border: 1px solid #D1D1D6; border-radius: 18px; display: flex; align-items: center; padding: 4px 4px 4px 14px; font-size: 16px; }
.tm-draft { flex: 1; color: #111; }
.tm-placeholder { flex: 1; color: #A0A0A5; }
.tm-send { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: #C7C7CC; color: #fff; }
.tm-send.is-on { background: #0A84FF; }

.tm-pop-enter-active { transition: transform 0.3s ease, opacity 0.3s ease; }
.tm-pop-enter-from { transform: translateY(12px) scale(0.96); opacity: 0; }
.tm-pop-leave-active { display: none; }
</style>
