// POST { id?, name, phoneNumber, pin? } -> the created/updated Rep.
// Staff-gated (used by /setup). Omit id to create a new rep; pass an
// existing id to rename it, change its phone number, or set/change its own
// PIN (a rep sets this themself — see reps-verify-pin — omit to leave
// whatever PIN, if any, is already on file unchanged).
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { requireStaffPin } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { normalizeUsPhone } from "../_shared/phone.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse(req, 405, "Method not allowed");
  if (!(await requireStaffPin(req))) return errorResponse(req, 401, "Unauthorized");

  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim() || typeof body.phoneNumber !== "string") {
    return errorResponse(req, 400, "name and phoneNumber are required");
  }

  const phoneNumber = normalizeUsPhone(body.phoneNumber);
  if (!phoneNumber) return errorResponse(req, 400, "phoneNumber must be a valid US phone number.");

  // has(...) not "!== undefined": a PATCH-style partial update needs to
  // tell "pin omitted" (leave whatever's on file alone) apart from
  // "pin explicitly cleared" isn't a case here (empty string comes through
  // as a truthy has() with body.pin === "", coerced to null below).
  const pinProvided = Object.prototype.hasOwnProperty.call(body, "pin");
  if (pinProvided && body.pin !== null && typeof body.pin !== "string") {
    return errorResponse(req, 400, "pin must be a string or null");
  }

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("reps")
    .upsert(
      {
        ...(body.id ? { id: body.id } : {}),
        name: body.name.trim(),
        phone_number: phoneNumber,
        ...(pinProvided ? { pin: body.pin?.trim() || null } : {}),
      },
      { onConflict: body.id ? "id" : "phone_number" },
    )
    .select()
    .single();
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(req, { id: data.id, name: data.name, phoneNumber: data.phone_number }, 201);
});
