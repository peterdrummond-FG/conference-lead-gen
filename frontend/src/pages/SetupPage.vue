<template>
  <q-page :class="[$q.screen.lt.sm ? 'q-pa-sm' : 'q-pa-lg', 'flex', 'flex-center']">
    <div style="width: 640px; max-width: 100%" class="q-gutter-md">
      <div>
        <div class="text-h5">Get ready for your conference</div>
        <div class="text-body2 text-grey-8 q-mt-xs">
          Two steps, once per conference. Everything you capture shows up in Review a few
          minutes later, already checked against Zoho.
        </div>
      </div>

      <!-- Every control in the two steps below writes to the real caller's own
           profile (profiles-set-current-event, kiosk-set-code, their own QR),
           never the previewed user's -- session-store.ts's viewingAs comment.
           Rendering them under someone else's name would show that person's
           conference next to buttons that change the admin's own account, so
           the whole personal section is swapped for this notice instead. -->
      <q-banner v-if="sessionStore.viewingAs" rounded class="bg-grey-2 text-grey-9">
        You're previewing {{ sessionStore.viewingAs.name }}. Joining a conference, downloading a QR
        code, and setting a PIN always act on your own account, so they're hidden here.
      </q-banner>

      <template v-else>
        <!-- Step 1 -->
        <q-card data-tour="setup-conference">
          <q-card-section>
            <div class="row items-center no-wrap">
              <q-avatar size="26px" :color="joinedEvent ? 'positive' : 'primary'" text-color="white" class="q-mr-sm">
                <q-icon v-if="joinedEvent" name="check" size="18px" />
                <template v-else>1</template>
              </q-avatar>
              <div class="text-subtitle1 text-weight-medium">Your conference</div>
            </div>
          </q-card-section>

          <q-card-section class="q-pt-none">
            <div v-if="!eventsLoaded" class="text-caption text-grey-8">Loading…</div>

            <template v-else-if="joinedEvent && !changing">
              <div class="row items-center no-wrap">
                <div class="col">
                  <div class="text-subtitle1">{{ joinedEvent.name }}</div>
                  <div class="text-caption text-grey-8">
                    {{ joinedEvent.state }} · started {{ formatRelativeTime(joinedEvent.activatedAt) }}
                  </div>
                </div>
                <!-- Only offered when there's actually something else to pick;
                     with one live conference "Change" would open a list
                     containing just the one you're already in. -->
                <q-btn v-if="activeEvents.length > 1" flat no-caps color="primary" label="Change" @click="changing = true" />
              </div>
            </template>

            <!-- Joining is a real write, not a display choice: a rep's QR
                 resolves its conference from their own current_event_id
                 (contacts-create), and rejects the attendee's submission if
                 that's empty. Seeing a conference here (events-active falls
                 back to the most recent one for staff with none linked) is
                 not the same as being linked to it, so this always asks. -->
            <template v-else-if="activeEvents.length">
              <div class="text-body2 q-mb-sm">
                {{ joinedEvent
                  ? 'Switch to a different conference:'
                  : "Join the conference you're at. Attendee scans and texted cards are credited to it." }}
              </div>
              <q-list bordered separator class="rounded-borders">
                <q-item v-for="e in activeEvents" :key="e.id">
                  <q-item-section>
                    <q-item-label>{{ e.name }}</q-item-label>
                    <q-item-label caption>{{ e.state }} · started {{ formatRelativeTime(e.activatedAt) }}</q-item-label>
                  </q-item-section>
                  <q-item-section side>
                    <q-icon v-if="e.id === joinedEvent?.id" name="check_circle" color="positive" size="24px" />
                    <q-btn
                      v-else
                      no-caps
                      color="primary"
                      :outline="!!joinedEvent || activeEvents.length > 1"
                      :label="joinedEvent ? 'Switch' : 'Join'"
                      :loading="joiningId === e.id"
                      @click="joinEvent(e)"
                    />
                  </q-item-section>
                </q-item>
              </q-list>
              <q-btn v-if="changing" flat no-caps color="grey-8" label="Cancel" class="q-mt-sm" @click="changing = false" />
            </template>

            <div v-else class="text-body2">
              No conference is running yet. Start the one you're at to get going.
            </div>

            <!-- Any role: a rep on their phone can start the conference they're at
                 (they always could by texting SETUP; events-activate now allows it
                 from here too). Offered whenever the list has loaded, including
                 alongside the list, since the conference a rep is at is often the
                 one nobody has started yet. -->
            <q-btn
              v-if="eventsLoaded"
              flat no-caps no-wrap color="primary" icon="add"
              :label="!joinedEvent && activeEvents.length ? `Don't see yours? Start a new one` : 'Start a new conference'"
              class="q-mt-sm"
              @click="pickingNew = true"
            />
          </q-card-section>
        </q-card>

        <!-- Step 2 -->
        <q-card data-tour="setup-capture">
          <q-card-section>
            <div class="row items-center no-wrap">
              <q-avatar size="26px" color="primary" text-color="white" class="q-mr-sm">2</q-avatar>
              <div class="text-subtitle1 text-weight-medium">Choose how you'll capture leads</div>
            </div>
            <div class="text-caption text-grey-8 q-mt-xs" style="margin-left: 34px">
              Use one or all of these.
            </div>
          </q-card-section>

          <!-- Only the text-in card depends on the joined conference (its
               "connected" status is per conference). The QR is the rep's own
               reusable code and the PIN belongs to the login, so both are
               available before joining -- reps can prepare a slide or set up
               a booth iPad ahead of the event. -->
          <!-- Sales accounts only: repSlug is only ever generated for them
               (profiles-create/-update). Admin and Solutions Success get the
               "Rep QR slides" list below instead. -->
          <template v-if="sessionStore.user?.repSlug">
            <q-separator />
            <q-card-section>
              <div class="row items-start no-wrap">
                <q-icon name="qr_code_2" size="28px" color="primary" class="q-mr-md" />
                <div class="col">
                  <div class="text-subtitle2 text-weight-bold">Your QR code</div>
                  <div class="text-body2 text-grey-8">
                    Attendees scan it and fill in their own details. It works at every conference you
                    join, so put it on a slide or open it on an iPad.
                  </div>
                  <!-- A scan is rejected until the rep is linked to a conference
                       (contacts-create), so say so rather than letting a rep find out at
                       the booth. -->
                  <div v-if="!joinedEvent" class="text-caption text-orange-9 q-mt-xs">
                    Scans only work once you've joined a conference above.
                  </div>
                  <q-btn
                    outline no-caps color="primary" icon="download" label="Download QR (PNG)"
                    class="q-mt-sm" :loading="generatingMySlide" @click="downloadMySlide"
                  />
                </div>
              </div>
            </q-card-section>
          </template>

          <!-- Admin and Solutions Success: they hold no QR of their own but are who
               sends each rep theirs, so the reps' slides are listed here (and per
               rep in Admin -> Team). Nothing here depends on a conference. -->
          <template v-if="canManageEvents">
            <q-separator />
            <q-card-section>
              <div class="row items-start no-wrap">
                <q-icon name="qr_code_2" size="28px" color="primary" class="q-mr-md" />
                <div class="col">
                  <div class="text-subtitle2 text-weight-bold">Rep QR slides</div>
                  <div class="text-body2 text-grey-8">
                    Every Sales rep has a reusable QR slide. Download one to send it to them. It only
                    works once they've joined a conference.
                  </div>
                  <q-list v-if="salesReps.length" dense separator class="q-mt-sm">
                    <q-item v-for="rep in salesReps" :key="rep.id" class="q-px-none">
                      <q-item-section>
                        <q-item-label>{{ rep.name }}</q-item-label>
                      </q-item-section>
                      <q-item-section side>
                        <q-btn
                          outline dense no-caps color="primary" icon="download" label="Download" class="q-px-sm"
                          :loading="downloadingSlideFor === rep.id"
                          @click="downloadRepSlide(rep)"
                        />
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
          </template>


          <q-separator />
          <q-card-section>
            <div class="row items-start no-wrap">
              <q-icon name="sms" size="28px" color="primary" class="q-mr-md" />
              <div class="col">
                <div class="row items-center q-gutter-x-sm q-mb-xs">
                  <span class="text-subtitle2 text-weight-bold">Text in cards and voice notes</span>
                  <q-badge v-if="smsStatus === 'connected'" color="positive" label="Connected" />
                  <q-badge v-else-if="smsStatus === 'pending'" color="orange-9" label="Not set up yet" />
                  <q-badge v-else-if="smsStatus === 'no-phone'" color="grey-7" label="Phone number needed" />
                </div>
                <div class="text-body2 text-grey-8">
                  Photograph a business card, or send a voice memo, from your own phone. No laptop needed.
                </div>
                <!-- Texting SETUP is self-contained (twilio-webhook finds or starts the
                     conference by name and binds the phone itself), so reps don't have
                     to come through this page each time -- and nothing about the
                     instructions or the disclosure below depends on having joined a
                     conference here. Only the status badge does (smsBound is per
                     conference), which is why an earlier draft that hid this whole
                     card until joining was wrong. -->
                <div v-if="!joinedEvent" class="text-caption text-grey-8 q-mt-xs">
                  Your connection status shows here once you've joined a conference above.
                </div>
                <!-- Joined, but eventStore.activeEvent hasn't caught up yet (a moment after
                     joining or switching). Without this, smsStatus null would fall through to
                     the "not connected" action below for a conference whose status simply
                     isn't known yet. -->
                <div v-else-if="smsStatus === null" class="text-caption text-grey-8 q-mt-xs">Checking…</div>

                <div v-if="smsStatus === 'no-phone'" class="text-body2 text-orange-9 q-mt-sm">
                  Your account has no phone number yet, so texted cards can't be credited to you.
                  Ask an admin to add yours.
                </div>
                <div v-else-if="smsStatus === 'connected'" class="text-body2 q-mt-sm">
                  <q-icon name="check_circle" color="positive" size="18px" />
                  You're connected for this conference. Text photos and voice memos to
                  <span class="text-weight-bold">{{ twilioNumber }}</span>.
                </div>
                <div v-else class="q-mt-sm">
                  <!-- sms: only opens a composer on a phone; on a laptop the
                       number and keyword are spelled out instead. -->
                  <q-btn
                    v-if="isMobile"
                    color="primary" no-caps icon="sms" label="Text the code SETUP"
                    :href="`sms:${twilioNumberE164}?&body=SETUP`"
                  />
                  <div v-else class="text-body2">
                    From your phone, text the code <span class="text-weight-bold">SETUP</span> to
                    <span class="text-weight-bold">{{ twilioNumber }}</span>.
                  </div>
                </div>

                <!-- Consent disclosure: always visible, directly under the action that
                     gives consent, never inside the collapsible steps below. This is the
                     later (2026-09-11) of the two wordings the page used to carry; it is
                     the only copy now, and it covers texting SETUP and texting the
                     folder code alike -- hence "the code SETUP" in the action above. -->
                <div class="text-caption text-grey-8 q-mt-sm">
                  By texting this code, you agree to receive recurring automated text messages from
                  Flippen Group related to conference lead capture. Msg&amp;data rates may apply. Msg
                  frequency varies. Reply HELP for help, STOP to cancel.
                </div>

                <!-- Open by default until the phone is connected, then collapsed; the rep's
                     own toggle wins once they've touched it. -->
                <q-expansion-item
                  dense dense-toggle label="How it works"
                  header-class="text-primary q-px-none q-mt-xs" class="q-mt-xs"
                  :model-value="stepsOpen"
                  @update:model-value="(v: boolean) => (stepsOverride = v)"
                >
                  <ol class="text-body2 q-pl-md q-mt-none q-mb-none" style="line-height: 1.6">
                    <li>
                      Text <span class="text-weight-bold">SETUP</span> to
                      <span class="text-weight-bold">{{ twilioNumber }}</span>. If you've already joined a
                      conference in the app it links your phone to that one; otherwise reply to the
                      prompts to find today's conference by name (reply CHANGE to pick a different one).
                      Do this again if you switch phones or conferences.
                    </li>
                    <li>Text a photo of a business card: one card filling the frame, or several laid out together on the table.</li>
                    <li>
                      Optional: right after, record and send a voice memo about the conversation. If it's
                      about someone from earlier (not the card you just sent), say their name and the
                      system sorts the note onto the right person.
                    </li>
                    <li>Everything shows up in <span class="text-weight-bold">Review</span> a few minutes later, matched against Zoho automatically.</li>
                  </ol>
                  <div v-if="linkedEvent?.folderCode" class="text-caption text-grey-8 q-mt-sm">
                    Already know today's code, <span class="text-weight-bold">{{ linkedEvent.folderCode }}</span>?
                    After you've activated your SMS opt-in, you can also text it directly to {{ twilioNumber }}
                    to bind your phone to today's event instead of texting SETUP.
                  </div>
                </q-expansion-item>
              </div>
            </div>
          </q-card-section>

          <q-separator />
          <q-card-section>
            <div class="row items-start no-wrap">
              <q-icon name="tablet_mac" size="28px" color="primary" class="q-mr-md" />
              <div class="col">
                <div class="row items-center q-gutter-x-sm q-mb-xs">
                  <span class="text-subtitle2 text-weight-bold">Booth iPad or laptop</span>
                  <q-badge v-if="sessionStore.user?.hasKioskPin" color="positive" label="PIN set" />
                  <q-badge v-else color="grey-7" label="PIN not set" />
                </div>
                <div class="text-body2 text-grey-8">
                  Lock a shared device to the sign-up form. You unlock it with a PIN of your own, separate
                  from your password.
                </div>
                <q-btn
                  outline no-caps color="primary" class="q-mt-sm"
                  :label="sessionStore.user?.hasKioskPin ? 'Change PIN' : 'Set PIN'"
                  @click="promptKioskPin"
                />
                <div class="text-caption text-grey-8 q-mt-xs">When you're ready, tap Lock kiosk in the top bar.</div>
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

      <StartConferenceDialog v-model="pickingNew" @started="onStarted" />
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { Dialog, Notify, Platform } from 'quasar';
import { api } from '@/boot/axios';
import { useEventStore } from '@/stores/event-store';
import { useSessionStore } from '@/stores/session-store';
import StartConferenceDialog from '@/components/StartConferenceDialog.vue';
import { downloadRepConnectSlide } from '@/utils/generateConnectSlide';
import type { Profile } from '@/types/review';

