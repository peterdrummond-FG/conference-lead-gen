import { ref } from 'vue';

// id is null for a locally-built option representing typed text that didn't
// match anything in the list — never persisted as a new row, just carried
// along as plain text (see onNewDistrict/onNewSchool).
export interface TypeaheadOption {
  id: string | null;
  name: string;
}

// Shared debounced-search wiring for Quasar's QSelect `@filter` API, so
// District and School selects don't each duplicate the same boilerplate.
export function useTypeahead(fetchFn: (search: string) => Promise<TypeaheadOption[]>) {
  const options = ref<TypeaheadOption[]>([]);

  function filterFn(val: string, update: (callbackFn: () => void) => void, abort: () => void) {
    fetchFn(val)
      .then((results) => {
        update(() => {
          options.value = results;
        });
      })
      .catch(() => abort());
  }

  return { options, filterFn };
}

// Quasar's `@new-value` (what `new-value-mode="add-unique"` relies on) only
// fires on Enter/Tab — QSelect's own onTargetKeydown gates the emit on
// keyCode 13/9 and nothing else. Blur runs a separate path (resetInputValue)
// that only resets the *displayed* text back to the current model value's
// label; it never calls `done()`, so a reviewer/rep who types a name and
// then clicks straight to Save/Submit (never pressing Enter) silently loses
// it. Call this from a `@blur` handler — fed by a ref kept current via
// `@input-value` — to commit on blur the same way Enter/Tab already does.
export function resolveTypedOption(
  text: string,
  current: TypeaheadOption | null,
  options: TypeaheadOption[],
): TypeaheadOption | null {
  const trimmed = text.trim();
  if (!trimmed) return current;
  if (current && current.name.toLowerCase() === trimmed.toLowerCase()) return current;
  const existing = options.find((o) => o.name.toLowerCase() === trimmed.toLowerCase());
  return existing ?? { id: null, name: trimmed };
}
