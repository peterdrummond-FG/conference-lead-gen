// Display helpers for a Zoho conference campaign name.
//
// Names here read "2026 09.30-10.02 (IL) IASA 62nd Annual Conference": a
// date/state prefix and then the actual title. On a phone the prefix eats the
// first line of every row and every row starts identically, so the list shows
// the title with the date and state beneath it -- but the FULL name is what
// becomes the Zoho Lead Source, so anywhere a rep confirms what they're starting
// the full name is shown untouched.

// "2026 09.30-10.02 (IL) ", "2026 10.06-07 - (OH) ", "2023 01.29- 02.01 (TX) "
const DATE_STATE_PREFIX = /^\d{4}\s+\d{2}\.\d{2}(?:\s*-\s*(?:\d{2}\.)?\d{2})?\s*(?:-\s*)?(?:\([A-Za-z]{2}\)\s*)?/;
// "2026 12.TBA (MI) ", "2026 TBD "
const UNDATED_PREFIX = /^\d{4}\s+(?:\d{2}\.)?(?:TBA|TBD)\s*(?:\([A-Za-z]{2}\)\s*)?/i;

export function cleanConferenceName(name: string): string {
  const stripped = name.replace(DATE_STATE_PREFIX, '').replace(UNDATED_PREFIX, '').trim();
  // A name that doesn't follow the pattern, or is only a prefix, is shown as-is
  // rather than blanked.
  return stripped || name;
}

// 'YYYY-MM-DD' -> a local Date at midnight. Not `new Date('YYYY-MM-DD')`, which
// is UTC midnight and reads as the previous day in every US timezone.
function parseDay(iso: string): Date {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmt(d: Date, withWeekday: boolean): string {
  return d.toLocaleDateString('en-US', {
    ...(withWeekday ? { weekday: 'short' } : {}),
    month: 'short',
    day: 'numeric',
  });
}

// "Tue, Sep 29" for one day, "Sep 30 to Oct 2" for a range, null when the name
// gave no date (those conferences only appear when searched for).
export function conferenceDateLabel(startsOn: string | null, endsOn: string | null): string | null {
  if (!startsOn) return null;
  const start = parseDay(startsOn);
  if (!endsOn || endsOn === startsOn) return fmt(start, true);
  return `${fmt(start, false)} to ${fmt(parseDay(endsOn), false)}`;
}

// A short status for the row: what a rep scanning the list needs to tell "mine,
// happening now" from "next month's". Null for anything further out.
export function conferenceTiming(
  startsOn: string | null,
  endsOn: string | null,
  now: Date = new Date(),
): 'In progress' | 'Today' | 'Tomorrow' | null {
  if (!startsOn) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = parseDay(startsOn);
  const end = endsOn ? parseDay(endsOn) : start;
  const dayMs = 24 * 60 * 60 * 1000;
  const startsIn = Math.round((start.getTime() - today.getTime()) / dayMs);
  if (startsIn === 0) return 'Today';
  if (startsIn === 1) return 'Tomorrow';
  if (startsIn < 0 && end.getTime() >= today.getTime()) return 'In progress';
  return null;
}
