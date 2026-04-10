/**
 * Tests for the HITL command module (src/hitl.ts).
 *
 * Uses mock.module to control external dependencies (issues, exec, worktree,
 * child_process) so we can test the orchestration flow without real GitHub
 * API calls or git operations.
 *
 * Separate file because mock.module() leaks across tests in the same bun
 * process — must be listed in ISOLATED array in scripts/test.ts.
 */
import { describe, test, expect, beforeEach, mock } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { EventEmitter } from "events";

import type { ParentIssueResult, IssueWithLabels } from "./issues.ts";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock exec.ts — controls all gh CLI calls
const mockExecQuiet = mock<(cmd: string, cwd: string) => string | null>();
mock.module("./exec.ts", () => ({
  execQuiet: mockExecQuiet,
  checkGhAvailable: () => true,
  setExecImpl: () => () => {},
  execOk: () => true,
  execWithStdin: () => null,
}));

// Mock issues.ts — controls parent discovery, issue fetching, repo detection
const mockDiscoverParentIssue =
  mock<
    (
      repo: string,
      issueNumber: number,
      cwd: string,
      prdLabel?: string,
    ) => ParentIssueResult
  >();
const mockFetchIssueWithLabels =
  mock<(repo: string, issueNumber: number, cwd: string) => IssueWithLabels>();
const mockDetectIssueRepo =
  mock<(cwd: string, configRepo?: string) => string | null>();

const realIssues = await import("./issues.ts");
mock.module("./issues.ts", () => ({
  ...realIssues,
  discoverParentIssue: mockDiscoverParentIssue,
  fetchIssueWithLabels: mockFetchIssueWithLabels,
  detectIssueRepo: mockDetectIssueRepo,
}));

// Mock worktree management — avoid real git operations
const mockIsGitWorktree = mock<(dir: string) => boolean>();
const mockEnsureRepoHasCommit = mock<(cwd: string) => void>();
const mockPrepareWorktree =
  mock<
    (
      cwd: string,
      slug: string,
      branch: string,
      baseBranch: string,
      setupCommand: string,
    ) => string
  >();

mock.module("./worktree/management.ts", () => ({
  isGitWorktree: mockIsGitWorktree,
  ensureRepoHasCommit: mockEnsureRepoHasCommit,
  resolveMainGitDir: () => undefined,
}));

mock.module("./worktree/index.ts", () => ({
  prepareWorktree: mockPrepareWorktree,
  writeFeedbackWrapper: () => {},
  parseWorktreeList: () => [],
  isRalphaiManagedBranch: () => false,
  listRalphaiWorktrees: () => [],
  selectPlanForWorktree: () => null,
  isGitWorktree: mockIsGitWorktree,
  resolveWorktreeInfo: () => ({ isWorktree: false, mainWorktree: "" }),
  resolveMainGitDir: () => undefined,
  ensureRepoHasCommit: mockEnsureRepoHasCommit,
  executeSetupCommand: () => {},
  listWorktrees: () => [],
  cleanWorktrees: () => {},
}));

// Mock git-helpers
const mockDetectBaseBranch = mock<(cwd?: string) => string>();
mock.module("./git-helpers.ts", () => ({
  detectBaseBranch: mockDetectBaseBranch,
  extractExecStderr: () => "",
  isInsideGitRepo: () => true,
}));

// Mock config — return a controlled resolved config
const mockResolveConfig = mock<(input: unknown) => { config: unknown }>();
const mockGetConfigFilePath = mock<(cwd: string) => string>();

const realConfig = await import("./config.ts");
mock.module("./config.ts", () => ({
  ...realConfig,
  resolveConfig: mockResolveConfig,
  getConfigFilePath: mockGetConfigFilePath,
}));

// Mock child_process.spawn — controls agent spawning
type SpawnResult = EventEmitter & { pid?: number };
let lastSpawnCall: { cmd: string; args: string[]; opts: unknown } | null = null;
let mockChildProcess: SpawnResult | null = null;

mock.module("child_process", () => {
  const real = require("child_process");
  return {
    ...real,
    spawn: (cmd: string, args: string[], opts: unknown) => {
      lastSpawnCall = { cmd, args, opts };
      mockChildProcess = new EventEmitter() as SpawnResult;
      mockChildProcess.pid = 12345;
      return mockChildProcess;
    },
  };
});

