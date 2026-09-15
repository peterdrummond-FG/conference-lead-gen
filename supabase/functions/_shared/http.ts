// Shared CORS + JSON response helpers for every Edge Function in this project.
// Response shape ({ error: string } on failure) matches what
// frontend/src/boot/axios.ts's interceptor already expects from the old .NET API.

const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:9000", "http://localhost:9200"];

function allowedOrigins(): string[] {
  const raw = Deno.env.get("ALLOWED_ORIGINS");
  if (!raw) {
    // Loud rather than silent: an unset ALLOWED_ORIGINS in production means
    // every function advertises localhost, the deployed frontend is blocked,
    // and the first symptom is an outage that looks like anything but config.
    console.error(
      "ALLOWED_ORIGINS is not set — falling back to localhost dev origins. " +
      "Set it with `supabase secrets set ALLOWED_ORIGINS=...`.",
    );
    return DEFAULT_ALLOWED_ORIGINS;
  }
  return raw.split(",").map((o) => o.trim()).filter(Boolean);
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = allowedOrigins();
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    // Without this the browser hides X-Export-Batch-Id from the fetch
    // response, and the client can never confirm an export (audit Q2).
    "Access-Control-Expose-Headers": "Content-Disposition, X-Export-Batch-Id",
    Vary: "Origin",
  };
  // Audit S5. An origin we don't recognise gets NO Access-Control-Allow-Origin
  // header — that is what a CORS denial looks like. Echoing back allowed[0]
  // was not a denial; it just made the browser's error message misleading and
  // masked the misconfiguration.
  if (allowed.includes("*")) headers["Access-Control-Allow-Origin"] = "*";
  else if (origin && allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

// Call at the top of every function; returns a response to send immediately
// on an OPTIONS preflight, or null to continue handling the real request.
export function handlePreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  return null;
}

export function jsonResponse(req: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

export function errorResponse(req: Request, status: number, message: string): Response {
  return jsonResponse(req, { error: message }, status);
}
