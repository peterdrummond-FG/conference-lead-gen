<template>
  <q-page class="q-pa-lg flex flex-center">
    <div style="width: 480px; max-width: 92vw" class="q-gutter-md">
      <q-card>
        <q-card-section>
          <div class="text-h5">Event Setup</div>
          <div class="text-caption text-grey">
            Pick today's conference to lock this table's Lead Source for the
            rest of the day.
          </div>
        </q-card-section>

        <q-card-section v-if="eventStore.activeEvent">
          <q-banner class="bg-green-1 text-green-10" rounded>
            <div class="text-subtitle1">
              Active: {{ eventStore.activeEvent.name }}
            </div>
            <div class="text-caption">
              {{ eventStore.activeEvent.state }}
            </div>
          </q-banner>

          <!-- Several conferences can be active at once (different reps,
               different cities, same day) — this switches which one this
               admin/Solutions Success login is administering (rep
               assignment, QR slides), without creating a new one. -->
          <div v-if="canManageEvents && activeEvents.length > 1" class="q-mt-sm">
            <q-select
              :model-value="eventStore.activeEvent.id"
              :options="activeEvents"
              option-label="name"
              option-value="id"
              emit-value
              map-options
              dense
              label="Switch to a different active conference"
              :loading="switchingEvent"
              @update:model-value="switchEvent"
            >
              <template v-slot:option="scope">
                <q-item v-bind="scope.itemProps">
                  <q-item-section>
                    <q-item-label>{{ scope.opt.name }}</q-item-label>
                    <q-item-label caption>{{ scope.opt.state }} · activated {{ formatRelativeTime(scope.opt.activatedAt) }}</q-item-label>
                  </q-item-section>
                </q-item>
              </template>
            </q-select>
          </div>

          <div v-if="eventStore.activeEvent.folderCode" class="q-mt-sm">
            <div class="text-caption">Card-photo folder for today:</div>
            <div class="text-subtitle2 text-weight-bold">{{ eventStore.activeEvent.folderCode }}</div>
            <div class="text-caption text-grey">
              Create/use a subfolder with this exact name under the watcher's inbox folder for today's card photos.
            </div>
            <div class="text-caption text-grey q-mt-xs">
              Already know this code? After you've activated your SMS opt-in, you can also text it directly to {{ twilioNumber }} to bind your phone to today's event instead of texting SETUP. By texting this code, you agree to receive recurring automated text messages from Flippen Group related to conference lead capture. Msg&amp;data rates may apply. Msg frequency varies. Reply HELP for help, STOP to cancel.
            </div>
          </div>

          <q-separator class="q-my-md" />

          <div v-if="eventStore.activeEvent.folderCode">
            <div class="text-subtitle2 text-weight-bold">
              Texting in cards &amp; notes (no laptop needed)
            </div>
            <div class="text-caption text-grey q-mb-sm">
              Every rep does this once per event, then just texts photos as they go.
            </div>
            <ol class="text-body2 q-pl-md q-mt-none q-mb-none" style="line-height: 1.6">
              <li>
                Text
                <span class="text-weight-bold">SETUP</span>
                to
                <span class="text-weight-bold">{{ twilioNumber }}</span>
                to activate SMS-based conference lead capture. By texting SETUP, you agree to receive recurring automated text messages from Flippen Group related to conference lead capture.
                <span class="text-grey">Msg&amp;data rates may apply. Msg frequency varies. Reply HELP for help, STOP to cancel.</span>
                Then reply to the prompts to find and confirm today's event by name. Do this again if you switch phones or events.
              </li>
              <li>Text a photo of a business card — one card filling the frame, or several laid out together on the table.</li>
              <li>
                Optional: right after, record and send a voice memo about the conversation. If it's
                about someone from earlier (not the card you just sent), just say their name — the
                system reads it and sorts the note onto the right person.
              </li>
              <li>Everything shows up in <span class="text-weight-bold">Review</span> a few minutes later, matched against Zoho automatically.</li>
            </ol>
          </div>

          <div class="q-mt-md text-center">
            <div class="text-caption text-grey q-mb-sm">
              Two separate QR codes, so booth walk-ups and breakout-session attendees show up as
              separately trackable leads. Drop either on a slide or open it on an iPad — attendees
              scan it, not the laptop screen.
            </div>
            <div class="q-gutter-sm">
              <q-btn
                color="primary"
                icon="image"
                label="Download booth QR (PNG)"
                :loading="generatingBoothSlide"
                @click="downloadSlide('booth')"
              />
              <q-btn
                color="primary"
                icon="image"
                label="Download breakout-session QR (PNG)"
                :loading="generatingSessionSlide"
                @click="downloadSlide('session')"
              />
            </div>
          </div>

          <!-- Sales reps have no say in which conferences exist — only
               whether they're personally linked to one. -->
          <div v-if="canManageEvents" class="q-mt-md">
            <q-btn flat color="primary" label="Pick a different event" @click="pickingNew = true" />
          </div>

          <div v-if="isSales" class="q-mt-md">
            <q-separator class="q-mb-md" />
            <div class="text-caption text-grey q-mb-xs">
              {{ sessionStore.user?.currentEventName ? `You're linked to: ${sessionStore.user.currentEventName}` : "You're not linked to this event yet." }}
            </div>
            <q-btn
              flat no-caps color="primary"
              :label="isLinkedToActiveEvent ? 'Unlink myself' : 'Link myself to this event'"
              :loading="linkingMyself"
              @click="toggleMyCurrentEvent"
            />
          </div>
        </q-card-section>

        <q-card-section v-if="canManageEvents && (!eventStore.activeEvent || pickingNew)">
          <q-select
            v-model="selectedCampaign"
            :options="campaignOptions"
            option-label="name"
            use-input
            fill-input
            hide-selected
            input-debounce="300"
            label="Search campaigns"
            @filter="filterFn"
          />

          <!--
            Zoho's Campaigns module has no State field at all (confirmed
            against live data — every one of 671 real conference campaigns has
            none), so the rep supplies the conference's location directly
            rather than anything being copied from the campaign. Shown once a
            campaign is picked, since that's the point at which it's actually
            needed. This is the conference's own location, used only as a
            fallback signal when resolving card-photo contacts — it never
            gates or defaults the intake form's own attendee-supplied state.
          -->
          <div v-if="selectedCampaign" class="row q-col-gutter-md q-mt-sm">
            <q-select
              v-model="stateOption"
              class="col"
              :options="stateOptions"
              option-label="name"
              use-input
              fill-input
              hide-selected
              input-debounce="0"
              label="Conference location (state) *"
              :rules="[(v: UsStateOption | null) => !!v || 'Required']"
              @filter="filterStates"
            />
          </div>

          <div class="q-mt-md text-right">
            <q-btn
              color="primary"
              label="Activate"
              :disable="!selectedCampaign || !stateOption"
              :loading="activating"
              @click="activate"
            />
          </div>
        </q-card-section>
      </q-card>

      <q-card v-if="eventStore.activeEvent && canManageEvents">
        <q-card-section>
          <div class="text-h6">Assign today's event</div>
          <div class="text-caption text-grey">
            Which sales rep gets credit for booth vs. breakout-session leads.
          </div>
        </q-card-section>
        <q-card-section>
          <div class="row q-col-gutter-md">
            <q-select
              class="col"
              :model-value="eventStore.activeEvent.boothRepId"
              :options="salesProfiles"
              option-label="name"
              option-value="id"
              emit-value
              map-options
              clearable
              dense
              label="Booth rep"
              @update:model-value="(v: string | null) => assignChannelRep('booth', v)"
            />
            <q-select
              class="col"
              :model-value="eventStore.activeEvent.sessionRepId"
              :options="salesProfiles"
              option-label="name"
              option-value="id"
              emit-value
              map-options
              clearable
              dense
              label="Breakout-session rep"
              @update:model-value="(v: string | null) => assignChannelRep('session', v)"
            />
          </div>
        </q-card-section>
      </q-card>

      <q-card v-if="canManageEvents">
        <q-card-section>
          <div class="text-h6">Manage Users</div>
          <div class="text-caption text-grey">
            {{ isAdmin ? 'Create and manage Solutions Success and Sales accounts.' : 'Create and manage Sales accounts.' }}
          </div>
        </q-card-section>

        <q-card-section>
          <q-list v-if="profiles.length" dense separator>
            <q-item v-for="p in profiles" :key="p.id">
              <q-item-section>
                <q-item-label>{{ p.name }} <span class="text-grey">({{ roleLabel(p.role) }})</span></q-item-label>
                <q-item-label caption>
                  {{ p.email }}<template v-if="p.phoneNumber"> · {{ p.phoneNumber }}</template>
                </q-item-label>
                <q-item-label v-if="p.role === 'sales'" caption>
                  {{ isLinkedToCurrentEvent(p) ? `Linked to ${eventStore.activeEvent?.name}` : 'Not linked to the current event' }}
                </q-item-label>
              </q-item-section>
              <q-item-section v-if="p.role === 'sales' && eventStore.activeEvent" side>
                <q-btn
                  flat dense no-caps color="primary"
                  :label="isLinkedToCurrentEvent(p) ? 'Unlink' : 'Link to current event'"
                  @click="toggleCurrentEvent(p)"
                />
              </q-item-section>
              <q-item-section v-if="p.id !== sessionStore.user?.id" side>
                <q-btn flat round dense icon="delete" color="grey-7" @click="confirmDeleteProfile(p)" />
              </q-item-section>
            </q-item>
          </q-list>
          <div v-else class="text-caption text-grey">No accounts yet.</div>

          <q-separator class="q-my-md" />

          <div class="text-caption text-weight-medium q-mb-sm">Add a user</div>
          <div class="q-gutter-sm">
            <q-input v-model="newName" label="Name" dense />
            <q-input v-model="newEmail" type="email" label="Email" dense />
            <q-input v-model="newPassword" type="password" label="Temporary password" dense />
            <q-select
              v-if="isAdmin"
              v-model="newRole"
              :options="creatableRoleOptions"
              option-label="label"
              option-value="value"
              emit-value
              map-options
              label="Role"
              dense
            />
            <q-input
              v-model="newPhone"
              label="Phone"
              hint="Optional. For a sales rep this is also how cards they text in get attributed to them."
              dense
            />
            <div class="text-right">
              <q-btn
                color="primary"
                label="Create account"
                :loading="creatingProfile"
                :disable="!newName || !newEmail || !newPassword"
                @click="createProfile"
              />
            </div>
          </div>
        </q-card-section>
      </q-card>

      <q-card>
        <q-card-section>
          <div class="text-h6">My kiosk PIN</div>
          <div class="text-caption text-grey">
            What you personally unlock a locked kiosk device with — separate from your login password. Each user sets their own.
          </div>
        </q-card-section>
        <q-card-section>
          <div class="row q-col-gutter-sm items-start">
            <q-input class="col" v-model="newKioskCode" label="New kiosk PIN" dense hint="At least 4 characters" />
            <q-btn
              class="col-auto"
              color="primary"
              label="Update"
              :loading="updatingKioskCode"
              :disable="newKioskCode.length < 4"
              @click="updateKioskCode"
            />
          </div>
        </q-card-section>
      </q-card>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { Dialog, Notify } from 'quasar';
