import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, '..', 'data');

type Entry = { id: string; name: string; width: number; height: number; stitchCount: number };

function readPatterns(): { id: string; json: string; entry: Entry }[] {
  if (!existsSync(dataDir)) return [];
  return readdirSync(dataDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const json = readFileSync(resolve(dataDir, f), 'utf8');
      const p = JSON.parse(json);
      const id: string = p.id ?? f.slice(0, -5);
      return {
        id,
        json,
        entry: { id, name: p.name, width: p.width, height: p.height, stitchCount: p.stitchCount },
      };
    });
}

/**
 * Patterns live outside the repo (`data/` is gitignored — GitHub Pages is always
 * public and the charts are not ours to publish). The dev server serves them from
 * disk; a production build embeds them only when explicitly asked for.
 */
function patterns(): Plugin {
  const embed = process.env.VITE_EMBED_PATTERNS === '1';
  return {
    name: 'local-patterns',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (!url.startsWith('/patterns/')) return next();
        const found = readPatterns();
        const body =
          url === '/patterns/index.json'
            ? JSON.stringify(found.map((p) => p.entry))
            : found.find((p) => `/patterns/${p.id}.json` === url)?.json;
        if (body === undefined) return next();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(body);
      });
    },
    generateBundle() {
      const found = embed ? readPatterns() : [];
      this.emitFile({
        type: 'asset',
        fileName: 'patterns/index.json',
        source: JSON.stringify(found.map((p) => p.entry)),
      });
      for (const p of found) {
        this.emitFile({ type: 'asset', fileName: `patterns/${p.id}.json`, source: p.json });
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [patterns()],
  build: { target: 'es2022' },
  // `host: true` binds every interface: Windows otherwise resolves the default
  // `localhost` to ::1 only, and it makes the phone reachable over the LAN.
  server: { host: true, port: 5173, strictPort: true },
  preview: { host: true, port: 5174, strictPort: true },
});
