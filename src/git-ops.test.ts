import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { useTempDir } from "./test-utils.ts";
import {
  isTreeDirty,
  branchHasOpenWork,
  validateBaseBranch,
  getCurrentCommitHash,
  getWorkingTreeDiffHash,
} from "./git-ops.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Initialize a git repo with one commit so HEAD exists. */
function initRepo(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "ignore" });
  execSync('git config user.email "test@test.com"', {
    cwd: dir,
    stdio: "ignore",
  });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "ignore" });
  writeFileSync(join(dir, "init.txt"), "init\n");
  execSync("git add -A && git commit -m 'init'", {
    cwd: dir,
    stdio: "ignore",
  });
}

// ---------------------------------------------------------------------------
// isTreeDirty
// ---------------------------------------------------------------------------

describe("isTreeDirty", () => {
  const ctx = useTempDir();

  it("returns false for a clean repo", () => {
    initRepo(ctx.dir);
    expect(isTreeDirty(ctx.dir)).toBe(false);
  });

  it("returns true for unstaged changes", () => {
    initRepo(ctx.dir);
    writeFileSync(join(ctx.dir, "init.txt"), "modified\n");
    expect(isTreeDirty(ctx.dir)).toBe(true);
  });

  it("returns true for staged changes", () => {
    initRepo(ctx.dir);
    writeFileSync(join(ctx.dir, "staged.txt"), "new\n");
    execSync("git add staged.txt", { cwd: ctx.dir, stdio: "ignore" });
    expect(isTreeDirty(ctx.dir)).toBe(true);
  });

  it("returns true for untracked files", () => {
    initRepo(ctx.dir);
    writeFileSync(join(ctx.dir, "untracked.txt"), "new\n");
    expect(isTreeDirty(ctx.dir)).toBe(true);
  });

  it("excludes .ralphai directory from dirty check", () => {
    initRepo(ctx.dir);
    mkdirSync(join(ctx.dir, ".ralphai"), { recursive: true });
    writeFileSync(join(ctx.dir, ".ralphai", "something.txt"), "data\n");
    expect(isTreeDirty(ctx.dir)).toBe(false);
  });

  it("excludes ralphai.json from untracked check", () => {
    initRepo(ctx.dir);
    writeFileSync(join(ctx.dir, "ralphai.json"), "{}");
    expect(isTreeDirty(ctx.dir)).toBe(false);
  });

  it("detects modified committed ralphai.json as dirty", () => {
    initRepo(ctx.dir);
    // Commit ralphai.json first
    writeFileSync(join(ctx.dir, "ralphai.json"), '{"v":1}');
    execSync("git add ralphai.json && git commit -m 'add config'", {
      cwd: ctx.dir,
      stdio: "ignore",
    });
    // Now modify it
    writeFileSync(join(ctx.dir, "ralphai.json"), '{"v":2}');
    expect(isTreeDirty(ctx.dir)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// branchHasOpenWork
// ---------------------------------------------------------------------------

describe("branchHasOpenWork", () => {
  const ctx = useTempDir();

  it("returns no collision for a nonexistent branch", () => {
    initRepo(ctx.dir);
    const result = branchHasOpenWork("ralphai/nonexistent", ctx.dir);
    expect(result.collision).toBe(false);
    expect(result.reason).toBe("");
  });

  it("returns collision for an existing local branch", () => {
    initRepo(ctx.dir);
    execSync("git branch ralphai/test-branch", {
      cwd: ctx.dir,
      stdio: "ignore",
    });
    const result = branchHasOpenWork("ralphai/test-branch", ctx.dir);
    expect(result.collision).toBe(true);
    expect(result.reason).toContain("Local branch");
    expect(result.reason).toContain("ralphai/test-branch");
  });
});

// ---------------------------------------------------------------------------
// validateBaseBranch
// ---------------------------------------------------------------------------

describe("validateBaseBranch", () => {
  const ctx = useTempDir();

  it("returns null for an existing branch", () => {
    initRepo(ctx.dir);
    // Default branch after init
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: ctx.dir,
      encoding: "utf-8",
    }).trim();
    expect(validateBaseBranch(branch, ctx.dir)).toBeNull();
  });

  it("returns error message for a missing branch", () => {
    initRepo(ctx.dir);
    const result = validateBaseBranch("nonexistent-branch", ctx.dir);
    expect(result).not.toBeNull();
    expect(result).toContain("nonexistent-branch");
    expect(result).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// getCurrentCommitHash
// ---------------------------------------------------------------------------

describe("getCurrentCommitHash", () => {
  const ctx = useTempDir();

  it("returns a valid SHA for a repo with commits", () => {
    initRepo(ctx.dir);
    const hash = getCurrentCommitHash(ctx.dir);
    expect(hash).not.toBeNull();
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it("returns null for a directory that is not a repo", () => {
    const hash = getCurrentCommitHash(ctx.dir);
    expect(hash).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getWorkingTreeDiffHash
// ---------------------------------------------------------------------------

describe("getWorkingTreeDiffHash", () => {
  const ctx = useTempDir();

  it("returns a consistent hash for a clean repo", () => {
    initRepo(ctx.dir);
    const hash1 = getWorkingTreeDiffHash(ctx.dir);
    const hash2 = getWorkingTreeDiffHash(ctx.dir);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns a different hash after modifying a file", () => {
    initRepo(ctx.dir);
    const hash1 = getWorkingTreeDiffHash(ctx.dir);
    writeFileSync(join(ctx.dir, "init.txt"), "changed\n");
    const hash2 = getWorkingTreeDiffHash(ctx.dir);
    expect(hash1).not.toBe(hash2);
  });

  it("returns same hash as before after reverting changes", () => {
    initRepo(ctx.dir);
    const hash1 = getWorkingTreeDiffHash(ctx.dir);
    writeFileSync(join(ctx.dir, "init.txt"), "changed\n");
    // Revert
    execSync("git checkout -- init.txt", { cwd: ctx.dir, stdio: "ignore" });
    const hash2 = getWorkingTreeDiffHash(ctx.dir);
    expect(hash1).toBe(hash2);
  });
});
