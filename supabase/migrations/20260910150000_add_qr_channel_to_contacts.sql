-- Distinguishes which of the two QR codes produced a scan-and-fill-out
-- intake submission: the one shown at the sales booth (printed flyer or an
-- iPad display) versus the one a rep displays during their own breakout
-- session. Both still land on the same /intake form and the same contacts
-- table -- this is purely a tag carried through in the QR's own URL (see
-- SetupPage.vue/generateConnectSlide.ts for where it's encoded and
-- IntakePage.vue for where it's read back off) so reps can see, and
-- eventually report on, which context drove a given lead. Null covers
-- anything reached without going through either tagged QR (a bookmarked or
-- typed URL).
alter table public.contacts
  add column qr_channel text check (qr_channel in ('booth','session'));
