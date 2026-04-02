/**
 * Tests for listGithubIssues() — fetching and classifying GitHub issues.
 *
 * Uses mock.module to control `child_process.execSync` so we can test
 * the GitHub API interaction without requiring a real repo or gh CLI.
 *
 * IMPORTANT: This file must be in the ISOLATED list in scripts/test.ts
 * because mock.module() leaks across test files in the same bun process.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";

const realChildProcess = require("child_process");
const realExecSync =
  realChildProcess.execSync as typeof import("child_process").execSync;

// ---------------------------------------------------------------------------
// Mock child_process.execSync
// ---------------------------------------------------------------------------

const mockExecSync = mock();

mock.module("child_process", () => ({
  ...realChildProcess,
  execSync: (...args: Parameters<typeof realExecSync>) => {
    const [cmd, options] = args;
    if (typeof cmd === "string" && cmd.startsWith("gh ")) {
      return mockExecSync(...args);
    }
    // Git remote detection — return a fake repo URL
    if (typeof cmd === "string" && cmd.includes("git remote get-url origin")) {
      return mockExecSync(...args);
    }
    return realExecSync(cmd, options as Parameters<typeof realExecSync>[1]);
  },
}));

// Import AFTER mocking so the module picks up the mock
const { listGithubIssues } = await import("./github-issues.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIssue(
  number: number,
  title: string,
  labels: string[] = ["ralphai"],
  body = "",
) {
  return {
    number,
    title,
    labels: labels.map((name) => ({ name })),
    body,
  };
}

/** Set up mockExecSync so gh is available and returns the given JSON for each label query. */
function mockGhWithIssues(regularJson: string, prdJson: string = "[]"): void {
  mockExecSync.mockImplementation((cmd: string) => {
    if (cmd === "gh --version" || cmd === "gh auth status") {
      return Buffer.from("ok");
    }
    if (typeof cmd === "string" && cmd.includes("git remote get-url origin")) {
      return "https://github.com/owner/repo.git";
    }
    if (
      typeof cmd === "string" &&
      cmd.includes("gh issue list") &&
      cmd.includes('"ralphai-prd"')
    ) {
      return prdJson;
    }
    if (
      typeof cmd === "string" &&
      cmd.includes("gh issue list") &&
      cmd.includes('"ralphai"')
    ) {
      return regularJson;
    }
    throw new Error(`Unexpected command: ${cmd}`);
  });
}

/** Make gh CLI unavailable (version check fails). */
function mockGhUnavailable(): void {
  mockExecSync.mockImplementation((cmd: string) => {
    if (cmd === "gh --version") {
      throw new Error("not found");
    }
    throw new Error(`Unexpected command: ${cmd}`);
  });
}

/** Make gh CLI available but both issue list calls fail. */
function mockGhApiFails(): void {
  mockExecSync.mockImplementation((cmd: string) => {
    if (cmd === "gh --version" || cmd === "gh auth status") {
      return Buffer.from("ok");
    }
    if (typeof cmd === "string" && cmd.includes("git remote get-url origin")) {
      return "https://github.com/owner/repo.git";
    }
    if (typeof cmd === "string" && cmd.includes("gh issue list")) {
      throw new Error("API rate limit exceeded");
    }
    throw new Error(`Unexpected command: ${cmd}`);
  });
}

const defaultOptions = {
  cwd: "/tmp",
  issueLabel: "ralphai",
  issueRepo: "owner/repo",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockExecSync.mockReset();
});

