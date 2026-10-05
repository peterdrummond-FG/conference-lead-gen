// The words of the animated tour, as plain data so they can be reviewed
// without reading any layout code. Each scene is one screen the rep reads
// while its animation plays; they only ever tap Next.
import type { Component } from 'vue';
import { TWILIO_NUMBER_DISPLAY } from '@/utils/smsNumber';
import TourSceneSetup from './scenes/TourSceneSetup.vue';
import TourSceneSend from './scenes/TourSceneSend.vue';
import TourSceneQr from './scenes/TourSceneQr.vue';
import TourSceneReview from './scenes/TourSceneReview.vue';
import TourSceneExport from './scenes/TourSceneExport.vue';
import TourSceneAdmin from './scenes/TourSceneAdmin.vue';

interface SceneCopy {
  title: string;
  // `**word**` renders bold and `{number}` becomes the text-in number (from
  // utils/smsNumber.ts, which Setup uses too). Nothing else is markup.
  body: string;
  note?: string;
}

export interface TourScene extends SceneCopy {
  id: string;
  managersOnly?: boolean;
  // Where a manager's version of the scene says something different.
  forManagers?: Partial<SceneCopy>;
  component: Component;
}

export const TOUR_SCENES: TourScene[] = [
  {
    id: 'setup',
    title: 'Text SETUP to start',
    body: 'From your phone, text **SETUP** to **{number}**. We reply with the conference you are linked to.',
    note: 'Wrong conference? Reply **CHANGE**, or change it in the app on **Setup**.',
    component: TourSceneSetup,
  },
  {
    id: 'send',
    title: 'Send us leads',
    body: 'Text a photo of a business card, conference ID or contact list, or a voice memo. Typing it out? One person per text.',
    note: 'Jotted down a few names? Tap **Import** in Review and paste them. We make one lead per person.',
    component: TourSceneSend,
  },
  {
    id: 'qr',
    title: 'Or let them add themselves',
    body: 'Tap the QR icon at the top to show your code. People scan it, fill in their details, and the lead comes to you.',
    note: 'Setting up an iPad at the booth? Open **Kiosk**.',
    forManagers: {
      body: 'Every rep has a QR code of their own. Save it for them from **Admin**, under Team.',
    },
    component: TourSceneQr,
  },
  {
    id: 'review',
    title: 'Check it, then approve it',
    body: 'Every lead arrives already checked against Zoho. Tap one, fix anything missing, tick **Followed up**, then **Approve**.',
    note: 'Notes you add go to Zoho with the lead.',
    component: TourSceneReview,
  },
  {
    id: 'export',
    title: 'Export to Zoho',
    body: 'Open **Export** and download your approved leads, ready to import into Zoho.',
    note: 'Then tap **Yes, it downloaded** so they are not in your next file.',
    managersOnly: true,
    component: TourSceneExport,
  },
  {
    id: 'admin',
    title: 'Look after your team',
    body: 'In **Admin**, activate and end conferences, add people, and choose which conference each rep is **Working at**.',
    note: 'Scans that need a conference wait here for you to file.',
    managersOnly: true,
    component: TourSceneAdmin,
  },
];

export function scenesFor(manager: boolean): TourScene[] {
  return TOUR_SCENES
    .filter((s) => manager || !s.managersOnly)
    .map((s) => (manager && s.forManagers ? { ...s, ...s.forManagers } : s));
}

// Copy markup to HTML: escaped first, then **bold** and {number}.
export function renderCopy(s: string): string {
  return s
    .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
    .replace(/\{number\}/g, `<span style="white-space:nowrap">${TWILIO_NUMBER_DISPLAY}</span>`)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

// Everything around the tour: the first screen, the two-screen quick start,
// the hand-off at the end, and the two "you can still watch it" reminders.
export const ONBOARDING_COPY = {
  splash: {
    title: 'Welcome to CKH Connect',
    body: 'Send us the people you meet and we check them against Zoho for you. How do you want to start?',
    quick: { label: 'Just get me texting', sub: 'Link your phone and start sending contacts.' },
    tour: { label: 'Show me how it works', sub: 'A 1-minute tour of everything.', subManagers: 'A 1-minute tour, plus Export and Admin.' },
    fine: 'You can watch the tour any time from the ? at the top of the app.',
  },
  quickText: {
    title: 'Text us your leads',
    body: 'Snap a business card, conference ID or contact list, or send a voice memo. We turn it into a lead.',
    note: 'Typing it yourself? One person per text.',
  },
  quickLink: {
    title: 'Link your phone',
    body: 'Text **SETUP** and follow the prompts. We reply with the conference you are linked to.',
    noPhoneBody: 'Texting your leads in needs your mobile number on your account.',
    footer: 'Want the full picture? Tap **?** at the top any time for the 1-minute tour.',
  },
  finish: {
    title: 'Your turn',
    body: 'Start by texting **SETUP** from your phone. It takes about a minute.',
    go: 'Go to Setup',
    again: 'Watch again',
  },
  skipped: 'No problem. Tap ? at the top any time to watch the tour.',
  reminder: {
    title: 'Got a minute?',
    body: 'Watch the 1-minute tour to see how your leads get from your phone to Zoho.',
    watch: 'Watch now',
    later: 'Not now',
  },
};

// How the welcome ended, so the caller can record it on the account and decide
// on the reminder: 'quick', 'quick-texted' and 'skipped' get one reminder the
// next time the app is opened at least an hour later; 'finished' doesn't.
// Every ending except 'skipped' lands on Setup.
export type OnboardingEnd = 'quick' | 'quick-texted' | 'skipped' | 'finished';