// Import module-under-test AFTER all mocks
const { runHitl, spawnInteractiveAgent } = await import("./hitl.ts");
const { makeTestResolvedConfig } = await import("./test-utils.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ralphai-hitl-test-"));
  return dir;
}

function setupDefaultMocks(tmpDir: string) {
  // Config file exists
  mockGetConfigFilePath.mockReturnValue(join(tmpDir, "ralphai.json"));

  // Write a dummy config file so existsSync passes
  writeFileSync(join(tmpDir, "ralphai.json"), "{}");

  // Default config resolution
  mockResolveConfig.mockReturnValue({
    config: makeTestResolvedConfig({
      agentCommand: "echo",
      agentInteractiveCommand: "opencode",
      issueSource: "github",
      review: "false",
    }),
  });

  // Not in a worktree
  mockIsGitWorktree.mockReturnValue(false);

  // Repo detection
  mockDetectIssueRepo.mockReturnValue("owner/repo");

  // Base branch
  mockDetectBaseBranch.mockReturnValue("main");

  // No-op for ensureRepoHasCommit
  mockEnsureRepoHasCommit.mockImplementation(() => {});

  // prepareWorktree returns tmpDir
  mockPrepareWorktree.mockReturnValue(tmpDir);

  // Default parent discovery — valid PRD parent
  mockDiscoverParentIssue.mockReturnValue({
    hasParent: true,
    parentNumber: 100,
    parentHasPrdLabel: true,
    parentTitle: "feat: implement user auth",
  });

  // Default issue fetch
  mockFetchIssueWithLabels.mockReturnValue({
    number: 42,
    title: "fix: login validation",
    body: "# Fix login validation\n\nThe login form should validate email format.",
    labels: ["ralphai-subissue-hitl"],
  });

  // Default execQuiet (for label operations)
  mockExecQuiet.mockReturnValue("ok");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runHitl", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
    lastSpawnCall = null;
    mockChildProcess = null;
    // Reset all mock call history (don't use mock.restore() which would
    // undo mock.module registrations)
    mockExecQuiet.mockReset();
    mockDiscoverParentIssue.mockReset();
    mockFetchIssueWithLabels.mockReset();
    mockDetectIssueRepo.mockReset();
    mockIsGitWorktree.mockReset();
    mockEnsureRepoHasCommit.mockReset();
    mockPrepareWorktree.mockReset();
    mockDetectBaseBranch.mockReset();
    mockResolveConfig.mockReset();
    mockGetConfigFilePath.mockReset();
    setupDefaultMocks(tmpDir);
  });

  // --- Parent discovery errors ---

  test("errors when issue has no parent", async () => {
    mockDiscoverParentIssue.mockReturnValue({
      hasParent: false,
      parentNumber: undefined,
      parentHasPrdLabel: false,
      parentTitle: undefined,
    });

    const logs: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => logs.push(args.join(" "));

    let exitCode: number | undefined;
    const originalExit = process.exit;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error("process.exit");
    }) as typeof process.exit;

    try {
      await runHitl({
        issueNumber: 42,
        cwd: tmpDir,
        dryRun: false,
        runArgs: [],
      });
    } catch {
      // Expected — process.exit throws
    }

    process.exit = originalExit;
    console.error = originalError;

    expect(exitCode).toBe(1);
    expect(logs.some((l) => l.includes("no parent issue"))).toBe(true);
  });

  test("errors when parent lacks PRD label", async () => {
    mockDiscoverParentIssue.mockReturnValue({
      hasParent: true,
      parentNumber: 100,
      parentHasPrdLabel: false,
      parentTitle: "Some parent",
    });

    let exitCode: number | undefined;
    const originalExit = process.exit;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error("process.exit");
    }) as typeof process.exit;

    const logs: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await runHitl({
        issueNumber: 42,
        cwd: tmpDir,
        dryRun: false,
        runArgs: [],
      });
    } catch {
      // Expected — process.exit throws
    }

    process.exit = originalExit;
    console.error = originalError;

    expect(exitCode).toBe(1);
    expect(logs.some((l) => l.includes("does not have the PRD label"))).toBe(
      true,
    );
  });

  // --- Missing config validation ---

  test("errors when agentInteractiveCommand is not configured", async () => {
    mockResolveConfig.mockReturnValue({
      config: makeTestResolvedConfig({
        agentCommand: "echo",
        agentInteractiveCommand: "",
        issueSource: "github",
        review: "false",
      }),
    });

    let exitCode: number | undefined;
    const originalExit = process.exit;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error("process.exit");
    }) as typeof process.exit;

    const logs: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await runHitl({
        issueNumber: 42,
        cwd: tmpDir,
        dryRun: false,
        runArgs: [],
      });
    } catch {
      // Expected — process.exit throws
    }

    process.exit = originalExit;
    console.error = originalError;

    expect(exitCode).toBe(1);
    expect(
      logs.some((l) => l.includes("agentInteractiveCommand is not configured")),
    ).toBe(true);
  });

  // --- Dry-run behavior ---

  test("dry-run prints preview without spawning agent or modifying labels", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      const result = await runHitl({
        issueNumber: 42,
        cwd: tmpDir,
        dryRun: true,
        runArgs: [],
      });

      expect(result.exitCode).toBe(0);
      expect(result.message).toContain("Dry-run");

      // Should print dry-run info
      expect(logs.some((l) => l.includes("[dry-run]"))).toBe(true);
      expect(logs.some((l) => l.includes("Sub-issue: #42"))).toBe(true);
      expect(logs.some((l) => l.includes("Parent PRD: #100"))).toBe(true);
      expect(logs.some((l) => l.includes("labels unchanged"))).toBe(true);
      expect(
        logs.some(
          (l) =>
            l.includes("No worktree created") && l.includes("no agent spawned"),
        ),
      ).toBe(true);

      // Should NOT have spawned agent
      expect(lastSpawnCall).toBeNull();

      // Should NOT have called execQuiet for label operations
      // (execQuiet is used during parent discovery and issue fetch, but
      //  not for label edits in dry-run)
      expect(mockEnsureRepoHasCommit).not.toHaveBeenCalled();
      expect(mockPrepareWorktree).not.toHaveBeenCalled();
    } finally {
      console.log = originalLog;
    }
  });

  // --- Label updates on clean exit ---

  test("on clean exit (code 0): removes HITL label, adds done label", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const hitlPromise = runHitl({
      issueNumber: 42,
      cwd: tmpDir,
      dryRun: false,
      runArgs: [],
    });

    // Wait a tick for spawn to be called, then simulate clean exit
    await new Promise((r) => setTimeout(r, 10));
    expect(mockChildProcess).not.toBeNull();
    mockChildProcess!.emit("close", 0);

    const result = await hitlPromise;
    console.log = originalLog;

    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("completed");
    expect(result.message).toContain("ralphai-subissue-hitl");
    expect(result.message).toContain("done");

    // Verify label edit was called
    expect(mockExecQuiet).toHaveBeenCalled();
    const labelCall = mockExecQuiet.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("gh issue edit") &&
        c[0].includes("--remove-label") &&
        c[0].includes("--add-label"),
    );
    expect(labelCall).toBeDefined();
    expect(labelCall![0]).toContain("ralphai-subissue-hitl");
    expect(labelCall![0]).toContain("done");

    // Verify other status labels are also removed
    expect(labelCall![0]).toContain('--remove-label "in-progress"');
    expect(labelCall![0]).toContain('--remove-label "stuck"');
  });

  // --- Label updates on abnormal exit ---

  test("on abnormal exit (non-zero): leaves labels unchanged", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const hitlPromise = runHitl({
      issueNumber: 42,
      cwd: tmpDir,
      dryRun: false,
      runArgs: [],
    });

    // Wait a tick for spawn to be called, then simulate abnormal exit
    await new Promise((r) => setTimeout(r, 10));
    expect(mockChildProcess).not.toBeNull();
    mockChildProcess!.emit("close", 130); // Ctrl+C exit code

    const result = await hitlPromise;
    console.log = originalLog;

    expect(result.exitCode).toBe(130);
    expect(result.message).toContain("Labels unchanged");

    // Verify NO label edit was called (only the parent discovery/fetch calls)
    const labelEditCalls = mockExecQuiet.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].includes("gh issue edit"),
    );
    expect(labelEditCalls.length).toBe(0);
  });

  // --- Agent spawning ---

  test("spawns agent with stdio inherit and correct prompt", async () => {
    const hitlPromise = runHitl({
      issueNumber: 42,
      cwd: tmpDir,
      dryRun: false,
      runArgs: [],
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(lastSpawnCall).not.toBeNull();

    // Verify spawn was called with correct command
    expect(lastSpawnCall!.cmd).toBe("opencode");

    // Verify stdio: "inherit" is used
    const opts = lastSpawnCall!.opts as { stdio: string };
    expect(opts.stdio).toBe("inherit");

    // Verify prompt contains issue info
    const prompt = lastSpawnCall!.args[lastSpawnCall!.args.length - 1];
    expect(prompt).toContain("sub-issue #42");
    expect(prompt).toContain("fix: login validation");
    expect(prompt).toContain("Parent PRD: #100");

    // Clean up
    mockChildProcess!.emit("close", 0);
    await hitlPromise;
  });

  // --- Worktree preparation ---

  test("calls prepareWorktree with PRD-derived slug and branch", async () => {
    const hitlPromise = runHitl({
      issueNumber: 42,
      cwd: tmpDir,
      dryRun: false,
      runArgs: [],
    });

    await new Promise((r) => setTimeout(r, 10));
    mockChildProcess!.emit("close", 0);
    await hitlPromise;

    expect(mockPrepareWorktree).toHaveBeenCalledTimes(1);
    const call = mockPrepareWorktree.mock.calls[0]!;
    // cwd
    expect(call[0]).toBe(tmpDir);
    // slug derived from parent title "feat: implement user auth"
    expect(call[1]).toBe("implement-user-auth");
    // branch derived from parent title
    expect(call[2]).toBe("feat/implement-user-auth");
    // baseBranch
    expect(call[3]).toBe("main");
  });

  test("uses config baseBranch for worktree creation, not detectBaseBranch()", async () => {
    // Config says "develop", but detectBaseBranch returns "main"
    mockResolveConfig.mockReturnValue({
      config: makeTestResolvedConfig({
        agentCommand: "echo",
        agentInteractiveCommand: "opencode",
        baseBranch: "develop",
      }),
    });
    mockDetectBaseBranch.mockReturnValue("main");

    const hitlPromise = runHitl({
      issueNumber: 42,
      cwd: tmpDir,
      dryRun: false,
      runArgs: [],
    });

    await new Promise((r) => setTimeout(r, 10));
    mockChildProcess!.emit("close", 0);
    await hitlPromise;

    expect(mockPrepareWorktree).toHaveBeenCalledTimes(1);
    const call = mockPrepareWorktree.mock.calls[0]!;
    // baseBranch should come from config, not detectBaseBranch
    expect(call[3]).toBe("develop");
    expect(mockDetectBaseBranch).not.toHaveBeenCalled();
  });
});

describe("spawnInteractiveAgent", () => {
  test("resolves with exit code from child process", async () => {
    const promise = spawnInteractiveAgent("echo hello", "test prompt", "/tmp");

    await new Promise((r) => setTimeout(r, 10));
    expect(mockChildProcess).not.toBeNull();
    mockChildProcess!.emit("close", 0);

    const exitCode = await promise;
    expect(exitCode).toBe(0);
  });

  test("resolves with non-zero code on abnormal exit", async () => {
    const promise = spawnInteractiveAgent("echo hello", "test prompt", "/tmp");

    await new Promise((r) => setTimeout(r, 10));
    mockChildProcess!.emit("close", 1);

    const exitCode = await promise;
    expect(exitCode).toBe(1);
  });

  test("resolves with 1 on error event", async () => {
    const logs: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => logs.push(args.join(" "));

    const promise = spawnInteractiveAgent("echo hello", "test prompt", "/tmp");

    await new Promise((r) => setTimeout(r, 10));
    mockChildProcess!.emit("error", new Error("spawn ENOENT"));

    const exitCode = await promise;
    console.error = originalError;

    expect(exitCode).toBe(1);
    expect(logs.some((l) => l.includes("spawn ENOENT"))).toBe(true);
  });
});