interface ActiveEventOption {
  id: string;
  name: string;
  slug: string;
  state: string;
  activatedAt: string;
}

// The number Twilio's SMS/MMS webhook is configured against — not stored
// anywhere server-side (the app never needs to know its own number; Twilio
// just POSTs inbound messages to twilio-webhook), so this is the one place
// it's hardcoded for display. Update here if the Twilio number ever changes.
const twilioNumber = '+1 (936) 218-1311';
// Same number as above, in the form an sms: link needs.
const twilioNumberE164 = '+19362181311';
// sms: opens a composer on a phone and does nothing useful on a laptop, so
// the "Text SETUP" button is phone-only and desktop gets the number spelled out.
const isMobile = Platform.is.mobile === true;

const eventStore = useEventStore();
const sessionStore = useSessionStore();
// True while a rep who's already joined a conference has asked to switch to
// another live one.
const changing = ref(false);
// Whether the "Start a conference" dialog is open.
const pickingNew = ref(false);
// Id of the conference whose Join/Switch button is mid-request.
const joiningId = ref<string | null>(null);
// Distinguishes "still fetching" from "genuinely none running" -- without it
// Step 1 flashes "No conference is running yet" on every page load.
const eventsLoaded = ref(false);
const generatingMySlide = ref(false);

// effectiveRole (not sessionStore.user?.role) so admin's "View as" preview
// (MainLayout's switcher) reshapes this page into what the previewed role
// would see. Purely a display change: every write here is still gated
// server-side by the real caller's own JWT.
// Admin/solutionsSuccess extras on Setup (the Rep QR slides list). Starting a
// conference is open to every role -- see StartConferenceDialog.
const canManageEvents = computed(() => (
  sessionStore.effectiveRole === 'admin' || sessionStore.effectiveRole === 'solutionsSuccess'
));

