import { describe, it, expect } from "bun:test";
import { formatCounts } from "./RepoSelector.tsx";
import { getPlanStateLabel } from "./state-labels.ts";
import type { RepoSummary } from "../global-state.ts";

function makeRepo(overrides: Partial<RepoSummary> = {}): RepoSummary {
  return {
    id: "repo-id",
    repoPath: "/repo",
    pathExists: true,
    backlogCount: 0,
    inProgressCount: 0,
    completedCount: 0,
    ...overrides,
  };
}

describe("dashboard state labels", () => {
  it("formats repo counts with pipeline terms", () => {
    expect(
      formatCounts(
        makeRepo({ backlogCount: 2, inProgressCount: 1, completedCount: 3 }),
      ),
    ).toBe("1 in progress · 2 backlog · 3 completed");
  });

  it("uses pipeline labels in the detail summary", () => {
    expect(getPlanStateLabel("backlog")).toBe("Backlog");
    expect(getPlanStateLabel("in-progress")).toBe("In progress");
    expect(getPlanStateLabel("completed")).toBe("Completed");
  });
});
