// Staff-PIN gate. This is a single shared secret (app_settings.staff_pin),
// not a per-user credential — it doubles as the kiosk-unlock PIN and the
// server-enforced gate on /setup, /review, /export now that they're reachable
// over the public internet rather than only venue WiFi. A plain string
// compare is fine for a shared shop-floor PIN, but we use a constant-time
// compare anyway since it costs nothing.
import { serviceClient } from "./supabase-client.ts";

const SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function requireStaffPin(req: Request): Promise<boolean> {
  const pin = req.headers.get("x-staff-pin") ?? "";
  if (!pin) return false;

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("staff_pin")
    .eq("id", SETTINGS_ID)
    .single();
  if (error || !data) return false;

  return timingSafeEqual(pin, data.staff_pin);
}

export const APP_SETTINGS_ID = SETTINGS_ID;

// contacts-from-ocr is called only by the local watcher/process-cards skill
// and (later) the local agent's SMS-photo poll loop — never a browser. It
// authenticates with the service-role key directly, a strictly stronger
// credential than the staff PIN, so it isn't double-gated by requireStaffPin.
export function isServiceRoleCall(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return serviceKey.length > 0 && auth === `Bearer ${serviceKey}`;
}
