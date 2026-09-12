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

          <div v-if="eventStore.activeEvent.folderCode" class="q-mt-sm">
            <div class="text-caption">Card-photo folder for today:</div>
            <div class="text-subtitle2 text-weight-bold">{{ eventStore.activeEvent.folderCode }}</div>
            <div class="text-caption text-grey">
              Create/use a subfolder with this exact name under the watcher's inbox folder for today's card photos.
            </div>
            <div class="text-caption text-grey q-mt-xs">
              Already know this code? After you've activated Conference Lead Capture, you can also text it directly to {{ twilioNumber }} to bind your phone to today's event instead of texting SETUP. By texting this code, you agree to receive recurring automated text messages from Flippen Group related to conference lead capture. Msg&amp;data rates may apply. Msg frequency varies. Reply HELP for help, STOP to cancel.
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

          <!-- Sales reps have no say in which conference the whole app is
               running for — only whether they're personally linked to it. -->
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
              <q-item-section side>
                <q-btn flat round dense icon="delete" color="grey-7" @click="deleteProfile(p.id)" />
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
            <q-input v-if="newRole === 'sales'" v-model="newPhone" label="Phone" dense />
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
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { Notify } from 'quasar';
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

function roleLabel(role: Role) {
  if (role === 'admin') return 'Admin';
  if (role === 'solutionsSuccess') return 'Solutions Success';
  return 'Sales';
}

function isLinkedToCurrentEvent(p: Profile) {
  return !!eventStore.activeEvent && p.currentEventId === eventStore.activeEvent.id;
}

// Short, memorable URLs (routes.ts redirects these into /intake?channel=...)
// — the QR itself is always scanned, but the slide also spells the URL out
// for anyone who can't scan, so it needs to be typeable on a phone keyboard.
function intakeUrlFor(channel: ConnectSlideChannel) {
  return `${window.location.origin}/#/${channel}`;
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
    pickingNew.value = false;
    selectedCampaign.value = null;
    stateOption.value = null;
  } finally {
    activating.value = false;
  }
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
      ...(newRole.value === 'sales' && newPhone.value ? { phoneNumber: newPhone.value } : {}),
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

async function deleteProfile(id: string) {
  await api.post('/profiles-delete', { id });
  await loadProfiles();
}

async function assignChannelRep(channel: 'booth' | 'session', repId: string | null) {
  await api.post('/events-assign-rep', { channel, repId });
  await eventStore.fetchActive();
}

async function toggleCurrentEvent(p: Profile) {
  const eventId = isLinkedToCurrentEvent(p) ? null : (eventStore.activeEvent?.id ?? null);
  await api.post('/profiles-assign-current-event', { repId: p.id, eventId });
  await loadProfiles();
  Notify.create({ type: 'positive', message: eventId ? `${p.name} linked to this event.` : `${p.name} unlinked.` });
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
  if (canManageEvents.value) void loadProfiles();
});
</script>
