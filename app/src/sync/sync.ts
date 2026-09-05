import { encodePattern } from '../state/pattern';
import type { Progress } from '../state/progress';
import type { Pattern } from '../types';
import { base64ToBytes, bytesEqual, bytesToBase64, debounce } from '../util';
import { Api, ApiError, currentApi } from './api';
import { merge } from './merge';

/** How long after the last stitch a push is attempted. */
const QUIET_MS = 5000;

/** How many times a version conflict may be merged and retried before giving up. */
const MAX_ATTEMPTS = 4;

export type SyncState =
  /** No server configured — the app is local-only, which is a valid way to use it. */
  | 'off'
  | 'idle'
  | 'pending'
  | 'syncing'
  | 'offline'
  | 'error';

/**
 * Keeps one pattern's progress mask in step with the worker.
 *
 * Everything is written to IndexedDB first and pushed afterwards, so a failed or
 * skipped sync never costs work — it only delays the off-device copy.
 */
export class Sync {
  state: SyncState = 'off';
  message = '';

  private api: Api | null = null;
  private pattern: Pattern | null = null;
  private progress: Progress | null = null;
  private listeners = new Set<() => void>();
  /** Patterns already known to exist on the server, so we ask only once a session. */
  private published = new Set<string>();
  private running = false;
  private rerun = false;
  private later = debounce(QUIET_MS, () => void this.run());

  constructor() {
    this.reconfigure();
    window.addEventListener('online', () => void this.run());
    window.addEventListener('offline', () => this.set('offline'));
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get configured(): boolean {
    return this.api !== null;
  }

  /** Re-reads the settings; called after the settings sheet saves. */
  reconfigure(): void {
    this.api = currentApi();
    this.published.clear();
    this.set(this.api ? 'pending' : 'off');
  }

  attach(pattern: Pattern, progress: Progress): void {
    this.later.cancel();
    this.pattern = pattern;
    this.progress = progress;
    this.set(this.api ? (progress.dirty ? 'pending' : 'idle') : 'off');
    void this.run();
  }

  /** Called on every edit; coalesces a burst of stitching into one push. */
  schedule(): void {
    if (!this.api) return;
    if (this.state !== 'syncing') this.set('pending');
    this.later();
  }

  /** Runs now, skipping the quiet period — startup, backgrounding, manual button. */
  async run(): Promise<void> {
    this.later.cancel();
    const { api, pattern, progress } = this;
    if (!api || !pattern || !progress) return;

    if (this.running) {
      // A push is already in flight; make it loop once more with the newer mask.
      this.rerun = true;
      return;
    }
    if (!navigator.onLine) {
      this.set('offline');
      return;
    }

    this.running = true;
    this.set('syncing');
    try {
      await this.publish(api, pattern);
      await this.push(api, progress);
      this.set(progress.dirty ? 'pending' : 'idle');
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) this.set('offline');
      else this.set('error', err instanceof Error ? err.message : String(err));
    } finally {
      this.running = false;
      if (this.rerun) {
        this.rerun = false;
        void this.run();
      }
    }
  }

  /** Charts are not on Pages, so the server copy is the only off-device one. */
  private async publish(api: Api, pattern: Pattern): Promise<void> {
    if (this.published.has(pattern.id)) return;
    if (this.published.size === 0) {
      for (const p of await api.listPatterns()) this.published.add(p.id);
      if (this.published.has(pattern.id)) return;
    }
    await api.putPattern(encodePattern(pattern));
    this.published.add(pattern.id);
  }

  private async push(api: Api, progress: Progress): Promise<void> {
    const remote = await api.getProgress(progress.patternId);
    let version = remote.version;

    if (remote.bits !== null && version !== progress.version) {
      this.adopt(progress, base64ToBytes(remote.bits));
    }
    if (version === progress.version && !progress.dirty) return;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Snapshot the mask: the user may keep stitching while the request is open,
      // and only what we actually sent counts as confirmed.
      const sent = new Uint8Array(progress.bits);
      const result = await api.putProgress(progress.patternId, version, bytesToBase64(sent));
      if (result.ok) {
        progress.markSynced(result.version, sent);
        return;
      }
      version = result.version;
      this.adopt(progress, base64ToBytes(result.bits));
    }
    throw new Error('не удалось согласовать версию с сервером');
  }

  /** Merges the server's mask into the local one, keeping this device's own edits. */
  private adopt(progress: Progress, server: Uint8Array): void {
    const merged = merge(progress.bits, progress.base, server);
    if (!bytesEqual(merged, progress.bits)) progress.replace(merged);
  }

  private set(state: SyncState, message = ''): void {
    if (this.state === state && this.message === message) return;
    this.state = state;
    this.message = message;
    for (const fn of this.listeners) fn();
  }
}

export const LABELS: Record<SyncState, string> = {
  off: 'Синхронизация не настроена',
  idle: 'Синхронизировано',
  pending: 'Есть несохранённые изменения',
  syncing: 'Синхронизация…',
  offline: 'Офлайн',
  error: 'Ошибка синхронизации',
};
