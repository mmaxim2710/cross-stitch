/**
 * Three-way merge of progress masks.
 *
 * Last-write-wins would throw away whatever was stitched offline, so instead the
 * cells this device actually changed since the server last confirmed the state
 * win, and every other cell is taken from the server.
 */
export function merge(local: Uint8Array, base: Uint8Array, server: Uint8Array): Uint8Array {
  const out = new Uint8Array(local.length);
  for (let i = 0; i < out.length; i++) {
    const l = local[i];
    const b = i < base.length ? base[i] : 0;
    const s = i < server.length ? server[i] : 0;
    const changed = l ^ b;
    out[i] = (l & changed) | (s & ~changed);
  }
  return out;
}