import { api } from '@/boot/axios';
import { useEventStore } from '@/stores/event-store';
import { useSessionStore } from '@/stores/session-store';
import { generateConnectSlidePng, type ConnectSlideChannel } from '@/utils/generateConnectSlide';
import { US_STATES, filterStateOptions, type UsStateOption } from '@/constants/usStates';
import type { Profile, Role } from '@/types/review';

interface CampaignOption {
  zohoCampaignId: string;
  name: string;
}

interface ActiveEventOption {
  id: string;
  name: string;
  state: string;
  activatedAt: string;
}

// The number Twilio's SMS/MMS webhook is configured against — not stored
// anywhere server-side (the app never needs to know its own number; Twilio
// just POSTs inbound messages to twilio-webhook), so this is the one place
// it's hardcoded for display. Update here if the Twilio number ever changes.
const twilioNumber = '+1 (936) 218-1311';

const eventStore = useEventStore();
const sessionStore = useSessionStore();
const campaignOptions = ref<CampaignOption[]>([]);
const selectedCampaign = ref<CampaignOption | null>(null);
const stateOption = ref<UsStateOption | null>(null);
const stateOptions = ref<UsStateOption[]>(US_STATES);
const activating = ref(false);
const pickingNew = ref(false);
const generatingBoothSlide = ref(false);
const generatingSessionSlide = ref(false);

