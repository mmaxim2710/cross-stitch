/**
 * Cells picked in marking mode, waiting for the ✓ / ✗ confirmation. Purely
 * transient: nothing here reaches IndexedDB or the server until it is applied to
 * {@link Progress}.
 */
export class Selection {
  count = 0;

  private bits: Uint8Array;

  constructor(readonly size: number) {
    this.bits = new Uint8Array((size + 7) >> 3);
  }

  has(i: number): boolean {
    return (this.bits[i >> 3] & (1 << (i & 7))) !== 0;
  }

  set(i: number, value: boolean): void {
    if (i < 0 || i >= this.size) return;
    const byte = i >> 3;
    const mask = 1 << (i & 7);
    const was = (this.bits[byte] & mask) !== 0;
    if (was === value) return;
    if (value) {
      this.bits[byte] |= mask;
      this.count++;
    } else {
      this.bits[byte] &= ~mask;
      this.count--;
    }
  }

  clear(): void {
    if (this.count === 0) return;
    this.bits.fill(0);
    this.count = 0;
  }

  /** Walks the picked cells; whole empty bytes are skipped, so a small pick over
      a large chart costs almost nothing. */
  forEach(fn: (index: number) => void): void {
    for (let byte = 0; byte < this.bits.length; byte++) {
      const bits = this.bits[byte];
      if (bits === 0) continue;
      for (let bit = 0; bit < 8; bit++) {
        if (bits & (1 << bit)) fn((byte << 3) | bit);
      }
    }
  }
}
