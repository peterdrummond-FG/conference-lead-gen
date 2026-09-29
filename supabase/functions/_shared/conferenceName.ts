// What a conference's Zoho campaign name says about it, for the web app's
// "Start a conference" search (campaigns-list).
//
// Names in this org follow "YYYY MM.DD[-DD] (ST) Title" -- see
// conference_date_from_name / conference_end_date_from_name in the database for
// the date half. This is the state half: Zoho campaigns carry no structured
// state (contacts-create's own comment on the same gap), so it's read from the
// "(ST)" postal code. A code that isn't a real postal abbreviation -- e.g.
// "(TW)" for Texas West -- deliberately maps to null rather than a guess, since
// a wrong state silently corrupts district-resolution fallback and Review's
// state filter for the whole conference (see US_STATE_BY_ABBREVIATION).
//
// twilio-webhook carries an identical local copy (stateFromConferenceName) for
// its SMS "SETUP" flow. It is left alone here so this change doesn't force a
// redeploy of a function that isn't otherwise changing; fold it into this file
// the next time twilio-webhook is deployed, so the two can't drift apart.
import { US_STATE_BY_ABBREVIATION } from "./usStates.ts";

export function stateFromConferenceName(name: string): string | null {
  const paren = /\(([A-Za-z]{2})\)/.exec(name);
  if (paren) {
    const state = US_STATE_BY_ABBREVIATION[paren[1].toUpperCase()];
    if (state) return state;
  }
  const suffix = /,\s*([A-Za-z]{2})\b/.exec(name);
  if (suffix) {
    const state = US_STATE_BY_ABBREVIATION[suffix[1].toUpperCase()];
    if (state) return state;
  }
  return null;
}
