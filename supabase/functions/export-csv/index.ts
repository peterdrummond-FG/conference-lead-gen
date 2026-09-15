// GET -> text/csv attachment. Staff-gated. Port of ExportEndpoints.cs's
// GET /api/export — another Stage 10 gap caught during Stage 15's
// frontend wiring. Fetched via the normal authenticated axios instance
// (responseType: 'blob') rather than a plain <a href> navigation, since a
// browser navigation can't carry the staff-PIN header or the anon-key
// bearer token this function needs — see ExportPage.vue.
import { corsHeaders, handlePreflight } from "../_shared/http.ts";
import { hasRole, requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";

// OWASP CSV/formula-injection mitigation: a value starting with one of
// these characters is interpreted as a formula by Excel/Sheets if a human
// opens the export before re-importing to Zoho. Prefixing with a plain
// quote neutralizes it without altering the visible text otherwise.
function csvField(value: string): string {
  if (value.length > 0 && "=+-@\t\r".includes(value[0])) {
    value = "'" + value;
  }
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

// deno-lint-ignore no-explicit-any
function channelLabel(c: any): string {
  if (c.qr_channel === "booth") return "Booth";
  if (c.qr_channel === "session") return "Breakout Session";
  return "";
}

// deno-lint-ignore no-explicit-any
function buildDescription(c: any): string {
  const parts: string[] = [];
  if (c.extraction_confidence) parts.push(`Extraction confidence: ${c.extraction_confidence}`);
  if (c.match_confidence) parts.push(`Match confidence: ${c.match_confidence}`);
  if (c.notes?.trim()) parts.push(c.notes);
  return parts.join(" — ");
}

// A row can be approved with no Zoho Account match at all (a genuinely new
// school/district — see match-contact's "new_account" status). There's
// nothing to put in the Account Id column yet, so the best available name
// falls back through our own local match, then whatever raw text the rep
// typed at intake.
// deno-lint-ignore no-explicit-any
function accountName(c: any): string {
  return c.matched_zoho_account_name ?? c.school?.name ?? c.school_name_raw ?? c.school_district?.name ?? c.school_district_name_raw ?? "";
}

// deno-lint-ignore no-explicit-any
function accountStatus(c: any): string {
  return c.matched_zoho_account_id ? "Existing" : "New — create in Zoho";
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405, headers: corsHeaders(req) });
  const user = await requireUser(req);
  if (!user || !hasRole(user, ["admin", "solutionsSuccess"])) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }

  const supabase = serviceClient();

  // Two-phase (audit Q2): RESERVE the exportable set here, and stamp
  // synced_at only once the client confirms it actually received the blob
  // (export-confirm). Marking first meant a timeout or a dropped download
  // silently removed those leads from every future export, with no record of
  // which ones -- and since the predicate widened to all approved contacts,
  // that was the whole approved set.
  //
  // Release anything a previous failed export abandoned first, so those leads
  // are exportable again before this batch is reserved.
  await supabase.rpc("export_release_stale", { p_stale_minutes: 30 });

  const { data: batch, error: reserveError } = await supabase.rpc("export_reserve", {
    p_user_id: user.id,
  });
  if (reserveError) {
    return new Response(JSON.stringify({ error: reserveError.message }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }
  const syncedIds: string[] = batch?.contact_ids ?? [];

  // deno-lint-ignore no-explicit-any
  let contacts: any[] = [];
  if (syncedIds && syncedIds.length > 0) {
    const { data, error } = await supabase
      .from("contacts")
      .select("*, event:events(name), school_district:school_districts(name), school:schools(name)")
      .in("id", syncedIds)
      .order("created_at");
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }
    contacts = data;
  }

  const lines = ["Salutation,First Name,Last Name,Email,Phone,Title,Account Name,Account Id,Account Status,Lead Source,Capture Channel,Description"];
  for (const c of contacts) {
    lines.push([
      csvField(""),
      csvField(c.first_name),
      csvField(c.last_name),
      csvField(c.email ?? ""),
      csvField(c.phone ?? ""),
      csvField(c.title ?? ""),
      csvField(accountName(c)),
      csvField(c.matched_zoho_account_id ?? ""),
      csvField(accountStatus(c)),
      csvField(c.event?.name ?? ""),
      csvField(channelLabel(c)),
      csvField(buildDescription(c)),
    ].join(","));
  }

  return new Response(lines.join("\n") + "\n", {
    status: 200,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="conference-leads.csv"',
      // The client POSTs this to export-confirm once the blob is in hand.
      // Until it does, these contacts stay unsynced and re-exportable.
      "X-Export-Batch-Id": batch.id,
    },
  });
});
