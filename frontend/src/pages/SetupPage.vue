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
              Already know this code? After you've activated Conference Lead Capture, you can also text it directly to {{ twilioNumber }} to bind your phone to today's event.
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
                to activate SMS-based conference lead capture.
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
              Drop this on a slide or open it on an iPad at the booth — attendees scan it, not the laptop screen.
            </div>
            <q-btn
              color="primary"
              icon="image"
              label="Download connect slide (PNG)"
              :loading="generatingSlide"
              @click="downloadSlide"
            />
          </div>

          <div class="q-mt-md">
            <q-btn flat color="primary" label="Pick a different event" @click="pickingNew = true" />
          </div>
        </q-card-section>

        <q-card-section v-if="!eventStore.activeEvent || pickingNew">
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

      <q-card>
        <q-card-section>
          <div class="text-h6">Kiosk settings</div>
          <div class="text-caption text-grey">Who's using this app, and the PIN that unlocks it from the kiosk screen.</div>
        </q-card-section>

        <q-card-section>
          <div class="text-caption text-weight-medium q-mb-xs">Signed in as</div>
          <q-btn-toggle
            :model-value="roleStore.role"
            spread
            no-caps
            toggle-color="primary"
            color="white"
            text-color="primary"
            :options="[
              { label: 'Sales', value: 'sales' },
              { label: 'Customer Success', value: 'customerSuccess' },
            ]"
            @update:model-value="(v: Role) => roleStore.setRole(v)"
          />
        </q-card-section>

        <q-separator />

        <q-card-section class="q-gutter-sm">
          <div class="text-caption text-weight-medium">Change kiosk PIN</div>
          <q-input v-model="currentPin" type="password" inputmode="numeric" label="Current PIN" dense />
          <q-input v-model="newPin" type="password" inputmode="numeric" label="New PIN" dense />
          <div class="text-right">
            <q-btn
              flat
              color="primary"
              label="Update PIN"
              :disable="!currentPin || !newPin"
              :loading="changingPin"
              @click="changePin"
            />
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
import { useRoleStore, type Role } from '@/stores/role-store';
import { generateConnectSlidePng } from '@/utils/generateConnectSlide';
import { US_STATES, filterStateOptions, type UsStateOption } from '@/constants/usStates';

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
const roleStore = useRoleStore();
const campaignOptions = ref<CampaignOption[]>([]);
const selectedCampaign = ref<CampaignOption | null>(null);
const stateOption = ref<UsStateOption | null>(null);
const stateOptions = ref<UsStateOption[]>(US_STATES);
const activating = ref(false);
const pickingNew = ref(false);
const generatingSlide = ref(false);

const currentPin = ref('');
const newPin = ref('');
const changingPin = ref(false);

const intakeUrl = computed(() => `${window.location.origin}/#/intake`);

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

async function downloadSlide() {
  if (!eventStore.activeEvent) return;
  generatingSlide.value = true;
  try {
    await generateConnectSlidePng({
      eventName: eventStore.activeEvent.name,
      state: eventStore.activeEvent.state,
      intakeUrl: intakeUrl.value,
    });
  } finally {
    generatingSlide.value = false;
  }
}

async function changePin() {
  changingPin.value = true;
  try {
    await api.put('/auth-change-pin', { currentPin: currentPin.value, newPin: newPin.value });
    Notify.create({ type: 'positive', message: 'Kiosk PIN updated.' });
    currentPin.value = '';
    newPin.value = '';
  } finally {
    changingPin.value = false;
  }
}

onMounted(() => {
  void eventStore.fetchActive();
});
</script>
