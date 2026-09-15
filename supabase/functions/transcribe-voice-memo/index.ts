// ┌──────────────────────────────────────────────────────────────────────┐
// │ RETIRED 2026-09-14 (audit S1/N1). This is the deployed 410 stub.     │
// └──────────────────────────────────────────────────────────────────────┘
//
// Voice-memo transcription is very much alive; it just doesn't run here
// anymore. It runs in `transcriptionLoop` in local-agent/agent.mjs, calling a
// LOCAL Whisper CLI via local-agent/whisper-runner.mjs — no OpenAI key, no
// metered API, same reasoning as every other `claude -p` step in that file.
//
// History: this was the original Stage 14 implementation, an OpenAI Whisper
// API call fired by a Postgres trigger. That trigger was dropped on 2026-09-03
// (20260903000000_drop_audio_transcription_trigger.sql), but the function was
// never undeployed — so for three months it stayed live and callable by anyone
// holding the published anon key, able to spend OPENAI_API_KEY, write into
// contacts.interaction_notes, and race local-agent's own claim on the same
// inbound_messages row (regressing attribution to the pre-Stage-14 logic).
//
// The original source is recoverable from git history at ebd5bba. It is NOT
// kept here: a file in supabase/functions/ is something scripts/deploy-
// functions.mjs will deploy, and "reference implementation" is not a good
// enough reason to keep a live endpoint one accidental deploy away.
// git history is the reference.
const ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type";

Deno.serve((req) => {
  const origin = req.headers.get("origin") ?? "";
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    Vary: "Origin",
    "Content-Type": "application/json",
  };
  if (origin && allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });

  return new Response(
    JSON.stringify({
      error: "This endpoint has been retired. Voice-memo transcription runs locally in local-agent's transcriptionLoop.",
    }),
    { status: 410, headers },
  );
});