// Every currently-active conference (not just this login's own) — lets any
// role pick which one they're actually at, instead of silently inheriting
// whichever conference was activated most recently system-wide.
const activeEvents = ref<ActiveEventOption[]>([]);

// The conference this login is actually linked to (profiles.current_event_id),
// as opposed to eventStore.activeEvent, which for staff with no link falls
// back to the most recently activated one (events-active's legacy fallback).
// Step 1 keys off this so "joined" never means "happened to be displayed".
const joinedEvent = computed(() => (
  activeEvents.value.find((e) => e.id === sessionStore.user?.currentEventId) ?? null
));
// eventStore.activeEvent, but only once it's confirmed to be the joined one --
// it carries smsBound/folderCode, which are only meaningful for that event and
// lag a moment behind a join/switch until fetchActive() returns.
const linkedEvent = computed(() => (
  joinedEvent.value && eventStore.activeEvent?.id === joinedEvent.value.id ? eventStore.activeEvent : null
));

// smsBound is undefined only when the caller's profile has no phone number
// (events-active can't look up a phone_event_bindings row without one), so
// that -- not "false" -- is the "no phone number" state. Null until
// linkedEvent has caught up, so no badge flashes wrongly in the meantime.
const smsStatus = computed<'connected' | 'pending' | 'no-phone' | null>(() => {
  if (!linkedEvent.value) return null;
  if (linkedEvent.value.smsBound === undefined) return 'no-phone';
  return linkedEvent.value.smsBound ? 'connected' : 'pending';
});

