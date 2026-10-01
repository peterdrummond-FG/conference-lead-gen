<template>
  <q-page :class="[$q.screen.lt.sm ? 'q-pa-sm' : 'q-pa-lg', 'flex', 'flex-center']">
    <div style="width: 640px; max-width: 100%" class="q-gutter-md">
      <div>
        <div class="text-h5">Get ready for your conference</div>
        <div class="text-body2 text-grey-8 q-mt-xs">
          Pick your conference, connect your phone, and you're ready to collect leads.
        </div>
      </div>

      <!-- Previewing someone (admin "View as"): the cards below show THEIR Setup,
           from sessionStore.preview (me?viewAsId). This page used to hide the lot
           behind a notice, so an admin had no way to see what a rep sees here.
           The controls that write -- joining a conference, texting SETUP, the PIN
           -- act on the caller's own account whoever is on screen (session-store's
           viewingAs comment), so they're shown but switched off rather than left
           live next to someone else's name. Reads (Check connection, copying,
           saving the rep's own QR) stay on. -->
      <div v-if="previewing" class="text-caption text-grey-8">
        This is {{ sessionStore.viewingAs?.name }}'s Setup. Buttons that would change your own
        account are switched off.
      </div>

      <div v-if="previewing && !subject" class="text-caption text-grey-8">Loading…</div>

      <template v-else>
        <!-- Step 1: conference. A step is its own card with a number that turns into
             a green check when it's done, so a rep can see what's left and, coming
             back later, which one to tap to change. -->
        <q-card data-tour="setup-conference">
          <q-card-section>
            <div class="row items-center no-wrap">
              <q-avatar size="26px" :color="joinedEvent ? 'positive' : 'primary'" text-color="white" class="q-mr-sm">
                <q-icon v-if="joinedEvent" name="check" size="18px" />
                <template v-else>1</template>
              </q-avatar>
              <div class="col text-subtitle1 text-weight-medium">
                {{ joinedEvent ? 'Your conference' : 'Choose your conference' }}
              </div>
              <!-- Always offered once joined: this is now the only way to switch or to
                   activate one that isn't live yet (the separate "Start a new
                   conference" button is gone), and the dialog lists both. -->
              <q-btn v-if="joinedEvent" flat no-caps color="primary" label="Change" :disable="previewing" @click="picking = true" />
            </div>
          </q-card-section>

          <q-card-section class="q-pt-none">
            <div v-if="!eventsLoaded" class="text-caption text-grey-8">Loading…</div>

            <div v-else-if="joinedEvent">
              <div class="text-subtitle1">{{ cleanConferenceName(joinedEvent.name) }}</div>
              <div class="row items-center q-gutter-x-sm text-caption text-grey-8">
                <span>{{ conferenceWhen(joinedEvent) }}</span>
                <!-- The check stays: they're still connected, and leads sent for a
                     conference that ended two days ago still arrive. The chip is only
                     there so someone who's at the wrong conference notices. -->
                <q-badge class="text-no-wrap" v-if="endedLabel" color="orange-10" :label="endedLabel" />
              </div>
            </div>

            <!-- Joining is a real write, not a display choice: a rep's QR resolves its
                 conference from their own current_event_id (contacts-create), and
                 rejects the attendee's submission if that's empty. Seeing a
                 conference here (events-active falls back to the most recent one for
                 staff with none linked) is not the same as being linked to it, so
                 this always asks. -->
            <div v-else>
              <div class="text-body2 q-mb-sm">Pick the one you're at, so every lead lands in the right place.</div>
              <q-btn unelevated no-caps color="primary" label="Choose conference" :disable="previewing" @click="picking = true" />
            </div>
          </q-card-section>
        </q-card>

        <!-- Step 2: phone. Texting SETUP is self-contained (twilio-webhook finds or
             starts the conference by name and binds the phone itself), so none of the
             instructions or the disclosure depend on having joined a conference
             here. Only the status does (smsBound is per conference). -->
        <q-card data-tour="setup-text-in">
          <q-card-section>
            <div class="row items-center no-wrap">
              <q-avatar size="26px" :color="smsStatus === 'connected' ? 'positive' : 'primary'" text-color="white" class="q-mr-sm">
                <q-icon v-if="smsStatus === 'connected'" name="check" size="18px" />
                <template v-else>2</template>
              </q-avatar>
              <div class="col text-subtitle1 text-weight-medium">Set up your phone</div>
              <!-- role=status so a screen reader hears it when Check connection (or
                   coming back from Messages) flips it, without moving focus. -->
              <span role="status" aria-atomic="true">
                <q-badge class="text-no-wrap" v-if="smsStatus === 'connected'" color="positive" label="Connected" />
                <q-badge class="text-no-wrap" v-else-if="smsStatus === 'pending'" color="orange-10" label="Not connected" />
                <q-badge class="text-no-wrap" v-else-if="smsStatus === 'no-phone'" color="grey-7" label="Phone number needed" />
              </span>
            </div>
          </q-card-section>

          <q-card-section class="q-pt-none">
            <!-- Three groups split by hairlines (who you are, what you can send, where
                 to send it), so the card reads as a sequence instead of one block of
                 text. The numbers sit on their own line with no-wrap: at 320px
                 the text-in number used to break after its area code. -->
            <q-separator class="q-mb-md" />

            <!-- The number on file, where a wrong one can be caught before it's
                 texted from: reps can't change their own (a deliberate limit), so the
                 ? says who can. A popup, not a tooltip, because tooltips don't open
                 on a phone. -->
            <div v-if="phoneOnFile">
              <div class="text-caption text-grey-8">Your number</div>
              <div class="row items-center no-wrap">
                <span class="text-subtitle1 text-weight-bold text-no-wrap">{{ phoneOnFile }}</span>
                <q-btn flat round icon="help_outline" color="grey-7" aria-label="Wrong number?">
                  <q-popup-proxy>
                    <div class="q-pa-md setup-popup">
                      Wrong number? Contact your Solutions Success rep and they'll fix it.
                    </div>
                  </q-popup-proxy>
                </q-btn>
              </div>
            </div>
            <div v-else-if="smsStatus === 'no-phone'" class="text-body2 text-orange-10">
              Your account has no phone number yet, so texted cards can't be credited to you. Ask
              your Solutions Success rep to add yours.
            </div>

            <q-separator class="q-my-md" />

            <div class="text-subtitle2 text-weight-bold">We'll turn anything into a contact</div>
            <div class="column q-gutter-y-md q-mt-xs text-body2">
              <div class="row items-center no-wrap">
                <span class="setup-tile q-mr-md"><q-icon name="photo_camera" size="20px" /></span>
                <span class="col">Photograph a business card, conference ID or contact list</span>
              </div>
              <div class="row items-center no-wrap">
                <span class="setup-tile q-mr-md"><q-icon name="mic" size="20px" /></span>
                <span class="col">Send a voice memo</span>
              </div>
              <div class="row items-center no-wrap">
                <span class="setup-tile q-mr-md"><q-icon name="sms" size="20px" /></span>
                <span class="col">Text the info yourself</span>
                <q-btn flat round icon="info_outline" color="grey-7" aria-label="Texting tip">
                  <q-popup-proxy>
                    <div class="q-pa-md setup-popup">
                      Due to character limits, text one contact per message for best results.
                    </div>
                  </q-popup-proxy>
                </q-btn>
              </div>
            </div>

            <q-separator class="q-my-md" />

            <div v-if="!joinedEvent" class="text-caption text-grey-8 q-mb-sm">
              Your connection status shows here once you've chosen a conference.
            </div>
            <!-- Joined, but eventStore.activeEvent hasn't caught up yet (a moment after
                 joining or switching). Without this, smsStatus null would fall through
                 to the "not connected" action below for a conference whose status
                 simply isn't known yet. -->
            <div v-else-if="smsStatus === null" class="text-caption text-grey-8 q-mb-sm">Checking…</div>

            <div v-if="smsStatus === 'connected'">
              <div class="text-caption text-grey-8">Text photos and voice memos to</div>
              <div class="setup-numberbox row items-center no-wrap q-mt-xs">
                <span class="col text-h6 text-weight-bold text-no-wrap">{{ twilioNumber }}</span>
                <q-btn flat round icon="content_copy" color="primary" aria-label="Copy the number" @click="copy(twilioNumber, 'Number copied.')" />
              </div>
            </div>
            <div v-else>
              <!-- sms: only opens a composer on a phone; on a laptop the number and
                   keyword are spelled out instead. -->
              <q-btn
                v-if="isMobile"
                unelevated class="full-width" color="primary" no-caps icon="sms" label="Text the code SETUP"
                :href="previewing ? undefined : `sms:${twilioNumberE164}?&body=SETUP`"
                :disable="previewing"
              />
              <div v-else class="text-body2">
                From your phone, text the code <span class="text-weight-bold">SETUP</span> to
                <span class="text-weight-bold text-no-wrap">{{ twilioNumber }}</span>.
              </div>
              <div class="row items-center no-wrap q-mt-xs">
                <q-btn
                  flat no-caps color="primary" icon="refresh" label="Check connection"
                  class="q-px-sm" :loading="checking" @click="checkConnection"
                />
                <q-space />
                <q-btn flat round icon="content_copy" color="primary" aria-label="Copy SETUP" @click="copy('SETUP', 'Copied SETUP.')" />
              </div>
            </div>

            <!-- Consent disclosure: always visible, directly under the action that gives
                 consent (it has to be on the same screen as the sign-up -- a campaign
                 was rejected four times over this), never collapsed. It covers texting
                 SETUP and texting the folder code alike -- hence "the code SETUP" in
                 the action above. -->
            <div class="text-caption text-grey-8 q-mt-md">
              By texting this code, you agree to receive recurring automated text messages from
              Flippen Group related to conference lead capture. Msg&amp;data rates may apply. Msg
              frequency varies. Reply HELP for help, STOP to cancel.
            </div>
          </q-card-section>
        </q-card>

        <!-- Step 3: kiosk. The PIN belongs to the login, so it's available before
             joining anything: reps can set up a booth iPad ahead of the event. -->
        <q-card>
          <q-card-section>
            <div class="row items-center no-wrap">
              <q-avatar size="26px" :color="subject?.hasKioskPin ? 'positive' : 'primary'" text-color="white" class="q-mr-sm">
                <q-icon v-if="subject?.hasKioskPin" name="check" size="18px" />
                <template v-else>3</template>
              </q-avatar>
              <div class="col text-subtitle1 text-weight-medium">Kiosk setup</div>
              <q-badge class="text-no-wrap" v-if="subject?.hasKioskPin" color="positive" label="PIN set" />
              <q-badge class="text-no-wrap" v-else color="grey-7" label="PIN not set" />
            </div>
          </q-card-section>
          <q-card-section class="q-pt-none">
            <div class="text-body2 text-grey-8">
              Lock a shared device to the sign-up form. You unlock it with a PIN of your own, separate
              from your password.
            </div>
            <q-btn
              outline no-caps color="primary" class="q-mt-sm"
              :label="subject?.hasKioskPin ? 'Change PIN' : 'Set PIN'"
              :disable="previewing"
              @click="promptKioskPin"
            />
            <div class="text-caption text-grey-8 q-mt-xs">When you're ready, open the Kiosk tab and tap Lock kiosk.</div>
          </q-card-section>
        </q-card>

        <!-- Your QR code: a resource, not a step. No number and no check, so the page
             doesn't read as finished at the point a rep still has nothing to do.
             Available before joining (the code is the rep's own and reusable), but
             it only works once they're linked to a conference. Sales accounts only:
             repSlug is only ever generated for them (profiles-create/-update). -->
        <q-card v-if="subject?.repSlug" data-tour="setup-qr">
          <q-card-section>
            <div class="row items-start no-wrap">
              <q-icon name="qr_code_2" size="28px" color="primary" class="q-mr-md" />
              <div class="col">
                <div class="text-subtitle1 text-weight-medium">Your QR code</div>
                <div class="text-body2 text-grey-8">Your QR is unique to you and works at any conference.</div>
                <!-- Says where a scan goes *right now*, and is true when nothing is
                     chosen: contacts-create answers 409 for a rep with no conference,
                     it doesn't file the lead under the previous one. -->
                <div v-if="joinedEvent" class="text-body2 q-mt-xs">
                  Right now, contacts who scan it are attached to
                  <span class="text-weight-bold">{{ cleanConferenceName(joinedEvent.name) }}</span>.
                </div>
                <div v-else class="text-body2 text-orange-10 q-mt-xs">
                  Choose a conference first. Scans won't go through until you do.
                </div>
                <qr-save-buttons
                  :rep="{ name: subject.name, repSlug: subject.repSlug }" class="q-mt-sm"
                />
              </div>
            </div>
          </q-card-section>
        </q-card>

        <!-- Admin and Solutions Success: they hold no QR of their own but are who
             sends each rep theirs, so the reps' slides are listed here (and per rep
             in Admin -> Team). Nothing here depends on a conference. -->
        <q-card v-if="canManageEvents" data-tour="setup-qr">
          <q-card-section>
            <div class="row items-start no-wrap">
              <q-icon name="qr_code_2" size="28px" color="primary" class="q-mr-md" />
              <div class="col">
                <div class="text-subtitle1 text-weight-medium">Rep QR slides</div>
                <div class="text-body2 text-grey-8">
                  Every Sales rep has a reusable QR slide. Download one to send it to them, as a slide or a phone-screen code. It only
                  works once they've joined a conference.
                </div>
                <q-list v-if="salesReps.length" dense separator class="q-mt-sm">
                  <q-item v-for="rep in salesReps" :key="rep.id" class="q-px-none">
                    <q-item-section>
                      <q-item-label>{{ rep.name }}</q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <qr-save-buttons :rep="{ name: rep.name, repSlug: rep.repSlug! }" dense />
                    </q-item-section>
                  </q-item>
                </q-list>
                <div v-else class="text-body2 q-mt-sm">
                  No Sales reps yet. Add one in
                  <router-link to="/admin" class="text-primary">Admin</router-link>.
                </div>
              </div>
            </div>
          </q-card-section>
        </q-card>

        <!-- Once a conference is joined there was no "you're done here" moment, so a
             rep finished the page not knowing where to go next. -->
        <q-card v-if="joinedEvent">
          <q-card-section>
            <div class="row items-center no-wrap">
              <q-icon name="check_circle" color="positive" size="24px" class="q-mr-sm" />
              <div class="text-subtitle1 text-weight-medium">You're ready to capture leads</div>
            </div>
            <div class="text-body2 text-grey-8 q-mt-xs">
              Everything you capture shows up in Review a few minutes later.
            </div>
            <div class="row q-gutter-sm q-mt-sm">
              <q-btn unelevated no-caps color="primary" icon="checklist" label="Go to Review" to="/review" class="col-12 col-sm-auto" />
              <q-btn outline no-caps color="primary" icon="tablet_mac" label="Open the sign-up form" to="/connect" class="col-12 col-sm-auto" />
            </div>
          </q-card-section>
        </q-card>
      </template>

      <StartConferenceDialog v-model="picking" @started="onStarted" />
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { Dialog, Notify, Platform, copyToClipboard } from 'quasar';
import { api } from '@/boot/axios';
import { useEventStore } from '@/stores/event-store';
import { TWILIO_NUMBER_DISPLAY, TWILIO_NUMBER_E164 } from '@/utils/smsNumber';
import { useSessionStore, type PreviewUser, type SessionUser } from '@/stores/session-store';
import StartConferenceDialog from '@/components/StartConferenceDialog.vue';
import QrSaveButtons from '@/components/QrSaveButtons.vue';
import { cleanConferenceName, conferenceDateLabel, conferenceEndedLabel, formatPhone } from '@/utils/conferenceName';
import type { Profile } from '@/types/review';

