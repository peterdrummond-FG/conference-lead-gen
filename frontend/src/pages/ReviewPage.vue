<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-mb-md q-gutter-md">
      <div class="text-h5">Review</div>
      <q-tabs v-model="tab" dense class="col-auto">
        <q-tab name="needs_review" label="Needs Review" />
        <q-tab name="approved" label="Approved" />
        <q-tab name="rejected" label="Rejected" />
      </q-tabs>
      <q-space />
      <q-btn
        color="positive"
        label="Bulk approve selected"
        :disable="selectedIds.length === 0"
        @click="bulkApprove"
      />
    </div>

    <div v-if="loading" class="text-center q-pa-lg">
      <q-spinner size="40px" />
    </div>

    <div v-else-if="contacts.length === 0" class="text-center text-grey q-pa-lg">
      Nothing here.
    </div>

    <div v-else>
      <ReviewContactCard
        v-for="contact in contacts"
        :key="contact.id"
        :contact="contact"
        :selected="selectedMap[contact.id] ?? false"
        @update:selected="(v: boolean) => (selectedMap[contact.id] = v)"
        @approve="approve"
        @reject="reject"
        @update="update"
      />
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { api } from '@/boot/axios';
import ReviewContactCard from '@/components/ReviewContactCard.vue';
import type { ContactListItem, UpdateContactPayload } from '@/types/review';

const tab = ref('needs_review');
const contacts = ref<ContactListItem[]>([]);
const loading = ref(false);
const selectedMap = reactive<Record<string, boolean>>({});

const selectedIds = computed(() => Object.keys(selectedMap).filter((id) => selectedMap[id]));

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get<ContactListItem[]>('/contacts', { params: { reviewStatus: tab.value } });
    contacts.value = data;
    for (const key of Object.keys(selectedMap)) delete selectedMap[key];
    for (const c of data) selectedMap[c.id] = false;
  } finally {
    loading.value = false;
  }
}

async function approve(id: string) {
  await api.patch(`/contacts/${id}`, { reviewStatus: 'approved' });
  await load();
}

async function reject(id: string) {
  await api.patch(`/contacts/${id}`, { reviewStatus: 'rejected' });
  await load();
}

async function update(id: string, payload: UpdateContactPayload) {
  await api.patch(`/contacts/${id}`, payload);
  await load();
}

async function bulkApprove() {
  await api.post('/contacts/bulk-approve', { ids: selectedIds.value });
  await load();
}

watch(tab, load);
onMounted(load);
</script>
