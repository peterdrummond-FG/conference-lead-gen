// GET ?id=<inboundMessageId> -> 302 to a short-lived signed Storage URL for the photo
// a rep texted in. For Contacts' "View photo" on a card that failed to process: there
// is no contact (so no contacts-photo) to show it from, and the rep needs to see the
// picture to decide between Retry and Delete.
//
// Same shape as contacts-photo, for the same reasons: the page fetches it with its
// token and shows the bytes as a blob: URL (CSP img-src has no Storage host), and the
// 302 carries CORS headers because a bare redirect would fail the browser's
// cross-origin check. Ownership as every inbound-messages function: a sales rep reaches
// only photos sent from their own number. The file is deleted 90 days after arrival
// (docs/DATA-RETENTION.md); then this answers 404 and the card shows no View photo.
import { corsHeaders, errorResponse, handlePreflight } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return errorResponse(req, 400, "id query param is required");

  const supabase = serviceClient();
  const { data: message, error } = await supabase
    .from("inbound_messages")
    .select("kind, from_phone, storage_path")
    .eq("id", id)
    .maybeSingle();
  if (error) return errorResponse(req, 500, error.message);
  if (!message || message.kind !== "photo" || !message.storage_path) return errorResponse(req, 404, "Not found");

  if (user.role === "sales") {
    const { data: profile } = await supabase.from("profiles").select("phone_number").eq("id", user.id).maybeSingle();
    if (!profile?.phone_number || profile.phone_number !== message.from_phone) return errorResponse(req, 404, "Not found");
  }

  const { data: signed, error: signError } = await supabase.storage.from("contact-photos").createSignedUrl(message.storage_path, 60);
  if (signError || !signed) return errorResponse(req, 404, "This photo is no longer available.");

  return new Response(null, { status: 302, headers: { ...corsHeaders(req), Location: signed.signedUrl } });
});
