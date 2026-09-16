import { onMounted, onUnmounted, reactive, ref, watchEffect } from 'vue';

// Review cards can be "collapsed" (short, uniform height) or "expanded"
// (one at a time, much taller, 2 columns wide). CSS Grid and Flexbox were
// both tried first and both rejected: a shared grid row (or flex line)
// sizes itself to its tallest member, so any collapsed card sharing a
// row/line with the tall expanded card gets stranded above dead space —
// `align-items: flex-start` only stops it from being *stretched*, not
// from sitting in an oversized row. There's no CSS-only fix for packing
// items of different heights without gaps (native `grid-template-rows:
// masonry` isn't reliably available across browsers yet), so this
// measures each card's real rendered height and places every card —
// expanded one included — into whichever column(s) have the least height
// so far, Pinterest-style.
export interface MasonryItem {
  id: string;
  span: 1 | 2; // columns wide
}

export function useMasonryGrid(
  getContainerEl: () => HTMLElement | null,
  getItems: () => MasonryItem[],
  options: { minColWidth: number; gap: number },
) {
  const { minColWidth, gap } = options;
  const styles = reactive<Record<string, Record<string, string>>>({});
  const containerHeight = ref(0);
  const elements = new Map<string, HTMLElement>();
  let resizeObserver: ResizeObserver | null = null;
  let scheduled = false;

  function relayout() {
    const container = getContainerEl();
    if (!container) return;

    // Recomputed from scratch every time, not cached from the first run —
    // a window resize can change the column *count*, not just the pixel
    // width of each column, and pairing a stale column count with a fresh
    // column width would misplace every 2-wide (expanded) card.
    const containerWidth = container.clientWidth;
    const columns = Math.max(1, Math.floor((containerWidth + gap) / (minColWidth + gap)));
    const colWidth = (containerWidth - gap * (columns - 1)) / columns;
    const heights = new Array(columns).fill(0);

    // Item order is left exactly as given — the expanded card is never
    // pulled to the front. It packs wherever it naturally sits in the
    // list, which is what makes this "fill in around it" rather than
    // "expanded card always leads".
    for (const item of getItems()) {
      const span = Math.min(item.span, columns) as 1 | 2;
      const height = elements.get(item.id)?.offsetHeight ?? 0;

      let start = 0;
      let bestMax = Infinity;
      for (let s = 0; s <= columns - span; s++) {
        const maxH = Math.max(...heights.slice(s, s + span));
        if (maxH < bestMax) {
          bestMax = maxH;
          start = s;
        }
      }

      const top = bestMax;
      const left = start * (colWidth + gap);
      const width = span * colWidth + (span - 1) * gap;
      styles[item.id] = { position: 'absolute', top: `${top}px`, left: `${left}px`, width: `${width}px` };

      const newHeight = top + height + gap;
      for (let i = start; i < start + span; i++) heights[i] = newHeight;
    }

    containerHeight.value = Math.max(0, ...heights) - gap;
  }

  function scheduleRelayout() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      relayout();
    });
  }

  // Vue 3 function-ref: called with a real element on mount, and again
  // with `el === null` right before unmount — that's the cleanup signal,
  // there's no separate onUnmounted hook per card.
  function setCardEl(id: string, el: Element | ComponentPublicInstanceLike | null) {
    const htmlEl = el instanceof HTMLElement ? el : null;
    if (htmlEl) {
      elements.set(id, htmlEl);
      resizeObserver?.observe(htmlEl);
    } else {
      const prev = elements.get(id);
      if (prev) resizeObserver?.unobserve(prev);
      elements.delete(id);
    }
    // Either a card appeared or disappeared — packing changes either way.
    scheduleRelayout();
  }

  onMounted(() => {
    resizeObserver = new ResizeObserver(() => scheduleRelayout());
    const container = getContainerEl();
    if (container) resizeObserver.observe(container);
    for (const el of elements.values()) resizeObserver.observe(el);
    scheduleRelayout();
  });

  onUnmounted(() => resizeObserver?.disconnect());

  // Re-packs whenever the item list itself changes — ids added/removed,
  // or which one is expanded (span 1 -> 2). This can run slightly ahead
  // of the DOM actually reflecting new expanded content; the per-card
  // ResizeObserver above is the safety net that corrects it once the
  // browser finishes laying out the taller card.
  watchEffect(() => {
    getItems();
    scheduleRelayout();
  });

  function styleFor(id: string): Record<string, string> {
    return styles[id] ?? { position: 'absolute', top: '0px', left: '0px' };
  }

  return { styleFor, containerHeight, setCardEl };
}

// Vue's function-ref callback type includes component instances for
// component refs — this composable is only ever bound to plain elements,
// but the signature has to accept the type Vue actually passes.
type ComponentPublicInstanceLike = { $el: unknown };
