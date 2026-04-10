/**
 * Tests for the PRD context builder's pure helpers.
 *
 * Tests the exported helpers from `src/tui/build-prd-context.ts`:
 * - `buildPrdPosition` — computes sub-issue position strings
 * - `buildPrdContextFromCache` — builds PrdContext from cached data
 */

import { describe, it, expect } from "bun:test";
import type { PrdSubIssue } from "../issue-lifecycle.ts";
import {
  buildPrdPosition,
  buildPrdContextFromCache,
} from "./build-prd-context.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSubIssue(overrides?: Partial<PrdSubIssue>): PrdSubIssue {
  return {
    number: 10,
    title: "Sub-issue title",
    state: "open",
    node_id: "node_1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildPrdPosition
// ---------------------------------------------------------------------------

describe("buildPrdPosition", () => {
  it("returns position for the first sub-issue", () => {
    expect(buildPrdPosition([10, 11, 12], 10)).toBe("1 of 3 remaining");
  });

  it("returns position for a middle sub-issue", () => {
    expect(buildPrdPosition([10, 11, 12], 11)).toBe("2 of 3 remaining");
  });

  it("returns position for the last sub-issue", () => {
    expect(buildPrdPosition([10, 11, 12], 12)).toBe("3 of 3 remaining");
  });

  it("returns position for a single sub-issue", () => {
    expect(buildPrdPosition([42], 42)).toBe("1 of 1 remaining");
  });

  it("returns fallback when current issue is not in the list", () => {
    expect(buildPrdPosition([10, 11, 12], 99)).toBe("3 remaining");
  });

  it("returns fallback for empty list", () => {
    expect(buildPrdPosition([], 10)).toBe("no remaining sub-issues");
  });

  it("handles large PRDs", () => {
    const issues = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(buildPrdPosition(issues, 15)).toBe("15 of 20 remaining");
  });
});

// ---------------------------------------------------------------------------
// buildPrdContextFromCache
// ---------------------------------------------------------------------------

describe("buildPrdContextFromCache", () => {
  it("builds context with title and position from cached sub-issues", () => {
    const subIssues = [
      makeSubIssue({ number: 10 }),
      makeSubIssue({ number: 11 }),
      makeSubIssue({ number: 12 }),
    ];

    const ctx = buildPrdContextFromCache("Auth Redesign", subIssues, 10);

    expect(ctx).toEqual({
      prdTitle: "Auth Redesign",
      position: "1 of 3 remaining",
    });
  });

  it("builds context for a middle sub-issue", () => {
    const subIssues = [
      makeSubIssue({ number: 5 }),
      makeSubIssue({ number: 6 }),
      makeSubIssue({ number: 7 }),
    ];

    const ctx = buildPrdContextFromCache("Feature Revamp", subIssues, 6);

    expect(ctx).toEqual({
      prdTitle: "Feature Revamp",
      position: "2 of 3 remaining",
    });
  });

  it("returns fallback position when current issue is not in the list", () => {
    const subIssues = [
      makeSubIssue({ number: 10 }),
      makeSubIssue({ number: 11 }),
    ];

    const ctx = buildPrdContextFromCache("My PRD", subIssues, 99);

    expect(ctx).toEqual({
      prdTitle: "My PRD",
      position: "2 remaining",
    });
  });

  it("handles empty sub-issues list", () => {
    const ctx = buildPrdContextFromCache("Empty PRD", [], 10);

    expect(ctx).toEqual({
      prdTitle: "Empty PRD",
      position: "no remaining sub-issues",
    });
  });
});
