import type { RawPattern, StoredProgress } from '../types';
import { base64ToBytes, bytesToBase64 } from '../util';
import { db } from './db';
import { decodePattern, encodePattern } from './pattern';

const FORMAT = 1;

type RawProgress = Omit<StoredProgress, 'bits' | 'base'> & { bits: string; base: string };

type Backup = {
  format: number;
  exportedAt: string;
  patterns: RawPattern[];
  progress: RawProgress[];
};

/**
 * A file the user keeps themselves — the fallback for the day both the phone's
 * IndexedDB and the Cloudflare account are unavailable. Charts are included, not
 * only masks: a mask without its chart restores nothing.
 */
export async function buildBackup(): Promise<Backup> {
  const [patterns, progress] = await Promise.all([db.allPatterns(), db.allProgress()]);
  return {
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    patterns: patterns.map(encodePattern),
    progress: progress.map((p) => ({
      ...p,
      bits: bytesToBase64(p.bits),
      base: bytesToBase64(p.base),
    })),
  };
}

export function backupFileName(): string {
  return `вышивка-${new Date().toISOString().slice(0, 10)}.json`;
}

export function downloadBackup(backup: Backup, name = backupFileName()): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(backup)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // Safari needs the object URL to outlive the click before it starts the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type RestoreResult = { patterns: number; progress: number };

/**
 * Restores over whatever is on the device. Progress comes back marked dirty so the
 * next sync pushes it up — and, if the server is ahead, merges rather than clobbers.
 */
export async function restoreBackup(file: File): Promise<RestoreResult> {
  const backup = JSON.parse(await file.text()) as Partial<Backup>;
  if (backup.format !== FORMAT || !Array.isArray(backup.patterns)) {
    throw new Error('это не файл бэкапа');
  }

  for (const raw of backup.patterns) await db.putPattern(decodePattern(raw));

  const restored = backup.progress ?? [];
  for (const p of restored) {
    await db.putProgress({
      patternId: p.patternId,
      version: p.version ?? 0,
      bits: base64ToBytes(p.bits),
      base: base64ToBytes(p.base),
      dirty: true,
      updatedAt: p.updatedAt ?? Date.now(),
    });
  }

  return { patterns: backup.patterns.length, progress: restored.length };
}
