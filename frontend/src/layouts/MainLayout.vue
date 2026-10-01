<template>
  <q-layout view="hHh lpr fFf">
    <q-header v-if="sessionStore.user && !kioskModeStore.locked" class="bg-white text-dark app-header" bordered>
      <q-toolbar class="app-toolbar">
        <q-toolbar-title class="app-logo">CKH Connect</q-toolbar-title>
        <q-tabs class="nav-pills" indicator-color="transparent" no-caps dense>
          <q-route-tab v-if="canSeeSetup" to="/setup" label="Setup" />
          <q-route-tab to="/connect" label="Kiosk" />
          <q-route-tab to="/review" label="Review" />
          <q-route-tab v-if="canSeeExport" to="/export" label="Export" />
          <q-route-tab v-if="canSeeAdmin" to="/admin" label="Admin" data-tour="nav-admin" />
        </q-tabs>
        <q-separator vertical spaced />

        <!-- Admin only: a genuine "view as" switcher, backed by real
             accounts — picking someone previews Review exactly as they'd
             see it, but every write still lands under the admin's own
             account (see session-store's effectiveRole/effectiveRepId). -->
        <q-btn-dropdown v-if="sessionStore.user.role === 'admin'" flat dense no-caps icon="switch_account" color="primary" :label="isPhone ? undefined : viewingAsLabel" :aria-label="viewingAsLabel">
          <q-tooltip>View as</q-tooltip>
          <q-list>
            <q-item clickable v-close-popup @click="void sessionStore.setViewingAs(null)">
              <q-item-section>Myself (Admin)</q-item-section>
            </q-item>
            <q-separator />
            <q-item v-for="p in profiles" :key="p.id" clickable v-close-popup @click="void sessionStore.setViewingAs(p)">
              <q-item-section>{{ p.name }} ({{ roleLabel(p.role) }})</q-item-section>
            </q-item>
          </q-list>
        </q-btn-dropdown>
        <div v-else class="text-caption text-grey q-px-sm app-username">{{ sessionStore.user.name }}</div>

        <!-- The rep's own QR on screen in one tap, so showing it to someone is not
             a trip to Setup. Only for an account that has one (Sales); an admin
             previewing a rep gets that rep's. -->
        <q-btn v-if="qrRep" flat dense round icon="qr_code_2" color="grey-7" aria-label="Show my QR code" data-tour="qr-button" @click="showQr = true">
          <q-tooltip>Show my QR code</q-tooltip>
        </q-btn>

        <!-- Replays the welcome tour. Never touches the saved "seen it" mark:
             that was set the first time and a replay shouldn't undo it. -->
        <q-btn flat dense round icon="help_outline" color="grey-7" aria-label="Take the tour" data-tour="tour-replay" @click="onReplayTour">
          <q-tooltip>Take the tour</q-tooltip>
        </q-btn>

        <q-separator vertical spaced />
        <q-btn v-if="!isPhone" flat dense icon="logout" round color="grey-7" aria-label="Log out" @click="onLogout">
          <q-tooltip>Log out</q-tooltip>
        </q-btn>

        <!-- Phones: a bare log-out icon beside the QR and ? icons is one slip from
             signing out, so it sits behind a labelled menu. (Lock kiosk used to
             live up here too; it is on the Kiosk page now, next to the form it
             locks.) The ? stays on its own because the tour's last step points
             at it. -->
        <q-btn v-else flat dense round icon="account_circle" color="grey-8" aria-label="Account menu">
          <q-menu auto-close anchor="bottom right" self="top right">
            <q-list style="min-width: 240px">
              <q-item clickable @click="onLogout">
                <q-item-section avatar><q-icon name="logout" /></q-item-section>
                <q-item-section>Log out</q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
      </q-toolbar>

      <!-- Previewing someone: say so on every page, in words, with the way back.
           On a phone the switcher above is an icon with no label, so before this
           an admin could be looking at a rep's Review (or approving their leads)
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

    <!-- The first-time welcome. Only for a signed-in person on an unlocked
         device: attendees on the public Kiosk form, and a booth iPad locked
         to it, must never see staff onboarding. -->
    <template v-if="sessionStore.user && !kioskModeStore.locked">
      <OnboardingSplash />
      <TourOverlay />
    </template>
  </q-layout>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { useSessionStore } from '@/stores/session-store';
import { useKioskModeStore } from '@/stores/kiosk-mode-store';
import { useTourStore } from '@/stores/tour-store';
import { tourStartAction } from '@/utils/onboardingTour';
import RepQrDialog from '@/components/RepQrDialog.vue';
import OnboardingSplash from '@/components/onboarding/OnboardingSplash.vue';
import TourOverlay from '@/components/onboarding/TourOverlay.vue';
import { api } from '@/boot/axios';
import type { Profile, Role } from '@/types/review';

const router = useRouter();
const $q = useQuasar();

// Phone widths (< 600px) drop the text from the header's action buttons and
// wrap the tabs onto their own row — see the .app-toolbar rules below.
const isPhone = computed(() => $q.screen.lt.sm);
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

// Starts the welcome for someone who hasn't seen it, or picks a refreshed tab
// back up mid-tour. Uses the person's real role, not effectiveRole: an admin
// previewing a rep's view (viewingAs) shouldn't trigger a tour, and shouldn't be
// shown the rep's version of it. Only an explicit `onboarded === false` starts
// it, so an older `me` response with no such field never shows it to everyone.
function maybeStartTour() {
  const u = sessionStore.user;
  const action = tourStartAction({
    hasUser: !!u,
    kioskLocked: kioskModeStore.locked,
    viewingAs: !!sessionStore.viewingAs,
    phase: tourStore.phase,
  });
  if (action === 'reset') {
    tourStore.reset();
    return;
  }
  if (action !== 'begin' || !u) return;
  if (tourStore.resume(u.role)) return;
  if (u.onboarded === false) tourStore.start(u.role);
}

watch(
  () => [sessionStore.user?.id, sessionStore.user?.onboarded, kioskModeStore.locked],
  maybeStartTour,
  { immediate: true },
);

function onReplayTour() {
  if (sessionStore.user) tourStore.start(sessionStore.user.role);
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

.app-logo {
  font-weight: 700;
  color: var(--q-primary);
  flex: 0 0 auto;
  margin-right: 24px;
}

.nav-pills {
  background: #EEF3F8;
  border-radius: 12px;
  padding: 4px;
  min-height: auto;
}

.nav-pills :deep(.q-tab) {
  border-radius: 8px;
  min-height: 36px;
  color: #5b7185;
  font-weight: 500;
  padding: 0 16px;
}

.nav-pills :deep(.q-tab--active) {
  background: white;
  color: var(--q-primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

/* Phones: the single row (logo + 4 tabs + "Viewing as …" + QR + logout) is wider than a 375px screen, so the tabs were cut off at
   "Revi…" and the page scrolled sideways. Two rows instead: logo and icon
   actions on top, the tabs as equal-width pills underneath. */
@media (max-width: 599px) {
  .app-toolbar {
    flex-wrap: wrap;
    padding: 4px 8px 8px 12px;
    row-gap: 4px;
  }

  .app-logo {
    flex: 1 1 0;
    min-width: 0;
    margin-right: 0;
  }

  .app-toolbar > .q-separator {
    display: none;
  }

  .app-username {
    max-width: 30vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .app-toolbar > .q-btn {
    min-width: 44px;
    min-height: 44px;
  }

  .nav-pills {
    order: 10;
    flex: 1 0 100%;
  }

  .nav-pills :deep(.q-tabs__content) {
    width: 100%;
  }

  .nav-pills :deep(.q-tab) {
    flex: 1 1 0;
    padding: 0 8px;
    min-height: 40px;
  }
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
