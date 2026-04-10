/**
 * Tests for gatherPipelineState.
 *
 * Uses real temp directories with fixture plan files, receipts, and PID
 * files to verify correct categorization, liveness detection, count
 * aggregation, dependency info, scope extraction, and problem detection.
 */

import { describe, it, expect } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { useTempDir } from "./test-utils.ts";
import { getRepoPipelineDirs } from "./plan-lifecycle.ts";
import { gatherPipelineState } from "./pipeline-state.ts";

describe("gatherPipelineState", () => {
  const ctx = useTempDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }

  /** Ensure pipeline directories exist and return them. */
  function setupPipeline() {
    return getRepoPipelineDirs(ctx.dir, testEnv());
  }

  /** Create a backlog plan file (flat .md in backlog dir). */
  function createBacklogPlan(
    backlogDir: string,
    slug: string,
    opts?: { scope?: string; dependsOn?: string[] },
  ): void {
    const lines: string[] = [];
    if (opts?.scope || opts?.dependsOn) {
      lines.push("---");
      if (opts.scope) lines.push(`scope: ${opts.scope}`);
      if (opts.dependsOn && opts.dependsOn.length > 0) {
        lines.push(`depends-on: [${opts.dependsOn.join(", ")}]`);
      }
      lines.push("---");
    }
    lines.push(`# ${slug}`);
    lines.push("");
    lines.push("### Task 1: Do something");
    lines.push("### Task 2: Do another thing");
    writeFileSync(join(backlogDir, `${slug}.md`), lines.join("\n") + "\n");
  }

  /** Create an in-progress plan with slug-folder structure. */
  function createInProgressPlan(
    ipDir: string,
    slug: string,
    opts?: {
      pid?: string;
      outcome?: string;
      scope?: string;
      tasksCompleted?: number;
      worktreePath?: string;
      taskCount?: number;
    },
  ): void {
    const planDir = join(ipDir, slug);
    mkdirSync(planDir, { recursive: true });

    const planLines: string[] = [];
    if (opts?.scope) {
      planLines.push("---");
      planLines.push(`scope: ${opts.scope}`);
      planLines.push("---");
    }
    planLines.push(`# ${slug}`);
    planLines.push("");
    const taskCount = opts?.taskCount ?? 3;
    for (let i = 1; i <= taskCount; i++) {
      planLines.push(`### Task ${i}: Task ${i}`);
    }
    writeFileSync(join(planDir, `${slug}.md`), planLines.join("\n") + "\n");

    const receiptLines = [
      "started_at=2026-03-07T12:00:00Z",
      `branch=ralphai/${slug}`,
      `slug=${slug}`,
      `plan_file=${slug}.md`,
      `tasks_completed=${opts?.tasksCompleted ?? 0}`,
    ];
    if (opts?.outcome) {
      receiptLines.push(`outcome=${opts.outcome}`);
    }
    if (opts?.worktreePath) {
      receiptLines.push(`worktree_path=${opts.worktreePath}`);
    }
    writeFileSync(join(planDir, "receipt.txt"), receiptLines.join("\n") + "\n");

    if (opts?.pid !== undefined) {
      writeFileSync(join(planDir, "runner.pid"), opts.pid);
    }
  }

  /** Create a completed plan (slug-folder in archive dir). */
  function createCompletedPlan(archiveDir: string, slug: string): void {
    const planDir = join(archiveDir, slug);
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, `${slug}.md`), `# ${slug}\n`);
  }

  // -----------------------------------------------------------------------
  // Scenario 63: structured data given plans in all directories
  // -----------------------------------------------------------------------

  it("returns structured data with plans in all directories", () => {
    const { backlogDir, wipDir: ipDir, archiveDir } = setupPipeline();

    createBacklogPlan(backlogDir, "plan-a", { scope: "packages/web" });
    createBacklogPlan(backlogDir, "plan-b", {
      dependsOn: ["plan-a.md"],
    });
    createInProgressPlan(ipDir, "plan-c", {
      scope: "packages/api",
      tasksCompleted: 1,
    });
    createCompletedPlan(archiveDir, "plan-d");

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    // Backlog
    expect(state.backlog).toHaveLength(2);
    const planA = state.backlog.find((p) => p.filename === "plan-a.md");
    const planB = state.backlog.find((p) => p.filename === "plan-b.md");
    expect(planA).toBeDefined();
    expect(planA!.scope).toBe("packages/web");
    expect(planA!.dependsOn).toEqual([]);
    expect(planB).toBeDefined();
    expect(planB!.dependsOn).toEqual(["plan-a.md"]);

    // In progress
    expect(state.inProgress).toHaveLength(1);
    expect(state.inProgress[0]!.filename).toBe("plan-c.md");
    expect(state.inProgress[0]!.slug).toBe("plan-c");
    expect(state.inProgress[0]!.scope).toBe("packages/api");
    expect(state.inProgress[0]!.totalTasks).toBe(3);
    expect(state.inProgress[0]!.tasksCompleted).toBe(1);

    // Completed
    expect(state.completedSlugs).toEqual(["plan-d"]);

    // No worktrees passed
    expect(state.worktrees).toEqual([]);

    // No problems
    expect(state.problems).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Scenario 64: in-progress plan with live PID shows "running"
  // -----------------------------------------------------------------------

  it("shows running liveness when PID is alive", () => {
    const { wipDir: ipDir } = setupPipeline();

    createInProgressPlan(ipDir, "live-plan", {
      pid: String(process.pid),
    });

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    expect(state.inProgress).toHaveLength(1);
    expect(state.inProgress[0]!.liveness).toEqual({
      tag: "running",
      pid: process.pid,
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 65: in-progress plan with dead PID shows "stalled"
  // -----------------------------------------------------------------------

  it("shows stalled liveness when PID is dead", () => {
    const { wipDir: ipDir } = setupPipeline();

    createInProgressPlan(ipDir, "dead-plan", {
      pid: "999999999",
    });

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    expect(state.inProgress).toHaveLength(1);
    expect(state.inProgress[0]!.liveness).toEqual({ tag: "stalled" });
  });

  // -----------------------------------------------------------------------
  // Scenario 66: in-progress plan with no PID file shows "in_progress"
  // -----------------------------------------------------------------------

  it("shows in_progress liveness when no runner.pid exists", () => {
    const { wipDir: ipDir } = setupPipeline();

    createInProgressPlan(ipDir, "no-pid-plan");

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    expect(state.inProgress).toHaveLength(1);
    expect(state.inProgress[0]!.liveness).toEqual({ tag: "in_progress" });
  });

  // -----------------------------------------------------------------------
  // Scenario 67: receipt with outcome takes priority over PID check
  // -----------------------------------------------------------------------

  it("uses outcome from receipt over PID liveness", () => {
    const { wipDir: ipDir } = setupPipeline();

    createInProgressPlan(ipDir, "stuck-plan", {
      pid: String(process.pid),
      outcome: "stuck",
    });

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    expect(state.inProgress).toHaveLength(1);
    expect(state.inProgress[0]!.liveness).toEqual({
      tag: "outcome",
      outcome: "stuck",
    });
  });

  // -----------------------------------------------------------------------
  // Scope extraction
  // -----------------------------------------------------------------------

  it("extracts scope from backlog and in-progress plans", () => {
    const { backlogDir, wipDir: ipDir } = setupPipeline();

    createBacklogPlan(backlogDir, "scoped-backlog", {
      scope: "packages/core",
    });
    createInProgressPlan(ipDir, "scoped-wip", {
      scope: "packages/web",
    });

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    expect(state.backlog[0]!.scope).toBe("packages/core");
    expect(state.inProgress[0]!.scope).toBe("packages/web");
  });

  // -----------------------------------------------------------------------
  // Dependency info
  // -----------------------------------------------------------------------

  it("extracts dependency info from backlog plans", () => {
    const { backlogDir } = setupPipeline();

    createBacklogPlan(backlogDir, "dep-plan", {
      dependsOn: ["prereq-a.md", "prereq-b.md"],
    });

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    expect(state.backlog[0]!.dependsOn).toEqual(["prereq-a.md", "prereq-b.md"]);
  });

  // -----------------------------------------------------------------------
  // Task count aggregation
  // -----------------------------------------------------------------------

  it("counts total tasks and completed tasks", () => {
    const { wipDir: ipDir } = setupPipeline();

    createInProgressPlan(ipDir, "task-plan", {
      taskCount: 5,
      tasksCompleted: 3,
    });

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    expect(state.inProgress[0]!.totalTasks).toBe(5);
    expect(state.inProgress[0]!.tasksCompleted).toBe(3);
  });

  // -----------------------------------------------------------------------
  // Worktree state
  // -----------------------------------------------------------------------

  it("determines worktree active plan state", () => {
    const { wipDir: ipDir } = setupPipeline();

    createInProgressPlan(ipDir, "active-wt", {});

    const state = gatherPipelineState(ctx.dir, {
      env: testEnv(),
      worktrees: [
        { path: "/tmp/wt-active", branch: "ralphai/active-wt" },
        { path: "/tmp/wt-idle", branch: "ralphai/no-such-plan" },
      ],
    });

    expect(state.worktrees).toHaveLength(2);
    expect(state.worktrees[0]!.hasActivePlan).toBe(true);
    expect(state.worktrees[1]!.hasActivePlan).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Has worktree flag from receipt
  // -----------------------------------------------------------------------

  it("sets hasWorktree from receipt worktree_path", () => {
    const { wipDir: ipDir } = setupPipeline();

    createInProgressPlan(ipDir, "wt-plan", {
      worktreePath: "/tmp/some-worktree",
    });

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    expect(state.inProgress[0]!.hasWorktree).toBe(true);
  });

  it("sets hasWorktree to false when no worktree_path in receipt", () => {
    const { wipDir: ipDir } = setupPipeline();

    createInProgressPlan(ipDir, "no-wt-plan", {});

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    expect(state.inProgress[0]!.hasWorktree).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Problem detection: orphaned receipts
  // -----------------------------------------------------------------------

  it("detects orphaned receipts (receipt without matching plan file)", () => {
    const { wipDir: ipDir } = setupPipeline();

    // Create a slug folder with receipt but no plan file
    const slug = "orphan-plan";
    const planDir = join(ipDir, slug);
    mkdirSync(planDir, { recursive: true });
    writeFileSync(
      join(planDir, "receipt.txt"),
      [
        "started_at=2026-03-07T12:00:00Z",
        `branch=ralphai/${slug}`,
        `slug=${slug}`,
        `plan_file=${slug}.md`,
        "tasks_completed=0",
      ].join("\n") + "\n",
    );
    // No plan file created — this is the orphaned case

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    expect(state.problems.length).toBeGreaterThanOrEqual(1);
    expect(state.problems[0]!.message).toContain("Orphaned receipt");
    expect(state.problems[0]!.message).toContain(slug);
  });

  // -----------------------------------------------------------------------
  // Problem detection: stale worktrees
  // -----------------------------------------------------------------------

  it("detects missing worktree directories", () => {
    setupPipeline();

    const state = gatherPipelineState(ctx.dir, {
      env: testEnv(),
      worktrees: [
        {
          path: "/tmp/definitely-does-not-exist-12345",
          branch: "ralphai/missing-wt",
        },
      ],
    });

    expect(state.problems.length).toBeGreaterThanOrEqual(1);
    const wtProblem = state.problems.find((p) =>
      p.message.includes("Missing worktree directory"),
    );
    expect(wtProblem).toBeDefined();
    expect(wtProblem!.message).toContain(
      "/tmp/definitely-does-not-exist-12345",
    );
  });

  // -----------------------------------------------------------------------
  // Empty pipeline
  // -----------------------------------------------------------------------

  it("returns empty state when pipeline has no plans", () => {
    setupPipeline();

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    expect(state.backlog).toEqual([]);
    expect(state.inProgress).toEqual([]);
    expect(state.completedSlugs).toEqual([]);
    expect(state.worktrees).toEqual([]);
    expect(state.problems).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Completed plans sorting
  // -----------------------------------------------------------------------

  it("returns completed slugs sorted alphabetically", () => {
    const { archiveDir } = setupPipeline();

    createCompletedPlan(archiveDir, "zebra");
    createCompletedPlan(archiveDir, "alpha");
    createCompletedPlan(archiveDir, "mango");

    const state = gatherPipelineState(ctx.dir, { env: testEnv() });

    expect(state.completedSlugs).toEqual(["alpha", "mango", "zebra"]);
  });
});
