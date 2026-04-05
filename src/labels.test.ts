import { describe, it, expect } from "bun:test";
import {
  IN_PROGRESS_LABEL,
  DONE_LABEL,
  STUCK_LABEL,
  STATE_LABELS,
} from "./labels.ts";

// ---------------------------------------------------------------------------
// Shared state label constants
// ---------------------------------------------------------------------------

describe("shared state label constants", () => {
  it("IN_PROGRESS_LABEL is 'in-progress'", () => {
    expect(IN_PROGRESS_LABEL).toBe("in-progress");
  });

  it("DONE_LABEL is 'done'", () => {
    expect(DONE_LABEL).toBe("done");
  });

  it("STUCK_LABEL is 'stuck'", () => {
    expect(STUCK_LABEL).toBe("stuck");
  });

  it("STATE_LABELS contains all three state labels", () => {
    expect(STATE_LABELS).toEqual(["in-progress", "done", "stuck"]);
  });

  it("state labels are plain strings without family prefixes", () => {
    for (const label of STATE_LABELS) {
      expect(label).not.toContain(":");
      expect(label).not.toContain("ralphai");
    }
  });
});
