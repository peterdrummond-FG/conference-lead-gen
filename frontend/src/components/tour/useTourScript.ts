// The engine behind the animated tour. A scene is a short async script that
// moves a pretend finger to real elements inside a TourDevice and presses
// them with el.click(), so what the rep watches is the app's own components
// reacting the way they really do (the edit panel sliding up, Followed up
// ticking, a lead leaving the list). The scene's handlers only ever change
// its own sample data: nothing here talks to the server.

export interface FingerState { x: number; y: number; visible: boolean; tapping: boolean }

export interface TourDeviceApi {
  root: () => HTMLElement | null;
  scale: () => number;
  finger: FingerState;
}

// Thrown into a running script when the player moves to another scene, so the
// old script stops at its next await instead of driving a screen that's gone.
export class TourCancelled extends Error {}

export interface TourRun {
  wait(ms: number): Promise<void>;
  // The milliseconds of waiting this run has done so far, as the script asked for
  // them: pause-aware, and the same in the dev "fast" mode (which sleeps ~10 ms but
  // still counts what was asked). The progress bar divides it by the scene's
  // declared length (tourLengths.ts), and the test that keeps those lengths honest
  // reads it after a fast run.
  elapsed(): number;
  find(selector: string): HTMLElement;
  findText(text: string, within?: string): HTMLElement;
  field(label: string): HTMLInputElement | HTMLTextAreaElement;
  moveTo(el: Element): Promise<void>;
  // press: the finger taps but nothing is clicked. For text fields, where a
  // real click would focus the input and could scroll the page under the tour.
  tap(el: Element, opts?: { press?: boolean }): Promise<void>;
  findIncl(text: string, within?: string): HTMLElement;
  type(el: HTMLInputElement | HTMLTextAreaElement, text: string): Promise<void>;
  scrollTo(container: Element, el: Element, offset?: number): Promise<void>;
  ring(el: Element, ms?: number): Promise<void>;
  hideFinger(): void;
}

