// Getting a generated image onto the user's device.
//
// A web page cannot write into the Photos library. The only route from a
// browser into it is the OS share sheet ("Save Image" on iOS, Google Photos /
// "Save to device" on Android), reached through navigator.share({ files }).
// A plain <a download> lands the PNG in Files/Downloads on a phone, which is
// not where a rep looks for a slide, and is ignored outright inside the
// in-app browsers (Teams, Outlook, Gmail) that reps open our links from.
//
// Kept free of Quasar/DOM imports so the choice of route is unit-testable.

export type SaveStrategy = 'share' | 'download' | 'manual';

export type SaveOutcome = 'shared' | 'downloaded' | 'cancelled' | 'manual';

interface ShareNavigator {
  canShare?: (data: { files: File[] }) => boolean;
  share?: (data: { files: File[]; title?: string | undefined }) => Promise<void>;
}

// `mobile` decides whether we want the share sheet at all. Desktop browsers
// (macOS Safari included) also expose navigator.share, but a real download is
// what someone at a laptop expects.
export function pickSaveStrategy(nav: ShareNavigator, file: File, mobile: boolean): SaveStrategy {
  if (!mobile) return 'download';
  const canShareFiles =
    typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] });
  // Mobile without file-share support (older browsers, many WebViews): a
  // download would silently do nothing, so hand back to the caller to show
  // the image for a long-press save instead.
  return canShareFiles ? 'share' : 'manual';
}

// Also used by the CSV export, which had the same detached-anchor and
// immediate-revoke bugs.
export function anchorDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  // Attached, because Firefox and some WebViews ignore click() on a detached
  // anchor.
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Not revoked straight away: on mobile the download starts asynchronously,
  // and revoking on the next line cancelled it or produced an empty file.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function saveImageBlob(
  blob: Blob,
  filename: string,
  opts: { mobile: boolean; title?: string },
): Promise<SaveOutcome> {
  const file = new File([blob], filename, { type: blob.type || 'image/png' });
  const strategy = pickSaveStrategy(navigator as ShareNavigator, file, opts.mobile);

  if (strategy === 'download') {
    anchorDownload(blob, filename);
    return 'downloaded';
  }
  if (strategy === 'manual') return 'manual';

  try {
    await (navigator as ShareNavigator).share!({ files: [file], title: opts.title });
    return 'shared';
  } catch (err) {
    // Closing the sheet is a choice, not an error.
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    // NotAllowedError (the tap's user-activation expired while the slide
    // rendered) or anything else: don't dead-end, fall back to the image.
    return 'manual';
  }
}