// "How it works": the rep's own toggle wins (null = untouched).
const stepsOverride = ref<boolean | null>(null);
// Collapsed by default: open until the phone connected it added ~500px to a page
// that was already three screens tall on a phone. The toggle stays visible.
const stepsOpen = computed(() => stepsOverride.value ?? false);

// Rough enough to disambiguate same-named test/duplicate conferences in the
// picker — not a general-purpose formatter.
function formatRelativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// Any logged-in role can call events-list-active (see its own header
// comment) -- a sales rep needs this exactly when there's more than one
// active conference to disambiguate between.
async function loadActiveEvents() {
  try {
    const { data } = await api.get<ActiveEventOption[]>('/events-list-active');
    activeEvents.value = data;
  } finally {
    eventsLoaded.value = true;
  }
}

// Joining is a write to this login's own current_event_id, and it's the same
// call whether they're picking a first conference or switching. It refetches
// both the session (currentEventId feeds Step 1 and the QR card) and
// eventStore.activeEvent (smsBound/folderCode feed Step 2) -- without those the
// page would keep showing the pre-join state until a full reload.
async function joinEvent(event: ActiveEventOption) {
  joiningId.value = event.id;
  try {
    await api.post('/profiles-set-current-event', { eventId: event.id });
    await Promise.all([sessionStore.fetchMe(), eventStore.fetchActive()]);
    changing.value = false;
    Notify.create({ type: 'positive', message: `You're now at ${event.name}.` });
  } finally {
    joiningId.value = null;
  }
}

