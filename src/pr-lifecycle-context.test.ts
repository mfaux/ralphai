import { describe, it, expect } from "bun:test";
import { execSync } from "child_process";
import { useTempDir, initRepo, commitFile } from "./test-utils.ts";
import {
  buildPrBody,
  buildContinuousPrBodyStructured,
  buildPrdPrBody,
} from "./pr-lifecycle.ts";

// ---------------------------------------------------------------------------
// buildPrBody — context section
// ---------------------------------------------------------------------------

describe("buildPrBody context", () => {
  const ctx = useTempDir();

  it("appends a collapsed <details> block when context is non-empty", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody("Test plan", "main", "feature", ctx.dir, {
      context: [
        "Refactored auth module to use JWT",
        "Skipped migration — not needed for this change",
      ],
    });
    expect(body).toContain("<details><summary>Session context</summary>");
    expect(body).toContain("- Refactored auth module to use JWT");
    expect(body).toContain("- Skipped migration — not needed for this change");
    expect(body).toContain("</details>");
  });

  it("places context section after learnings section", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody("Test plan", "main", "feature", ctx.dir, {
      learnings: ["A lesson learned"],
      context: ["Some session context"],
    });
    const learningsIdx = body.indexOf("## Learnings");
    const contextIdx = body.indexOf("<details><summary>Session context");
    expect(learningsIdx).toBeGreaterThan(-1);
    expect(contextIdx).toBeGreaterThan(-1);
    expect(learningsIdx).toBeLessThan(contextIdx);
  });

  it("places context after Changes when no learnings are present", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody("Test plan", "main", "feature", ctx.dir, {
      context: ["Some session context"],
    });
    const changesIdx = body.indexOf("## Changes");
    const contextIdx = body.indexOf("<details><summary>Session context");
    expect(changesIdx).toBeGreaterThan(-1);
    expect(contextIdx).toBeGreaterThan(-1);
    expect(changesIdx).toBeLessThan(contextIdx);
    expect(body).not.toContain("## Learnings");
  });

  it("omits context block when context is empty array", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody("Test plan", "main", "feature", ctx.dir, {
      context: [],
    });
    expect(body).not.toContain("<details>");
    expect(body).not.toContain("Session context");
  });

  it("omits context block when context not provided", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody("Test plan", "main", "feature", ctx.dir);
    expect(body).not.toContain("<details>");
    expect(body).not.toContain("Session context");
  });

  it("omits context block when options is undefined", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody(
      "Test plan",
      "main",
      "feature",
      ctx.dir,
      undefined,
    );
    expect(body).not.toContain("<details>");
    expect(body).not.toContain("Session context");
  });
});

// ---------------------------------------------------------------------------
// buildContinuousPrBodyStructured — context section
// ---------------------------------------------------------------------------

describe("buildContinuousPrBodyStructured context", () => {
  const ctx = useTempDir();

  it("appends a collapsed <details> block when context is non-empty", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: implement plan A");

    const body = buildContinuousPrBodyStructured(
      ["plan-a"],
      ["plan-b.md"],
      "main",
      "feature",
      ctx.dir,
      {
        context: [
          "Used workaround for flaky CI test",
          "Deferred database index to follow-up",
        ],
      },
    );
    expect(body).toContain("<details><summary>Session context</summary>");
    expect(body).toContain("- Used workaround for flaky CI test");
    expect(body).toContain("- Deferred database index to follow-up");
    expect(body).toContain("</details>");
  });

  it("places context section after learnings section", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: implement plan A");

    const body = buildContinuousPrBodyStructured(
      ["plan-a"],
      [],
      "main",
      "feature",
      ctx.dir,
      {
        learnings: ["A lesson learned"],
        context: ["Some session context"],
      },
    );
    const learningsIdx = body.indexOf("## Learnings");
    const contextIdx = body.indexOf("<details><summary>Session context");
    expect(learningsIdx).toBeGreaterThan(-1);
    expect(contextIdx).toBeGreaterThan(-1);
    expect(learningsIdx).toBeLessThan(contextIdx);
  });

  it("places context after Changes when no learnings are present", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: implement plan A");

    const body = buildContinuousPrBodyStructured(
      ["plan-a"],
      [],
      "main",
      "feature",
      ctx.dir,
      { context: ["Some session context"] },
    );
    const changesIdx = body.indexOf("## Changes");
    const contextIdx = body.indexOf("<details><summary>Session context");
    expect(changesIdx).toBeGreaterThan(-1);
    expect(contextIdx).toBeGreaterThan(-1);
    expect(changesIdx).toBeLessThan(contextIdx);
    expect(body).not.toContain("## Learnings");
  });

  it("omits context block when context is empty array", () => {
    initRepo(ctx.dir);
    const body = buildContinuousPrBodyStructured(
      ["plan-a"],
      [],
      "main",
      "main",
      ctx.dir,
      { context: [] },
    );
    expect(body).not.toContain("<details>");
    expect(body).not.toContain("Session context");
  });

  it("omits context block when context not provided", () => {
    initRepo(ctx.dir);
    const body = buildContinuousPrBodyStructured(
      ["plan-a"],
      [],
      "main",
      "main",
      ctx.dir,
    );
    expect(body).not.toContain("<details>");
    expect(body).not.toContain("Session context");
  });

  it("includes context alongside all other sections", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: implement plan A");

    const body = buildContinuousPrBodyStructured(
      ["plan-a"],
      ["plan-b.md"],
      "main",
      "feature",
      ctx.dir,
      {
        prdNumber: 146,
        summary: "Implement metrics dashboard.",
        learnings: ["Validate all inputs"],
        context: ["Skipped optional migration"],
      },
    );
    // All sections should be present
    expect(body).toContain("Implement metrics dashboard.");
    expect(body).toContain("Closes #146");
    expect(body).toContain("## Completed Plans");
    expect(body).toContain("- [x] plan-a");
    expect(body).toContain("## Remaining Plans");
    expect(body).toContain("- [ ] plan-b.md");
    expect(body).toContain("## Changes");
    expect(body).toContain("## Learnings");
    expect(body).toContain("- Validate all inputs");
    expect(body).toContain("<details><summary>Session context</summary>");
    expect(body).toContain("- Skipped optional migration");

    // Verify ordering: Changes < Learnings < Context
    const changesIdx = body.indexOf("## Changes");
    const learningsIdx = body.indexOf("## Learnings");
    const contextIdx = body.indexOf("<details><summary>Session context");
    expect(changesIdx).toBeLessThan(learningsIdx);
    expect(learningsIdx).toBeLessThan(contextIdx);
  });
});

// ---------------------------------------------------------------------------
// buildPrdPrBody — must NOT accept or render context
// ---------------------------------------------------------------------------

describe("buildPrdPrBody does not render context", () => {
  const ctx = useTempDir();

  it("does not include a context details block in the body", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: implement sub-issue #10");

    const body = buildPrdPrBody({
      prd: { number: 100, title: "Parent PRD" },
      completedSubIssues: [10],
      stuckSubIssues: [],
      baseBranch: "main",
      headBranch: "feature",
      cwd: ctx.dir,
      learnings: ["A lesson from sub-issue runs"],
    });
    // Learnings should still be present (they are aggregated)
    expect(body).toContain("## Learnings");
    expect(body).toContain("- A lesson from sub-issue runs");
    // Context must NOT appear
    expect(body).not.toContain("<details>");
    expect(body).not.toContain("Session context");
  });
});
