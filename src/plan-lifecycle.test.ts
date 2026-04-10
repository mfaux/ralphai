/**
 * Boundary tests for plan-lifecycle.ts facade.
 *
 * Verifies that every public function and type re-exported through the
 * facade is the same reference as the original module's export. This
 * catches missing or stale re-exports without duplicating the exhaustive
 * behavior tests that already exist in each module's own test file.
 */
import { describe, it, expect } from "bun:test";

// Import everything from the facade
import * as facade from "./plan-lifecycle.ts";

// Import originals from each underlying module
import * as planDetection from "./plan-detection.ts";
import * as frontmatter from "./frontmatter.ts";
import * as receipt from "./receipt.ts";
import * as globalState from "./global-state.ts";
import * as pipelineState from "./pipeline-state.ts";

// ---------------------------------------------------------------------------
// plan-detection.ts re-exports
// ---------------------------------------------------------------------------

describe("plan-lifecycle facade — plan-detection", () => {
  it("re-exports listPlanFolders", () => {
    expect(facade.listPlanFolders).toBe(planDetection.listPlanFolders);
  });

  it("re-exports planPathForSlug", () => {
    expect(facade.planPathForSlug).toBe(planDetection.planPathForSlug);
  });

  it("re-exports listPlanSlugs", () => {
    expect(facade.listPlanSlugs).toBe(planDetection.listPlanSlugs);
  });

  it("re-exports listPlanFiles", () => {
    expect(facade.listPlanFiles).toBe(planDetection.listPlanFiles);
  });

  it("re-exports resolvePlanPath", () => {
    expect(facade.resolvePlanPath).toBe(planDetection.resolvePlanPath);
  });

  it("re-exports planExistsForSlug", () => {
    expect(facade.planExistsForSlug).toBe(planDetection.planExistsForSlug);
  });

  it("re-exports detectPlanFormat", () => {
    expect(facade.detectPlanFormat).toBe(planDetection.detectPlanFormat);
  });

  it("re-exports countPlanTasksFromContent", () => {
    expect(facade.countPlanTasksFromContent).toBe(
      planDetection.countPlanTasksFromContent,
    );
  });

  it("re-exports countPlanTasks", () => {
    expect(facade.countPlanTasks).toBe(planDetection.countPlanTasks);
  });

  it("re-exports countCompletedFromProgress", () => {
    expect(facade.countCompletedFromProgress).toBe(
      planDetection.countCompletedFromProgress,
    );
  });

  it("re-exports countCompletedTasks", () => {
    expect(facade.countCompletedTasks).toBe(planDetection.countCompletedTasks);
  });

  it("re-exports collectBacklogPlans", () => {
    expect(facade.collectBacklogPlans).toBe(planDetection.collectBacklogPlans);
  });

  it("re-exports checkDependencyStatus", () => {
    expect(facade.checkDependencyStatus).toBe(
      planDetection.checkDependencyStatus,
    );
  });

  it("re-exports planReadiness", () => {
    expect(facade.planReadiness).toBe(planDetection.planReadiness);
  });

  it("re-exports getPlanDescription", () => {
    expect(facade.getPlanDescription).toBe(planDetection.getPlanDescription);
  });

  it("re-exports detectPlan", () => {
    expect(facade.detectPlan).toBe(planDetection.detectPlan);
  });
});

// ---------------------------------------------------------------------------
// frontmatter.ts re-exports
// ---------------------------------------------------------------------------

describe("plan-lifecycle facade — frontmatter", () => {
  it("re-exports extractScope", () => {
    expect(facade.extractScope).toBe(frontmatter.extractScope);
  });

  it("re-exports extractDependsOn", () => {
    expect(facade.extractDependsOn).toBe(frontmatter.extractDependsOn);
  });

  it("re-exports extractFeedbackScope", () => {
    expect(facade.extractFeedbackScope).toBe(frontmatter.extractFeedbackScope);
  });

  it("re-exports extractIssueFrontmatter", () => {
    expect(facade.extractIssueFrontmatter).toBe(
      frontmatter.extractIssueFrontmatter,
    );
  });

  it("re-exports parseFrontmatter", () => {
    expect(facade.parseFrontmatter).toBe(frontmatter.parseFrontmatter);
  });
});

