// Kiosk PIN rules (used by kiosk-set-code and kiosk-verify-code).
//
// What was wrong: profiles.kiosk_pin was NOT NULL DEFAULT '1234', so every account
// "had" a PIN from the day it was created. `me` reports hasKioskPin from whether a PIN
// exists, so it was always true: the app never showed its "Set PIN" prompt, and every
// account kept the well-known default. Migration 20261012...kiosk_pin_no_default drops
// the default and clears every PIN still equal to it, so a person now has to choose
// one before they can lock a device. (The lock is a display mode on one device, not a
// security boundary; see CLAUDE.md. This only makes it do what it says.)

// The old column default. It cannot be chosen as a PIN, or the problem comes back.
export const BLOCKED_KIOSK_PINS: ReadonlySet<string> = new Set(["1234"]);
export const MIN_KIOSK_PIN_LENGTH = 4;

// Returns an error message to show, or null when the PIN is acceptable.
export function validateNewKioskPin(code: unknown): string | null {
  if (typeof code !== "string" || code.length < MIN_KIOSK_PIN_LENGTH) {
    return `code must be a string of at least ${MIN_KIOSK_PIN_LENGTH} characters`;
  }
  if (BLOCKED_KIOSK_PINS.has(code)) {
    return "That PIN is too easy to guess. Choose a different one.";
  }
  return null;
}

// Does the attempt unlock? An account with no PIN set cannot be unlocked by anything:
// without this check an empty or missing stored value could be matched by an empty attempt.
export async function kioskPinMatches(
  stored: string | null | undefined,
  attempt: string,
  compare: (a: string, b: string) => Promise<boolean>,
): Promise<boolean> {
  if (!stored) return false;
  return await compare(attempt, stored);
}
