<template>
  <q-page class="q-pa-lg flex flex-center">
    <div style="width: 480px; max-width: 92vw" class="q-gutter-md">
      <q-card>
        <q-card-section>
          <div class="text-h5">Event Setup</div>
          <div class="text-caption text-grey">
            Pick today's conference to lock this table's State/City and Lead
            Source for the rest of the day.
          </div>
        </q-card-section>

        <q-card-section v-if="eventStore.activeEvent">
          <q-banner class="bg-green-1 text-green-10" rounded>
            <div class="text-subtitle1">
              Active: {{ eventStore.activeEvent.name }}
            </div>
            <div class="text-caption">
              {{ eventStore.activeEvent.city }}, {{ eventStore.activeEvent.state }}
            </div>
          </q-banner>

          <div v-if="eventStore.activeEvent.folderCode" class="q-mt-sm">
            <div class="text-caption">Card-photo folder for today:</div>
            <div class="text-subtitle2 text-weight-bold">{{ eventStore.activeEvent.folderCode }}</div>
            <div class="text-caption text-grey">
              Create/use a subfolder with this exact name under the watcher's inbox folder for today's card photos.
            </div>
          </div>

          <div class="q-mt-md text-center">
            <div class="text-caption text-grey q-mb-sm">
              Print this and set it on the booth table — attendees scan it, not the laptop screen.
            </div>
            <q-btn
              color="primary"
              icon="picture_as_pdf"
              label="Download connect flyer (PDF)"
              :loading="generatingFlyer"
              @click="downloadFlyer"
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
            Zoho's Campaigns module has no State/City fields at all (confirmed
            against live data — every one of 671 real conference campaigns has
            neither), so the rep supplies them directly rather than anything
            being copied from the campaign. Shown once a campaign is picked,
            since that's the point at which they're actually needed.
          -->
          <div v-if="selectedCampaign" class="row q-col-gutter-md q-mt-sm">
            <q-input
              v-model="state"
              class="col"
              label="State *"
              :rules="[(v: string) => !!v || 'Required']"
            />
            <q-input
              v-model="city"
              class="col"
              label="City *"
              :rules="[(v: string) => !!v || 'Required']"
            />
          </div>

          <div class="q-mt-md text-right">
            <q-btn
              color="primary"
              label="Activate"
              :disable="!selectedCampaign || !state || !city"
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
import { generateFlyerPdf } from '@/utils/generateFlyer';

interface CampaignOption {
  zohoCampaignId: string;
  name: string;
}

const eventStore = useEventStore();
const roleStore = useRoleStore();
const campaignOptions = ref<CampaignOption[]>([]);
const selectedCampaign = ref<CampaignOption | null>(null);
const state = ref('');
const city = ref('');
const activating = ref(false);
const pickingNew = ref(false);
const generatingFlyer = ref(false);

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

async function activate() {
  if (!selectedCampaign.value || !state.value || !city.value) return;
  activating.value = true;
  try {
    await api.post('/events-activate', {
      zohoCampaignId: selectedCampaign.value.zohoCampaignId,
      name: selectedCampaign.value.name,
      state: state.value,
      city: city.value,
    });
    await eventStore.fetchActive();
    pickingNew.value = false;
    selectedCampaign.value = null;
    state.value = '';
    city.value = '';
  } finally {
    activating.value = false;
  }
}

async function downloadFlyer() {
  if (!eventStore.activeEvent) return;
  generatingFlyer.value = true;
  try {
    await generateFlyerPdf({
      eventName: eventStore.activeEvent.name,
      city: eventStore.activeEvent.city,
      state: eventStore.activeEvent.state,
      intakeUrl: intakeUrl.value,
    });
  } finally {
    generatingFlyer.value = false;
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
