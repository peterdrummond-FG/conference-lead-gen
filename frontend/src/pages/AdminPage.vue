<template>
  <q-page :class="[$q.screen.lt.sm ? 'q-pa-sm' : 'q-pa-lg', 'flex', 'flex-center']">
    <div style="width: 640px; max-width: 100%" class="q-gutter-md">
      <div>
        <div class="text-h5">Admin</div>
        <div class="text-body2 text-grey-8 q-mt-xs">
          Activate and end conferences, and manage who's on your team.
        </div>
      </div>

      <AdminConferencesCard
        :events-loaded="eventsLoaded" :event-rows="eventRows" :rep-count="repCount" :completing-event="completingEvent"
        @activate="pickingNew = true" @end="confirmMarkComplete"
      />

      <AdminTeamCard
        :is-admin="isAdmin" :profiles-loaded="profilesLoaded" :profiles="profiles"
        :working-at-options="workingAtOptions" :has-active-events="activeEvents.length > 0"
        :assigning-rep="assigningRep" :current-user-id="sessionStore.user?.id ?? null"
        @add="openAddPerson" @assign="assignRep" @edit="openEditPerson" @remove="confirmDeleteProfile"
      />

      <StartConferenceDialog v-model="pickingNew" @started="onStarted" />

      <q-dialog v-model="addingPerson">
        <q-card style="width: 420px; max-width: 92vw">
          <q-card-section>
            <div class="text-h6">Add a person</div>
          </q-card-section>
          <q-card-section class="q-pt-none q-gutter-sm">
            <q-input v-model="newName" label="Name" dense />
            <q-input v-model="newEmail" type="email" label="Email" dense />
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
            <!-- profiles-create rejects a sales account with no phone (a rep
                 with none can never be credited for a texted-in card), so
                 this is required for Sales rather than "optional" as the old
                 Manage Users form said -- which only surfaced as a server
                 error after clicking Create. -->
            <q-input
              v-model="newPhone"
              label="Phone"
              :hint="effectiveNewRole === 'sales' ? 'Required. Cards they text in are credited to this number.' : 'Optional'"
              dense
            />
            <q-input
              v-model="newPassword"
              type="password"
              label="Temporary password"
              hint="Share it with them yourself. They can change it later with Forgot password."
              dense
            />
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat no-caps label="Cancel" v-close-popup />
            <q-btn
              color="primary"
              no-caps
              label="Create account"
              :loading="creatingProfile"
              :disable="!newName || !newEmail || !newPassword || (effectiveNewRole === 'sales' && !newPhone)"
              @click="createProfile"
            />
          </q-card-actions>
        </q-card>
      </q-dialog>

      <q-dialog v-model="editingPerson" @hide="editing = null">
        <q-card style="width: 420px; max-width: 92vw">
          <q-card-section>
            <div class="text-h6">Edit {{ editing?.name }}</div>
          </q-card-section>
          <q-card-section class="q-pt-none q-gutter-sm">
            <q-input v-model="editName" label="Name" dense />
            <q-input
              v-model="editPhone"
              label="Phone"
              :hint="editing?.role === 'sales' ? 'Required. Cards they text in are credited to this number.' : 'Optional'"
              dense
            />
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat no-caps label="Cancel" v-close-popup />
            <q-btn
              color="primary"
              no-caps
              label="Save"
              :loading="savingEdit"
              :disable="!editName.trim() || (editing?.role === 'sales' && !editPhone.trim())"
              @click="saveEdit"
            />
          </q-card-actions>
        </q-card>
      </q-dialog>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { Dialog, Notify } from 'quasar';
import { api } from '@/boot/axios';
import { useEventStore } from '@/stores/event-store';
import { useSessionStore } from '@/stores/session-store';
import StartConferenceDialog from '@/components/StartConferenceDialog.vue';
import AdminConferencesCard from '@/components/AdminConferencesCard.vue';
import AdminTeamCard from '@/components/AdminTeamCard.vue';
import type { Profile, Role } from '@/types/review';

interface ActiveEventOption {
  id: string;
  name: string;
  slug: string;
  state: string;
  activatedAt: string;
}

interface RecentEventOption extends ActiveEventOption {
  status: 'active' | 'completed';
}

const eventStore = useEventStore();
const sessionStore = useSessionStore();

