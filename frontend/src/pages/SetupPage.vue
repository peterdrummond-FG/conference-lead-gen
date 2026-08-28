<template>
  <q-page class="q-pa-lg flex flex-center">
    <q-card style="width: 480px; max-width: 90vw">
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

        <div class="q-mt-md text-center">
          <div class="text-caption q-mb-sm">
            Scan to open the intake form on another device:
          </div>
          <qrcode-vue :value="intakeUrl" :size="220" level="M" />
          <div class="text-caption text-grey q-mt-sm">{{ intakeUrl }}</div>
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
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import QrcodeVue from 'qrcode.vue';
import { api } from '@/boot/axios';
import { useEventStore } from '@/stores/event-store';

interface CampaignOption {
  zohoCampaignId: string;
  name: string;
}

const eventStore = useEventStore();
const campaignOptions = ref<CampaignOption[]>([]);
const selectedCampaign = ref<CampaignOption | null>(null);
const state = ref('');
const city = ref('');
const activating = ref(false);
const pickingNew = ref(false);

const intakeUrl = computed(() => `${window.location.origin}/#/intake`);

function filterFn(val: string, update: (cb: () => void) => void) {
  update(async () => {
    const { data } = await api.get<CampaignOption[]>('/campaigns', { params: { search: val } });
    campaignOptions.value = data;
  });
}

async function activate() {
  if (!selectedCampaign.value || !state.value || !city.value) return;
  activating.value = true;
  try {
    await api.post('/events', {
      zohoCampaignId: selectedCampaign.value.zohoCampaignId,
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

onMounted(() => {
  void eventStore.fetchActive();
});
</script>
