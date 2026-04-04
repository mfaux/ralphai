/**
 * Unit tests for archiveRun() sub-issue label behaviour.
 *
 * When a plan has `prd: <number>` in its frontmatter, archiveRun() should
 * use the subissue label family (ralphai-subissue:*) for the done transition
 * instead of the standalone labels.
 *
 * Uses mock.module to control `child_process.execSync` so we can verify
 * the label arguments passed to `gh issue edit`.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { useTempDir } from "./test-utils.ts";

// ---------------------------------------------------------------------------
// Mock child_process.execSync — intercept gh commands only
// ---------------------------------------------------------------------------

const realChildProcess = require("child_process");
const realExecSync =
  realChildProcess.execSync as typeof import("child_process").execSync;

const mockExecSync = mock();

mock.module("child_process", () => ({
  ...realChildProcess,
  execSync: (...args: Parameters<typeof realExecSync>) => {
    const [cmd, options] = args;
    if (typeof cmd === "string" && cmd.startsWith("gh ")) {
      return mockExecSync(...args);
    }
    // Pass through non-gh commands (e.g., git init in test setup)
    return realExecSync(cmd, options as Parameters<typeof realExecSync>[1]);
  },
}));

// Import AFTER mocking so the module picks up the mock
const { archiveRun } = await import("./pr-lifecycle.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockGhAvailable(): void {
  mockExecSync.mockImplementation((cmd: string) => {
    if (cmd === "gh --version" || cmd === "gh auth status") {
      return Buffer.from("ok");
    }
    if (typeof cmd === "string" && cmd.includes("gh issue edit")) {
      return "ok";
    }
    throw new Error(`Unexpected command: ${cmd}`);
  });
}

const ctx = useTempDir();

beforeEach(() => {
  mockExecSync.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("archiveRun — sub-issue label selection", () => {
  it("uses subissue labels for done transition when plan has prd frontmatter", () => {
    mockGhAvailable();

    const wipDir = join(ctx.dir, "in-progress", "gh-201-sub-task");
    const archiveDir = join(ctx.dir, "out");
    mkdirSync(wipDir, { recursive: true });
    writeFileSync(
      join(wipDir, "gh-201-sub-task.md"),
      "---\nsource: github\nissue: 201\nprd: 100\nissue-url: https://github.com/owner/repo/issues/201\n---\n\n# Sub task\n",
    );

    const result = archiveRun({
      wipFiles: [join(wipDir, "gh-201-sub-task.md")],
      archiveDir,
      standaloneInProgressLabel: "ralphai-standalone:in-progress",
      standaloneDoneLabel: "ralphai-standalone:done",
      subissueInProgressLabel: "ralphai-subissue:in-progress",
      subissueDoneLabel: "ralphai-subissue:done",
      cwd: ctx.dir,
    });

    expect(result.archived).toBe(true);

    // Verify gh issue edit was called with subissue labels, not standalone
    const ghEditCalls = mockExecSync.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("gh issue edit"),
    );
    expect(ghEditCalls.length).toBe(1);
    const cmd = ghEditCalls[0]![0] as string;
    expect(cmd).toContain("gh issue edit 201");
    expect(cmd).toContain('--add-label "ralphai-subissue:done"');
    expect(cmd).toContain('--remove-label "ralphai-subissue:in-progress"');
    // Should NOT contain standalone labels
    expect(cmd).not.toContain("ralphai-standalone");
  });

  it("uses standalone labels for done transition when plan has no prd frontmatter", () => {
    mockGhAvailable();

    const wipDir = join(ctx.dir, "in-progress", "gh-42-fix-bug");
    const archiveDir = join(ctx.dir, "out");
    mkdirSync(wipDir, { recursive: true });
    writeFileSync(
      join(wipDir, "gh-42-fix-bug.md"),
      "---\nsource: github\nissue: 42\nissue-url: https://github.com/owner/repo/issues/42\n---\n\n# Fix bug\n",
    );

    const result = archiveRun({
      wipFiles: [join(wipDir, "gh-42-fix-bug.md")],
      archiveDir,
      standaloneInProgressLabel: "ralphai-standalone:in-progress",
      standaloneDoneLabel: "ralphai-standalone:done",
      subissueInProgressLabel: "ralphai-subissue:in-progress",
      subissueDoneLabel: "ralphai-subissue:done",
      cwd: ctx.dir,
    });

    expect(result.archived).toBe(true);

    // Verify gh issue edit was called with standalone labels
    const ghEditCalls = mockExecSync.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("gh issue edit"),
    );
    expect(ghEditCalls.length).toBe(1);
    const cmd = ghEditCalls[0]![0] as string;
    expect(cmd).toContain("gh issue edit 42");
    expect(cmd).toContain('--add-label "ralphai-standalone:done"');
    expect(cmd).toContain('--remove-label "ralphai-standalone:in-progress"');
    // Should NOT contain subissue labels
    expect(cmd).not.toContain("ralphai-subissue");
  });

  it("falls back to standalone labels when subissue labels are not provided for a sub-issue", () => {
    mockGhAvailable();

    const wipDir = join(ctx.dir, "in-progress", "gh-201-sub-task");
    const archiveDir = join(ctx.dir, "out");
    mkdirSync(wipDir, { recursive: true });
    writeFileSync(
      join(wipDir, "gh-201-sub-task.md"),
      "---\nsource: github\nissue: 201\nprd: 100\nissue-url: https://github.com/owner/repo/issues/201\n---\n\n# Sub task\n",
    );

    // Do NOT pass subissue label options — should fall back to standalone
    const result = archiveRun({
      wipFiles: [join(wipDir, "gh-201-sub-task.md")],
      archiveDir,
      standaloneInProgressLabel: "ralphai-standalone:in-progress",
      standaloneDoneLabel: "ralphai-standalone:done",
      cwd: ctx.dir,
    });

    expect(result.archived).toBe(true);

    const ghEditCalls = mockExecSync.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("gh issue edit"),
    );
    expect(ghEditCalls.length).toBe(1);
    const cmd = ghEditCalls[0]![0] as string;
    // Falls back to standalone since subissue labels not provided
    expect(cmd).toContain('--add-label "ralphai-standalone:done"');
    expect(cmd).toContain('--remove-label "ralphai-standalone:in-progress"');
  });
});
