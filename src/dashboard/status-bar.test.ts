import { describe, it, expect } from "vitest";
import { formatElapsed } from "./format.ts";

describe("formatElapsed", () => {
  it('returns "< 1m" for a timestamp 30 seconds ago', () => {
    const now = new Date("2025-06-15T12:00:30Z").getTime();
    expect(formatElapsed("2025-06-15T12:00:00Z", now)).toBe("< 1m");
  });

  it('returns "2m 34s" for a timestamp 2 minutes 34 seconds ago', () => {
    const now = new Date("2025-06-15T12:02:34Z").getTime();
    expect(formatElapsed("2025-06-15T12:00:00Z", now)).toBe("2m 34s");
  });

  it('returns "1h 5m" for a timestamp 1 hour 5 minutes ago', () => {
    const now = new Date("2025-06-15T13:05:00Z").getTime();
    expect(formatElapsed("2025-06-15T12:00:00Z", now)).toBe("1h 5m");
  });

  it("returns empty string for undefined input", () => {
    expect(formatElapsed(undefined)).toBe("");
  });

  it("returns empty string for invalid date string", () => {
    expect(formatElapsed("not-a-date")).toBe("");
  });

  it("returns empty string for empty string input", () => {
    expect(formatElapsed("")).toBe("");
  });

  it("returns empty string for a future timestamp", () => {
    const now = new Date("2025-06-15T12:00:00Z").getTime();
    expect(formatElapsed("2025-06-15T13:00:00Z", now)).toBe("");
  });

  it('exactly 60 seconds shows "1m 0s"', () => {
    const now = new Date("2025-06-15T12:01:00Z").getTime();
    expect(formatElapsed("2025-06-15T12:00:00Z", now)).toBe("1m 0s");
  });
});