// events-activate also links the caller to the conference they just started, so
// Step 1 flips to "joined" -- but only if the session, the active list and
// eventStore.activeEvent (smsBound/folderCode) are all refreshed; a fetchActive
// alone left Step 1 asking them to join something they'd just created.
async function onStarted(payload: { joined: boolean; name: string }) {
  await Promise.all([sessionStore.fetchMe(), eventStore.fetchActive(), loadActiveEvents()]);
  changing.value = false;
  Notify.create({
    type: 'positive',
    message: payload.joined ? `You're now at ${payload.name}.` : `Started ${payload.name}. You're now at it.`,
  });
}

// The sales rep's own reusable QR — shown once they have a repSlug at all
// (profiles-create/-update always generates one for a sales account). It's
// tied to the rep, not a conference, so it's downloadable before joining one;
// only a *scan* needs the rep to be linked (contacts-create rejects it
// otherwise), which the QR card says. Found 2026-09-28: an earlier draft of
// this page hid the whole of Step 2, QR and PIN included, until a conference
// was joined, which blocked preparing a slide ahead of the event.
async function downloadMySlide() {
  if (!sessionStore.user?.repSlug) return;
  generatingMySlide.value = true;
  try {
    await downloadRepConnectSlide({ name: sessionStore.user.name, repSlug: sessionStore.user.repSlug });
  } finally {
    generatingMySlide.value = false;
  }
}

// Admin / Solutions Success don't have a QR of their own (only Sales accounts
// get a rep_slug), but they're who gets each rep theirs to send -- so Setup
// lists the Sales reps with a download each, instead of leaving them to know
// it lives in Admin -> Team. profiles-list is staff-only, so it's only fetched
// for them.
const profiles = ref<Profile[]>([]);
const salesReps = computed(() => profiles.value.filter((p) => p.role === 'sales' && p.repSlug));
// Keyed by rep id -- a specific row's download.
const downloadingSlideFor = ref<string | null>(null);

async function loadProfiles() {
  const { data } = await api.get<Profile[]>('/profiles-list');
  profiles.value = data;
}

async function downloadRepSlide(rep: Profile) {
  if (!rep.repSlug) return;
  downloadingSlideFor.value = rep.id;
  try {
    await downloadRepConnectSlide({ name: rep.name, repSlug: rep.repSlug });
  } finally {
    downloadingSlideFor.value = null;
  }
}

// Setting a PIN is also offered by MainLayout's Lock kiosk button, but only
// when the user has never set one -- this is the only place to *change* an
// existing PIN, which is why the Booth iPad card keeps a button for it.
function promptKioskPin() {
  Dialog.create({
    title: sessionStore.user?.hasKioskPin ? 'Change your kiosk PIN' : 'Set your kiosk PIN',
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
});

// A watch, not an onMounted check: an admin can flip "View as" while this page
// is open, and canManageEvents (effectiveRole) changes under it.
watch(canManageEvents, (staff) => { if (staff) void loadProfiles(); }, { immediate: true });
</script>