interface ActiveEventOption {
  id: string;
  name: string;
  slug: string;
  state: string;
  activatedAt: string;
  // Read from the campaign name by events-list-active; null when the name has no
  // date (test conferences).
  startsOn: string | null;
  endsOn: string | null;
}

// The number lives in utils/smsNumber.ts so the welcome tour quotes the same one.
const twilioNumber = TWILIO_NUMBER_DISPLAY;
const twilioNumberE164 = TWILIO_NUMBER_E164;
// sms: opens a composer on a phone and does nothing useful on a laptop, so
// the "Text SETUP" button is phone-only and desktop gets the number spelled out.
const isMobile = Platform.is.mobile === true;

const eventStore = useEventStore();
const sessionStore = useSessionStore();
// Whether the conference dialog is open. It is both "Choose" and "Change": it
// lists live conferences (Join) and upcoming ones (Activate) in one place.
const picking = ref(false);
// Distinguishes "still fetching" from "genuinely none running" -- without it
// Step 1 flashes "Choose your conference" on every page load.
const eventsLoaded = ref(false);
// A Check connection tap in flight.
const checking = ref(false);

// effectiveRole (not sessionStore.user?.role) so admin's "View as" preview
// (MainLayout's switcher) reshapes this page into what the previewed role
// would see. Purely a display change: every write here is still gated
// server-side by the real caller's own JWT.
// Admin/solutionsSuccess extras on Setup (the Rep QR slides list). Activating a
// conference is open to every role -- see StartConferenceDialog.
// Admin "View as": whose Setup is on screen. subject is that person's own facts
// (sessionStore.preview) or the caller's; null only while a preview loads.
const previewing = computed(() => !!sessionStore.viewingAs);
const subject = computed<PreviewUser | SessionUser | null>(() => (previewing.value ? sessionStore.preview : sessionStore.user));

