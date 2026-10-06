// The words of the first-time onboarding, as plain data (no components, no
// aliases) so the wording can be reviewed without reading layout code and a test
// can run the copy checks directly. tourFlow.ts attaches the components.
export interface SceneCopy {
  title: string;
  // `**word**` renders bold and `{number}` becomes the text-in number (from
  // utils/smsNumber.ts, which Setup uses too). Nothing else is markup.
  // Bold follows ONE rule (a test holds it): bold only the name of a tab or
  // button the person taps in that sentence (Admin, Import, Setup, Kiosk, Export,
  // Approve, Followed up, Yes, it downloaded), or SETUP as the word they text.
  // Field labels, numbers and other mid-sentence phrases are plain; emphasis that
  // isn't something to tap reads as random.
  body: string;
  note?: string;
}

export interface SceneCopyEntry extends SceneCopy {
  // The id used everywhere: onboardingFlow.ts, the recorded resume point, the
  // Edge Function's allow-list. A test keeps them the same.
  id: string;
  managersOnly?: boolean;
  // Where a manager's version of the scene says something different.
  forManagers?: Partial<SceneCopy>;
  // The note when the account has no mobile number, by role.
  noPhoneNote?: { sales: string; solutionsSuccess: string; admin: string };
  // The version a quick-start rep sees from the reminder, which starts at Import.
  importOnly?: SceneCopy;
}

export const SCENE_COPY: SceneCopyEntry[] = [
  {
    id: 'setup',
    title: 'Text SETUP to start',
    body: "From your phone, text **SETUP** to {number}, then reply with your conference's name and pick it from the list.",
    note: "Already picked one in the app? We'll just confirm it. You can change it any time on **Setup**.",
    // No mobile number on the account: SETUP can't link the phone, so texted
    // leads wouldn't be credited to anyone. Who can fix it depends on the role:
    // Admin lists Solutions Success and Sales accounts with an Edit on each (an
    // admin's own row included), Solutions Success sees Sales accounts only.
    noPhoneNote: {
      sales: 'Your account needs your mobile number first. Ask your Solutions Success rep to add it.',
      solutionsSuccess: 'Your account needs your mobile number first. Ask an admin to add it.',
      admin: 'Your account needs your mobile number first. Add it in Admin, under Team.',
    },
  },
  {
    id: 'send',
    title: 'Send us leads',
    body: 'Text a photo of a business card, conference ID or contact list, or a voice memo. Typing it out? One person per text.',
    note: 'Jotted down a few names? Tap **Import** in Review and paste them. We make one lead per person.',
    // The quick start already showed the texting half, so a quick-start rep's
    // reminder plays this scene starting at the Import button.
    importOnly: {
      title: 'Send us leads',
      body: 'Jotted down a few names? Tap **Import** in Review and paste them. We make one lead per person.',
      note: 'You can also text photos, a voice memo, or one person at a time.',
    },
  },
  {
    id: 'qr',
    title: 'Or let them add themselves',
    body: 'Tap the QR icon at the top to show your code. People scan it, fill in their details, and the lead comes to you.',
    note: 'Setting up an iPad at the booth? Open **Kiosk**.',
    forManagers: {
      body: 'Every rep has a QR code of their own. Save it for them from **Admin**, under Team.',
    },
  },
  {
    id: 'review',
    title: 'Check it, then approve it',
    body: 'Every lead arrives already checked against Zoho. Tap one, fix anything missing, tick **Followed up**, then **Approve**.',
    note: 'Notes you add go to Zoho with the lead.',
  },
  {
    id: 'export',
    title: 'Export to Zoho',
    body: 'Open **Export** and download your approved leads, ready to import into Zoho.',
    note: 'Then tap **Yes, it downloaded** so they are not in your next file.',
    managersOnly: true,
  },
  {
    id: 'admin',
    title: 'Look after your team',
    body: 'In **Admin**, activate and end conferences, add people, and choose which conference each rep is working at.',
    note: 'Scans that need a conference wait here for you to file.',
    managersOnly: true,
  },
];

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
    // This is the quick start's FIRST screen and "Link your phone" is the second,
    // so it can't open with "Then". The body says the true order: a first text from
    // a phone that isn't linked yet gets "Text SETUP to link it", so linking has to
    // come before any of this works, and the next screen is where they do it.
    body: 'Once your phone is linked, snap a business card, conference ID or contact list, or send a voice memo. We turn it into a lead.',
    note: 'Typing it yourself? One person per text.',
  },
  quickLink: {
    title: 'Link your phone',
    body: "Text **SETUP**, then reply with your conference's name and pick it from the list.",
    noPhoneBody: 'Texting your leads in needs your mobile number on your account.',
    footer: 'Want the full picture? Tap **?** at the top any time for the 1-minute tour.',
  },
  finish: {
    title: 'Your turn',
    body: 'Start by texting **SETUP** from your phone. It takes about a minute.',
    go: 'Go to Setup',
    again: 'Watch again',
    // Someone who already texted SETUP (the quick start), or who replays the tour
    // later, is linked already: telling them to start by texting SETUP would be
    // wrong. The real value comes from `me`'s sms status (phoneConnected).
    connected: {
      title: "You're all set",
      body: "Your phone is linked, so text your leads in whenever you're ready.",
      go: 'Go to Review',
    },
  },
  skipped: 'No problem. Tap ? at the top any time to watch the tour.',
  reminder: { watch: 'Watch now', later: 'Not now', fine: 'Skip it and you can still watch any time from the ? at the top of the app.' },
};
