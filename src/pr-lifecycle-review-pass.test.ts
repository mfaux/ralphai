import { describe, it, expect } from "bun:test";
import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";
import { useTempDir } from "./test-utils.ts";
import { buildPrBody } from "./pr-lifecycle.ts";

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
// buildPrBody — review pass annotation
// ---------------------------------------------------------------------------

describe("buildPrBody reviewPassMadeChanges", () => {
  const ctx = useTempDir();

  it("includes review pass note when reviewPassMadeChanges is true", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody("Test plan", "main", "feature", ctx.dir, {
      reviewPassMadeChanges: true,
    });
    expect(body).toContain(
      "A review pass was run to simplify the implementation.",
    );
  });

  it("omits review pass note when reviewPassMadeChanges is false", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody("Test plan", "main", "feature", ctx.dir, {
      reviewPassMadeChanges: false,
    });
    expect(body).not.toContain("review pass");
  });

  it("omits review pass note when reviewPassMadeChanges is not provided", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody("Test plan", "main", "feature", ctx.dir);
    expect(body).not.toContain("review pass");
  });

  it("omits review pass note when options is undefined", () => {
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
    expect(body).not.toContain("review pass");
  });

  it("places review pass note after Changes section", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody("Test plan", "main", "feature", ctx.dir, {
      reviewPassMadeChanges: true,
    });
    const changesIdx = body.indexOf("## Changes");
    const reviewIdx = body.indexOf("review pass was run");
    expect(changesIdx).toBeGreaterThan(-1);
    expect(reviewIdx).toBeGreaterThan(-1);
    expect(changesIdx).toBeLessThan(reviewIdx);
  });

  it("places review pass note after learnings when both present", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody("Test plan", "main", "feature", ctx.dir, {
      learnings: ["A lesson learned"],
      reviewPassMadeChanges: true,
    });
    const learningsIdx = body.indexOf("## Learnings");
    const reviewIdx = body.indexOf("review pass was run");
    expect(learningsIdx).toBeGreaterThan(-1);
    expect(reviewIdx).toBeGreaterThan(-1);
    expect(learningsIdx).toBeLessThan(reviewIdx);
  });

  it("works alongside all other options", () => {
    initRepo(ctx.dir);
    execSync("git checkout -b feature", { cwd: ctx.dir, stdio: "ignore" });
    commitFile(ctx.dir, "a.txt", "a", "feat: add feature");

    const body = buildPrBody("Test plan", "main", "feature", ctx.dir, {
      summary: "A great summary.",
      prd: 42,
      issueRepo: "org/repo",
      issueNumber: 99,
      learnings: ["A lesson"],
      reviewPassMadeChanges: true,
    });
    expect(body).toContain("A great summary.");
    expect(body).toContain("**PRD:** org/repo#42");
    expect(body).toContain("Closes #99");
    expect(body).toContain("## Changes");
    expect(body).toContain("## Learnings");
    expect(body).toContain(
      "A review pass was run to simplify the implementation.",
    );
  });
});
