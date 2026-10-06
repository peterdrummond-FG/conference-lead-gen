import { ref, watch } from 'vue';
import { api } from '@/boot/axios';
import {
  districtOptions as buildDistrictOptions,
  changeDistrict,
  changeSchool,
  changeState,
  resolveTyped,
  schoolOptions as buildSchoolOptions,
  type TypeaheadOption,
} from '@/utils/institutionPicker';
import type { UsStateOption } from '@/constants/usStates';

// The State, District and School answers of one form, as the form keeps them (the attendee
// form's reactive object, the lead editor's draft, the merge dialog's draft). The picker
// writes straight into it, as the old per-page code did.
export interface InstitutionModel {
  state: UsStateOption | null;
  district: TypeaheadOption | null;
  school: TypeaheadOption | null;
}

// ── lists: loaded once, kept on the device ───────────────────────────────
//
// A state's whole district list (Texas, the biggest: 932 names, ~88 KB, a third of that
// compressed) or a district's whole school list (the biggest has 183) is fetched the first
// time it is needed and then filtered locally, so the pickers open on a full list at once and
// don't need a request per keystroke on conference wifi. Kept in memory for the page's life
// and in localStorage for a day, so the next scan on the same device doesn't wait at all.
// localStorage can be empty, full or blocked (private windows): every touch is wrapped and
// the picker simply fetches. A failed fetch is never cached, so the next open tries again.
// Shared across every picker on the page (the attendee form, the editor, the merge dialog).
const lists = new Map<string, TypeaheadOption[]>();
const inflight = new Map<string, Promise<TypeaheadOption[]>>();
const TTL_MS = 24 * 60 * 60 * 1000;

function readStored(key: string): TypeaheadOption[] | null {
  try {
    const raw = localStorage.getItem(`ckh.list.v1:${key}`);
    if (!raw) return null;
    const { at, rows } = JSON.parse(raw) as { at: number; rows: TypeaheadOption[] };
    return Date.now() - at < TTL_MS && Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, rows: TypeaheadOption[]) {
  try {
    localStorage.setItem(`ckh.list.v1:${key}`, JSON.stringify({ at: Date.now(), rows }));
  } catch {
    // Quota or blocked storage: fine, it just isn't kept.
  }
}

function loadList(key: string, fetchRows: () => Promise<TypeaheadOption[]>): Promise<TypeaheadOption[]> {
  const have = lists.get(key);
  if (have) return Promise.resolve(have);
  const stored = readStored(key);
  if (stored) {
    lists.set(key, stored);
    return Promise.resolve(stored);
  }
  let p = inflight.get(key);
  if (!p) {
    p = fetchRows()
      .then((rows) => {
        lists.set(key, rows);
        writeStored(key, rows);
        return rows;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

const districtsOf = (state: string) =>
  loadList(`districts:${state}`, async () => {
    const { data } = await api.get<{ id: string; name: string }[]>('/districts-list', { params: { state, all: 1 } });
    return data.map((d) => ({ id: d.id, name: d.name }));
  });

const schoolsOf = (districtId: string) =>
  loadList(`schools:${districtId}`, async () => {
    const { data } = await api.get<{ id: string; name: string }[]>('/schools-list', { params: { districtId, all: 1 } });
    return data.map((s) => ({ id: s.id, name: s.name }));
  });

// Tests and sign-out: forget everything held.
export function clearInstitutionLists() {
  lists.clear();
  inflight.clear();
}

type Update = (cb: () => void) => void;

// `enabled` is false where the fields are only drawn (the onboarding tour fills them in by
// script): no requests, no clearing.
export function useInstitutionPicker(model: InstitutionModel, enabled: () => boolean = () => true) {
  const districtOpts = ref<TypeaheadOption[]>([]);
  const schoolOpts = ref<TypeaheadOption[]>([]);
  const loadingDistricts = ref(false);
  const loadingSchools = ref(false);
  // Set when a list couldn't be fetched; the field then offers only the typed entry and
  // says so, instead of an empty menu that looks like "no such district".
  const districtsFailed = ref(false);
  const schoolsFailed = ref(false);
  // The lists the options were last built from; blur matches typed text against them.
  let districtAll: TypeaheadOption[] = [];
  let schoolAll: TypeaheadOption[] = [];

  async function currentDistricts(): Promise<TypeaheadOption[]> {
    const state = model.state?.name;
    if (!enabled() || !state) return [];
    loadingDistricts.value = true;
    try {
      const rows = await districtsOf(state);
      districtsFailed.value = false;
      return rows;
    } catch {
      districtsFailed.value = true;
      return [];
    } finally {
      loadingDistricts.value = false;
    }
  }

  async function currentSchools(): Promise<TypeaheadOption[]> {
    const id = model.district?.id;
    if (!enabled() || !id) return [];
    loadingSchools.value = true;
    try {
      const rows = await schoolsOf(id);
      schoolsFailed.value = false;
      return rows;
    } catch {
      schoolsFailed.value = true;
      return [];
    } finally {
      loadingSchools.value = false;
    }
  }

  // Start fetching as soon as the list is knowable, so it is usually there by the time the
  // field is opened. These watchers only LOAD; clearing a downstream answer happens in
  // setState / setDistrict below, on a person's change, not here, because a page also
  // re-points the model at another lead in one go and that must not wipe the new values.
  watch(() => model.state?.name ?? null, () => { void currentDistricts(); }, { immediate: true });
  watch(() => model.district?.id ?? null, () => { void currentSchools(); }, { immediate: true });

  // Quasar calls @filter with '' the moment the menu opens, and again on every keystroke.
  async function filterDistrict(val: string, update: Update) {
    districtAll = await currentDistricts();
    update(() => { districtOpts.value = buildDistrictOptions(districtAll, val); });
  }

  async function filterSchool(val: string, update: Update) {
    schoolAll = await currentSchools();
    update(() => { schoolOpts.value = buildSchoolOptions(model.district, schoolAll, val); });
  }

  // ── what the person's changes do (utils/institutionPicker: changeState / changeDistrict) ──
  const setState = (next: UsStateOption | null) => changeState(model, next);
  const setDistrict = (next: TypeaheadOption | null) => changeDistrict(model, next);
  const setSchool = (next: TypeaheadOption | null) => changeSchool(model, next);

  // Enter / Tab on text that isn't in the list (QSelect's new-value).
  function onNewDistrict(val: string, done: (item?: TypeaheadOption, mode?: 'add-unique') => void) {
    done({ id: null, name: val.trim() }, 'add-unique');
  }
  function onNewSchool(val: string, done: (item?: TypeaheadOption, mode?: 'add-unique') => void) {
    done({ id: null, name: val.trim() }, 'add-unique');
  }

  // Leaving the field commits what is typed, as Enter and Tab do (resolveTyped explains why
  // QSelect doesn't). The input text is tracked from @input-value.
  const districtText = ref('');
  const schoolText = ref('');
  function onDistrictBlur() {
    if (!enabled()) return;
    const next = resolveTyped(districtText.value, model.district, districtAll);
    if (next !== model.district) setDistrict(next);
  }
  function onSchoolBlur() {
    if (!enabled()) return;
    const next = resolveTyped(schoolText.value, model.school, schoolAll);
    if (next !== model.school) setSchool(next);
  }

  return {
    districtOpts, schoolOpts, loadingDistricts, loadingSchools, districtsFailed, schoolsFailed,
    filterDistrict, filterSchool, setState, setDistrict, setSchool,
    onNewDistrict, onNewSchool, districtText, schoolText, onDistrictBlur, onSchoolBlur,
  };
}