const canManageEvents = computed(() => (
  sessionStore.effectiveRole === 'admin' || sessionStore.effectiveRole === 'solutionsSuccess'
));

// Every currently-active conference (not just this login's own). Setup only
// needs it to find the one this login is linked to and read its dates.
const activeEvents = ref<ActiveEventOption[]>([]);

// The conference this login is actually linked to (profiles.current_event_id),
// as opposed to eventStore.activeEvent, which for staff with no link falls
// back to the most recently activated one (events-active's legacy fallback).
// Step 1 keys off this so "joined" never means "happened to be displayed".
const joinedEvent = computed(() => (
  activeEvents.value.find((e) => e.id === subject.value?.currentEventId) ?? null
));
// eventStore.activeEvent, but only once it's confirmed to be the joined one --
// it carries smsBound, which is only meaningful for that event and lags a
// moment behind a join/switch until fetchActive() returns.
const linkedEvent = computed(() => (
  joinedEvent.value && eventStore.activeEvent?.id === joinedEvent.value.id ? eventStore.activeEvent : null
));

// smsBound is undefined only when the caller's profile has no phone number
// (events-active can't look up a phone_event_bindings row without one), so
// that -- not "false" -- is the "no phone number" state. Null until
// linkedEvent has caught up, so no badge flashes wrongly in the meantime.
const smsStatus = computed<'connected' | 'pending' | 'no-phone' | null>(() => {
  // Previewing: the same three states, from the previewed person's own phone
  // binding (me?viewAsId), not eventStore, which only ever describes the caller.
  if (previewing.value) {
    const p = sessionStore.preview;
    if (!joinedEvent.value || !p) return null;
    if (!p.phoneNumber) return 'no-phone';
    return p.smsBound ? 'connected' : 'pending';
  }
  if (!linkedEvent.value) return null;
  if (linkedEvent.value.smsBound === undefined) return 'no-phone';
  return linkedEvent.value.smsBound ? 'connected' : 'pending';
});

