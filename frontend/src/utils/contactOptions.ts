// Shared mapping from a ContactListItem's state/district/school fields to
// the QSelect option shape used by the intake form, /review, and the
// duplicate-merge dialog. A matched district/school shows its real name; a
// typed value that never matched anything shows its raw text instead
// (id: null) — never a new school_districts/schools row.
import { US_STATES, type UsStateOption } from '@/constants/usStates';
import type { TypeaheadOption } from '@/composables/useTypeahead';
import type { ContactListItem } from '@/types/review';

export function stateOptionFor(name: string | null): UsStateOption | null {
  if (!name) return null;
  return US_STATES.find((s) => s.name === name) ?? { code: '', name };
}

export function districtOptionFor(c: ContactListItem): TypeaheadOption | null {
  if (c.schoolDistrictId) return { id: c.schoolDistrictId, name: c.districtName ?? '' };
  if (c.schoolDistrictNameRaw) return { id: null, name: c.schoolDistrictNameRaw };
  return null;
}

export function schoolOptionFor(c: ContactListItem): TypeaheadOption | null {
  if (c.schoolId) return { id: c.schoolId, name: c.schoolName ?? '' };
  if (c.schoolNameRaw) return { id: null, name: c.schoolNameRaw };
  return null;
}
