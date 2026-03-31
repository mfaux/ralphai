/**
 * Generic circular (ring) buffer with fixed capacity.
 *
 * Used by the dashboard to hold the most recent N lines of agent output
 * received via IPC, evicting oldest entries when capacity is exceeded.
 */

/** Default ring buffer capacity, matching the output tail size. */
export const DEFAULT_CAPACITY = 200;

export class RingBuffer<T> {
  private readonly items: (T | undefined)[];
  private readonly cap: number;
  private head = 0; // Next write position
  private count = 0;

  constructor(capacity: number = DEFAULT_CAPACITY) {
    if (capacity < 1) {
      throw new Error("RingBuffer capacity must be at least 1");
    }
    this.cap = capacity;
    this.items = new Array(capacity);
  }

  /** Add an item to the buffer, evicting the oldest if at capacity. */
  push(item: T): void {
    this.items[this.head] = item;
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) {
      this.count++;
    }
  }

  /** Return all items in insertion order (oldest first). */
  toArray(): T[] {
    if (this.count === 0) return [];

    const result: T[] = [];
    // Start from the oldest item
    const start = this.count < this.cap ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.cap;
      result.push(this.items[idx] as T);
    }
    return result;
  }

  /** Remove all items from the buffer. */
  clear(): void {
    this.head = 0;
    this.count = 0;
    // Clear references to allow GC
    this.items.fill(undefined);
  }

  /** Number of items currently in the buffer. */
  get length(): number {
    return this.count;
  }

  /** Maximum capacity of the buffer. */
  get capacity(): number {
    return this.cap;
  }
}
