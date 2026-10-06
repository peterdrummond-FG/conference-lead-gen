// The rules behind the District and School pickers, as pure functions so they can be
// tested without a browser (utils/institutionPicker.test.mjs).
//
// The pickers load a state's whole district list (or a district's whole school list)
// once and filter it on the device, so opening a field shows its options at once, every
// letter is instant, and a rep on bad conference wifi isn't waiting on a request per
// keystroke. What the server holds is only ever OUR districts and schools; anything a
// person types that isn't in the list is kept as plain text (id: null), never turned
// into a new school_districts / schools row (contacts-create, contacts-patch).

// id is null for typed text that didn't match anything in the list. `typed` marks the
// "Use '<text>'" entry the pickers append; `caption` is the small line under an option.
export interface TypeaheadOption {
  id: string | null;
  name: string;
  typed?: boolean;
  caption?: string;
}

// Case, accents and punctuation don't make two names different ("St. Mary's ISD" is
// "st marys isd" is "ST MARYS ISD"). Used for matching only; the name that is shown and
// saved is always the one the person typed or picked.
export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Typing narrows the list, best match first: names that START with what was typed, then
// names where each typed word starts a word ("clay carmel" finds "Carmel Clay Schools"),
// then names that merely contain it. Within a group the list keeps its own (alphabetical)
// order. Nothing typed returns the whole list, untouched.
export function filterOptions(all: TypeaheadOption[], typed: string): TypeaheadOption[] {
  const key = norm(typed);
  if (!key) return all;
  const words = key.split(' ');
  const starts: TypeaheadOption[] = [];
  const wordStarts: TypeaheadOption[] = [];
  const contains: TypeaheadOption[] = [];
  for (const o of all) {
    const n = norm(o.name);
    if (n.startsWith(key)) starts.push(o);
    else if (words.every((w) => n.split(' ').some((nw) => nw.startsWith(w)))) wordStarts.push(o);
    else if (n.includes(key)) contains.push(o);
  }
  return [...starts, ...wordStarts, ...contains];
}

export function hasExactMatch(all: TypeaheadOption[], typed: string): boolean {
  const key = norm(typed);
  return key !== '' && all.some((o) => norm(o.name) === key);
}

// "Use '<typed>'" goes LAST, whenever the typed text isn't already an exact match for
// something in the list (an exact match is just picked). It is how a person gets past a
// list that doesn't have their district: some states have only a handful of ours.
export function withTypedOption(list: TypeaheadOption[], all: TypeaheadOption[], typed: string, caption: string): TypeaheadOption[] {
  const text = typed.trim();
  if (!text || hasExactMatch(all, text)) return list;
  return [...list, { id: null, name: text, typed: true, caption }];
}

export const DISTRICT_TYPED_CAPTION = 'Not in the list? Keep what you typed.';
export const SCHOOL_TYPED_CAPTION = 'Not in the list? Keep what you typed.';
// With no district picked, the typed school is the whole answer, and the pipeline looks
// the district up from it (research-contact).
export const SCHOOL_NO_DISTRICT_CAPTION = "We'll look up the district for you.";

export function districtOptions(all: TypeaheadOption[], typed: string): TypeaheadOption[] {
  return withTypedOption(filterOptions(all, typed), all, typed, DISTRICT_TYPED_CAPTION);
}

// With a district from our list, School offers that district's schools. With none (or
// with a district the person typed, which has no schools of ours), it takes typed text
// only: no searching a state's schools, because District is the first step and School
// without one is the quiet fallback for a school we don't have.
export function schoolOptions(district: TypeaheadOption | null, schools: TypeaheadOption[], typed: string): TypeaheadOption[] {
  if (!district?.id) return withTypedOption([], [], typed, SCHOOL_NO_DISTRICT_CAPTION);
  return withTypedOption(filterOptions(schools, typed), schools, typed, SCHOOL_TYPED_CAPTION);
}

// What a field commits when the person leaves it with text in the box. QSelect's own
// new-value only fires on Enter or Tab (verified against its source: onTargetKeydown gates
// the emit on keyCode 13 / 9); leaving by blur only resets the DISPLAYED text to the
// current value's label and never commits. So a rep who types a name and taps straight to
// Save / Submit would lose it silently. Call this from @blur, fed by @input-value, to
// commit on blur exactly as Enter and Tab do.
//   * nothing typed        -> keep what is selected
//   * same as the selection -> keep it (QSelect shows the selected label in the box)
//   * matches a list entry  -> that entry (so its id is kept, not a typed copy)
//   * anything else         -> the text, as plain text (id: null)
export function resolveTyped(text: string, current: TypeaheadOption | null, all: TypeaheadOption[]): TypeaheadOption | null {
  const trimmed = text.trim();
  if (!trimmed) return current;
  const key = norm(trimmed);
  if (current && norm(current.name) === key) return current;
  const existing = all.find((o) => norm(o.name) === key);
  if (existing) return { id: existing.id, name: existing.name };
  return { id: null, name: trimmed };
}

// Changing the district drops a school that was picked from the OLD district's list
// (it has an id, and the new district isn't the one it came from). A school the person
// typed has no district of ours to disagree with, so it stays: clearing it would throw
// away what they wrote.
export function shouldClearSchool(prevDistrictId: string | null, nextDistrictId: string | null, school: TypeaheadOption | null): boolean {
  return !!school?.id && prevDistrictId !== nextDistrictId;
}

// ── what a person's change does to the answers below it ─────────────────────
//
// Done on the person's own change (the field's update event), never from a watcher on
// the model: a page also re-points the whole model at another lead in one go (the editor
// on a reload, the merge dialog on a new keeper), and a watcher would clear the school or
// district that was just loaded.
export interface InstitutionAnswers<S extends { name: string }> {
  state: S | null;
  district: TypeaheadOption | null;
  school: TypeaheadOption | null;
}

// Strip the bookkeeping an option carries in the menu (typed, caption): only id and name
// are an answer.
const plain = (o: TypeaheadOption | null): TypeaheadOption | null => (o ? { id: o.id, name: o.name } : null);

// A different state invalidates both District and School.
export function changeState<S extends { name: string }>(model: InstitutionAnswers<S>, next: S | null): void {
  const changed = (next?.name ?? null) !== (model.state?.name ?? null);
  model.state = next;
  if (changed) {
    model.district = null;
    model.school = null;
  }
}

// A different district drops a school picked from the old one; a typed school stays.
export function changeDistrict<S extends { name: string }>(model: InstitutionAnswers<S>, next: TypeaheadOption | null): void {
  const prevId = model.district?.id ?? null;
  const n = plain(next);
  model.district = n;
  if (shouldClearSchool(prevId, n?.id ?? null, model.school)) model.school = null;
}

export function changeSchool<S extends { name: string }>(model: InstitutionAnswers<S>, next: TypeaheadOption | null): void {
  model.school = plain(next);
}