const isAdmin = computed(() => sessionStore.user?.role === 'admin');
const isSales = computed(() => sessionStore.user?.role === 'sales');
// Picking/activating a conference, assigning booth/session reps, and
// managing accounts are all admin/solutionsSuccess actions — a sales rep
// reaching Setup is here only to download QR slides and link themself to
// the event, never to reconfigure it.
const canManageEvents = computed(() => isAdmin.value || sessionStore.user?.role === 'solutionsSuccess');
const linkingMyself = ref(false);

// Every currently-active conference (not just this login's own) — lets
// admin/solutionsSuccess switch which one they're administering instead of
// only ever seeing whichever they personally activated.
const activeEvents = ref<ActiveEventOption[]>([]);
const switchingEvent = ref(false);

const profiles = ref<Profile[]>([]);
const salesProfiles = computed(() => profiles.value.filter((p) => p.role === 'sales'));

const isLinkedToActiveEvent = computed(() => (
  !!eventStore.activeEvent && sessionStore.user?.currentEventId === eventStore.activeEvent.id
));

const creatableRoleOptions = [
  { label: 'Solutions Success', value: 'solutionsSuccess' },
  { label: 'Sales', value: 'sales' },
];
const newName = ref('');
const newEmail = ref('');
const newPassword = ref('');
const newPhone = ref('');
const newRole = ref<Role>('sales');
const creatingProfile = ref(false);

