import { ref } from 'vue';

export type ReviewView = 'smart' | 'classic';

// Per device, not per account: it's a display preference, and a browser
// that blocks storage (private window, cleared site data) just gets the
// default instead of an error.
const STORAGE_KEY = 'ckh.review.view';

function read(): ReviewView {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'classic' ? 'classic' : 'smart';
  } catch {
    return 'smart';
  }
}

// Module-level so the menu in either view and the page shell that picks the
// view all share one value.
const view = ref<ReviewView>(read());

export function useReviewView() {
  function setView(next: ReviewView) {
    view.value = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisting is fine — the switch still applies for this visit.
    }
  }
  return { view, setView };
}
