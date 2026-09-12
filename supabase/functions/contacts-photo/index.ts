// GET ?id=<contactId>&full=true -> 302 redirect to a short-lived signed
// Storage URL. Staff-gated (for consistency with the rest of /review).
// source_image_path/cropped_image_path are Supabase Storage object paths in
// the 'contact-photos' bucket (uniform for both the local watcher and
// SMS-sourced photos, per Stage 12).
import { corsHeaders, errorResponse, handlePreflight } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const full = url.searchParams.get("full") === "true";
  if (!id) return errorResponse(req, 400, "id query param is required");

  const supabase = serviceClient();
  const { data: contact, error } = await supabase
    .from("contacts")
    .select("source_image_path, cropped_image_path, rep_id")
    .eq("id", id)
    .maybeSingle();
  if (error) return errorResponse(req, 500, error.message);
  if (!contact || !contact.source_image_path) return errorResponse(req, 404, "Not found");
  if (user.role === "sales" && contact.rep_id !== user.id) return errorResponse(req, 404, "Not found");

  const path = !full && contact.cropped_image_path ? contact.cropped_image_path : contact.source_image_path;

  const { data: signed, error: signError } = await supabase.storage
    .from("contact-photos")
    .createSignedUrl(path, 60);
  if (signError || !signed) return errorResponse(req, 404, "Source image file is missing in storage.");

  // Not Response.redirect(): it builds a bare Location header with no CORS
  // headers, which fails the browser's cross-origin redirect check outright
  // (fetch() throws "Failed to fetch" before ever reaching Storage) since
  // this function's own origin differs from the frontend's.
  return new Response(null, {
    status: 302,
    headers: { ...corsHeaders(req), Location: signed.signedUrl },
  });
});
