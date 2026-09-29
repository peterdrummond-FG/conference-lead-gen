<template>
  <q-dialog :model-value="modelValue" @update:model-value="(v: boolean) => emit('update:modelValue', v)" @hide="reset">
    <q-card style="width: 480px; max-width: 92vw">
      <q-card-section>
        <div class="text-h6">Start a conference</div>
        <div class="text-caption text-grey">
          Pick the conference from Zoho. You'll be joined to it, and others can then join it from their own Setup page.
        </div>
      </q-card-section>
      <q-card-section class="q-pt-none">
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
        <q-select
          v-if="selectedCampaign"
          v-model="stateOption"
          class="q-mt-sm"
          :options="stateOptions"
          option-label="name"
          use-input
          fill-input
          hide-selected
          input-debounce="0"
          label="Conference location (state) *"
          hint="Used to help match card-photo submissions when the district isn't legible"
          :rules="[(v: UsStateOption | null) => !!v || 'Required']"
          @filter="filterStates"
        />
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat no-caps label="Cancel" v-close-popup />
        <q-btn
          color="primary"
          no-caps
          label="Start conference"
          :disable="!selectedCampaign || !stateOption"
          :loading="activating"
          @click="activate"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { api } from '@/boot/axios';
import { US_STATES, filterStateOptions, type UsStateOption } from '@/constants/usStates';

// Shared by Setup (any role -- a rep on their phone can start the conference
// they're at, as they always could by texting SETUP) and Admin. One copy so the
// two can't drift apart on what starting a conference asks for.
defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  (e: 'update:modelValue', open: boolean): void;
  // events-activate also links the caller to the conference they just started,
  // so the parent has to refresh the session as well as its own lists.
  (e: 'started'): void;
}>();

interface CampaignOption {
  zohoCampaignId: string;
  name: string;
}

const campaignOptions = ref<CampaignOption[]>([]);
const selectedCampaign = ref<CampaignOption | null>(null);
const stateOption = ref<UsStateOption | null>(null);
const stateOptions = ref<UsStateOption[]>(US_STATES);
const activating = ref(false);

function reset() {
  selectedCampaign.value = null;
  stateOption.value = null;
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
    // `name` is sent for compatibility with a not-yet-updated events-activate
    // (which required it) but the server now ignores it and looks the name up
    // from the campaign cache by id.
    await api.post('/events-activate', {
      zohoCampaignId: selectedCampaign.value.zohoCampaignId,
      name: selectedCampaign.value.name,
      state: stateOption.value.name,
    });
    emit('update:modelValue', false);
    emit('started');
  } finally {
    activating.value = false;
  }
}
</script>
