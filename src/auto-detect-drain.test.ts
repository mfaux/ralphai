/**
 * Tests for auto-detect drain: each standalone plan gets its own
 * branch and worktree when processed via `ralphai run` (no target).
 *
 * Covers:
 *   - Each plan gets a unique ralphai/<slug> branch
 *   - --once processes exactly one plan
 *   - Worktrees are cleaned up between plans
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

import { runCli } from "./test-utils.ts";
import { getConfigFilePath } from "./config.ts";
import { getRepoPipelineDirs } from "./global-state.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTmpGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ralphai-autodrain-"));
  execSync("git init --initial-branch=main", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@ralphai.dev"', {
    cwd: dir,
    stdio: "pipe",
  });
  execSync('git config user.name "Ralphai Test"', {
    cwd: dir,
    stdio: "pipe",
  });
  writeFileSync(join(dir, "README.md"), "# Test\n");
  execSync("git add -A && git commit -m init", { cwd: dir, stdio: "pipe" });
  return dir;
}

/**
 * Fast agent that immediately completes, producing the COMPLETE signal,
 * a learnings block, and a progress block.
 */
const completeAgent = `bash -c 'echo "<promise>COMPLETE</promise>"; echo "<learnings>none</learnings>"; echo "<progress>"; echo "- [x] Done"; echo "</progress>"'`;

/** Initialize ralphai with a fast-completing agent. */
function initWithAgent(dir: string, env: Record<string, string>): void {
  runCli(["init", "--yes"], dir, env);
  const configPath = getConfigFilePath(dir, env);
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  config.agentCommand = completeAgent;
  config.autoCommit = true;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

/** Create plan files in the backlog directory. */
function addPlans(
  dir: string,
  env: Record<string, string>,
  plans: Array<{ slug: string; title: string }>,
): string {
  const { backlogDir } = getRepoPipelineDirs(dir, env);
  mkdirSync(backlogDir, { recursive: true });
  for (const plan of plans) {
    writeFileSync(
      join(backlogDir, `${plan.slug}.md`),
      `# Plan: ${plan.title}\n\n### Task 1: Do it\n`,
    );
  }
  return backlogDir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(process.platform === "win32")(
  "auto-detect drain: branch-per-plan",
  () => {
    let dir: string;
    let ralphaiHome: string;
    let savedHome: string | undefined;

    function testEnv() {
      return { RALPHAI_HOME: ralphaiHome };
    }

    beforeEach(() => {
      savedHome = process.env.RALPHAI_HOME;
      dir = createTmpGitRepo();
      ralphaiHome = join(dir, ".ralphai-home");
    });

    afterEach(() => {
      if (savedHome === undefined) delete process.env.RALPHAI_HOME;
      else process.env.RALPHAI_HOME = savedHome;
    });

    test("two unrelated plans get distinct branches", () => {
      initWithAgent(dir, testEnv());
      process.env.RALPHAI_HOME = ralphaiHome;
      addPlans(dir, testEnv(), [
        { slug: "aaa-first", title: "First Plan" },
        { slug: "bbb-second", title: "Second Plan" },
      ]);

      runCli(["run"], dir, testEnv(), 60000);

      const branches = execSync("git branch --list", {
        cwd: dir,
        encoding: "utf-8",
      });

      expect(branches).toContain("ralphai/aaa-first");
      expect(branches).toContain("ralphai/bbb-second");
    });

    test("--once processes exactly one plan when two are available", () => {
      initWithAgent(dir, testEnv());
      process.env.RALPHAI_HOME = ralphaiHome;
      const backlogDir = addPlans(dir, testEnv(), [
        { slug: "aaa-first", title: "First Plan" },
        { slug: "bbb-second", title: "Second Plan" },
      ]);

      runCli(["run", "--once"], dir, testEnv(), 60000);

      const branches = execSync("git branch --list", {
        cwd: dir,
        encoding: "utf-8",
      });

      expect(branches).toContain("ralphai/aaa-first");
      expect(branches).not.toContain("ralphai/bbb-second");
      expect(existsSync(join(backlogDir, "bbb-second.md"))).toBe(true);
    });

    test("worktrees are cleaned up between plans in drain loop", () => {
      initWithAgent(dir, testEnv());
      process.env.RALPHAI_HOME = ralphaiHome;
      addPlans(dir, testEnv(), [
        { slug: "aaa-first", title: "First Plan" },
        { slug: "bbb-second", title: "Second Plan" },
      ]);

      runCli(["run"], dir, testEnv(), 60000);

      // After drain, earlier plan's worktree directory should be removed
      const worktreeBase = join(dir, "..", ".ralphai-worktrees");
      expect(existsSync(join(worktreeBase, "aaa-first"))).toBe(false);
    });
  },
);
