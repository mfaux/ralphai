import { describe, it, expect } from "bun:test";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import {
  runCliOutputInProcess,
  stripLogo,
  useTempGitDir,
} from "./test-utils.ts";
import { getRepoPipelineDirs } from "./plan-lifecycle.ts";
import { resetPlanBySlug } from "./ralphai.ts";

const GH_FRONTMATTER = `---
source: github
issue: 42
issue-url: https://github.com/acme/widgets/issues/42
---

# GH Feature
`;

const LOCAL_CONTENT = "# Local Feature";

const MALFORMED_FRONTMATTER = `---
source: github
issue: not-a-number
---

# Malformed Feature
`;

describe("reset: GH-sourced plan handling", () => {
  const ctx = useTempGitDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }

  // -----------------------------------------------------------------------
  // Bulk reset (runRalphaiReset via CLI)
  // -----------------------------------------------------------------------

  it("reset --yes removes GH plan instead of moving to backlog", async () => {
    await runCliOutputInProcess(["init", "--yes"], ctx.dir, testEnv());

    const { wipDir, backlogDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDir = join(wipDir, "gh-42-my-feature");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, "gh-42-my-feature.md"), GH_FRONTMATTER);

    const output = stripLogo(
      await runCliOutputInProcess(["reset", "--yes"], ctx.dir, testEnv()),
    );

    // GH plan should NOT appear in backlog
    expect(existsSync(join(backlogDir, "gh-42-my-feature.md"))).toBe(false);
    // Slug-folder should be deleted from in-progress
    expect(existsSync(join(wipDir, "gh-42-my-feature"))).toBe(false);
    // Summary should mention removal
    expect(output).toContain("removed (re-pull from GitHub)");
  });

  it("reset --yes moves local plan to backlog (existing behavior)", async () => {
    await runCliOutputInProcess(["init", "--yes"], ctx.dir, testEnv());

    const { wipDir, backlogDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDir = join(wipDir, "prd-local-feature");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, "prd-local-feature.md"), LOCAL_CONTENT);

    const output = stripLogo(
      await runCliOutputInProcess(["reset", "--yes"], ctx.dir, testEnv()),
    );

    // Local plan should be moved to backlog
    expect(existsSync(join(backlogDir, "prd-local-feature.md"))).toBe(true);
    expect(existsSync(join(wipDir, "prd-local-feature"))).toBe(false);
    expect(output).toContain("moved to backlog");
  });

  it("reset --yes with mixed plans: GH removed, local moved, summary reflects both", async () => {
    await runCliOutputInProcess(["init", "--yes"], ctx.dir, testEnv());

    const { wipDir, backlogDir } = getRepoPipelineDirs(ctx.dir, testEnv());

    // Create a GH plan
    const ghDir = join(wipDir, "gh-99-api-fix");
    mkdirSync(ghDir, { recursive: true });
    writeFileSync(
      join(ghDir, "gh-99-api-fix.md"),
      `---\nsource: github\nissue: 99\nissue-url: https://github.com/acme/widgets/issues/99\n---\n\n# API Fix\n`,
    );

    // Create a local plan
    const localDir = join(wipDir, "prd-dashboard");
    mkdirSync(localDir, { recursive: true });
    writeFileSync(join(localDir, "prd-dashboard.md"), LOCAL_CONTENT);

    const output = stripLogo(
      await runCliOutputInProcess(["reset", "--yes"], ctx.dir, testEnv()),
    );

    // GH plan should NOT be in backlog
    expect(existsSync(join(backlogDir, "gh-99-api-fix.md"))).toBe(false);
    // Local plan should be in backlog
    expect(existsSync(join(backlogDir, "prd-dashboard.md"))).toBe(true);
    // Both slug-folders should be gone
    expect(existsSync(join(wipDir, "gh-99-api-fix"))).toBe(false);
    expect(existsSync(join(wipDir, "prd-dashboard"))).toBe(false);
    // Summary should report separate counts
    expect(output).toContain("1 plan moved to backlog");
    expect(output).toContain("1 plan removed (re-pull from GitHub)");
  });

  it("reset --yes treats malformed frontmatter as local plan (moved to backlog)", async () => {
    await runCliOutputInProcess(["init", "--yes"], ctx.dir, testEnv());

    const { wipDir, backlogDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDir = join(wipDir, "gh-77-broken");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, "gh-77-broken.md"), MALFORMED_FRONTMATTER);

    await runCliOutputInProcess(["reset", "--yes"], ctx.dir, testEnv());

    // Malformed frontmatter should fall through to backlog (not deleted)
    expect(existsSync(join(backlogDir, "gh-77-broken.md"))).toBe(true);
    expect(existsSync(join(wipDir, "gh-77-broken"))).toBe(false);
  });

  it("reset --yes preview differentiates GH and local plans", async () => {
    await runCliOutputInProcess(["init", "--yes"], ctx.dir, testEnv());

    const { wipDir } = getRepoPipelineDirs(ctx.dir, testEnv());

    // Create a GH plan
    const ghDir = join(wipDir, "gh-10-feat");
    mkdirSync(ghDir, { recursive: true });
    writeFileSync(
      join(ghDir, "gh-10-feat.md"),
      `---\nsource: github\nissue: 10\n---\n\n# Feat\n`,
    );

    // Create a local plan
    const localDir = join(wipDir, "prd-widget");
    mkdirSync(localDir, { recursive: true });
    writeFileSync(join(localDir, "prd-widget.md"), LOCAL_CONTENT);

    const output = stripLogo(
      await runCliOutputInProcess(["reset", "--yes"], ctx.dir, testEnv()),
    );

    // Preview should mention both categories
    expect(output).toContain("moved back to backlog");
    expect(output).toContain("removed (re-pull from GitHub)");
  });

  // -----------------------------------------------------------------------
  // Single-plan reset (resetPlanBySlug)
  // -----------------------------------------------------------------------

  /** Run resetPlanBySlug with RALPHAI_HOME set and console.log captured. */
  function captureResetBySlug(slug: string): string[] {
    const logs: string[] = [];
    const origLog = console.log;
    const origHome = process.env.RALPHAI_HOME;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    process.env.RALPHAI_HOME = testEnv().RALPHAI_HOME;
    try {
      resetPlanBySlug(ctx.dir, slug);
    } finally {
      console.log = origLog;
      process.env.RALPHAI_HOME = origHome;
    }
    return logs;
  }

  it("resetPlanBySlug removes GH plan and logs re-pull message", async () => {
    await runCliOutputInProcess(["init", "--yes"], ctx.dir, testEnv());

    const { wipDir, backlogDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDir = join(wipDir, "gh-55-search");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, "gh-55-search.md"), GH_FRONTMATTER);
    writeFileSync(join(planDir, "progress.md"), "## Progress");

    const logs = captureResetBySlug("gh-55-search");

    // Plan should NOT be in backlog
    expect(existsSync(join(backlogDir, "gh-55-search.md"))).toBe(false);
    // Slug-folder should be gone
    expect(existsSync(join(wipDir, "gh-55-search"))).toBe(false);
    // Log message should say "re-pull from GitHub"
    expect(logs.some((l) => l.includes("re-pull from GitHub"))).toBe(true);
  });

  it("resetPlanBySlug moves local plan to backlog", async () => {
    await runCliOutputInProcess(["init", "--yes"], ctx.dir, testEnv());

    const { wipDir, backlogDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDir = join(wipDir, "prd-charts");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, "prd-charts.md"), LOCAL_CONTENT);

    const logs = captureResetBySlug("prd-charts");

    // Local plan should be in backlog
    expect(existsSync(join(backlogDir, "prd-charts.md"))).toBe(true);
    expect(existsSync(join(wipDir, "prd-charts"))).toBe(false);
    // Log should say "moved back to backlog"
    expect(logs.some((l) => l.includes("moved back to backlog"))).toBe(true);
  });

  it("resetPlanBySlug treats malformed frontmatter as local plan", async () => {
    await runCliOutputInProcess(["init", "--yes"], ctx.dir, testEnv());

    const { wipDir, backlogDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDir = join(wipDir, "gh-88-malformed");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, "gh-88-malformed.md"), MALFORMED_FRONTMATTER);

    const logs = captureResetBySlug("gh-88-malformed");

    // Malformed frontmatter should fall through to backlog
    expect(existsSync(join(backlogDir, "gh-88-malformed.md"))).toBe(true);
    expect(existsSync(join(wipDir, "gh-88-malformed"))).toBe(false);
    expect(logs.some((l) => l.includes("moved back to backlog"))).toBe(true);
  });
});