// The number texted cards are credited to, for the rep to sanity-check.
const phoneOnFile = computed(() => formatPhone(subject.value?.phoneNumber));

// "Sep 30 to Oct 2 · IL"; just the state for a name with no date.
function conferenceWhen(e: ActiveEventOption): string {
  return [conferenceDateLabel(e.startsOn, e.endsOn), e.state].filter(Boolean).join(' · ');
}
const endedLabel = computed(() => conferenceEndedLabel(joinedEvent.value?.endsOn ?? null));

// Any logged-in role can call events-list-active (see its own header
// comment).
async function loadActiveEvents() {
  try {
    const { data } = await api.get<ActiveEventOption[]>('/events-list-active');
    activeEvents.value = data;
  } finally {
    eventsLoaded.value = true;
  }
}

// The dialog joined a live conference or activated one (events-activate also links
// the caller to it), so Step 1 flips to "joined" -- but only if the session, the
// active list and eventStore.activeEvent (smsBound) are all refreshed; a
// fetchActive alone left Step 1 asking them to join something they'd just created.
async function onStarted(payload: { joined: boolean; name: string }) {
  await Promise.all([sessionStore.fetchMe(), eventStore.fetchActive(), loadActiveEvents()]);
  Notify.create({
    type: 'positive',
    message: payload.joined ? `You're now at ${payload.name}.` : `Started ${payload.name}. You're now at it.`,
  });
}

