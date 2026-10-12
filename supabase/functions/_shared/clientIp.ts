// Which network a public request came from (used by contacts-create's rate limit).
//
// What was wrong: the code took the FIRST entry of x-forwarded-for. A client can send
// that header itself, and the first entry is the one it controls, so a bot could put a
// fresh made-up address on every request and never reach the per-network limit.
//
// What was checked (2026-10-12, Supabase edge logs and two test requests to a public
// read-only function): the platform sets cf-connecting-ip and x-real-ip itself. A
// request carrying its own x-real-ip arrived with the real one (ours was overwritten),
// and a request carrying its own cf-connecting-ip was refused by Cloudflare with a
// 403 before reaching the function. So those two are not settable by a visitor.
// x-forwarded-for is not recorded in the logs, so it was not tested and is used only
// as a last resort, and then from the END of the list (the entry nearest the platform,
// which a client cannot prepend its way past).
//
// If none is present (a local run) every request shares the "unknown" bucket, which is
// strict rather than open.
export function clientIp(headers: { get(name: string): string | null }): string {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return "unknown";
}