// effectiveRole so admin's "View as" preview reshapes the page like every
// other; the server still gates every write by the real caller's own JWT.
const isAdmin = computed(() => sessionStore.effectiveRole === 'admin');

// --- Conferences -----------------------------------------------------------

// Every active conference, and the 5 most recently activated regardless of
// status -- two separate reads because events-list-active feeds the
// "Working at" picker (active only) while events-list-recent adds since-ended
// conferences as read-only history (see events-list-recent's own header).
const activeEvents = ref<ActiveEventOption[]>([]);
const recentEvents = ref<RecentEventOption[]>([]);
// Distinguishes "still fetching" from "genuinely none" so the empty-state text
// doesn't flash on every load.
const eventsLoaded = ref(false);
const completingEvent = ref<string | null>(null);

// Every active conference, plus whichever of the 5 most recent ones aren't
// already active (so an ended conference still shows) -- de-duplicated by id,
// newest first.
const eventRows = computed<RecentEventOption[]>(() => {
  const byId = new Map<string, RecentEventOption>();
  for (const e of recentEvents.value) byId.set(e.id, e);
  for (const e of activeEvents.value) {
    if (!byId.has(e.id)) byId.set(e.id, { ...e, status: 'active' });
  }
  return Array.from(byId.values()).sort((a, b) => b.activatedAt.localeCompare(a.activatedAt));
});

async function loadEvents() {
  try {
    const [active, recent] = await Promise.all([
      api.get<ActiveEventOption[]>('/events-list-active'),
      api.get<RecentEventOption[]>('/events-list-recent'),
    ]);
    activeEvents.value = active.data;
    recentEvents.value = recent.data;
  } finally {
    eventsLoaded.value = true;
  }
}

function confirmMarkComplete(event: { id: string; name: string }) {
  Dialog.create({
    title: 'End this conference?',
    message: `This ends "${event.name}" for every rep at it. They'll need to join another conference on Setup next time. This can't be undone.`,
    cancel: true,
    persistent: true,
    ok: { label: 'End conference', color: 'negative' },
  }).onOk(() => markComplete(event.id));
}

async function markComplete(eventId: string) {
  completingEvent.value = eventId;
  try {
    await api.post('/events-complete', { eventId });
    await Promise.all([loadEvents(), loadProfiles()]);
    // The admin/SS caller themself might have been at the conference they
    // just ended -- reflect that immediately rather than on their next reload.
    if (sessionStore.user?.currentEventId === eventId) {
      await sessionStore.fetchMe();
      await eventStore.fetchActive();
    }
    Notify.create({ type: 'positive', message: 'Conference ended.' });
  } finally {
    completingEvent.value = null;
  }
}

// --- Activate a conference ----------------------------------------------------

const pickingNew = ref(false);

// events-activate also links the caller to the conference they just started,
// so the session (Setup's "joined" state) and the team list both need a
// refresh, not just the conferences.
async function onStarted(payload: { joined: boolean; name: string }) {
  await Promise.all([sessionStore.fetchMe(), eventStore.fetchActive(), loadEvents(), loadProfiles()]);
  Notify.create({
    type: 'positive',
    message: payload.joined ? `You're now at ${payload.name}.` : `Started ${payload.name}.`,
  });
}

// --- Team ------------------------------------------------------------------

const profiles = ref<Profile[]>([]);
const profilesLoaded = ref(false);
const assigningRep = ref<string | null>(null);

const creatableRoleOptions = [
  { label: 'Solutions Success', value: 'solutionsSuccess' },
  { label: 'Sales', value: 'sales' },
];
const addingPerson = ref(false);
const newName = ref('');
const newEmail = ref('');
const newPassword = ref('');
const newPhone = ref('');
const newRole = ref<Role>('sales');
const creatingProfile = ref(false);
// A non-admin (Solutions Success) can only ever create Sales accounts, and
// the role picker isn't rendered for them.
const effectiveNewRole = computed<Role>(() => (isAdmin.value ? newRole.value : 'sales'));

const editing = ref<Profile | null>(null);
const editingPerson = computed({
  get: () => !!editing.value,
  set: (open: boolean) => { if (!open) editing.value = null; },
});
const editName = ref('');
const editPhone = ref('');
const savingEdit = ref(false);