const newKioskCode = ref('');
const updatingKioskCode = ref(false);

function roleLabel(role: Role) {
  if (role === 'admin') return 'Admin';
  if (role === 'solutionsSuccess') return 'Solutions Success';
  return 'Sales';
}

function isLinkedToCurrentEvent(p: Profile) {
  return !!eventStore.activeEvent && p.currentEventId === eventStore.activeEvent.id;
}

// Short, memorable, per-event URLs (routes.ts redirects these into
// /intake?eventSlug=...&channel=...) — the QR itself is always scanned, but
// the slide also spells the URL out for anyone who can't scan, so it needs
// to be typeable on a phone keyboard. The slug is what makes leads from
// concurrent conferences (multiple reps, same day) attribute correctly
// instead of racing to whichever event happens to be "active" — see
// 20260915120000_event_slug_and_concurrent_events.sql.
function intakeUrlFor(channel: ConnectSlideChannel) {
  return `${window.location.origin}/connect/${eventStore.activeEvent?.slug}-${channel}`;
}

function filterFn(val: string, update: (cb: () => void) => void) {
  update(async () => {
    const { data } = await api.get<CampaignOption[]>('/campaigns-list', { params: { search: val } });
    campaignOptions.value = data;
  });
}

function filterStates(val: string, update: (cb: () => void) => void) {
  update(() => {
    stateOptions.value = filterStateOptions(val);
  });
}

async function activate() {
  if (!selectedCampaign.value || !stateOption.value) return;
  activating.value = true;
  try {
    await api.post('/events-activate', {
      zohoCampaignId: selectedCampaign.value.zohoCampaignId,
      name: selectedCampaign.value.name,
      state: stateOption.value.name,
    });
    await eventStore.fetchActive();
    await loadActiveEvents();
    pickingNew.value = false;
    selectedCampaign.value = null;
    stateOption.value = null;
  } finally {
    activating.value = false;
  }
}

async function loadActiveEvents() {
  if (!canManageEvents.value) return;
  const { data } = await api.get<ActiveEventOption[]>('/events-list-active');
  activeEvents.value = data;
}

