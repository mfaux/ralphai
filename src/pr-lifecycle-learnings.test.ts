import { describe, it, expect } from "bun:test";
import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";
import { useTempDir } from "./test-utils.ts";
import {
  buildPrBody,
  buildContinuousPrBodyStructured,
} from "./pr-lifecycle.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initRepo(dir: string): void {
  execSync("git init -b main", { cwd: dir, stdio: "ignore" });
  execSync('git config user.email "test@test.com"', {
    cwd: dir,
    stdio: "ignore",
  });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "ignore" });
  writeFileSync(join(dir, "init.txt"), "init\n");
  execSync('git add -A && git commit -m "init"', {
    cwd: dir,
    stdio: "ignore",
  });
}

function commitFile(
  dir: string,
  filename: string,
  content: string,
  message: string,
): void {
  writeFileSync(join(dir, filename), content);
  execSync(`git add -A && git commit -m "${message}"`, {
    cwd: dir,
    stdio: "ignore",
  });
}

// ---------------------------------------------------------------------------
// buildPrBody — learnings section
// ---------------------------------------------------------------------------

describe("buildPrBody learnings", () => {
  const ctx = useTempDir();

  it("appends ## Learnings section with bullet points when learnings provided", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody("Test plan", "main", "feature", ctx.dir, {
      learnings: [
        "Always validate inputs before processing",
        "Use path.join() for cross-platform paths",
      ],
    });
    expect(body).toContain("## Learnings");
    expect(body).toContain("- Always validate inputs before processing");
    expect(body).toContain("- Use path.join() for cross-platform paths");
  });

  it("places learnings section after Changes section", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody("Test plan", "main", "feature", ctx.dir, {
      learnings: ["A lesson learned"],
    });
    const changesIdx = body.indexOf("## Changes");
    const learningsIdx = body.indexOf("## Learnings");
    expect(changesIdx).toBeGreaterThan(-1);
    expect(learningsIdx).toBeGreaterThan(-1);
    expect(changesIdx).toBeLessThan(learningsIdx);
  });

  it("omits learnings section when learnings is empty array", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody("Test plan", "main", "feature", ctx.dir, {
      learnings: [],
    });
    expect(body).not.toContain("## Learnings");
  });

  it("omits learnings section when learnings not provided", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody("Test plan", "main", "feature", ctx.dir);
    expect(body).not.toContain("## Learnings");
  });

  it("omits learnings section when options is undefined", () => {
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
    expect(body).not.toContain("## Learnings");
  });
});

// ---------------------------------------------------------------------------
// buildContinuousPrBodyStructured — learnings section
// ---------------------------------------------------------------------------

describe("buildContinuousPrBodyStructured learnings", () => {
  const ctx = useTempDir();

  it("appends ## Learnings section with bullet points when learnings provided", () => {
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
        learnings: [
          "Bun test runner lacks vi.setSystemTime",
          "Always use importOriginal in vi.mock factories",
        ],
      },
    );
    expect(body).toContain("## Learnings");
    expect(body).toContain("- Bun test runner lacks vi.setSystemTime");
    expect(body).toContain("- Always use importOriginal in vi.mock factories");
  });

  it("places learnings section after Changes section", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: implement plan A");

    const body = buildContinuousPrBodyStructured(
      ["plan-a"],
      [],
      "main",
      "feature",
      ctx.dir,
      { learnings: ["A lesson learned"] },
    );
    const changesIdx = body.indexOf("## Changes");
    const learningsIdx = body.indexOf("## Learnings");
    expect(changesIdx).toBeGreaterThan(-1);
    expect(learningsIdx).toBeGreaterThan(-1);
    expect(changesIdx).toBeLessThan(learningsIdx);
  });

  it("omits learnings section when learnings is empty array", () => {
    initRepo(ctx.dir);
    const body = buildContinuousPrBodyStructured(
      ["plan-a"],
      [],
      "main",
      "main",
      ctx.dir,
      { learnings: [] },
    );
    expect(body).not.toContain("## Learnings");
  });

  it("omits learnings section when learnings not provided", () => {
    initRepo(ctx.dir);
    const body = buildContinuousPrBodyStructured(
      ["plan-a"],
      [],
      "main",
      "main",
      ctx.dir,
    );
    expect(body).not.toContain("## Learnings");
  });

  it("includes learnings alongside all other sections", () => {
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

    // Verify ordering: Changes before Learnings (Learnings is last)
    const changesIdx = body.indexOf("## Changes");
    const learningsIdx = body.indexOf("## Learnings");
    expect(changesIdx).toBeLessThan(learningsIdx);
  });
});
