// Real per-user auth, replacing the shared staff-PIN gate. The frontend now
// sends the logged-in user's own Supabase Auth access token as
// `Authorization: Bearer <token>` (not a static anon key + x-staff-pin
// header) -- requireUser validates that token and resolves it to the
// caller's own profiles row (role + current_event_id), which every
// staff-gated function uses to decide what it may see/do. Returns null on
// any failure (missing/invalid token, no matching profile) rather than
// throwing, so callers can uniformly 401.
import { serviceClient } from "./supabase-client.ts";

export interface AuthedUser {
  id: string;
  name: string;
  role: "admin" | "solutionsSuccess" | "sales";
  currentEventId: string | null;
}

export async function requireUser(req: Request): Promise<AuthedUser | null> {
  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return null;

  const supabase = serviceClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !user) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, name, role, current_event_id")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || !profile) return null;

  return {
    id: profile.id,
    name: profile.name,
    role: profile.role,
    currentEventId: profile.current_event_id,
  };
}

// True if the authed user's role is one of `roles` -- a thin readability
// helper, not a security boundary on its own; every call site still needs
// its own errorResponse(401/403) around it.
export function hasRole(user: AuthedUser, roles: AuthedUser["role"][]): boolean {
  return roles.includes(user.role);
}

// contacts-from-ocr is called only by the local watcher/process-cards skill
// and the local agent's SMS-photo poll loop -- never a browser, never a
// logged-in user. It authenticates with the service-role key directly, a
// strictly stronger credential than anything requireUser checks, so it
// isn't double-gated by it.
export function isServiceRoleCall(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return serviceKey.length > 0 && auth === `Bearer ${serviceKey}`;
}
