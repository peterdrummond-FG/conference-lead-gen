// Shared CORS + JSON response helpers for every Edge Function in this project.
// Response shape ({ error: string } on failure) matches what
// frontend/src/boot/axios.ts's interceptor already expects from the old .NET API.

const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:9000", "http://localhost:9200"];

function allowedOrigins(): string[] {
  const raw = Deno.env.get("ALLOWED_ORIGINS");
  if (!raw) return DEFAULT_ALLOWED_ORIGINS;
  return raw.split(",").map((o) => o.trim()).filter(Boolean);
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = allowedOrigins();
  const matched = allowed.includes("*")
    ? "*"
    : allowed.includes(origin)
    ? origin
    : allowed[0];
  return {
    "Access-Control-Allow-Origin": matched,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    Vary: "Origin",
  };
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
