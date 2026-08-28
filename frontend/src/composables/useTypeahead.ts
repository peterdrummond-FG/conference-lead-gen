import { ref } from 'vue';

export interface TypeaheadOption {
  id: string;
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
