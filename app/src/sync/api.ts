import type { PatternSummary, RawPattern } from '../types';

const SETTINGS = 'cross-stitch:sync';

export type SyncSettings = { url: string; token: string };

/** Settings live in localStorage: one device, one person, no account to speak of. */
export function loadSettings(): SyncSettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SyncSettings>;
    if (!parsed.url || !parsed.token) return null;
    return { url: parsed.url.replace(/\/+$/, ''), token: parsed.token };
  } catch {
    return null;
  }
}

export function saveSettings(settings: SyncSettings | null): void {
  if (settings) localStorage.setItem(SETTINGS, JSON.stringify(settings));
  else localStorage.removeItem(SETTINGS);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type RemoteProgress = { version: number; bits: string | null; updatedAt: number };

/** Either the new version, or the server's state to merge against. */
export type PutResult = { ok: true; version: number } | { ok: false; version: number; bits: string };

export class Api {
  constructor(readonly settings: SyncSettings) {}

  private async call(path: string, init?: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(this.settings.url + path, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.settings.token}`,
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          ...init?.headers,
        },
      });
    } catch {
      // A network failure is not the same as a rejection: status 0 tells the caller
      // to stay quiet and retry later instead of complaining about the token.
      throw new ApiError('сервер недоступен', 0);
    }
    if (res.status === 401) throw new ApiError('неверный токен', 401);
    return res;
  }

  private async expectOk(path: string, init?: RequestInit): Promise<Response> {
    const res = await this.call(path, init);
    if (!res.ok) throw new ApiError(`сервер ответил ${res.status}`, res.status);
    return res;
  }

  /** Unauthenticated probe — separates a wrong address from a wrong token. */
  async health(): Promise<void> {
    const res = await this.call('/api/health');
    if (!res.ok) throw new ApiError(`сервер ответил ${res.status}`, res.status);
  }

  async listPatterns(): Promise<PatternSummary[]> {
    return (await this.expectOk('/api/patterns')).json() as Promise<PatternSummary[]>;
  }

  async getPattern(id: string): Promise<RawPattern | null> {
    const res = await this.call(`/api/patterns/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new ApiError(`сервер ответил ${res.status}`, res.status);
    return res.json() as Promise<RawPattern>;
  }

  async putPattern(raw: RawPattern): Promise<void> {
    await this.expectOk(`/api/patterns/${encodeURIComponent(raw.id)}`, {
      method: 'PUT',
      body: JSON.stringify(raw),
    });
  }

  async getProgress(id: string): Promise<RemoteProgress> {
    return (await this.expectOk(`/api/progress/${encodeURIComponent(id)}`)).json() as Promise<RemoteProgress>;
  }

  async putProgress(id: string, baseVersion: number, bits: string): Promise<PutResult> {
    const res = await this.call(`/api/progress/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ baseVersion, bits }),
    });
    if (res.status === 409) {
      const body = (await res.json()) as { version: number; bits: string };
      return { ok: false, version: body.version, bits: body.bits };
    }
    if (!res.ok) throw new ApiError(`сервер ответил ${res.status}`, res.status);
    const body = (await res.json()) as { version: number };
    return { ok: true, version: body.version };
  }
}

/** The configured client, or null while the app has no server set up. */
export function currentApi(): Api | null {
  const settings = loadSettings();
  return settings ? new Api(settings) : null;
}
