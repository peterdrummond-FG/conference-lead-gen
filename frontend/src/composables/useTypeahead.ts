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
