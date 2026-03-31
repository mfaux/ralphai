import { describe, it, expect } from "bun:test";
import { truncateSlug, wrapText, repoDisplayName } from "./format.ts";
import type { RepoSummary } from "../global-state.ts";

function makeRepo(overrides: Partial<RepoSummary> = {}): RepoSummary {
  return {
    id: "github.com-mfaux-ralphai",
    repoPath: "/home/user/work/ralphai",
    pathExists: true,
    backlogCount: 0,
    inProgressCount: 0,
    completedCount: 0,
    ...overrides,
  };
}

describe("truncateSlug", () => {
  it("returns slug unchanged when shorter than maxLen", () => {
    expect(truncateSlug("add-auth", 20)).toBe("add-auth");
  });

  it("returns slug unchanged when exactly maxLen", () => {
    expect(truncateSlug("add-auth", 8)).toBe("add-auth");
  });

  it("truncates at last dash boundary when slug is longer", () => {
    // "refactor-auth-middleware" is 23 chars, maxLen 15
    // truncatable = "refactor-auth-m", lastDash at 13 ("refactor-auth")
    expect(truncateSlug("refactor-auth-middleware", 15)).toBe(
      "refactor-auth\u2026",
    );
  });

  it("truncates at an earlier dash boundary when needed", () => {
    // "add-user-dashboard-feature" with maxLen 12
    // truncatable = "add-user-das", lastDash at 8 ("add-user")
    expect(truncateSlug("add-user-dashboard-feature", 12)).toBe(
      "add-user\u2026",
    );
  });

  it("hard-truncates when no dash in truncatable portion", () => {
    // "superlongword" has no dashes, maxLen 8
    expect(truncateSlug("superlongword", 8)).toBe("superlo\u2026");
  });

  it("handles single-character maxLen gracefully", () => {
    expect(truncateSlug("abc", 1)).toBe("\u2026");
  });

  it("handles slug with leading dash", () => {
    // "-leading-dash" with maxLen 5
    // truncatable = "-lead", lastDash at 0 — but lastDash > 0 is false, so hard-truncate
    expect(truncateSlug("-leading-dash", 5)).toBe("-lea\u2026");
  });
});

describe("wrapText", () => {
  it("returns short lines unchanged", () => {
    expect(wrapText("hello world", 40)).toEqual(["hello world"]);
  });

  it("preserves existing newlines", () => {
    expect(wrapText("line one\nline two\nline three", 40)).toEqual([
      "line one",
      "line two",
      "line three",
    ]);
  });

  it("wraps a long line at word boundaries", () => {
    expect(wrapText("the quick brown fox jumps", 15)).toEqual([
      "the quick brown",
      "fox jumps",
    ]);
  });

  it("hard-breaks a single word longer than width", () => {
    expect(wrapText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("handles empty input", () => {
    expect(wrapText("", 40)).toEqual([""]);
  });

  it("handles empty lines between content", () => {
    expect(wrapText("hello\n\nworld", 40)).toEqual(["hello", "", "world"]);
  });

  it("wraps multi-line text with mixed short and long lines", () => {
    const input = "short\nthis is a longer line that needs wrapping here";
    expect(wrapText(input, 20)).toEqual([
      "short",
      "this is a longer",
      "line that needs",
      "wrapping here",
    ]);
  });

  it("handles width of 1", () => {
    expect(wrapText("ab", 1)).toEqual(["a", "b"]);
  });

  it("handles width <= 0 gracefully by returning unsplit lines", () => {
    expect(wrapText("hello\nworld", 0)).toEqual(["hello", "world"]);
  });

  it("wraps the progress log example correctly", () => {
    const longLine =
      "Completed Task 1 (types/hooks) and Task 2 (three left panels + format helpers).";
    const result = wrapText(longLine, 40);
    // Every wrapped line should fit within width
    for (const line of result) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
    // Joined content should match original (minus the space where we broke)
    expect(result.join(" ")).toBe(longLine);
  });
});

describe("repoDisplayName", () => {
  it("returns basename of repoPath", () => {
    const repo = makeRepo({ repoPath: "/home/user/work/ralphai" });
    expect(repoDisplayName(repo, [repo])).toBe("ralphai");
  });

  it("falls back to id when repoPath is null", () => {
    const repo = makeRepo({ repoPath: null, id: "_path-abc123def456" });
    expect(repoDisplayName(repo, [repo])).toBe("_path-abc123def456");
  });

  it("disambiguates when two repos share the same basename", () => {
    const a = makeRepo({
      id: "github.com-mfaux-ralphai",
      repoPath: "/home/user/work/ralphai",
    });
    const b = makeRepo({
      id: "github.com-other-ralphai",
      repoPath: "/home/user/personal/ralphai",
    });
    const all = [a, b];
    expect(repoDisplayName(a, all)).toBe("ralphai (work)");
    expect(repoDisplayName(b, all)).toBe("ralphai (personal)");
  });

  it("does not disambiguate when basenames differ", () => {
    const a = makeRepo({ repoPath: "/home/user/work/alpha" });
    const b = makeRepo({ repoPath: "/home/user/work/beta" });
    const all = [a, b];
    expect(repoDisplayName(a, all)).toBe("alpha");
    expect(repoDisplayName(b, all)).toBe("beta");
  });

  it("ignores repos with null repoPath for disambiguation", () => {
    const a = makeRepo({ repoPath: "/home/user/work/ralphai" });
    const b = makeRepo({ id: "_path-abc", repoPath: null });
    const all = [a, b];
    expect(repoDisplayName(a, all)).toBe("ralphai");
  });
});
