/**
 * Unit tests for archiveRun() label behaviour with sub-issues.
 *
 * With shared state labels, archiveRun() uses the same `done` and
 * `in-progress` labels regardless of whether the plan is a standalone
 * issue or a sub-issue. This file verifies that the done transition
 * works correctly for both plan types.
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

describe("archiveRun — shared state labels for sub-issues", () => {
  it("uses shared done label for sub-issue plans (prd frontmatter)", () => {
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
      cwd: ctx.dir,
    });

    expect(result.archived).toBe(true);

    // Verify gh issue edit was called with shared state labels
    const ghEditCalls = mockExecSync.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("gh issue edit"),
    );
    expect(ghEditCalls.length).toBe(1);
    const cmd = ghEditCalls[0]![0] as string;
    expect(cmd).toContain("gh issue edit 201");
    expect(cmd).toContain('--add-label "done"');
    expect(cmd).toContain('--remove-label "in-progress"');
  });

  it("uses the same shared labels for standalone issues (no prd frontmatter)", () => {
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
      cwd: ctx.dir,
    });

    expect(result.archived).toBe(true);

    // Verify gh issue edit was called with the same shared state labels
    const ghEditCalls = mockExecSync.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("gh issue edit"),
    );
    expect(ghEditCalls.length).toBe(1);
    const cmd = ghEditCalls[0]![0] as string;
    expect(cmd).toContain("gh issue edit 42");
    expect(cmd).toContain('--add-label "done"');
    expect(cmd).toContain('--remove-label "in-progress"');
  });

  it("both standalone and sub-issue use identical label transitions", () => {
    mockGhAvailable();

    // Sub-issue plan
    const wipDir1 = join(ctx.dir, "in-progress", "gh-201-sub-task");
    mkdirSync(wipDir1, { recursive: true });
    writeFileSync(
      join(wipDir1, "gh-201-sub-task.md"),
      "---\nsource: github\nissue: 201\nprd: 100\nissue-url: https://github.com/owner/repo/issues/201\n---\n\n# Sub task\n",
    );

    archiveRun({
      wipFiles: [join(wipDir1, "gh-201-sub-task.md")],
      archiveDir: join(ctx.dir, "out1"),
      cwd: ctx.dir,
    });

    // Standalone plan
    const wipDir2 = join(ctx.dir, "in-progress", "gh-42-fix-bug");
    mkdirSync(wipDir2, { recursive: true });
    writeFileSync(
      join(wipDir2, "gh-42-fix-bug.md"),
      "---\nsource: github\nissue: 42\nissue-url: https://github.com/owner/repo/issues/42\n---\n\n# Fix bug\n",
    );

    archiveRun({
      wipFiles: [join(wipDir2, "gh-42-fix-bug.md")],
      archiveDir: join(ctx.dir, "out2"),
      cwd: ctx.dir,
    });

    // Both calls should use the same shared state labels
    const ghEditCalls = mockExecSync.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("gh issue edit"),
    );
    expect(ghEditCalls.length).toBe(2);

    const cmd1 = ghEditCalls[0]![0] as string;
    const cmd2 = ghEditCalls[1]![0] as string;

    // Extract just the label parts (everything after the issue number)
    const labelPart1 = cmd1.replace(/gh issue edit \d+/, "");
    const labelPart2 = cmd2.replace(/gh issue edit \d+/, "");

    // Same label operations for both families
    expect(labelPart1).toContain('--add-label "done"');
    expect(labelPart2).toContain('--add-label "done"');
    expect(labelPart1).toContain('--remove-label "in-progress"');
    expect(labelPart2).toContain('--remove-label "in-progress"');
  });
});
