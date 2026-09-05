/*
 * Copyright (C) 2026 mmaxim2710
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version.  See <https://www.gnu.org/licenses/>.
 */

/**
 * Sync backend for the cross-stitch app: charts and progress masks in D1.
 *
 * One user, one shared bearer token. Progress writes are guarded by a version
 * number so that an offline device cannot silently overwrite newer work — the
 * client merges and retries on 409.
 */

export type Env = {
  DB: D1Database;
  AUTH_TOKEN: string;
};

const CORS = {
  // The app lives on GitHub Pages, the worker on workers.dev, so every call is
  // cross-origin. A wildcard is safe here: authorisation is a bearer token, never
  // a cookie, so a random page cannot borrow the browser's credentials.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

/** Compares without leaking the position of the first difference through timing. */
function tokenMatches(given: string, expected: string): boolean {
  // Also covers the window between `wrangler deploy` and `wrangler secret put`:
  // with no secret set, nothing is accepted rather than everything.
  if (!expected) return false;
  const encoder = new TextEncoder();
  const a = encoder.encode(given);
  const b = encoder.encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i % b.length] as number);
  return diff === 0;
}

function authorised(request: Request, env: Env): boolean {
  const header = request.headers.get('Authorization') ?? '';
  const prefix = 'Bearer ';
  return header.startsWith(prefix) && tokenMatches(header.slice(prefix.length), env.AUTH_TOKEN);
}

/** Rejects anything that is not plain base64 before it reaches the database. */
function isBase64(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 4_000_000 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(value)
  );
}

async function listPatterns(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, name, width, height, stitch_count FROM patterns ORDER BY name',
  ).all<{ id: string; name: string; width: number; height: number; stitch_count: number }>();
  return json(
    results.map((r) => ({
      id: r.id,
      name: r.name,
      width: r.width,
      height: r.height,
      stitchCount: r.stitch_count,
    })),
  );
}

async function getPattern(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT json FROM patterns WHERE id = ?')
    .bind(id)
    .first<{ json: string }>();
  if (!row) return json({ error: 'not found' }, 404);
  return new Response(row.json, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

async function putPattern(env: Env, id: string, request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  const p = body as Record<string, unknown>;
  if (typeof p.width !== 'number' || typeof p.height !== 'number' || !isBase64(p.cells)) {
    return json({ error: 'not a chart' }, 400);
  }
  await env.DB.prepare(
    `INSERT INTO patterns (id, name, width, height, stitch_count, json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, width = excluded.width, height = excluded.height,
       stitch_count = excluded.stitch_count, json = excluded.json,
       updated_at = excluded.updated_at`,
  )
    .bind(
      id,
      typeof p.name === 'string' ? p.name : id,
      p.width,
      p.height,
      typeof p.stitchCount === 'number' ? p.stitchCount : 0,
      JSON.stringify({ ...p, id }),
      Date.now(),
    )
    .run();
  return json({ id });
}

async function deletePattern(env: Env, id: string): Promise<Response> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM patterns WHERE id = ?').bind(id),
    env.DB.prepare('DELETE FROM progress WHERE pattern_id = ?').bind(id),
  ]);
  return json({ id });
}

async function getProgress(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT version, bits, updated_at FROM progress WHERE pattern_id = ?',
  )
    .bind(id)
    .first<{ version: number; bits: string; updated_at: number }>();
  // Having no row is a normal state, not an error: version 0 means "nothing stored".
  if (!row) return json({ version: 0, bits: null, updatedAt: 0 });
  return json({ version: row.version, bits: row.bits, updatedAt: row.updated_at });
}

async function putProgress(env: Env, id: string, request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  const { baseVersion, bits } = body as { baseVersion?: unknown; bits?: unknown };
  if (typeof baseVersion !== 'number' || baseVersion < 0 || !isBase64(bits)) {
    return json({ error: 'baseVersion and bits required' }, 400);
  }

  const now = Date.now();
  // Both statements are conditional writes: D1 reports zero affected rows when the
  // client's version is stale, and that is exactly the conflict we need to detect.
  const written =
    baseVersion === 0
      ? await env.DB.prepare(
          `INSERT INTO progress (pattern_id, version, bits, updated_at) VALUES (?, 1, ?, ?)
           ON CONFLICT(pattern_id) DO NOTHING`,
        )
          .bind(id, bits, now)
          .run()
      : await env.DB.prepare(
          `UPDATE progress SET version = version + 1, bits = ?, updated_at = ?
           WHERE pattern_id = ? AND version = ?`,
        )
          .bind(bits, now, id, baseVersion)
          .run();

  if (written.meta.changes === 1) return json({ version: baseVersion + 1 });

  const current = await env.DB.prepare('SELECT version, bits FROM progress WHERE pattern_id = ?')
    .bind(id)
    .first<{ version: number; bits: string }>();
  if (!current) return json({ error: 'write failed' }, 500);
  return json({ version: current.version, bits: current.bits }, 409);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    // Unauthenticated on purpose: the settings screen uses it to tell a wrong URL
    // apart from a wrong token.
    if (path === '/api/health') return json({ ok: true });

    if (!authorised(request, env)) return json({ error: 'unauthorised' }, 401);

    const patterns = /^\/api\/patterns(?:\/([^/]+))?$/.exec(path);
    if (patterns) {
      const id = patterns[1] === undefined ? null : decodeURIComponent(patterns[1]);
      if (id === null) {
        if (request.method === 'GET') return listPatterns(env);
      } else if (request.method === 'GET') {
        return getPattern(env, id);
      } else if (request.method === 'PUT') {
        return putPattern(env, id, request);
      } else if (request.method === 'DELETE') {
        return deletePattern(env, id);
      }
      return json({ error: 'method not allowed' }, 405);
    }

    const progress = /^\/api\/progress\/([^/]+)$/.exec(path);
    if (progress) {
      const id = decodeURIComponent(progress[1] as string);
      if (request.method === 'GET') return getProgress(env, id);
      if (request.method === 'PUT') return putProgress(env, id, request);
      return json({ error: 'method not allowed' }, 405);
    }

    return json({ error: 'not found' }, 404);
  },
} satisfies ExportedHandler<Env>;
