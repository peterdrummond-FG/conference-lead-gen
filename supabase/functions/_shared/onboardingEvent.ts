// What the browser tells profiles-complete-onboarding, validated. Pure, so the rules
// (especially the legacy body-less call) are tested without a server.
//
// A body-less call is the OLD welcome tour finishing: the first version of this function
// took no body and stamped profiles.onboarded_at. A tab that was open on the old
// frontend keeps making exactly that call after this ships, because the function is
// deployed before the frontend that replaces it. Answering it with a 400 would break
// those tabs mid-flow, so it stays valid and does what it always did. Validation is for
// when a body is present: the new frontend always sends one.

// The ids in frontend/src/components/tour/tourFlow.ts (TOUR_SCENES) plus the
// import-only half of "Send us leads". Keep in step; a frontend test checks.
export const RESUME_IDS = ["setup", "send", "send-import", "qr", "review", "export", "admin"];

export type OnboardingBody =
  | { kind: "legacy" }
  | { kind: "seen" }
  | { kind: "ended"; path: "quick" | "tour"; resumeFrom: string | null }
  | { kind: "reminder-shown" }
  | { kind: "complete" }
  | { kind: "invalid"; message: string };

export function parseOnboardingBody(raw: string): OnboardingBody {
  if (!raw.trim()) return { kind: "legacy" };
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { kind: "invalid", message: "Body must be JSON." };
  }
  if (!body || typeof body !== "object" || typeof (body as { event?: unknown }).event !== "string") {
    return { kind: "invalid", message: "event is required." };
  }
  const b = body as { event: string; path?: unknown; resumeFrom?: unknown };
  switch (b.event) {
    case "seen":
      return { kind: "seen" };
    case "reminder-shown":
      return { kind: "reminder-shown" };
    case "complete":
      return { kind: "complete" };
    case "ended": {
      if (b.path !== "quick" && b.path !== "tour") return { kind: "invalid", message: "path must be 'quick' or 'tour'." };
      const resumeFrom = b.resumeFrom ?? null;
      if (resumeFrom !== null && (typeof resumeFrom !== "string" || !RESUME_IDS.includes(resumeFrom))) {
        return { kind: "invalid", message: "resumeFrom must be a known scene id or null." };
      }
      return { kind: "ended", path: b.path, resumeFrom };
    }
    default:
      return { kind: "invalid", message: "Unknown event." };
  }
}
