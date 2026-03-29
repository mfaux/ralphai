import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PlanInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// Mocks — set up before importing the module under test
// ---------------------------------------------------------------------------

const mockExecAsync = vi.fn<(cmd: string, cwd: string) => Promise<string>>();

vi.mock("node:child_process", () => ({
  exec: vi.fn(
    (
      cmd: string,
      opts: unknown,
      cb: (err: Error | null, stdout: string) => void,
    ) => {
      mockExecAsync(cmd, (opts as { cwd: string }).cwd)
        .then((stdout: string) => cb(null, stdout))
        .catch((err: Error) => cb(err, ""));
    },
  ),
}));

vi.mock("../config.ts", () => ({
  getConfigFilePath: vi.fn(() => "/mock/.ralphai/repos/test/config.json"),
  parseConfigFile: vi.fn(() => ({
    values: {
      issueSource: "github",
      issueLabel: "ralphai",
      issueRepo: "",
    },
    warnings: [],
  })),
}));

vi.mock("../issues.ts", () => ({
  detectIssueRepo: vi.fn(() => "owner/repo"),
  slugify: vi.fn((text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60),
  ),
}));

import { loadGithubIssuesAsync } from "./issue-loader.ts";
import { parseConfigFile } from "../config.ts";
import { detectIssueRepo } from "../issues.ts";

const mockParseConfigFile = parseConfigFile as ReturnType<typeof vi.fn>;
const mockDetectIssueRepo = detectIssueRepo as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Restore defaults
  mockParseConfigFile.mockReturnValue({
    values: {
      issueSource: "github",
      issueLabel: "ralphai",
      issueRepo: "",
    },
    warnings: [],
  });
  mockDetectIssueRepo.mockReturnValue("owner/repo");
});

describe("loadGithubIssuesAsync", () => {
  it("returns empty array when issueSource is not github", async () => {
    mockParseConfigFile.mockReturnValue({
      values: { issueSource: "none", issueLabel: "ralphai", issueRepo: "" },
      warnings: [],
    });

    const result = await loadGithubIssuesAsync("/repo", []);
    expect(result).toEqual([]);
  });

  it("returns empty array when config file is missing", async () => {
    mockParseConfigFile.mockReturnValue(null);

    const result = await loadGithubIssuesAsync("/repo", []);
    expect(result).toEqual([]);
  });

  it("returns empty array when gh auth fails", async () => {
    mockExecAsync.mockRejectedValue(new Error("not logged in"));

    const result = await loadGithubIssuesAsync("/repo", []);
    expect(result).toEqual([]);
  });

  it("returns empty array when repo detection fails", async () => {
    mockExecAsync.mockResolvedValue(""); // gh auth succeeds
    mockDetectIssueRepo.mockReturnValue(null);

    const result = await loadGithubIssuesAsync("/repo", []);
    expect(result).toEqual([]);
  });

  it("returns PlanInfo objects for fetched issues", async () => {
    const issues = [
      {
        number: 42,
        title: "Add dark mode",
        url: "https://github.com/owner/repo/issues/42",
      },
      {
        number: 10,
        title: "Fix login bug",
        url: "https://github.com/owner/repo/issues/10",
      },
    ];

    mockExecAsync
      .mockResolvedValueOnce("") // gh auth status
      .mockResolvedValueOnce(JSON.stringify(issues)); // gh issue list

    const result = await loadGithubIssuesAsync("/repo", []);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      slug: "gh-42-add-dark-mode",
      state: "backlog",
      source: "github-remote",
      issueNumber: 42,
      issueUrl: "https://github.com/owner/repo/issues/42",
    });
    expect(result[1]).toMatchObject({
      slug: "gh-10-fix-login-bug",
      state: "backlog",
      source: "github-remote",
      issueNumber: 10,
    });
  });

  it("deduplicates against local plans by issue number", async () => {
    const issues = [
      {
        number: 42,
        title: "Add dark mode",
        url: "https://github.com/owner/repo/issues/42",
      },
      {
        number: 10,
        title: "Fix login bug",
        url: "https://github.com/owner/repo/issues/10",
      },
    ];

    mockExecAsync
      .mockResolvedValueOnce("") // gh auth status
      .mockResolvedValueOnce(JSON.stringify(issues)); // gh issue list

    const localPlans: PlanInfo[] = [
      {
        filename: "gh-42-add-dark-mode.md",
        slug: "gh-42-add-dark-mode",
        state: "in-progress",
        source: "github",
        issueNumber: 42,
      },
    ];

    const result = await loadGithubIssuesAsync("/repo", localPlans);

    expect(result).toHaveLength(1);
    expect(result[0]!.issueNumber).toBe(10);
  });

  it("returns empty array when gh issue list returns invalid JSON", async () => {
    mockExecAsync
      .mockResolvedValueOnce("") // gh auth status
      .mockResolvedValueOnce("not json"); // gh issue list

    const result = await loadGithubIssuesAsync("/repo", []);
    expect(result).toEqual([]);
  });

  it("returns empty array when gh issue list returns empty array", async () => {
    mockExecAsync
      .mockResolvedValueOnce("") // gh auth status
      .mockResolvedValueOnce("[]"); // gh issue list

    const result = await loadGithubIssuesAsync("/repo", []);
    expect(result).toEqual([]);
  });

  it("returns empty array when gh issue list command fails", async () => {
    mockExecAsync
      .mockResolvedValueOnce("") // gh auth status
      .mockRejectedValueOnce(new Error("network error")); // gh issue list

    const result = await loadGithubIssuesAsync("/repo", []);
    expect(result).toEqual([]);
  });
});
