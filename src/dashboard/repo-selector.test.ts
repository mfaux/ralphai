import { describe, it, expect } from "vitest";
import { formatCounts } from "./RepoSelector.tsx";
import type { RepoSummary } from "../global-state.ts";

function makeRepo(overrides: Partial<RepoSummary> = {}): RepoSummary {
  return {
    id: "test-repo",
    repoPath: "/tmp/test-repo",
    pathExists: true,
    backlogCount: 0,
    inProgressCount: 0,
    completedCount: 0,
    ...overrides,
  };
}

describe("formatCounts", () => {
  it('returns "empty" when all counts are zero', () => {
    expect(formatCounts(makeRepo())).toBe("empty");
  });

  it("shows active count only", () => {
    expect(formatCounts(makeRepo({ inProgressCount: 2 }))).toBe("2A");
  });

  it("shows queued count only", () => {
    expect(formatCounts(makeRepo({ backlogCount: 3 }))).toBe("3Q");
  });

  it("shows done count only", () => {
    expect(formatCounts(makeRepo({ completedCount: 1 }))).toBe("1D");
  });

  it("joins multiple counts with middle dot", () => {
    const repo = makeRepo({
      inProgressCount: 2,
      backlogCount: 3,
      completedCount: 1,
    });
    expect(formatCounts(repo)).toBe("2A\u00B73Q\u00B71D");
  });

  it("omits zero counts from output", () => {
    const repo = makeRepo({ inProgressCount: 1, completedCount: 5 });
    expect(formatCounts(repo)).toBe("1A\u00B75D");
  });
});
