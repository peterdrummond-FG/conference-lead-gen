<template>
  <q-layout view="hHh lpr fFf">
    <q-header v-if="sessionStore.user && !kioskModeStore.locked" class="bg-white text-dark app-header" bordered>
      <AppHeader
        :role="sessionStore.user.role" :name="sessionStore.user.name" :is-phone="isPhone"
        :can-see-setup="canSeeSetup" :can-see-export="canSeeExport" :can-see-admin="canSeeAdmin"
        :has-qr="!!qrRep" :viewing-as-label="viewingAsLabel" :profiles="profiles"
        @view-as="(p) => void sessionStore.setViewingAs(p)" @qr="showQr = true"
        @tour="onReplayTour" @logout="onLogout" @menu="showMenu = true"
      />

      <!-- Previewing someone: say so on every page, in words, with the way back.
           On a phone the switcher above is an icon with no label, so before this
           an admin could be looking at a rep's Review (or confirming their leads)
           with nothing on screen saying whose view it was. -->
      <div v-if="sessionStore.viewingAs" ref="previewBarEl" class="preview-bar" role="status">
        <q-icon name="visibility" size="18px" class="q-mr-sm" />
        <span class="preview-bar-text">
          Viewing as <span class="text-weight-bold">{{ sessionStore.viewingAs.name }}</span>
          ({{ roleLabel(sessionStore.viewingAs.role) }}). Anything you change is done as you.
        </span>
        <q-btn flat dense no-caps color="white" label="Back to me" class="preview-bar-btn" @click="void sessionStore.setViewingAs(null)" />
      </div>
    </q-header>

    <!-- Phones only; Review is first because it is the page everyone lives in.
         Same role checks as the desktop tabs. -->
    <q-drawer
      v-if="isPhone && sessionStore.user && !kioskModeStore.locked"
      v-model="showMenu"
      side="right"
      overlay
      behavior="mobile"
      :width="280"
    >
      <AppMenu
        :name="sessionStore.user?.name ?? ''"
        :can-see-setup="canSeeSetup" :can-see-export="canSeeExport" :can-see-admin="canSeeAdmin"
        @go="showMenu = false" @logout="onMenuLogout"
      />
    </q-drawer>

    <q-page-container>
      <router-view />
    </q-page-container>

    <q-btn
      v-if="kioskModeStore.locked"
      round
      flat
      icon="settings"
      class="kiosk-unlock-btn"
      color="grey-6"
      @click="showUnlockDialog = true"
    />

    <RepQrDialog v-if="qrRep" v-model="showQr" :rep="qrRep" :event-name="qrEventName" />

    <q-dialog v-model="showUnlockDialog" @hide="unlockCode = ''; unlockError = ''">
      <q-card style="width: 320px">
        <q-card-section>
          <div class="text-h6">Unlock kiosk</div>
          <div class="text-caption text-grey">Enter your kiosk PIN to unlock.</div>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <q-input
            v-model="unlockCode"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            autofocus
            label="Your kiosk PIN"
            :error="!!unlockError"
            :error-message="unlockError"
            @keyup.enter="onUnlockKiosk"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="primary" label="Unlock" :loading="unlocking" @click="onUnlockKiosk" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- The first-time onboarding, its one-hour reminder, and the tour behind the ?.
         Only for a signed-in person on an unlocked device: attendees on the
         public Kiosk form, and a booth iPad locked to it, must never see staff
         onboarding. -->
    <OnboardingHost v-if="sessionStore.user && !kioskModeStore.locked" />
  </q-layout>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { useSessionStore } from '@/stores/session-store';
import { useKioskModeStore } from '@/stores/kiosk-mode-store';
import { useTourStore } from '@/stores/tour-store';
import { flowStartAction } from '@/utils/onboardingFlow';
import AppHeader from '@/components/AppHeader.vue';
import AppMenu from '@/components/AppMenu.vue';
import RepQrDialog from '@/components/RepQrDialog.vue';
import OnboardingHost from '@/components/tour/OnboardingHost.vue';
import { api } from '@/boot/axios';
import type { Profile, Role } from '@/types/review';

const router = useRouter();
const $q = useQuasar();

// Phone widths (< 600px) drop the text from the header's action buttons and
// move the page links into a right-hand menu drawer.
const isPhone = computed(() => $q.screen.lt.sm);
const showMenu = ref(false);
// Rotating or resizing past the phone breakpoint removes the drawer, so don't
// leave it "open" for when the window narrows again.
watch(isPhone, (phone) => { if (!phone) showMenu.value = false; });
const sessionStore = useSessionStore();
const kioskModeStore = useKioskModeStore();
const tourStore = useTourStore();

// effectiveRole (real role, or the admin-only "view as" preview role when
// set) rather than sessionStore.user?.role directly -- found 2026-09-16: the
// nav tabs stayed keyed to the real admin's own role no matter who they
// picked in the "View as" switcher, so previewing a sales rep still showed
// every admin-only tab (Export) instead of what that rep would actually see.
// The switcher's own visibility (below) stays on the real role regardless --
// an admin previewing someone must always be able to switch back.
const canSeeSetup = computed(() => (
  sessionStore.effectiveRole === 'admin' || sessionStore.effectiveRole === 'solutionsSuccess' || sessionStore.effectiveRole === 'sales'
));

// Matches the /export route's own meta.roles guard (router/index.ts) — sales
// could otherwise still click into the tab even though the router would
// bounce them straight back out.
const canSeeExport = computed(() => (
  sessionStore.effectiveRole === 'admin' || sessionStore.effectiveRole === 'solutionsSuccess'
));

// Matches the /admin route's own meta.roles guard (routes.ts) — the same two
// roles that can already start conferences and manage accounts.
const canSeeAdmin = computed(() => (
  sessionStore.effectiveRole === 'admin' || sessionStore.effectiveRole === 'solutionsSuccess'
));

