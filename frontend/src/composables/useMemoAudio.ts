import { onBeforeUnmount, ref } from 'vue';

// A signed Storage URL lasts 5 minutes (inbound-messages-audio). A player left idle
// longer than this fetches a fresh one on the next Play instead of failing on an
// expired link.
const URL_FRESH_MS = 4 * 60 * 1000;

// Only one memo plays at a time: starting one stops whichever was playing, so two
// cards never talk over each other.
let current: { stop: () => void } | null = null;

// One memo's audio. The URL is fetched on the first Play, not when the card draws:
// a list of memos must not request a signed link per card nobody listens to.
export function useMemoAudio(getUrl: () => Promise<string>) {
  const playing = ref(false);
  const loading = ref(false);
  const failed = ref(false);
  const time = ref(0);
  const duration = ref(0);
  let el: HTMLAudioElement | null = null;
  let fetchedAt = 0;

  const me = { stop };

  function stop() {
    el?.pause();
    playing.value = false;
  }

  function drop() {
    if (!el) return;
    el.pause();
    el.removeAttribute('src');
    el = null;
    playing.value = false;
  }

  function open(url: string) {
    const a = new Audio(url);
    a.preload = 'metadata';
    a.addEventListener('loadedmetadata', () => { duration.value = Number.isFinite(a.duration) ? a.duration : 0; });
    a.addEventListener('timeupdate', () => { time.value = a.currentTime; });
    a.addEventListener('play', () => { playing.value = true; });
    a.addEventListener('pause', () => { playing.value = false; });
    a.addEventListener('ended', () => { playing.value = false; time.value = 0; });
    // An expired or removed file: forget it so the next Play asks for a new link.
    a.addEventListener('error', () => { failed.value = true; drop(); });
    return a;
  }

  async function toggle() {
    if (playing.value) { stop(); return; }
    failed.value = false;
    if (el && Date.now() - fetchedAt > URL_FRESH_MS) drop();
    if (!el) {
      loading.value = true;
      try {
        const url = await getUrl();
        el = open(url);
        fetchedAt = Date.now();
      } catch {
        // The 404 for a purged recording was already shown by the axios interceptor.
        failed.value = true;
        return;
      } finally {
        loading.value = false;
      }
    }
    if (current && current !== me) current.stop();
    current = me;
    try {
      await el.play();
    } catch {
      failed.value = true;
      drop();
    }
  }

  function seek(seconds: number) {
    if (el) el.currentTime = seconds;
    time.value = seconds;
  }

  onBeforeUnmount(() => {
    drop();
    if (current === me) current = null;
  });

  return { playing, loading, failed, time, duration, toggle, seek };
}