// ---------------------------------------------------------------------------
// receipt.ts re-exports
// ---------------------------------------------------------------------------

describe("plan-lifecycle facade — receipt", () => {
  it("re-exports resolveReceiptPath", () => {
    expect(facade.resolveReceiptPath).toBe(receipt.resolveReceiptPath);
  });

  it("re-exports parseReceipt", () => {
    expect(facade.parseReceipt).toBe(receipt.parseReceipt);
  });

  it("re-exports initReceipt", () => {
    expect(facade.initReceipt).toBe(receipt.initReceipt);
  });

  it("re-exports updateReceiptTasks", () => {
    expect(facade.updateReceiptTasks).toBe(receipt.updateReceiptTasks);
  });

  it("re-exports updateReceiptPrUrl", () => {
    expect(facade.updateReceiptPrUrl).toBe(receipt.updateReceiptPrUrl);
  });

  it("re-exports updateReceiptOutcome", () => {
    expect(facade.updateReceiptOutcome).toBe(receipt.updateReceiptOutcome);
  });

  it("re-exports findPlansByBranch", () => {
    expect(facade.findPlansByBranch).toBe(receipt.findPlansByBranch);
  });

  it("re-exports checkReceiptSource", () => {
    expect(facade.checkReceiptSource).toBe(receipt.checkReceiptSource);
  });
});

// ---------------------------------------------------------------------------
// global-state.ts re-exports
// ---------------------------------------------------------------------------

describe("plan-lifecycle facade — global-state", () => {
  it("re-exports getRalphaiHome", () => {
    expect(facade.getRalphaiHome).toBe(globalState.getRalphaiHome);
  });

  it("re-exports getRepoId", () => {
    expect(facade.getRepoId).toBe(globalState.getRepoId);
  });

  it("re-exports resolveRepoStateDir", () => {
    expect(facade.resolveRepoStateDir).toBe(globalState.resolveRepoStateDir);
  });

  it("re-exports ensureRepoStateDir", () => {
    expect(facade.ensureRepoStateDir).toBe(globalState.ensureRepoStateDir);
  });

  it("re-exports getRepoPipelineDirs", () => {
    expect(facade.getRepoPipelineDirs).toBe(globalState.getRepoPipelineDirs);
  });

  it("re-exports listAllRepos", () => {
    expect(facade.listAllRepos).toBe(globalState.listAllRepos);
  });

  it("re-exports resolveRepoByNameOrPath", () => {
    expect(facade.resolveRepoByNameOrPath).toBe(
      globalState.resolveRepoByNameOrPath,
    );
  });

  it("re-exports removeStaleRepos", () => {
    expect(facade.removeStaleRepos).toBe(globalState.removeStaleRepos);
  });
});

// ---------------------------------------------------------------------------
// pipeline-state.ts re-exports
// ---------------------------------------------------------------------------

describe("plan-lifecycle facade — pipeline-state", () => {
  it("re-exports gatherPipelineState", () => {
    expect(facade.gatherPipelineState).toBe(pipelineState.gatherPipelineState);
  });
});

// ---------------------------------------------------------------------------
// Completeness check — every runtime export from underlying modules
// must appear in the facade.
// ---------------------------------------------------------------------------

describe("plan-lifecycle facade — completeness", () => {
  const facadeKeys = new Set(Object.keys(facade));

  for (const [label, mod] of [
    ["plan-detection", planDetection],
    ["frontmatter", frontmatter],
    ["receipt", receipt],
    ["global-state", globalState],
    ["pipeline-state", pipelineState],
  ] as const) {
    for (const key of Object.keys(mod)) {
      it(`includes ${label}.${key}`, () => {
        expect(facadeKeys.has(key)).toBe(true);
      });
    }
  }
});
