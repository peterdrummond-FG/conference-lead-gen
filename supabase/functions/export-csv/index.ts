// GET -> text/csv attachment. Staff-gated. Port of ExportEndpoints.cs's
// GET /api/export — another Stage 10 gap caught during Stage 15's
// frontend wiring. Fetched via the normal authenticated axios instance
// (responseType: 'blob') rather than a plain <a href> navigation, since a
// browser navigation can't carry the staff-PIN header or the anon-key
// bearer token this function needs — see ExportPage.vue.
import { corsHeaders, handlePreflight } from "../_shared/http.ts";
import { requireStaffPin } from "../_shared/auth.ts";
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

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405, headers: corsHeaders(req) });
  if (!(await requireStaffPin(req))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }

  const supabase = serviceClient();
  // Approved isn't enough on its own — the CSV's Account Id column needs a
  // real Zoho id to write, so that's the actual inclusion gate.
  const { data: contacts, error } = await supabase
    .from("contacts")
    .select("*, event:events(name)")
    .eq("review_status", "approved")
    .not("matched_zoho_account_id", "is", null)
    .order("created_at");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }

  const lines = ["Salutation,First Name,Last Name,Email,Phone,Title,Account Name,Account Id,Lead Source,Capture Channel,Description"];
  for (const c of contacts) {
    lines.push([
      csvField(""),
      csvField(c.first_name),
      csvField(c.last_name),
      csvField(c.email ?? ""),
      csvField(c.phone ?? ""),
      csvField(c.title ?? ""),
      csvField(c.matched_zoho_account_name ?? ""),
      csvField(c.matched_zoho_account_id ?? ""),
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
    },
  });
});