async function switchEvent(eventId: string) {
  if (!eventId || eventId === eventStore.activeEvent?.id) return;
  switchingEvent.value = true;
  try {
    await api.post('/profiles-set-current-event', { eventId });
    await eventStore.fetchActive();
  } finally {
    switchingEvent.value = false;
  }
}

// Rough enough to disambiguate same-named test/duplicate conferences in the
// switcher — not a general-purpose formatter.
function formatRelativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

async function downloadSlide(channel: ConnectSlideChannel) {
  if (!eventStore.activeEvent) return;
  const loading = channel === 'booth' ? generatingBoothSlide : generatingSessionSlide;
  loading.value = true;
  try {
    await generateConnectSlidePng({
      eventName: eventStore.activeEvent.name,
      state: eventStore.activeEvent.state,
      intakeUrl: intakeUrlFor(channel),
      channel,
    });
  } finally {
    loading.value = false;
  }
}

async function loadProfiles() {
  const { data } = await api.get<Profile[]>('/profiles-list');
  profiles.value = data;
}

async function createProfile() {
  creatingProfile.value = true;
  try {
    await api.post('/profiles-create', {
      name: newName.value,
      email: newEmail.value,
      password: newPassword.value,
      role: isAdmin.value ? newRole.value : 'sales',
      // Any role may have a phone (the list has always displayed one for
      // admins too) -- it's only *load-bearing* for sales, where
      // contacts-from-ocr matches a texted-in card's sender against it.
      ...(newPhone.value ? { phoneNumber: newPhone.value } : {}),
    });
    newName.value = '';
    newEmail.value = '';
    newPassword.value = '';
    newPhone.value = '';
    await loadProfiles();
  } finally {
    creatingProfile.value = false;
  }
}

// Deleting a profile deletes the underlying auth.users login outright --
// there's no undo and no soft-delete to restore from, so it always goes
// through a confirm step. Your own row renders no delete button at all
// (profiles-delete refuses self-deletion anyway).
function confirmDeleteProfile(p: Profile) {
  Dialog.create({
    title: 'Delete this account?',
    message: `${p.name} will no longer be able to sign in. Any contacts or event assignments they own stay, but are no longer attributed to them. This can't be undone.`,
    cancel: true,
    persistent: true,
    ok: { label: 'Delete', color: 'negative' },
  }).onOk(() => deleteProfile(p));
}

async function deleteProfile(p: Profile) {
  await api.post('/profiles-delete', { id: p.id });
  await loadProfiles();
  Notify.create({ type: 'positive', message: `${p.name}'s account was deleted.` });
}

async function assignChannelRep(channel: 'booth' | 'session', repId: string | null) {
  if (!eventStore.activeEvent) return;
  await api.post('/events-assign-rep', { eventId: eventStore.activeEvent.id, channel, repId });
  await eventStore.fetchActive();
}

async function toggleCurrentEvent(p: Profile) {
  const eventId = isLinkedToCurrentEvent(p) ? null : (eventStore.activeEvent?.id ?? null);
  await api.post('/profiles-assign-current-event', { repId: p.id, eventId });
  await loadProfiles();
  Notify.create({ type: 'positive', message: eventId ? `${p.name} linked to this event.` : `${p.name} unlinked.` });
}

async function updateKioskCode() {
  updatingKioskCode.value = true;
  try {
    await api.post('/kiosk-set-code', { code: newKioskCode.value });
    newKioskCode.value = '';
    Notify.create({ type: 'positive', message: 'Kiosk PIN updated.' });
  } finally {
    updatingKioskCode.value = false;
  }
}

async function toggleMyCurrentEvent() {
  linkingMyself.value = true;
  try {
    const eventId = isLinkedToActiveEvent.value ? null : (eventStore.activeEvent?.id ?? null);
    await api.post('/profiles-set-current-event', { eventId });
    await sessionStore.fetchMe();
    Notify.create({ type: 'positive', message: eventId ? 'Linked to this event.' : 'Unlinked.' });
  } finally {
    linkingMyself.value = false;
  }
}

onMounted(() => {
  void eventStore.fetchActive();
  if (canManageEvents.value) {
    void loadProfiles();
    void loadActiveEvents();
  }
});
</script>
