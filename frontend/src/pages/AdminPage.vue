<template>
  <q-page :class="[$q.screen.lt.sm ? 'q-pa-sm' : 'q-pa-lg', 'flex', 'flex-center']">
    <div style="width: 640px; max-width: 100%" class="q-gutter-md">
      <div>
        <div class="text-h5">Admin</div>
        <div class="text-body2 text-grey-8 q-mt-xs">
          Activate and end conferences, and manage who's on your team.
        </div>
      </div>

      <q-card>
        <q-card-section>
          <div class="admin-head">
            <div class="text-h6">Conferences</div>
            <q-btn color="primary" no-caps icon="add" label="Activate a conference" class="admin-btn" @click="pickingNew = true" />
          </div>
          <div class="text-caption text-grey-8 q-mt-xs">
            A conference stays live until you end it. Reps join a live one from their Setup page.
          </div>
        </q-card-section>

        <q-card-section v-if="!eventsLoaded" class="q-pt-none text-caption text-grey-8">Loading…</q-card-section>
        <q-card-section v-else-if="!eventRows.length" class="q-pt-none text-body2">
          No conferences yet. Activate one to get going.
        </q-card-section>
        <q-list v-else separator>
          <q-separator />
          <q-item v-for="event in eventRows" :key="event.id" class="q-py-md">
            <q-item-section>
              <q-item-label>
                {{ event.name }}
                <q-badge
                  class="q-ml-xs"
                  :color="event.status === 'active' ? 'positive' : 'grey-6'"
                  :label="event.status === 'active' ? 'Live' : 'Ended'"
                />
              </q-item-label>
              <q-item-label caption>
                {{ event.state }} · started {{ formatRelativeTime(event.activatedAt) }}
                <template v-if="event.status === 'active' && repCount(event.id)">
                  · {{ repCount(event.id) }} {{ repCount(event.id) === 1 ? 'rep' : 'reps' }}
                </template>
              </q-item-label>
              <q-item-label v-if="event.status === 'active' && !repCount(event.id)" caption class="text-orange-9">
                <q-icon name="warning" size="14px" /> No reps yet
              </q-item-label>
            </q-item-section>
            <q-item-section v-if="event.status === 'active'" side>
              <q-btn
                outline no-caps color="negative" label="End" class="admin-btn"
                :aria-label="`End ${event.name}`"
                :loading="completingEvent === event.id"
                @click="confirmMarkComplete(event)"
              />
            </q-item-section>
          </q-item>
        </q-list>
      </q-card>

      <q-card>
        <q-card-section>
          <div class="admin-head">
            <div class="text-h6">Team</div>
            <q-btn color="primary" no-caps icon="add" label="Add person" class="admin-btn" @click="openAddPerson" />
          </div>
          <div class="text-caption text-grey-8 q-mt-xs">
            {{ isAdmin ? 'Solutions Success and Sales accounts.' : 'Sales accounts.' }}
            A rep can only be at one conference at a time. A scan for a rep who isn't at one waits in Review for you to file it.
          </div>
        </q-card-section>

        <q-card-section v-if="!profilesLoaded" class="q-pt-none text-caption text-grey-8">Loading…</q-card-section>
        <q-card-section v-else-if="!profiles.length" class="q-pt-none text-body2">No accounts yet.</q-card-section>
        <q-list v-else separator>
          <q-separator />
          <q-item v-for="p in profiles" :key="p.id" class="q-py-md">
            <q-item-section>
              <q-item-label>
                {{ p.name }}
                <q-badge class="q-ml-xs" color="grey-7" :label="roleLabel(p.role)" />
              </q-item-label>
              <q-item-label caption>
                {{ p.email }}<template v-if="p.phoneNumber"> · {{ p.phoneNumber }}</template>
                <span v-else class="text-orange-9"> · no phone number</span>
              </q-item-label>

              <!-- Only sales reps have a QR (repSlug) and only their
                   current_event_id decides where a scan lands, so this is the
                   one control that fixes a rep who forgot to join. -->
              <q-select
                v-if="p.role === 'sales'"
                :model-value="p.currentEventId"
                :options="workingAtOptions"
                emit-value
                map-options
                dense
                outlined
                class="q-mt-sm"
                style="width: 100%; max-width: 320px"
                label="Working at"
                :loading="assigningRep === p.id"
                @update:model-value="(v: string | null) => assignRep(p, v)"
              />
              <q-item-label
                v-if="p.role === 'sales' && !p.currentEventId && activeEvents.length"
                caption class="text-orange-9 q-mt-xs"
              >
                <q-icon name="warning" size="14px" /> Not at a conference, so their scans wait in Review
              </q-item-label>

              <!-- Labelled rather than an icon in the corner: this is how an
                   admin gets a rep their slide to send, and an unlabelled QR
                   glyph beside edit/delete wasn't findable. -->
              <div v-if="p.role === 'sales' && p.repSlug" class="q-mt-sm">
                <qr-save-buttons :rep="{ name: p.name, repSlug: p.repSlug }" class="admin-link" />
              </div>
            </q-item-section>

            <q-item-section side top>
              <div class="row no-wrap">
                <q-btn flat round padding="10px" icon="edit" color="grey-8" aria-label="Edit" @click="openEditPerson(p)">
                  <q-tooltip>Edit name or phone</q-tooltip>
                </q-btn>
                <q-btn
                  v-if="p.id !== sessionStore.user?.id"
                  flat round padding="10px" icon="delete" color="grey-8" aria-label="Delete"
                  @click="confirmDeleteProfile(p)"
                />
              </div>
            </q-item-section>
          </q-item>
        </q-list>
      </q-card>

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
import QrSaveButtons from '@/components/QrSaveButtons.vue';
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

// Rough enough to disambiguate same-named test/duplicate conferences -- not a
// general-purpose formatter.
function formatRelativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

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

function confirmMarkComplete(event: RecentEventOption) {
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
