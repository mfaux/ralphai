/**
 * Tests for auto-detect drain: each standalone plan gets its own
 * branch and worktree when processed via `ralphai run` (no target).
 *
 * Covers:
 *   - Each plan gets a unique <type>/<slug> branch (conventional commit style)
 *   - --once processes exactly one plan
 *   - Worktrees are cleaned up between plans
 *   - Plans with prd: frontmatter route through the PRD flow, not standalone
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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
const completeAgent = `bash -c 'N=$RALPHAI_NONCE; echo "<promise nonce=\\"$N\\">COMPLETE</promise>"; echo "<learnings nonce=\\"$N\\">none</learnings>"; echo "<progress nonce=\\"$N\\">"; echo "- [x] Done"; echo "</progress>"'`;

/** Initialize ralphai with a fast-completing agent. */
function initWithAgent(dir: string, env: Record<string, string>): void {
  runCli(["init", "--yes"], dir, env);
  const configPath = getConfigFilePath(dir, env);
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  config.agentCommand = completeAgent;
  config.autoCommit = true;
  config.sandbox = "none"; // Force local execution — the bash agent isn't Docker-compatible
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

  // Remove the scaffolded hello-world sample plan so it doesn't interfere
  // with test plans. The hello-world plan uses task headings that don't
  // match the test agent's progress format, causing the completion gate
  // to reject and the runner to get stuck.
  const { backlogDir } = getRepoPipelineDirs(dir, env);
  const samplePlan = join(backlogDir, "hello-world.md");
  if (existsSync(samplePlan)) {
    rmSync(samplePlan);
  }
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
      `# Plan: ${plan.title}\n\nImplement the feature.\n`,
    );
  }
  return backlogDir;
}

/** Create a plan file with prd: N frontmatter (simulating a PRD sub-issue). */
function addPrdSubIssuePlan(
  dir: string,
  env: Record<string, string>,
  slug: string,
  issueNumber: number,
  prdNumber: number,
): string {
  const { backlogDir } = getRepoPipelineDirs(dir, env);
  mkdirSync(backlogDir, { recursive: true });
  writeFileSync(
    join(backlogDir, `${slug}.md`),
    `---\nsource: github\nissue: ${issueNumber}\nissue-url: https://github.com/test/repo/issues/${issueNumber}\nprd: ${prdNumber}\n---\n\n# Plan: ${slug}\n\nImplement the feature.\n`,
  );
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

      expect(branches).toContain("feat/plan-first-plan");
      expect(branches).toContain("feat/plan-second-plan");
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

      expect(branches).toContain("feat/plan-first-plan");
      expect(branches).not.toContain("feat/plan-second-plan");
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

    test("plan with prd: frontmatter does not get a standalone branch", () => {
      initWithAgent(dir, testEnv());
      process.env.RALPHAI_HOME = ralphaiHome;

      // Add a plan that simulates a PRD sub-issue (has prd: 42 frontmatter)
      addPrdSubIssuePlan(dir, testEnv(), "gh-99-prd-sub-task", 99, 42);

      // Run auto-detect. Since there's no GitHub remote, PRD discovery
      // will fail, but the drain loop should NOT process this as a
      // standalone plan on a feature branch.
      const result = runCli(["run"], dir, testEnv(), 60000);

      const branches = execSync("git branch --list", {
        cwd: dir,
        encoding: "utf-8",
      });

      // The plan has prd: frontmatter, so it must NOT be processed as
      // standalone (which would create a feat/plan-gh-99-prd-sub-task branch).
      expect(branches).not.toContain("feat/plan-gh-99-prd-sub-task");

      // The combined output should indicate PRD routing was attempted
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/PRD|prd/i);
    });

    test("plan without prd: frontmatter still gets standalone branch", () => {
      initWithAgent(dir, testEnv());
      process.env.RALPHAI_HOME = ralphaiHome;
      addPlans(dir, testEnv(), [
        { slug: "standalone-task", title: "Standalone Task" },
      ]);

      runCli(["run"], dir, testEnv(), 60000);

      const branches = execSync("git branch --list", {
        cwd: dir,
        encoding: "utf-8",
      });

      // Plan without prd: should still be processed as standalone
      expect(branches).toContain("feat/plan-standalone-task");
    });
  },
);