export function createRun(
  device: TourDeviceApi,
  opts: {
    paused: () => boolean;
    alive: () => boolean;
    fast?: boolean;
    onTick?: (elapsedMs: number) => void;
    // How long each pass of a wait sleeps. 50 in the app; the length test passes 1
    // so measuring every scene takes seconds, not minutes.
    stepMs?: number;
  },
): TourRun {
  const root = () => {
    const r = device.root();
    if (!r) throw new TourCancelled();
    return r;
  };

  // Counted in what the script asked for, a step at a time, and only while not
  // paused: wall-clock time would run on under Pause and on a slow device, and a
  // progress bar built on it would say "done" before the script was.
  let elapsed = 0;

  async function wait(ms: number) {
    const step = opts.stepMs ?? 50;
    let left = opts.fast ? Math.min(ms, 10) : ms;
    let owed = ms;
    if (opts.fast) { elapsed += ms; opts.onTick?.(elapsed); }
    while (left > 0 || opts.paused()) {
      if (!opts.alive()) throw new TourCancelled();
      await new Promise((r) => setTimeout(r, step));
      if (!opts.paused()) {
        left -= step;
        if (!opts.fast) {
          const counted = Math.min(step, owed);
          owed -= counted;
          elapsed += counted;
          opts.onTick?.(elapsed);
        }
      }
    }
    if (!opts.alive()) throw new TourCancelled();
  }

  // A missing element is a broken scene, not something to paper over: fail
  // loudly so it shows up the moment the app's markup changes under it.
  function find(selector: string): HTMLElement {
    const el = root().querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`Tour: nothing matches ${selector}`);
    return el;
  }

  function findText(text: string, within = '*'): HTMLElement {
    const all = Array.from(root().querySelectorAll<HTMLElement>(within));
    // The innermost match, so a tap lands on the label itself and not on the
    // whole card that happens to contain it.
    const hits = all.filter((el) => el.textContent?.trim() === text);
    const el = hits.find((h) => !hits.some((o) => o !== h && h.contains(o))) ?? hits[0];
    if (!el) throw new Error(`Tour: no element with text "${text}"`);
    return el;
  }

  // The innermost element whose text contains `text` (a chip whose exact
  // wording carries a prefix, like "Account: Existing district").
  function findIncl(text: string, within = '*'): HTMLElement {
    const hits = Array.from(root().querySelectorAll<HTMLElement>(within)).filter((el) => el.textContent?.includes(text));
    const el = hits.find((h) => !hits.some((o) => o !== h && h.contains(o))) ?? hits[0];
    if (!el) throw new Error(`Tour: no element containing "${text}"`);
    return el;
  }

  // A Quasar input by its visible label ("Email", "Notes").
  function field(label: string) {
    const labels = Array.from(root().querySelectorAll<HTMLElement>('.q-field__label'));
    const lab = labels.find((l) => l.textContent?.trim() === label);
    const input = lab?.closest('.q-field')?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
    if (!input) throw new Error(`Tour: no field labelled ${label}`);
    return input;
  }

  // Where an element's centre sits in the device's own (unscaled) pixels.
  function centre(el: Element) {
    const r = root().getBoundingClientRect();
    const e = el.getBoundingClientRect();
    const s = device.scale();
    return { x: (e.left + e.width / 2 - r.left) / s, y: (e.top + e.height / 2 - r.top) / s };
  }

  async function moveTo(el: Element) {
    const c = centre(el);
    device.finger.visible = true;
    device.finger.x = c.x;
    device.finger.y = c.y;
    await wait(700);
  }

  async function tap(el: Element, o: { press?: boolean } = {}) {
    await moveTo(el);
    device.finger.tapping = true;
    await wait(160);
    if (!o.press) (el as HTMLElement).click();
    await wait(340);
    device.finger.tapping = false;
  }

  // Types the way a person does, one character at a time, through the same
  // input event v-model listens to. Never focuses the field: on a phone that
  // would open the keyboard and scroll the real page.
  async function type(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
    for (let i = 1; i <= text.length; i++) {
      el.value = text.slice(0, i);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(45);
    }
  }

  async function scrollTo(container: Element, el: Element, offset = 90) {
    const s = device.scale();
    const top = (el.getBoundingClientRect().top - container.getBoundingClientRect().top) / s + container.scrollTop - offset;
    const target = Math.min(Math.max(0, top), Math.max(0, container.scrollHeight - container.clientHeight));
    container.scrollTo({ top: target, behavior: opts.fast ? 'auto' : 'smooth' });
    // Wait until it has actually arrived. A fixed 650 ms was not enough for a long
    // scroll on a phone (found checking the admin scene at 375px: the ring on "Add
    // person" and "Working at" appeared while the card was still sliding into view),
    // and "stopped moving" is not enough either: a smooth scroll can start late (a
    // throttled or backgrounded tab), so wait for the target itself, with a ceiling.
    for (let waited = 0; waited < 2400; waited += 100) {
      await wait(100);
      if (Math.abs(container.scrollTop - target) < 1) break;
    }
    // If it still hasn't arrived (a tab that isn't painting frames doesn't advance a
    // smooth scroll), jump there: the next thing the script does is point at the target.
    if (Math.abs(container.scrollTop - target) >= 1) container.scrollTo({ top: target, behavior: 'auto' });
    await wait(150);
  }

  // A pulsing outline that says "look at this" without pressing it.
  async function ring(el: Element, ms = 1600) {
    el.classList.add('tour-ring');
    try { await wait(ms); } finally { el.classList.remove('tour-ring'); }
  }

  function hideFinger() {
    device.finger.visible = false;
    device.finger.tapping = false;
  }

  return { wait, elapsed: () => elapsed, find, findText, findIncl, field, moveTo, tap, type, scrollTo, ring, hideFinger };
}
