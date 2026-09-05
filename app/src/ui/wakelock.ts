/**
 * Keeps the screen awake while the chart is open — stitching means long stretches
 * of not touching the phone, and a screen that dims every thirty seconds is
 * unusable. Supported from iOS 16.4; absent elsewhere, in which case this is a
 * no-op.
 *
 * The lock is released by the browser whenever the tab is hidden, so it has to be
 * taken again on every return from the background.
 */
let lock: WakeLockSentinel | null = null;

async function acquire(): Promise<void> {
  if (lock || document.visibilityState !== 'visible' || !navigator.wakeLock) return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => {
      lock = null;
    });
  } catch {
    // Refused (low battery, no user gesture yet) — try again on the next return.
    lock = null;
  }
}

export function keepScreenAwake(): void {
  void acquire();
  document.addEventListener('visibilitychange', () => void acquire());
}