// null value = "not at a conference" (profiles-assign-current-event's eventId: null).
const workingAtOptions = computed(() => [
  { label: 'Not at a conference', value: null as string | null },
  ...activeEvents.value.map((e) => ({ label: e.name, value: e.id as string | null })),
]);

// Derived from each rep's own current_event_id, the same field the "Working
// at" picker writes, so the count can't disagree with the list below it.
function repCount(eventId: string): number {
  return profiles.value.filter((p) => p.role === 'sales' && p.currentEventId === eventId).length;
}

function roleLabel(role: Role) {
  if (role === 'admin') return 'Admin';
  if (role === 'solutionsSuccess') return 'Solutions Success';
  return 'Sales';
}

async function loadProfiles() {
  try {
    const { data } = await api.get<Profile[]>('/profiles-list');
    profiles.value = data;
  } finally {
    profilesLoaded.value = true;
  }
}

// Reloads the whole list rather than patching one row: the select is bound to
// the loaded value, so a failed write must snap back to what the server has,
// and the conference rows' rep counts read from the same list.
async function assignRep(p: Profile, eventId: string | null) {
  assigningRep.value = p.id;
  try {
    await api.post('/profiles-assign-current-event', { repId: p.id, eventId });
  } finally {
    await loadProfiles();
    assigningRep.value = null;
  }
}

function openAddPerson() {
  newName.value = '';
  newEmail.value = '';
  newPassword.value = '';
  newPhone.value = '';
  newRole.value = 'sales';
  addingPerson.value = true;
}

async function createProfile() {
  creatingProfile.value = true;
  try {
    await api.post('/profiles-create', {
      name: newName.value,
      email: newEmail.value,
      password: newPassword.value,
      role: effectiveNewRole.value,
      ...(newPhone.value ? { phoneNumber: newPhone.value } : {}),
    });
    addingPerson.value = false;
    await loadProfiles();
    Notify.create({ type: 'positive', message: `${newName.value}'s account was created.` });
  } finally {
    creatingProfile.value = false;
  }
}

function openEditPerson(p: Profile) {
  editing.value = p;
  editName.value = p.name;
  editPhone.value = p.phoneNumber ?? '';
}

// Setup's "Phone number needed" badge tells a rep to ask an admin to add their
// number, and profiles-update has always supported it -- this is the control
// that was missing. Clearing the phone sends null, which the server accepts
// for non-sales accounts only.
async function saveEdit() {
  if (!editing.value) return;
  const target = editing.value;
  savingEdit.value = true;
  try {
    await api.post('/profiles-update', {
      id: target.id,
      name: editName.value.trim(),
      phoneNumber: editPhone.value.trim() || null,
    });
    editing.value = null;
    await loadProfiles();
    // Editing your own row changes what Setup reads about you.
    if (target.id === sessionStore.user?.id) await Promise.all([sessionStore.fetchMe(), eventStore.fetchActive()]);
    Notify.create({ type: 'positive', message: 'Saved.' });
  } finally {
    savingEdit.value = false;
  }
}

// Deleting a profile deletes the underlying auth.users login outright --
// there's no undo and no soft-delete to restore from, so it always goes
// through a confirm step. Your own row renders no delete button at all
// (profiles-delete refuses self-deletion anyway).
function confirmDeleteProfile(p: Profile) {
  Dialog.create({
    title: 'Delete this account?',
    message: `${p.name} will no longer be able to sign in. Any contacts or conference assignments they own stay, but are no longer attributed to them. This can't be undone.`,
    cancel: true,
    persistent: true,
    ok: { label: 'Delete', color: 'negative' },
  }).onOk(() => deleteProfile(p));
}

async function deleteProfile(p: Profile) {
  await api.post('/profiles-delete', { id: p.id });
  await Promise.all([loadProfiles(), loadEvents()]);
  Notify.create({ type: 'positive', message: `${p.name}'s account was deleted.` });
}

onMounted(() => {
  void loadEvents();
  void loadProfiles();
});
</script>

<style scoped>
/* Title and its button share a line when they fit and wrap when they don't — the
   no-wrap row clipped "Conferences" down to "Conference" on a phone. */
.admin-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
}
.admin-btn { min-height: 44px; }
.admin-link { min-height: 40px; }
</style>
