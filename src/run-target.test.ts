/**
 * Tests for `ralphai run <target>` — positional target detection integration.
 *
 * Covers:
 * - Issue target: `ralphai run 42` → error (no GitHub in test env)
 * - Plan target: `ralphai run my-feature.md` → error when plan doesn't exist
 * - Plan target: `ralphai run my-feature.md` → works when plan exists
 * - Invalid target: `ralphai run not-a-target` → actionable error
 * - Help passthrough: `ralphai run 42 --help` → shows help
 * - Dry-run passthrough: `ralphai run 42 --dry-run` → dry-run error
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { runCliInProcess, useTempGitDir } from "./test-utils.ts";
import { getConfigFilePath } from "./config.ts";
import { getRepoPipelineDirs } from "./global-state.ts";

describe("ralphai run <target>", () => {
  const ctx = useTempGitDir();

  /** Per-test RALPHAI_HOME so config goes to a temp dir. */
  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }

  /** Resolve the global config file path for this test's cwd. */
  function configPath() {
    return getConfigFilePath(ctx.dir, testEnv());
  }

  /** Initialize ralphai in the test dir. */
  async function initRalphai() {
    await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());
  }

  // -------------------------------------------------------------------------
  // Issue target: `ralphai run 42`
  // -------------------------------------------------------------------------

  describe("issue target", () => {
    it("run 42 requires GitHub repo detection", async () => {
      await initRalphai();
      const result = await runCliInProcess(["run", "42"], ctx.dir, testEnv());
      const combined = result.stdout + result.stderr;
      expect(result.exitCode).not.toBe(0);
      // Without a GitHub remote, repo detection fails
      expect(combined).toMatch(/GitHub repo|gh CLI/i);
    });

    it("run 42 --dry-run requires GitHub repo detection", async () => {
      await initRalphai();
      const result = await runCliInProcess(
        ["run", "42", "--dry-run"],
        ctx.dir,
        testEnv(),
      );
      const combined = result.stdout + result.stderr;
      expect(result.exitCode).not.toBe(0);
      // Even in dry-run, we need the repo to fetch the issue title
      expect(combined).toMatch(/GitHub repo|gh CLI/i);
    });

    it("run 42 --help still shows help", async () => {
      await initRalphai();
      const result = await runCliInProcess(
        ["run", "42", "--help"],
        ctx.dir,
        testEnv(),
      );
      const combined = result.stdout + result.stderr;
      expect(result.exitCode).toBe(0);
      expect(combined).toContain("--dry-run");
    });
  });

  // -------------------------------------------------------------------------
  // Plan target: `ralphai run my-feature.md`
  // -------------------------------------------------------------------------

  describe("plan target", () => {
    it("run plan.md fails with error when plan doesn't exist", async () => {
      await initRalphai();
      const result = await runCliInProcess(
        ["run", "nonexistent.md"],
        ctx.dir,
        testEnv(),
      );
      const combined = result.stdout + result.stderr;
      expect(result.exitCode).not.toBe(0);
      expect(combined).toContain("not found");
    });

    it("run plan.md lists available plans when target doesn't exist", async () => {
      await initRalphai();
      // Create a plan in the backlog
      const { backlogDir } = getRepoPipelineDirs(ctx.dir, testEnv());
      writeFileSync(
        join(backlogDir, "existing-plan.md"),
        "# Existing Plan\n\n- [ ] task 1\n",
      );

      const result = await runCliInProcess(
        ["run", "nonexistent.md"],
        ctx.dir,
        testEnv(),
      );
      const combined = result.stdout + result.stderr;
      expect(result.exitCode).not.toBe(0);
      expect(combined).toContain("nonexistent.md");
      expect(combined).toContain("not found");
      expect(combined).toContain("existing-plan.md");
    });

    it("run plan.md --help still shows help", async () => {
      await initRalphai();
      const result = await runCliInProcess(
        ["run", "my-feature.md", "--help"],
        ctx.dir,
        testEnv(),
      );
      const combined = result.stdout + result.stderr;
      expect(result.exitCode).toBe(0);
      expect(combined).toContain("--dry-run");
    });
  });

  // -------------------------------------------------------------------------
  // Invalid target
  // -------------------------------------------------------------------------

  describe("invalid target", () => {
    it("run with invalid target prints actionable error", async () => {
      const result = await runCliInProcess(
        ["run", "not-a-target"],
        ctx.dir,
        testEnv(),
      );
      const combined = result.stdout + result.stderr;
      expect(result.exitCode).not.toBe(0);
      expect(combined).toContain("Invalid run target");
      expect(combined).toContain("not-a-target");
    });

    it("run with empty-looking target prints actionable error", async () => {
      const result = await runCliInProcess(
        ["run", "feature-branch"],
        ctx.dir,
        testEnv(),
      );
      const combined = result.stdout + result.stderr;
      expect(result.exitCode).not.toBe(0);
      expect(combined).toContain("Invalid run target");
    });
  });

  // -------------------------------------------------------------------------
  // Help text includes target syntax
  // -------------------------------------------------------------------------

  describe("help text", () => {
    it("run --help shows target syntax", async () => {
      await initRalphai();
      const result = await runCliInProcess(
        ["run", "--help"],
        ctx.dir,
        testEnv(),
      );
      const combined = result.stdout + result.stderr;
      expect(result.exitCode).toBe(0);
      expect(combined).toContain("<target>");
      expect(combined).toContain("issue number");
    });

    it("run --help shows examples with issue and plan targets", async () => {
      await initRalphai();
      const result = await runCliInProcess(
        ["run", "--help"],
        ctx.dir,
        testEnv(),
      );
      const combined = result.stdout + result.stderr;
      expect(combined).toContain("ralphai run 42");
      expect(combined).toContain("my-feature.md");
    });
  });
});