// A rep who texts SETUP lands back here to find the status unchanged until the
// page is reloaded; this is the button for that, and it also runs whenever the
// tab comes back to the front (returning from Messages).
async function checkConnection() {
  checking.value = true;
  try {
    if (previewing.value) {
      await sessionStore.fetchPreview();
      return;
    }
    await Promise.all([sessionStore.fetchMe(), eventStore.fetchActive()]);
  } finally {
    checking.value = false;
  }
}
function onVisible() {
  if (document.visibilityState === 'visible' && !previewing.value && joinedEvent.value && smsStatus.value !== 'connected') {
    void eventStore.fetchActive();
  }
}

async function copy(text: string, message: string) {
  try {
    await copyToClipboard(text);
    Notify.create({ type: 'positive', message, timeout: 1500 });
  } catch {
    Notify.create({ type: 'negative', message: `Couldn't copy. Type ${text} instead.` });
  }
}

// Admin / Solutions Success don't have a QR of their own (only Sales accounts
// get a rep_slug), but they're who gets each rep theirs to send -- so Setup
// lists the Sales reps with a download each, instead of leaving them to know
// it lives in Admin -> Team. profiles-list is staff-only, so it's only fetched
// for them.
const profiles = ref<Profile[]>([]);
const salesReps = computed(() => profiles.value.filter((p) => p.role === 'sales' && p.repSlug));

