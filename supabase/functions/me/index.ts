// GET -> { id, name, role, email, phoneNumber, currentEventId, currentEventName,
// repSlug, hasKioskPin, onboarded }.
// Any logged-in user. The first call the frontend makes after login (or on
// app boot with an existing session) -- a Supabase Auth session alone only
// carries id/email, not this app's role/current-event state.
//
// GET ?viewAsId=<profile id> -> the same shape for THAT person, plus smsBound
// (whether their phone has texted SETUP for their conference). Admin only: it
// backs the "View as" switcher, so Setup and Connect can show exactly what that
// person sees. Before this, the switcher only reached Review (contacts-list's
// viewAsRepId); Setup hid its whole personal section and Connect showed the
// ADMIN's own conference, so "what does Calen see?" had no answer outside
// Review. Read-only: nothing here changes which account a write lands on, and
// the kiosk PIN itself is never returned, only whether one is set.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");

  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");

  const supabase = serviceClient();

  const viewAsId = new URL(req.url).searchParams.get("viewAsId");
  if (viewAsId !== null) return viewAs(req, supabase, user.role, viewAsId);

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

async function viewAs(
  req: Request,
  supabase: ReturnType<typeof serviceClient>,
  callerRole: string,
  viewAsId: string,
): Promise<Response> {
  // Same boundary as contacts-list's viewAsRepId and MainLayout's switcher:
  // admin only. Solutions Success can manage Sales accounts but has never had
  // "View as", and this must not quietly widen that.
  if (callerRole !== "admin") return errorResponse(req, 403, "Forbidden");
  if (!UUID_RE.test(viewAsId)) return errorResponse(req, 400, "viewAsId is invalid.");

  const { data: target, error: targetError } = await supabase
    .from("profiles")
    .select("id, name, role, current_event_id, rep_slug, kiosk_pin, phone_number, onboarded_at")
    .eq("id", viewAsId)
    .maybeSingle();
  if (targetError) return errorResponse(req, 500, targetError.message);
  if (!target) return errorResponse(req, 404, "No such person.");

  const [{ data: authUser }, { data: event }, binding] = await Promise.all([
    supabase.auth.admin.getUserById(target.id),
    target.current_event_id
      ? supabase.from("events").select("name").eq("id", target.current_event_id).maybeSingle()
      : Promise.resolve({ data: null }),
    // Mirrors events-active's smsBound for its own caller: keyed by phone
    // number (phone_event_bindings is what texting SETUP writes), and left
    // undefined when there is no number, because then we can't tell.
    target.phone_number && target.current_event_id
      ? supabase
        .from("phone_event_bindings")
        .select("phone_number")
        .eq("phone_number", target.phone_number)
        .eq("event_id", target.current_event_id)
        .maybeSingle()
      : Promise.resolve(null),
  ]);
  if (binding?.error) return errorResponse(req, 500, binding.error.message);

  return jsonResponse(req, {
    id: target.id,
    name: target.name,
    role: target.role,
    email: authUser?.user?.email ?? null,
    phoneNumber: target.phone_number ?? null,
    currentEventId: target.current_event_id,
    currentEventName: event?.name ?? null,
    repSlug: target.rep_slug,
    hasKioskPin: !!target.kiosk_pin,
    onboarded: !!target.onboarded_at,
    ...(binding ? { smsBound: !!binding.data } : {}),
  });
}
