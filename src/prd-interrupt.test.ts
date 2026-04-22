/**
 * Tests that interrupted PRD sub-issues stop the outer PRD loop.
 *
 * Uses mock.module(), so this file must run in isolation.
 */
import { describe, test, expect, beforeEach, mock } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { makeTestResolvedConfig } from "./test-utils.ts";
import type { RunnerResult } from "./runner.ts";

const mockRunRunner = mock<() => Promise<RunnerResult>>();
const realRunner = await import("./runner.ts");
mock.module("./runner.ts", () => {
  return {
    ...realRunner,
    runRunner: mockRunRunner,
  };
});

const mockDiscoverPrdTarget = mock();
const mockFetchIssueWithLabels = mock();
const mockPullGithubIssueByNumber = mock();
const mockPrdTransitionInProgress = mock();
const mockPrdTransitionDone = mock();
const mockFormatPrdHitlSummary = mock();
const mockDetectIssueRepo =
  mock<(cwd: string, configRepo?: string) => string | null>();
const realIssueLifecycle = await import("./issue-lifecycle.ts");
mock.module("./issue-lifecycle.ts", () => {
  return {
    ...realIssueLifecycle,
    detectIssueRepo: mockDetectIssueRepo,
    fetchIssueWithLabels: mockFetchIssueWithLabels,
    discoverPrdTarget: mockDiscoverPrdTarget,
    pullGithubIssueByNumber: mockPullGithubIssueByNumber,
    prdTransitionInProgress: mockPrdTransitionInProgress,
    prdTransitionDone: mockPrdTransitionDone,
    formatPrdHitlSummary: mockFormatPrdHitlSummary,
  };
});

const mockPrepareWorktree = mock<(cwd: string) => string>();
const mockListRalphaiWorktrees = mock<() => Array<{ branch: string }>>();
const realWorktree = await import("./worktree/index.ts");
mock.module("./worktree/index.ts", () => {
  return {
    ...realWorktree,
    resolveWorktreeInfo: () => ({ isWorktree: false, mainWorktree: "" }),
    resolveMainRepo: (dir: string) => dir,
    ensureRepoHasCommit: () => {},
    prepareWorktree: mockPrepareWorktree,
    listRalphaiWorktrees: mockListRalphaiWorktrees,
  };
});

const mockResolveConfig = mock();
const mockGetConfigFilePath = mock<(cwd: string) => string>();
const realConfig = await import("./config.ts");
mock.module("./config.ts", () => {
  return {
    ...realConfig,
    resolveConfig: mockResolveConfig,
    getConfigFilePath: mockGetConfigFilePath,
  };
});

const mockExecQuiet = mock<(cmd: string, cwd: string) => string | null>();
const realExec = await import("./exec.ts");
mock.module("./exec.ts", () => {
  return {
    ...realExec,
    execQuiet: mockExecQuiet,
  };
});

const { runRalphai } = await import("./ralphai.ts");

function createRepoDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ralphai-prd-interrupt-"));
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

describe("PRD interrupt handling", () => {
  let dir: string;
  let envHome: string;

  beforeEach(() => {
    dir = createRepoDir();
    envHome = join(dir, ".ralphai-home");
    mkdirSync(envHome, { recursive: true });
    const configPath = join(envHome, "config.json");
    writeFileSync(configPath, "{}");

    mockResolveConfig.mockReturnValue({
      config: makeTestResolvedConfig({
        gate: { review: false },
        issue: { source: "github" },
      }),
      warnings: [],
      configFilePath: configPath,
    });
    mockGetConfigFilePath.mockReturnValue(configPath);
    mockDetectIssueRepo.mockReturnValue("owner/repo");
    mockFetchIssueWithLabels.mockReturnValue({
      title: "feat: parent prd",
      labels: ["ralphai-prd"],
    });
    mockDiscoverPrdTarget.mockReturnValue({
      isPrd: true,
      prd: { number: 42, title: "feat: parent prd" },
      subIssues: [101, 102],
      allCompleted: false,
    });
    mockPrepareWorktree.mockReturnValue(dir);
    mockListRalphaiWorktrees.mockReturnValue([]);
    mockExecQuiet.mockImplementation((cmd: string) => {
      if (cmd.startsWith("git rev-parse --abbrev-ref HEAD")) {
        return "feat/parent-prd";
      }
      if (cmd.includes("gh issue view")) {
        return "";
      }
      return null;
    });
    mockPullGithubIssueByNumber.mockImplementation(
      ({ issueNumber }: { issueNumber: number }) => ({
        pulled: true,
        message: `Pulled sub-issue #${issueNumber}`,
        planPath: join(dir, `${issueNumber}.md`),
      }),
    );
    mockFormatPrdHitlSummary.mockReturnValue(["summary"]);
    mockPrdTransitionInProgress.mockImplementation(() => {});
    mockPrdTransitionDone.mockImplementation(() => {});

    mockRunRunner.mockResolvedValue({
      stuckSlugs: [],
      accumulatedLearnings: [],
      interrupted: true,
    });
  });

  test("stops after an interrupted sub-issue and skips PRD finalization", async () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    const originalEnvHome = process.env.RALPHAI_HOME;

    process.env.RALPHAI_HOME = envHome;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    console.error = (...args: unknown[]) =>
      errors.push(args.map(String).join(" "));

    try {
      await runRalphai(["run", "42"]);
    } finally {
      console.log = originalLog;
      console.error = originalError;
      if (originalEnvHome === undefined) delete process.env.RALPHAI_HOME;
      else process.env.RALPHAI_HOME = originalEnvHome;
    }

    expect(errors).toEqual([]);
    expect(mockRunRunner).toHaveBeenCalledTimes(1);
    expect(mockPullGithubIssueByNumber).toHaveBeenCalledTimes(1);
    expect(mockPullGithubIssueByNumber.mock.calls[0]?.[0].issueNumber).toBe(
      101,
    );
    expect(logs.join("\n")).toContain(
      "Sub-issue #101 interrupted — stopping PRD run.",
    );
    expect(logs.join("\n")).toContain(
      "Interrupted during PRD #42. Work is preserved in in-progress — resume with another run.",
    );
    expect(logs.join("\n")).not.toContain("Creating PRD pull request...");
    expect(mockPrdTransitionDone).not.toHaveBeenCalled();
  });
});