async function loadProfiles() {
  const { data } = await api.get<Profile[]>('/profiles-list');
  profiles.value = data;
}

// Setting a PIN is also offered by the Kiosk page's Lock kiosk button, but only
// when the user has never set one -- this is the only place to *change* an
// existing PIN, which is why the Kiosk setup card keeps a button for it.
function promptKioskPin() {
  Dialog.create({
    title: subject.value?.hasKioskPin ? 'Change your kiosk PIN' : 'Set your kiosk PIN',
    message: "You'll unlock a locked device with this. It's separate from your login password. At least 4 characters.",
    prompt: { model: '', type: 'text', isValid: (v: string) => v.length >= 4 },
    cancel: true,
    persistent: true,
  }).onOk((code: string) => { void saveKioskPin(code); });
}

async function saveKioskPin(code: string) {
  await api.post('/kiosk-set-code', { code });
  if (sessionStore.user) sessionStore.user.hasKioskPin = true;
  Notify.create({ type: 'positive', message: 'Kiosk PIN saved.' });
}

onMounted(() => {
  void eventStore.fetchActive();
  void loadActiveEvents();
  document.addEventListener('visibilitychange', onVisible);
});
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible));

// A watch, not an onMounted check: an admin can flip "View as" while this page
// is open, and canManageEvents (effectiveRole) changes under it.
watch(canManageEvents, (staff) => { if (staff) void loadProfiles(); }, { immediate: true });
</script>

<style scoped>
/* q-popup-proxy opens as a bare q-dialog on a phone, and a q-dialog paints no
   background of its own: the "Wrong number?" and "Texting tip" text floated
   straight over the dimmed page, nearly invisible. On a laptop it is a q-menu,
   which does paint white, so this was only ever seen on a phone. Any new
   popup-proxy content needs a background of its own for the same reason. */
.setup-tile {
  flex: none;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: #E8F1F9;
  color: #0067AC;
}
.setup-numberbox {
  background: #F4F6F9;
  border-radius: 10px;
  padding: 4px 4px 4px 12px;
}
.setup-popup {
  max-width: 260px;
  background: #fff;
  color: #1B2630;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
}
</style>
