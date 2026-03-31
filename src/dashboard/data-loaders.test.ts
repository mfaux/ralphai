import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Mock getRepoPipelineDirs to return our temp dirs without needing a git repo.
let mockPipelineDirs: {
  backlogDir: string;
  wipDir: string;
  archiveDir: string;
};

vi.mock("../global-state.ts", () => ({
  getRepoPipelineDirs: () => mockPipelineDirs,
  listAllRepos: () => [],
}));

// Now import the functions under test (after vi.mock is declared).
import {
  loadPlans,
  loadPlansAsync,
  loadPlanContent,
  loadPlanContentAsync,
} from "./data.ts";
import type { PlanInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Counter to generate unique cwd keys, preventing cache collisions. */
let cwdCounter = 0;
function uniqueCwd(): string {
  return `/fake/cwd/${++cwdCounter}`;
}

function makePipelineDirs(base: string) {
  const backlogDir = join(base, "backlog");
  const wipDir = join(base, "in-progress");
  const archiveDir = join(base, "out");
  mkdirSync(backlogDir, { recursive: true });
  mkdirSync(wipDir, { recursive: true });
  mkdirSync(archiveDir, { recursive: true });
  return { backlogDir, wipDir, archiveDir };
}

function writePlan(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

const PLAN_WITH_SCOPE_AND_DEPS = [
  "---",
  "scope: packages/web",
  "depends-on: [setup.md, infra.md]",
  "source: github",
  "issue: 42",
  "issue-url: https://github.com/test/repo/issues/42",
  "---",
  "",
  "# Test Plan",
  "",
  "- [ ] Task 1",
  "- [ ] Task 2",
  "- [x] Task 3",
].join("\n");

const PLAN_WITH_MULTILINE_DEPS = [
  "---",
  "scope: packages/api",
  "depends-on:",
  "  - alpha.md",
  "  - beta.md",
  "---",
  "",
  "# Another Plan",
].join("\n");

const PLAN_NO_SCOPE_NO_DEPS = [
  "---",
  "source: github",
  "issue: 10",
  "---",
  "",
  "# Minimal Plan",
].join("\n");

// ---------------------------------------------------------------------------
// loadPlans (sync) — scope and deps for all plan states
// ---------------------------------------------------------------------------

describe("loadPlans — scope and deps for all plan states", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ralphai-data-loader-"));
    mockPipelineDirs = makePipelineDirs(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads scope and deps for backlog plans", () => {
    writeFileSync(
      join(mockPipelineDirs.backlogDir, "my-plan.md"),
      PLAN_WITH_SCOPE_AND_DEPS,
    );

    const plans = loadPlans(uniqueCwd());
    const plan = plans.find((p) => p.slug === "my-plan");
    expect(plan).toBeDefined();
    expect(plan!.state).toBe("backlog");
    expect(plan!.scope).toBe("packages/web");
    expect(plan!.deps).toEqual(["setup.md", "infra.md"]);
  });

  it("loads scope and deps for in-progress plans", () => {
    const slugDir = join(mockPipelineDirs.wipDir, "my-plan");
    writePlan(join(slugDir, "my-plan.md"), PLAN_WITH_SCOPE_AND_DEPS);

    const plans = loadPlans(uniqueCwd());
    const plan = plans.find((p) => p.slug === "my-plan");
    expect(plan).toBeDefined();
    expect(plan!.state).toBe("in-progress");
    expect(plan!.scope).toBe("packages/web");
    expect(plan!.deps).toEqual(["setup.md", "infra.md"]);
  });

  it("loads scope and deps for completed plans", () => {
    const slugDir = join(mockPipelineDirs.archiveDir, "my-plan");
    writePlan(join(slugDir, "my-plan.md"), PLAN_WITH_SCOPE_AND_DEPS);

    const plans = loadPlans(uniqueCwd());
    const plan = plans.find((p) => p.slug === "my-plan");
    expect(plan).toBeDefined();
    expect(plan!.state).toBe("completed");
    expect(plan!.scope).toBe("packages/web");
    expect(plan!.deps).toEqual(["setup.md", "infra.md"]);
  });

  it("loads multiline deps for completed plans", () => {
    const slugDir = join(mockPipelineDirs.archiveDir, "multi-dep");
    writePlan(join(slugDir, "multi-dep.md"), PLAN_WITH_MULTILINE_DEPS);

    const plans = loadPlans(uniqueCwd());
    const plan = plans.find((p) => p.slug === "multi-dep");
    expect(plan).toBeDefined();
    expect(plan!.deps).toEqual(["alpha.md", "beta.md"]);
  });

  it("returns undefined scope/deps when frontmatter has neither", () => {
    const slugDir = join(mockPipelineDirs.archiveDir, "no-meta");
    writePlan(join(slugDir, "no-meta.md"), PLAN_NO_SCOPE_NO_DEPS);

    const plans = loadPlans(uniqueCwd());
    const plan = plans.find((p) => p.slug === "no-meta");
    expect(plan).toBeDefined();
    expect(plan!.scope).toBeUndefined();
    expect(plan!.deps).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// loadPlansAsync — scope and deps for all plan states
// ---------------------------------------------------------------------------

describe("loadPlansAsync — scope and deps for all plan states", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ralphai-data-async-"));
    mockPipelineDirs = makePipelineDirs(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads scope and deps for backlog plans", async () => {
    writeFileSync(
      join(mockPipelineDirs.backlogDir, "async-plan.md"),
      PLAN_WITH_SCOPE_AND_DEPS,
    );

    const plans = await loadPlansAsync(uniqueCwd());
    const plan = plans.find((p) => p.slug === "async-plan");
    expect(plan).toBeDefined();
    expect(plan!.state).toBe("backlog");
    expect(plan!.scope).toBe("packages/web");
    expect(plan!.deps).toEqual(["setup.md", "infra.md"]);
  });

  it("loads scope and deps for in-progress plans", async () => {
    const slugDir = join(mockPipelineDirs.wipDir, "async-plan");
    writePlan(join(slugDir, "async-plan.md"), PLAN_WITH_SCOPE_AND_DEPS);

    const plans = await loadPlansAsync(uniqueCwd());
    const plan = plans.find((p) => p.slug === "async-plan");
    expect(plan).toBeDefined();
    expect(plan!.state).toBe("in-progress");
    expect(plan!.scope).toBe("packages/web");
    expect(plan!.deps).toEqual(["setup.md", "infra.md"]);
  });

  it("loads scope and deps for completed plans", async () => {
    const slugDir = join(mockPipelineDirs.archiveDir, "async-plan");
    writePlan(join(slugDir, "async-plan.md"), PLAN_WITH_SCOPE_AND_DEPS);

    const plans = await loadPlansAsync(uniqueCwd());
    const plan = plans.find((p) => p.slug === "async-plan");
    expect(plan).toBeDefined();
    expect(plan!.state).toBe("completed");
    expect(plan!.scope).toBe("packages/web");
    expect(plan!.deps).toEqual(["setup.md", "infra.md"]);
  });

  it("loads multiline deps for in-progress plans", async () => {
    const slugDir = join(mockPipelineDirs.wipDir, "multi-dep");
    writePlan(join(slugDir, "multi-dep.md"), PLAN_WITH_MULTILINE_DEPS);

    const plans = await loadPlansAsync(uniqueCwd());
    const plan = plans.find((p) => p.slug === "multi-dep");
    expect(plan).toBeDefined();
    expect(plan!.scope).toBe("packages/api");
    expect(plan!.deps).toEqual(["alpha.md", "beta.md"]);
  });

  it("returns undefined scope/deps when frontmatter has neither", async () => {
    const slugDir = join(mockPipelineDirs.archiveDir, "no-meta");
    writePlan(join(slugDir, "no-meta.md"), PLAN_NO_SCOPE_NO_DEPS);

    const plans = await loadPlansAsync(uniqueCwd());
    const plan = plans.find((p) => p.slug === "no-meta");
    expect(plan).toBeDefined();
    expect(plan!.scope).toBeUndefined();
    expect(plan!.deps).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// loadPlanContentAsync
// ---------------------------------------------------------------------------

describe("loadPlanContentAsync", () => {
  let tmpDir: string;
  let cwd: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ralphai-content-async-"));
    mockPipelineDirs = makePipelineDirs(tmpDir);
    cwd = uniqueCwd();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads backlog plan content asynchronously", async () => {
    writeFileSync(
      join(mockPipelineDirs.backlogDir, "test-plan.md"),
      PLAN_WITH_SCOPE_AND_DEPS,
    );

    const plan: PlanInfo = {
      filename: "test-plan.md",
      slug: "test-plan",
      state: "backlog",
    };

    const content = await loadPlanContentAsync(cwd, plan);
    expect(content).toBe(PLAN_WITH_SCOPE_AND_DEPS);
  });

  it("reads in-progress plan content asynchronously", async () => {
    const slugDir = join(mockPipelineDirs.wipDir, "wip-plan");
    writePlan(join(slugDir, "wip-plan.md"), PLAN_WITH_MULTILINE_DEPS);

    const plan: PlanInfo = {
      filename: "wip-plan.md",
      slug: "wip-plan",
      state: "in-progress",
    };

    const content = await loadPlanContentAsync(cwd, plan);
    expect(content).toBe(PLAN_WITH_MULTILINE_DEPS);
  });

  it("reads completed plan content asynchronously", async () => {
    const slugDir = join(mockPipelineDirs.archiveDir, "done-plan");
    writePlan(join(slugDir, "done-plan.md"), PLAN_NO_SCOPE_NO_DEPS);

    const plan: PlanInfo = {
      filename: "done-plan.md",
      slug: "done-plan",
      state: "completed",
    };

    const content = await loadPlanContentAsync(cwd, plan);
    expect(content).toBe(PLAN_NO_SCOPE_NO_DEPS);
  });

  it("returns null for non-existent plan file", async () => {
    const plan: PlanInfo = {
      filename: "ghost.md",
      slug: "ghost",
      state: "backlog",
    };

    const content = await loadPlanContentAsync(cwd, plan);
    expect(content).toBeNull();
  });

  it("returns same content as sync loadPlanContent", async () => {
    writeFileSync(
      join(mockPipelineDirs.backlogDir, "sync-check.md"),
      PLAN_WITH_SCOPE_AND_DEPS,
    );

    const plan: PlanInfo = {
      filename: "sync-check.md",
      slug: "sync-check",
      state: "backlog",
    };

    // Use same cwd so both functions resolve the same dirs
    const syncContent = loadPlanContent(cwd, plan);
    const asyncContent = await loadPlanContentAsync(cwd, plan);
    expect(asyncContent).toBe(syncContent);
  });
});
