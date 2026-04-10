/**
 * Tests that ANSI escape codes are stripped from PR titles and bodies before
 * they are sent to GitHub via `gh pr create` / `gh pr edit`.
 *
 * Uses the same `setExecImpl()` DI pattern as `pr-lifecycle-stdin.test.ts` to
 * intercept `gh` commands and inspect the arguments and stdin input.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { execSync as realExecSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { setExecImpl } from "./exec.ts";
import { useTempDir } from "./test-utils.ts";
import { createPr, createPrdPr } from "./pr-lifecycle.ts";

// ---------------------------------------------------------------------------
// Mock setup — swap execSync via DI
// ---------------------------------------------------------------------------

const mockExecSync = mock();
let restoreExec: () => void;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ctx = useTempDir();

/** Set up a repo with a remote so pushBranch succeeds, plus a feature branch. */
function initRepoWithRemoteAndBranch(dir: string, branch: string): string {
  const remoteDir = join(dir, "remote.git");
  const repoDir = join(dir, "repo");
  mkdirSync(remoteDir, { recursive: true });
  realExecSync("git init --bare", { cwd: remoteDir, stdio: "ignore" });
  realExecSync(`git clone "${remoteDir}" repo`, {
    cwd: dir,
    stdio: "ignore",
  });
  realExecSync('git config user.email "test@test.com"', {
    cwd: repoDir,
    stdio: "ignore",
  });
  realExecSync('git config user.name "Test"', {
    cwd: repoDir,
    stdio: "ignore",
  });
  writeFileSync(join(repoDir, "init.txt"), "init\n");
  realExecSync('git add -A && git commit -m "init"', {
    cwd: repoDir,
    stdio: "ignore",
  });
  realExecSync("git push", { cwd: repoDir, stdio: "ignore" });
  realExecSync(`git checkout -b "${branch}"`, {
    cwd: repoDir,
    stdio: "ignore",
  });
  writeFileSync(join(repoDir, "feature.txt"), "feature\n");
  realExecSync('git add -A && git commit -m "feat: add feature"', {
    cwd: repoDir,
    stdio: "ignore",
  });
  return repoDir;
}

/** Sample string tainted with ANSI escape codes (color + cursor movement). */
const ANSI_TAINTED =
  "\x1b[38;5;145mColored title\x1b[0m with \x1b[1mbold\x1b[0m";

/** ANSI terminal output resembling what leaked into PR #383. */
const ANSI_TERMINAL_OUTPUT =
  "\x1b[38;5;145mThe following will be cleaned:\x1b[0m\n" +
  "\x1b[38;5;102m1 archived plan\x1b[0m\n" +
  "\x1b[?25l\x1b[999D\x1b[4A cursor junk";

/** Regex that matches any ANSI escape sequence. */
const ANSI_RE =
  /[\x1b\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/;

/**
 * Wrapping mock that intercepts only `gh` commands and passes everything
 * else (git push, git remote, etc.) through to real execSync.
 */
function ghOnlyExec(...args: Parameters<typeof realExecSync>) {
  const [cmd, options] = args;
  if (typeof cmd === "string" && cmd.startsWith("gh ")) {
    return mockExecSync(...args);
  }
  return realExecSync(cmd, options as Parameters<typeof realExecSync>[1]);
}

beforeEach(() => {
  restoreExec = setExecImpl(ghOnlyExec as typeof realExecSync);
  mockExecSync.mockReset();
});

afterEach(() => {
  restoreExec();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ANSI stripping in PR creation", () => {
  it("createPr strips ANSI from title and body", () => {
    const repoDir = initRepoWithRemoteAndBranch(ctx.dir, "ralphai/ansi-title");

    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("gh pr create")) {
        return "https://github.com/o/r/pull/1";
      }
      throw new Error(`Unexpected gh command: ${cmd}`);
    });

    const result = createPr({
      branch: "ralphai/ansi-title",
      baseBranch: "main",
      planDescription: `fix: ${ANSI_TAINTED}`,
      cwd: repoDir,
      summary: ANSI_TERMINAL_OUTPUT,
    });

    expect(result.ok).toBe(true);

    const prCreateCall = mockExecSync.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("gh pr create"),
    );
    expect(prCreateCall).toBeDefined();

    const cmd = prCreateCall![0] as string;
    const opts = prCreateCall![1] as { input?: string };

    // Title must be ANSI-free
    expect(cmd).not.toMatch(ANSI_RE);
    expect(cmd).toContain("Colored title");

    // Body must be ANSI-free
    expect(opts.input).toBeDefined();
    expect(opts.input).not.toMatch(ANSI_RE);
    expect(opts.input).toContain("The following will be cleaned:");
  });

  it("createPrdPr strips ANSI from title and body on create", () => {
    const repoDir = initRepoWithRemoteAndBranch(ctx.dir, "feat/ansi-prd");

    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("gh pr view")) {
        throw new Error("no PR");
      }
      if (typeof cmd === "string" && cmd.includes("gh pr create")) {
        return "https://github.com/o/r/pull/5";
      }
      throw new Error(`Unexpected gh command: ${cmd}`);
    });

    const result = createPrdPr({
      branch: "feat/ansi-prd",
      baseBranch: "main",
      prd: { number: 42, title: `feat: ${ANSI_TAINTED}` },
      completedSubIssues: [10],
      stuckSubIssues: [],
      cwd: repoDir,
      summaries: new Map([[10, ANSI_TERMINAL_OUTPUT]]),
    });

    expect(result.ok).toBe(true);

    const prCreateCall = mockExecSync.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("gh pr create"),
    );
    expect(prCreateCall).toBeDefined();

    const cmd = prCreateCall![0] as string;
    const opts = prCreateCall![1] as { input?: string };

    expect(cmd).not.toMatch(ANSI_RE);
    expect(opts.input).not.toMatch(ANSI_RE);
    // Verify content is preserved, just without ANSI
    expect(opts.input).toContain("The following will be cleaned:");
  });

  it("createPrdPr strips ANSI from body on edit (existing PR)", () => {
    const repoDir = initRepoWithRemoteAndBranch(ctx.dir, "feat/ansi-prd-edit");

    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("gh pr view")) {
        return "https://github.com/o/r/pull/6";
      }
      if (typeof cmd === "string" && cmd.includes("gh pr edit")) {
        return "ok";
      }
      throw new Error(`Unexpected gh command: ${cmd}`);
    });

    const result = createPrdPr({
      branch: "feat/ansi-prd-edit",
      baseBranch: "main",
      prd: { number: 42, title: "Add dashboard" },
      completedSubIssues: [10],
      stuckSubIssues: [],
      cwd: repoDir,
      summaries: new Map([[10, ANSI_TERMINAL_OUTPUT]]),
    });

    expect(result.ok).toBe(true);

    const prEditCall = mockExecSync.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("gh pr edit"),
    );
    expect(prEditCall).toBeDefined();

    const opts = prEditCall![1] as { input?: string };
    expect(opts.input).not.toMatch(ANSI_RE);
  });
});
