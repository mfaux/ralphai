import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { runCli, runCliOutput, useTempGitDir } from "./test-utils.ts";
import { getRepoPipelineDirs } from "./global-state.ts";

// ---------------------------------------------------------------------------
// Flat backlog plan discovery (TypeScript side)
// ---------------------------------------------------------------------------

describe("flat backlog plan discovery", () => {
  const ctx = useTempGitDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }

  function initProject(dir: string): void {
    runCli(["init", "--yes"], dir, testEnv());
  }

  function backlogDir(dir: string): string {
    return getRepoPipelineDirs(dir, testEnv()).backlogDir;
  }

  it("flat .md file in backlog is listed by status", () => {
    initProject(ctx.dir);
    // Remove the sample plan if it exists
    const bd = backlogDir(ctx.dir);
    writeFileSync(join(bd, "my-flat-plan.md"), "# Plan: Flat Plan\n");

    const output = runCliOutput(["status"], ctx.dir, testEnv());
    expect(output).toContain("my-flat-plan.md");
  });

  it("slug-folder plan in backlog is NOT discovered (flat-only)", () => {
    initProject(ctx.dir);
    const bd = backlogDir(ctx.dir);
    mkdirSync(join(bd, "folder-plan"), { recursive: true });
    writeFileSync(
      join(bd, "folder-plan", "folder-plan.md"),
      "# Plan: Folder Plan\n",
    );

    const output = runCliOutput(["status"], ctx.dir, testEnv());
    // Slug-folder plans in backlog should be ignored
    expect(output).not.toContain("folder-plan.md");
  });

  it("multiple flat plans are listed together", () => {
    initProject(ctx.dir);
    const bd = backlogDir(ctx.dir);
    writeFileSync(join(bd, "flat-one.md"), "# Plan: Flat One\n");
    writeFileSync(join(bd, "flat-two.md"), "# Plan: Flat Two\n");

    const output = runCliOutput(["status"], ctx.dir, testEnv());
    expect(output).toContain("flat-one.md");
    expect(output).toContain("flat-two.md");
  });

  it("init --yes creates sample plan in global backlog", () => {
    initProject(ctx.dir);
    const bd = backlogDir(ctx.dir);
    // Sample plan should be created as a flat file in the global backlog
    expect(existsSync(join(bd, "hello-ralphai.md"))).toBe(true);
    // Slug-folder should NOT exist (it's a flat backlog file)
    expect(existsSync(join(bd, "hello-ralphai", "hello-ralphai.md"))).toBe(
      false,
    );
  });

  it("doctor detects flat backlog plans", () => {
    initProject(ctx.dir);
    const bd = backlogDir(ctx.dir);
    // Add a flat plan (hello-ralphai.md already exists from init)
    writeFileSync(join(bd, "doc-plan.md"), "# Plan: Doc Plan\n");

    const output = runCliOutput(["doctor"], ctx.dir, testEnv());
    expect(output).toContain("backlog:");
    expect(output).toContain("2 plan");
  });
});

// ---------------------------------------------------------------------------
// Flat backlog plan with depends-on in status
// ---------------------------------------------------------------------------

describe("flat backlog plan dependencies in status", () => {
  const ctx = useTempGitDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }

  it("shows dependency info for flat plans with depends-on frontmatter", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());
    const { backlogDir: bd } = getRepoPipelineDirs(ctx.dir, testEnv());
    writeFileSync(
      join(bd, "child-plan.md"),
      `---
depends-on: [parent-plan.md]
---
# Plan: Child Plan
`,
    );

    const output = runCliOutput(["status"], ctx.dir, testEnv());
    expect(output).toContain("child-plan.md");
    expect(output).toContain("waiting on parent-plan.md");
  });
});

// ---------------------------------------------------------------------------
// Flat plan selection for worktree (dry-run via TS runner)
// ---------------------------------------------------------------------------

describe.skipIf(process.platform === "win32")(
  "flat backlog plan execution (TS runner)",
  () => {
    let testDir: string;

    beforeEach(() => {
      testDir = mkdtempSync(join(tmpdir(), "ralphai-flat-runner-"));
      execSync("git init", { cwd: testDir, stdio: "ignore" });
      execSync(
        "git config user.email 'test@test.com' && git config user.name 'Test'",
        { cwd: testDir, stdio: "ignore" },
      );
      execSync("git commit --allow-empty -m 'init'", {
        cwd: testDir,
        stdio: "ignore",
      });
    });

    afterEach(() => {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("dry-run detects flat backlog plan and shows promote message", () => {
      const ralphaiHome = mkdtempSync(join(tmpdir(), "ralphai-home-"));
      const env = { RALPHAI_HOME: ralphaiHome };

      // Set up ralphai config structure (for init check)
      runCli(["init", "--yes"], testDir, env);

      // Write the plan to the global state backlog directory
      const { backlogDir } = getRepoPipelineDirs(testDir, env);
      // Remove the sample plan so test-flat.md is the first detected plan
      const samplePlan = join(backlogDir, "hello-ralphai.md");
      if (existsSync(samplePlan)) rmSync(samplePlan);
      writeFileSync(join(backlogDir, "test-flat.md"), "# Plan: Test Flat\n");

      // Run the CLI in dry-run mode (which invokes the bundled runner)
      const result = runCli(["run", "--dry-run"], testDir, {
        RALPHAI_AGENT_COMMAND: "echo mock",
        RALPHAI_NO_UPDATE_CHECK: "1",
        RALPHAI_HOME: ralphaiHome,
      });
      const output = result.stdout + result.stderr;
      // Should mention the flat file and show promote message
      expect(output).toContain("test-flat");
      expect(output).toContain("promote flat file");
    });
  },
);
