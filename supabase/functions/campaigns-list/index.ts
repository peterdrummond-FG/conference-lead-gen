// GET ?search=  -> Conference[]
// Any logged-in role (used by Setup's and Admin's "Start a conference" -- a
// sales rep can start one too, exactly as they already can by texting SETUP,
// which searches this same campaign cache). Read-only, capped at 30 rows, and
// it returns only conference names/dates/states, so there is nothing here worth
// withholding from a rep.
//
// Ranking lives in the conference_search() database function (see
// 20260929120000/123000): with no search it lists conferences that haven't
// finished yet, nearest first, so a rep at a booth sees theirs without typing;
// with a search it matches substring-or-fuzzy and ranks unfinished conferences
// first. It used to be `order by name desc limit 50`, which -- because names
// start "YYYY MM.DD" -- put December ahead of this week's conference.
//
// Each row also says whether that campaign is ALREADY LIVE (liveEventId), so the
// client can offer Join instead of Start, and carries the state read from the
// name's "(ST)" code (null when absent or not a real state, so the client asks).
// id / zohoCampaignId / name keep their old meaning for older clients.
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/http.ts";
import { hasRole, requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase-client.ts";
import { stateFromConferenceName } from "../_shared/conferenceName.ts";
import { LIMITS } from "../_shared/validate.ts";

// A conference is offered for another day after its last day: a rep is often
// still adding leads the morning after, and joining a just-ended conference is
// better than not finding it.
const GRACE_DAYS = 1;
const RESULT_LIMIT = 30;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return errorResponse(req, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return errorResponse(req, 401, "Unauthorized");
  if (!hasRole(user, ["admin", "solutionsSuccess", "sales"])) return errorResponse(req, 403, "Forbidden");

  const url = new URL(req.url);
  const search = url.searchParams.get("search")?.trim() ?? "";
  // No campaign name is anywhere near this long; a longer string is a mistake or
  // an attempt to make the trigram match expensive, not a search.
  if (search.length > LIMITS.name) return errorResponse(req, 400, "search is too long.");

  const supabase = serviceClient();
  // The database escapes LIKE metacharacters itself (a typed % or _ is literal),
  // so the raw string goes straight through -- see conference_search().
  const { data, error } = await supabase.rpc("conference_search", {
    p_query: search,
    p_days_back: GRACE_DAYS,
    p_limit: RESULT_LIMIT,
  });
  if (error) return errorResponse(req, 500, error.message);

  return jsonResponse(
    req,
    (data ?? []).map((c: {
      id: string;
      zoho_campaign_id: string;
      name: string;
      starts_on: string | null;
      ends_on: string | null;
      live_event_id: string | null;
      live_state: string | null;
    }) => ({
      id: c.id,
      zohoCampaignId: c.zoho_campaign_id,
      name: c.name,
      startsOn: c.starts_on,
      endsOn: c.ends_on,
      // A live conference already has its real state; otherwise read it off the name.
      state: c.live_state ?? stateFromConferenceName(c.name),
      liveEventId: c.live_event_id,
    })),
  );
});