// The preview bar makes the header taller, and Review's sticky lead pane sits
// a fixed distance below the header, so it would slide under the bar. Its
// height (it wraps on a phone) is published as --preview-bar-h for that pane.
const previewBarEl = ref<HTMLElement | null>(null);
let previewBarObserver: ResizeObserver | null = null;
function setPreviewBarHeight(px: number) {
  document.documentElement.style.setProperty('--preview-bar-h', `${px}px`);
}
watch(previewBarEl, (el) => {
  previewBarObserver?.disconnect();
  previewBarObserver = null;
  if (!el) {
    setPreviewBarHeight(0);
    return;
  }
  previewBarObserver = new ResizeObserver(() => setPreviewBarHeight(el.offsetHeight));
  previewBarObserver.observe(el);
});
onBeforeUnmount(() => previewBarObserver?.disconnect());

// Whose QR the header button shows: the previewed rep's while an admin is
// viewing as someone, otherwise the signed-in account's own.
const showQr = ref(false);
const qrRep = computed(() => {
  const who = sessionStore.viewingAs ?? sessionStore.user;
  return who?.repSlug ? { name: who.name, repSlug: who.repSlug } : null;
});
const qrEventName = computed(() => (
  sessionStore.viewingAs ? (sessionStore.preview?.currentEventName ?? null) : (sessionStore.user?.currentEventName ?? null)
));

const showUnlockDialog = ref(false);
const unlockCode = ref('');
const unlockError = ref('');
const unlocking = ref(false);

// Kiosk-locking never signs anyone out — the same account is still the one
// logged in underneath. Unlocking checks that account's own kiosk PIN (set
// by each user in Setup), never their real login password — a device left
// unlocked shouldn't leak a real password to whoever's standing at the booth.
async function onUnlockKiosk() {
  if (!unlockCode.value) return;
  unlocking.value = true;
  unlockError.value = '';
  try {
    const { data } = await api.post<{ valid: boolean }>('/kiosk-verify-code', { code: unlockCode.value });
    if (!data.valid) {
      unlockError.value = 'Incorrect code';
      return;
    }
    kioskModeStore.unlock();
    showUnlockDialog.value = false;
  } catch {
    unlockError.value = 'Incorrect code';
  } finally {
    unlocking.value = false;
  }
}

const profiles = ref<Profile[]>([]);

function roleLabel(role: Role) {
  if (role === 'admin') return 'Admin';
  if (role === 'solutionsSuccess') return 'Solutions Success';
  return 'Sales';
}

const viewingAsLabel = computed(() => (
  sessionStore.viewingAs ? `Viewing as ${sessionStore.viewingAs.name}` : 'Myself (Admin)'
));

async function loadProfiles() {
  const { data } = await api.get<Profile[]>('/profiles-list');
  profiles.value = data;
}

watch(() => sessionStore.user?.role, (role) => {
  if (role === 'admin') void loadProfiles();
}, { immediate: true });

// Starts the onboarding for someone who hasn't seen it, shows the one-hour
// reminder once it is due, or picks a refreshed tab back up mid-flow. The rules
// are utils/onboardingFlow.ts (tested). Uses the person's real role, not
// effectiveRole: an admin previewing a rep's view (viewingAs) shouldn't trigger
// onboarding, and shouldn't be shown the rep's version of it. Checked when the
// account loads and whenever the app is opened or returned to, which is when a
// reminder that became due while the tab sat open should appear.
function maybeStartOnboarding() {
  const u = sessionStore.user;
  const action = flowStartAction({
    hasUser: !!u,
    kioskLocked: kioskModeStore.locked,
    viewingAs: !!sessionStore.viewingAs,
    phase: tourStore.phase,
    onboarding: u?.onboarding,
    now: Date.now(),
  });
  if (action === 'reset') {
    tourStore.reset();
    return;
  }
  if (!u || tourStore.phase !== 'idle' || kioskModeStore.locked || sessionStore.viewingAs) return;
  if (tourStore.resume(u.id)) return;
  if (action === 'splash') tourStore.showSplash(u.id);
  else if (action === 'reminder' && u.onboarding?.resumeFrom) tourStore.showReminder(u.id, u.onboarding.resumeFrom);
}

watch(
  () => [sessionStore.user?.id, sessionStore.user?.onboarding?.seen, kioskModeStore.locked, sessionStore.viewingAs?.id],
  maybeStartOnboarding,
  { immediate: true },
);
function onVisible() {
  if (document.visibilityState === 'visible') maybeStartOnboarding();
}
document.addEventListener('visibilitychange', onVisible);
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible));

// The ? button: always the whole tour from the top. Never changes what the
// account remembers, so it can't bring the splash or a reminder back.
function onReplayTour() {
  if (sessionStore.user) tourStore.playReplay(sessionStore.user.id);
}

function onMenuLogout() {
  showMenu.value = false;
  void onLogout();
}

async function onLogout() {
  // Drop an in-progress tour without counting it as seen, so the next person
  // on this tab doesn't resume it.
  tourStore.reset();
  await sessionStore.logout();
  void router.push('/login');
}
</script>

<style scoped>
.app-header {
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

.preview-bar {
  display: flex;
  align-items: center;
  gap: 4px 0;
  padding: 6px 8px 6px 16px;
  background: #5B3E96;
  color: #fff;
  font-size: 14px;
  line-height: 1.35;
}
.preview-bar-text { flex: 1; min-width: 0; }
.preview-bar-btn { flex: none; min-height: 40px; }

.kiosk-unlock-btn {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2000;
  opacity: 0.45;
}

.kiosk-unlock-btn:hover {
  opacity: 1;
}
</style>