describe("listGithubIssues", () => {
  it("returns error when gh CLI is not available", () => {
    mockGhUnavailable();
    const result = listGithubIssues(defaultOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("gh CLI not available");
      expect(result.error).toContain("https://cli.github.com/");
    }
  });

  it("returns error when both API calls fail", () => {
    mockGhApiFails();
    const result = listGithubIssues(defaultOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Could not fetch issues");
    }
  });

  it("returns empty list when no issues found", () => {
    mockGhWithIssues("[]", "[]");
    const result = listGithubIssues(defaultOptions);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.issues).toEqual([]);
    }
  });

  it("returns regular issues with correct fields", () => {
    const issues = [
      makeIssue(14, "Fix dashboard bug"),
      makeIssue(15, "Add search feature"),
    ];
    mockGhWithIssues(JSON.stringify(issues));
    const result = listGithubIssues(defaultOptions);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.issues.length).toBe(2);
      expect(result.issues[0]!.number).toBe(14);
      expect(result.issues[0]!.title).toBe("Fix dashboard bug");
      expect(result.issues[0]!.isPrd).toBe(false);
      expect(result.issues[0]!.subIssues).toEqual([]);
    }
  });

  it("classifies PRD issues and parses sub-issues", () => {
    const prdBody =
      "## Sub-issues\n- [ ] #11 Add login\n- [ ] #12 Add signup\n- [x] #13 Done";
    const prdIssues = [
      makeIssue(10, "Auth Redesign", ["ralphai-prd"], prdBody),
    ];
    mockGhWithIssues("[]", JSON.stringify(prdIssues));

    const result = listGithubIssues(defaultOptions);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.issues.length).toBe(1);
      const prd = result.issues[0]!;
      expect(prd.isPrd).toBe(true);
      expect(prd.subIssues).toEqual([11, 12]); // #13 is checked, excluded
    }
  });

  it("combines regular and PRD issues, PRDs sorted first", () => {
    const regular = [makeIssue(14, "Fix bug")];
    const prd = [makeIssue(10, "Auth Redesign", ["ralphai-prd"], "- [ ] #11")];
    mockGhWithIssues(JSON.stringify(regular), JSON.stringify(prd));

    const result = listGithubIssues(defaultOptions);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.issues.length).toBe(2);
      expect(result.issues[0]!.number).toBe(10); // PRD first
      expect(result.issues[0]!.isPrd).toBe(true);
      expect(result.issues[1]!.number).toBe(14); // Regular second
      expect(result.issues[1]!.isPrd).toBe(false);
    }
  });

  it("deduplicates issues that appear in both queries", () => {
    // Issue #10 has both ralphai and ralphai-prd labels
    const issue10 = makeIssue(
      10,
      "Auth Redesign",
      ["ralphai", "ralphai-prd"],
      "- [ ] #11",
    );
    const regular = [issue10, makeIssue(14, "Fix bug")];
    const prd = [issue10];
    mockGhWithIssues(JSON.stringify(regular), JSON.stringify(prd));

    const result = listGithubIssues(defaultOptions);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Should not have duplicates
      const numbers = result.issues.map((i) => i.number);
      expect(numbers).toEqual([10, 14]); // PRD first, then regular
    }
  });

  it("handles PRD with no sub-issues (empty body)", () => {
    const prd = [makeIssue(10, "Empty PRD", ["ralphai-prd"], "")];
    mockGhWithIssues("[]", JSON.stringify(prd));

    const result = listGithubIssues(defaultOptions);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.issues[0]!.isPrd).toBe(true);
      expect(result.issues[0]!.subIssues).toEqual([]);
    }
  });

  it("returns repo in successful result", () => {
    mockGhWithIssues("[]");
    const result = listGithubIssues(defaultOptions);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repo).toBe("owner/repo");
    }
  });

  it("handles partial failure (only one query fails)", () => {
    // Regular query succeeds, PRD query fails
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "gh --version" || cmd === "gh auth status") {
        return Buffer.from("ok");
      }
      if (
        typeof cmd === "string" &&
        cmd.includes("git remote get-url origin")
      ) {
        return "https://github.com/owner/repo.git";
      }
      if (
        typeof cmd === "string" &&
        cmd.includes("gh issue list") &&
        cmd.includes('"ralphai-prd"')
      ) {
        throw new Error("network error");
      }
      if (
        typeof cmd === "string" &&
        cmd.includes("gh issue list") &&
        cmd.includes('"ralphai"')
      ) {
        return JSON.stringify([makeIssue(14, "Fix bug")]);
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const result = listGithubIssues(defaultOptions);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.issues.length).toBe(1);
      expect(result.issues[0]!.number).toBe(14);
    }
  });

  it("sorts multiple PRDs and regular issues by number within group", () => {
    const regular = [makeIssue(20, "Bug B"), makeIssue(15, "Bug A")];
    const prd = [
      makeIssue(10, "PRD B", ["ralphai-prd"], ""),
      makeIssue(5, "PRD A", ["ralphai-prd"], ""),
    ];
    mockGhWithIssues(JSON.stringify(regular), JSON.stringify(prd));

    const result = listGithubIssues(defaultOptions);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const numbers = result.issues.map((i) => i.number);
      // PRDs first sorted by number, then regular sorted by number
      expect(numbers).toEqual([5, 10, 15, 20]);
    }
  });
});
