import { onBeforeUnmount, ref, watch, type Ref } from 'vue';

export interface TargetBox { top: number; left: number; width: number; height: number }
// searching: looking for it. settling: found, but it's still moving (the page
// is loading, fonts are arriving, we're scrolling to it). ready: holding still.
// missing: never turned up, so the caller shows a plain centred card instead.
export type TargetState = 'searching' | 'settling' | 'ready' | 'missing';

const PAD = 6;
const EDGE = 4;
const GIVE_UP_MS = 3500;
const STILL_MS = 150;

// Follows a real element on the page, every frame, and reports where it is.
//
// The first version measured once, after a fixed delay, and listened for
// scroll and for the element's own size changing. That is not enough. The
// header's icon buttons change WIDTH when the icon font arrives, so every
// button after them shifts sideways without the target itself resizing; data
// loading pushes a list down; a toast appears. Each left the bright window
// sitting over the wrong thing (the lock icon instead of the help icon, the
// page title instead of the sample lead). Watching position every frame covers
// every cause at once, and costs one getBoundingClientRect per frame.
//
// It also refuses to say "ready" until the element has held still for a moment,
// so the card never appears beside a spot the target is about to leave.
export function useTourTarget(selector: Ref<string | null>) {
  const box = ref<TargetBox | null>(null);
  const state = ref<TargetState>('searching');

  let raf = 0;
  let timer = 0;
  let token = 0;
  let userScrolled = 0;

  const onUserScroll = () => { userScrolled = performance.now(); };

  function stop() {
    token += 1;
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
    raf = 0;
    timer = 0;
    window.removeEventListener('wheel', onUserScroll);
    window.removeEventListener('touchmove', onUserScroll);
  }

  // Padded, and kept inside the screen so the window never clips off an edge.
  function padded(r: DOMRect): TargetBox {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const top = Math.max(r.top - PAD, EDGE);
    const left = Math.max(r.left - PAD, EDGE);
    const bottom = Math.min(r.bottom + PAD, vh - EDGE);
    const right = Math.min(r.right + PAD, vw - EDGE);
    return { top, left, width: Math.max(right - left, 0), height: Math.max(bottom - top, 0) };
  }

  function offscreen(r: DOMRect) {
    return r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth;
  }

  // Fully visible below whatever fixed header is showing.
  function comfortablyVisible(r: DOMRect) {
    const header = document.querySelector('.q-header')?.getBoundingClientRect().bottom ?? 0;
    return r.top >= header && r.bottom <= window.innerHeight;
  }

  async function begin(sel: string) {
    stop();
    const mine = token;
    const cancelled = () => mine !== token;
    box.value = null;
    state.value = 'searching';
    window.addEventListener('wheel', onUserScroll, { passive: true });
    window.addEventListener('touchmove', onUserScroll, { passive: true });

    // Icon buttons are sized by their icon font; measuring before it loads is
    // exactly how the highlight ended up a button-width to the left. Capped so
    // a font that never arrives can't hold the tour up.
    try {
      await Promise.race([
        document.fonts?.ready ?? Promise.resolve(),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    } catch { /* fonts API missing: the still-for-a-moment rule below covers it */ }
    if (cancelled()) return;

    const t0 = performance.now();
    let last: DOMRect | null = null;
    let lastEl: Element | null = null;
    let lastMoved = performance.now();
    let scrolledIn = false;
    let extraScrolls = 0;

    // Driven by whichever of an animation frame or a 50 ms timer fires first.
    // Animation frames are what keep the window glued to its target at 60 fps,
    // but a browser that throttles them (a hidden or unfocused pane, low-power
    // mode) can drop to a couple a second, which made every step crawl. The
    // timer keeps the tracking alive at a steady 20 Hz in that case.
    const schedule = () => {
      raf = requestAnimationFrame(frame);
      timer = window.setTimeout(frame, 50);
    };
    const frame = () => {
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      raf = 0;
      timer = 0;
      if (cancelled()) return;
      const now = performance.now();
      const el = document.querySelector<HTMLElement>(sel);
      const r = el?.getBoundingClientRect();

      if (!el || !r || r.width === 0 || r.height === 0) {
        // Not there (yet). Give the page a few seconds, then let the caller
        // fall back to a centred card rather than wait forever.
        if (state.value !== 'ready' && now - t0 > GIVE_UP_MS) {
          box.value = null;
          state.value = 'missing';
          return;
        }
        if (state.value === 'ready') { box.value = null; state.value = 'searching'; }
        schedule();
        return;
      }

      const moved = !last || lastEl !== el
        || Math.abs(r.top - last.top) >= 0.5 || Math.abs(r.left - last.left) >= 0.5
        || Math.abs(r.width - last.width) >= 0.5 || Math.abs(r.height - last.height) >= 0.5;
      if (moved) lastMoved = now;
      last = r;
      lastEl = el;

      const still = now - lastMoved >= STILL_MS;

      if (state.value !== 'ready') {
        // Once it has stopped moving, bring it into view (once), then wait for
        // that scroll and any layout it causes to settle before showing the card.
        if (still && !scrolledIn && !comfortablyVisible(r)) {
          scrolledIn = true;
          el.scrollIntoView({ block: 'center', inline: 'nearest' });
          lastMoved = now;
        } else if (still) {
          state.value = 'ready';
        } else {
          state.value = 'settling';
        }
      } else if (
        // Already showing, then a layout change carried it off screen and the
        // person isn't the one scrolling: bring it back rather than leave a
        // window pointing at nothing. Bounded so it can't fight a stubborn page.
        offscreen(r) && extraScrolls < 2 && now - userScrolled > 800
      ) {
        extraScrolls += 1;
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
      }

      // Keep the window glued to the element, in every state.
      const next = padded(r);
      const cur = box.value;
      if (!cur || Math.abs(cur.top - next.top) >= 0.5 || Math.abs(cur.left - next.left) >= 0.5
        || Math.abs(cur.width - next.width) >= 0.5 || Math.abs(cur.height - next.height) >= 0.5) {
        box.value = next;
      }
      schedule();
    };
    schedule();
  }

  watch(selector, (sel) => {
    if (sel) void begin(sel);
    else {
      stop();
      box.value = null;
      state.value = 'searching';
    }
  }, { immediate: true });

  onBeforeUnmount(stop);

  return { box, state };
}
