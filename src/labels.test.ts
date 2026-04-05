import { describe, it, expect } from "bun:test";
import { STATE_LABELS } from "./labels.ts";

// ---------------------------------------------------------------------------
// Shared state label constants
// ---------------------------------------------------------------------------

describe("shared state label constants", () => {
  it("state labels are plain strings without family prefixes", () => {
    for (const label of STATE_LABELS) {
      expect(label).not.toContain(":");
      expect(label).not.toContain("ralphai");
    }
  });
});
