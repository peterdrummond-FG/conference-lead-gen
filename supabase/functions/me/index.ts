// GET -> { id, name, role, email, phoneNumber, currentEventId, currentEventName,
// repSlug, hasKioskPin, onboarded }.
// Any logged-in user. The first call the frontend makes after login (or on
// app boot with an existing session) -- a Supabase Auth session alone only
// carries id/email, not this app's role/current-event state.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");

  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");

  const supabase = serviceClient();

  // onboarded_at and phone_number are read here rather than added to
  // requireUser's select: `me` is their only consumer, and widening
  // _shared/auth.ts would mean redeploying every function that imports it.
  // phone_number is the number texted cards are credited to; Setup shows it so a
  // rep can see which number we have on file before texting SETUP.
  const [{ data: authUser }, { data: event }, { data: onboarding, error: onboardingError }] = await Promise.all([
    supabase.auth.admin.getUserById(user.id),
    user.currentEventId
      ? supabase.from("events").select("name").eq("id", user.currentEventId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("profiles").select("onboarded_at, phone_number").eq("id", user.id).maybeSingle(),
  ]);

  return jsonResponse(req, {
    id: user.id,
    name: user.name,
    role: user.role,
    email: authUser?.user?.email ?? null,
    phoneNumber: onboarding?.phone_number ?? null,
    currentEventId: user.currentEventId,
    currentEventName: event?.name ?? null,
    repSlug: user.repSlug,
    hasKioskPin: !!user.kioskPin,
    // Fails closed: if the lookup errored, say "done" so a hiccup never
    // shows the welcome tour to someone who already finished it.
    onboarded: onboardingError ? true : !!onboarding?.onboarded_at,
  });
});
