/**
 * Tests for the ring buffer data structure.
 */

import { describe, test, expect } from "bun:test";
import { RingBuffer, DEFAULT_CAPACITY } from "./ring-buffer.ts";

describe("RingBuffer", () => {
  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  test("default capacity matches DEFAULT_CAPACITY", () => {
    const buf = new RingBuffer<string>();
    expect(buf.capacity).toBe(DEFAULT_CAPACITY);
    expect(buf.capacity).toBe(200);
  });

  test("custom capacity", () => {
    const buf = new RingBuffer<number>(5);
    expect(buf.capacity).toBe(5);
  });

  test("throws on zero capacity", () => {
    expect(() => new RingBuffer(0)).toThrow("capacity must be at least 1");
  });

  test("throws on negative capacity", () => {
    expect(() => new RingBuffer(-1)).toThrow("capacity must be at least 1");
  });

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------

  test("empty buffer has length 0", () => {
    const buf = new RingBuffer<string>(5);
    expect(buf.length).toBe(0);
  });

  test("empty buffer toArray returns empty array", () => {
    const buf = new RingBuffer<string>(5);
    expect(buf.toArray()).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Insertion order
  // ---------------------------------------------------------------------------

  test("items are returned in insertion order", () => {
    const buf = new RingBuffer<string>(5);
    buf.push("a");
    buf.push("b");
    buf.push("c");
    expect(buf.toArray()).toEqual(["a", "b", "c"]);
    expect(buf.length).toBe(3);
  });

  test("filling to capacity preserves order", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.toArray()).toEqual([1, 2, 3]);
    expect(buf.length).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // Overflow / wrap-around
  // ---------------------------------------------------------------------------

  test("overflow evicts oldest item", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4); // Evicts 1
    expect(buf.toArray()).toEqual([2, 3, 4]);
    expect(buf.length).toBe(3);
  });

  test("multiple overflows maintain correct order", () => {
    const buf = new RingBuffer<number>(3);
    for (let i = 1; i <= 10; i++) {
      buf.push(i);
    }
    // Should contain the last 3: [8, 9, 10]
    expect(buf.toArray()).toEqual([8, 9, 10]);
    expect(buf.length).toBe(3);
  });

  test("capacity of 1 always holds the latest item", () => {
    const buf = new RingBuffer<string>(1);
    buf.push("a");
    expect(buf.toArray()).toEqual(["a"]);
    buf.push("b");
    expect(buf.toArray()).toEqual(["b"]);
    buf.push("c");
    expect(buf.toArray()).toEqual(["c"]);
    expect(buf.length).toBe(1);
  });

  test("wrap-around with exact capacity multiples", () => {
    const buf = new RingBuffer<number>(4);
    // Fill exactly twice
    for (let i = 1; i <= 8; i++) {
      buf.push(i);
    }
    expect(buf.toArray()).toEqual([5, 6, 7, 8]);
  });

  // ---------------------------------------------------------------------------
  // Clear
  // ---------------------------------------------------------------------------

  test("clear empties the buffer", () => {
    const buf = new RingBuffer<string>(5);
    buf.push("a");
    buf.push("b");
    buf.push("c");
    expect(buf.length).toBe(3);

    buf.clear();
    expect(buf.length).toBe(0);
    expect(buf.toArray()).toEqual([]);
  });

  test("push after clear works correctly", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.clear();

    buf.push(10);
    buf.push(20);
    expect(buf.toArray()).toEqual([10, 20]);
    expect(buf.length).toBe(2);
  });

  test("clear after overflow resets properly", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4); // Overflow
    buf.push(5);
    buf.clear();

    expect(buf.length).toBe(0);
    expect(buf.toArray()).toEqual([]);

    buf.push(100);
    expect(buf.toArray()).toEqual([100]);
  });

  // ---------------------------------------------------------------------------
  // Generic type support
  // ---------------------------------------------------------------------------

  test("works with object types", () => {
    const buf = new RingBuffer<{ id: number; name: string }>(2);
    buf.push({ id: 1, name: "first" });
    buf.push({ id: 2, name: "second" });
    buf.push({ id: 3, name: "third" }); // Evicts first

    expect(buf.toArray()).toEqual([
      { id: 2, name: "second" },
      { id: 3, name: "third" },
    ]);
  });

  // ---------------------------------------------------------------------------
  // Stress test
  // ---------------------------------------------------------------------------

  test("handles large number of inserts correctly", () => {
    const cap = 200;
    const buf = new RingBuffer<number>(cap);
    const total = 10_000;

    for (let i = 0; i < total; i++) {
      buf.push(i);
    }

    expect(buf.length).toBe(cap);
    const arr = buf.toArray();
    expect(arr.length).toBe(cap);
    // Should contain [9800, 9801, ..., 9999]
    expect(arr[0]).toBe(total - cap);
    expect(arr[cap - 1]).toBe(total - 1);

    // Verify monotonically increasing
    for (let i = 1; i < arr.length; i++) {
      expect(arr[i]!).toBe(arr[i - 1]! + 1);
    }
  });
});
