import { describe, it, expect, vi } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { useTempDir } from "./test-utils.ts";
import {
  parseReceipt,
  initReceipt,
  updateReceiptTasks,
  resolveReceiptPath,
  checkReceiptSource,
  findPlansByBranch,
  type Receipt,
} from "./receipt.ts";

// ---------------------------------------------------------------------------
// resolveReceiptPath
// ---------------------------------------------------------------------------

describe("resolveReceiptPath", () => {
  it("returns correct path for a plan slug", () => {
    const result = resolveReceiptPath("/repo/.ralphai", "my-plan");
    expect(result).toBe(
      join(
        "/repo/.ralphai",
        "pipeline",
        "in-progress",
        "my-plan",
        "receipt.txt",
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// parseReceipt
// ---------------------------------------------------------------------------

describe("parseReceipt", () => {
  const ctx = useTempDir();

  it("returns null for missing file", () => {
    expect(parseReceipt(join(ctx.dir, "nonexistent.txt"))).toBeNull();
  });

  it("parses a valid receipt file", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    writeFileSync(
      receiptPath,
      [
        "started_at=2025-06-15T10:30:00Z",
        "worktree_path=/tmp/wt",
        "branch=feat/dark-mode",
        "slug=dark-mode",
        "plan_file=dark-mode.md",
        "tasks_completed=2",
        "outcome=success",
      ].join("\n") + "\n",
    );

    const receipt = parseReceipt(receiptPath);
    expect(receipt).not.toBeNull();
    expect(receipt!.started_at).toBe("2025-06-15T10:30:00Z");
    expect(receipt!.worktree_path).toBe("/tmp/wt");
    expect(receipt!.branch).toBe("feat/dark-mode");
    expect(receipt!.slug).toBe("dark-mode");
    expect(receipt!.plan_file).toBe("dark-mode.md");
    expect(receipt!.tasks_completed).toBe(2);
    expect(receipt!.outcome).toBe("success");
  });

  it("handles malformed lines gracefully", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    writeFileSync(
      receiptPath,
      [
        "started_at=2025-01-01T00:00:00Z",
        "no-equals-sign-here",
        "",
        "slug=test",
        "=empty-key-ignored",
      ].join("\n"),
    );

    const receipt = parseReceipt(receiptPath);
    expect(receipt).not.toBeNull();
    expect(receipt!.started_at).toBe("2025-01-01T00:00:00Z");
    expect(receipt!.slug).toBe("test");
    expect(receipt!.branch).toBe("");
    expect(receipt!.tasks_completed).toBe(0);
  });

  it("returns tasks_completed: 0 for non-numeric values (NaN guard)", () => {
    const receiptPath = join(ctx.dir, "receipt-nan.txt");
    writeFileSync(
      receiptPath,
      [
        "started_at=2025-01-01T00:00:00Z",
        "branch=main",
        "slug=test",
        "tasks_completed=abc",
      ].join("\n") + "\n",
    );

    const receipt = parseReceipt(receiptPath);
    expect(receipt).not.toBeNull();
    expect(receipt!.tasks_completed).toBe(0);
  });

  it("handles receipt without optional fields", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    writeFileSync(
      receiptPath,
      [
        "started_at=2025-01-01T00:00:00Z",
        "branch=main",
        "slug=test",
        "tasks_completed=0",
      ].join("\n") + "\n",
    );

    const receipt = parseReceipt(receiptPath);
    expect(receipt).not.toBeNull();
    expect(receipt!.worktree_path).toBeUndefined();
    expect(receipt!.plan_file).toBeUndefined();
    expect(receipt!.outcome).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// initReceipt
// ---------------------------------------------------------------------------

describe("initReceipt", () => {
  const ctx = useTempDir();

  it("creates a valid receipt file", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    initReceipt(receiptPath, {
      branch: "feat/my-feature",
      slug: "my-feature",
      plan_file: "my-feature.md",
    });

    const content = readFileSync(receiptPath, "utf-8");
    expect(content).toContain("started_at=");
    expect(content).toContain("branch=feat/my-feature");
    expect(content).toContain("slug=my-feature");
    expect(content).toContain("plan_file=my-feature.md");
    expect(content).toContain("tasks_completed=0");
  });

  it("includes worktree_path when provided", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    initReceipt(receiptPath, {
      worktree_path: "/tmp/my-worktree",
      branch: "feat/wt",
      slug: "wt-plan",
      plan_file: "wt-plan.md",
    });

    const content = readFileSync(receiptPath, "utf-8");
    expect(content).toContain("worktree_path=/tmp/my-worktree");
  });

  it("omits worktree_path when not provided", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    initReceipt(receiptPath, {
      branch: "main",
      slug: "test",
      plan_file: "test.md",
    });

    const content = readFileSync(receiptPath, "utf-8");
    expect(content).not.toContain("worktree_path=");
  });

  it("generates a valid ISO timestamp", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    initReceipt(receiptPath, {
      branch: "main",
      slug: "test",
      plan_file: "test.md",
    });

    const content = readFileSync(receiptPath, "utf-8");
    const match = content.match(/^started_at=(.+)$/m);
    expect(match).not.toBeNull();
    // Should be a valid ISO date ending in Z (no milliseconds)
    expect(match![1]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: initReceipt -> parseReceipt
// ---------------------------------------------------------------------------

describe("receipt round-trip", () => {
  const ctx = useTempDir();

  it("init then parse returns matching fields", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    initReceipt(receiptPath, {
      worktree_path: "/home/user/wt",
      branch: "feat/round-trip",
      slug: "round-trip",
      plan_file: "round-trip.md",
    });

    const receipt = parseReceipt(receiptPath);
    expect(receipt).not.toBeNull();
    expect(receipt!.worktree_path).toBe("/home/user/wt");
    expect(receipt!.branch).toBe("feat/round-trip");
    expect(receipt!.slug).toBe("round-trip");
    expect(receipt!.plan_file).toBe("round-trip.md");
    expect(receipt!.tasks_completed).toBe(0);
    expect(receipt!.outcome).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// updateReceiptTasks
// ---------------------------------------------------------------------------

describe("updateReceiptTasks", () => {
  const ctx = useTempDir();

  it("counts individual Status Complete markers", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    const progressPath = join(ctx.dir, "progress.md");
    writeFileSync(receiptPath, "tasks_completed=0\n");
    writeFileSync(
      progressPath,
      [
        "## Progress",
        "",
        "### Task 1: A",
        "**Status:** Complete",
        "",
        "### Task 2: B",
        "**Status:** Complete",
      ].join("\n"),
    );

    updateReceiptTasks(receiptPath, progressPath);

    const content = readFileSync(receiptPath, "utf-8");
    expect(content).toContain("tasks_completed=2");
  });

  it("counts batch heading Tasks X-Y plus Status Complete", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    const progressPath = join(ctx.dir, "progress.md");
    writeFileSync(receiptPath, "tasks_completed=0\n");
    writeFileSync(
      progressPath,
      ["## Progress", "", "### Tasks 1-3: Batch", "**Status:** Complete"].join(
        "\n",
      ),
    );

    updateReceiptTasks(receiptPath, progressPath);

    const content = readFileSync(receiptPath, "utf-8");
    // 3 from batch (1-3) + 1 from Status Complete = 4
    expect(content).toContain("tasks_completed=4");
  });

  it("counts batch heading with en-dash", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    const progressPath = join(ctx.dir, "progress.md");
    writeFileSync(receiptPath, "tasks_completed=0\n");
    writeFileSync(
      progressPath,
      "## Progress\n\n### Tasks 5\u20138: Later batch\n",
    );

    updateReceiptTasks(receiptPath, progressPath);

    const content = readFileSync(receiptPath, "utf-8");
    // 8 - 5 + 1 = 4 from batch, no Status Complete
    expect(content).toContain("tasks_completed=4");
  });

  it("does not count Tasks X-Y in prose body text", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    const progressPath = join(ctx.dir, "progress.md");
    writeFileSync(receiptPath, "tasks_completed=0\n");
    writeFileSync(
      progressPath,
      [
        "## Progress",
        "",
        "### Task 1: Refactor",
        "**Status:** Complete",
        "",
        "Refactored validation. CLI parsing moves in Tasks 3-4.",
        "",
        "### Task 2: Extract",
        "**Status:** Complete",
        "",
        "Remaining size includes show-config which moves in Tasks 3-4.",
      ].join("\n"),
    );

    updateReceiptTasks(receiptPath, progressPath);

    const content = readFileSync(receiptPath, "utf-8");
    // Only 2 individual completions, prose mentions should be ignored
    expect(content).toContain("tasks_completed=2");
  });

  it("appends tasks_completed when field is missing from receipt", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    const progressPath = join(ctx.dir, "progress.md");
    writeFileSync(receiptPath, "slug=test\n");
    writeFileSync(progressPath, "### Task 1: Done\n**Status:** Complete\n");

    updateReceiptTasks(receiptPath, progressPath);

    const content = readFileSync(receiptPath, "utf-8");
    expect(content).toContain("tasks_completed=1");
  });

  it("is a no-op when receipt file does not exist", () => {
    const progressPath = join(ctx.dir, "progress.md");
    writeFileSync(progressPath, "### Task 1\n**Status:** Complete\n");
    // Should not throw
    updateReceiptTasks(join(ctx.dir, "missing.txt"), progressPath);
  });

  it("is a no-op when progress file does not exist", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    writeFileSync(receiptPath, "tasks_completed=0\n");
    // Should not throw
    updateReceiptTasks(receiptPath, join(ctx.dir, "missing.md"));
    // tasks_completed should remain 0
    const content = readFileSync(receiptPath, "utf-8");
    expect(content).toContain("tasks_completed=0");
  });
});

// ---------------------------------------------------------------------------
// checkReceiptSource
// ---------------------------------------------------------------------------

describe("checkReceiptSource", () => {
  const ctx = useTempDir();

  it("returns true when wip directory does not exist", () => {
    expect(checkReceiptSource(join(ctx.dir, "nonexistent"), false)).toBe(true);
  });

  it("returns true when receipt has no worktree_path and running from main", () => {
    const wipDir = join(ctx.dir, "in-progress");
    const slugDir = join(wipDir, "test-plan");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(
      join(slugDir, "receipt.txt"),
      "slug=test-plan\nbranch=main\n",
    );

    expect(checkReceiptSource(wipDir, false)).toBe(true);
  });

  it("returns true when receipt has worktree_path and running in worktree", () => {
    const wipDir = join(ctx.dir, "in-progress");
    const slugDir = join(wipDir, "test-plan");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(
      join(slugDir, "receipt.txt"),
      "slug=test-plan\nbranch=feat/x\nworktree_path=/tmp/wt\n",
    );

    expect(checkReceiptSource(wipDir, true)).toBe(true);
  });

  it("blocks when receipt has worktree_path but running from main", () => {
    const wipDir = join(ctx.dir, "in-progress");
    const slugDir = join(wipDir, "test-plan");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(
      join(slugDir, "receipt.txt"),
      [
        "slug=test-plan",
        "branch=feat/x",
        "worktree_path=/tmp/wt",
        "started_at=2025-01-01T00:00:00Z",
      ].join("\n") + "\n",
    );

    // Suppress console.error output during test
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = checkReceiptSource(wipDir, false);
    spy.mockRestore();

    expect(result).toBe(false);
  });

  it("returns true when receipt has no source conflict", () => {
    const wipDir = join(ctx.dir, "in-progress");
    const slugDir = join(wipDir, "plan-a");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(join(slugDir, "receipt.txt"), "slug=plan-a\nbranch=main\n");

    // Running from main, receipt says main: no conflict
    expect(checkReceiptSource(wipDir, false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findPlansByBranch
// ---------------------------------------------------------------------------

describe("findPlansByBranch", () => {
  const ctx = useTempDir();

  it("returns empty array when in-progress directory does not exist", () => {
    const result = findPlansByBranch(
      join(ctx.dir, "nonexistent"),
      "feat/prd-x",
    );
    expect(result).toEqual([]);
  });

  it("returns empty array when no receipts exist", () => {
    const wipDir = join(ctx.dir, "in-progress");
    mkdirSync(wipDir, { recursive: true });

    const result = findPlansByBranch(wipDir, "feat/prd-x");
    expect(result).toEqual([]);
  });

  it("returns matching slug for one matching receipt", () => {
    const wipDir = join(ctx.dir, "in-progress");
    const slugDir = join(wipDir, "plan-a");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(
      join(slugDir, "receipt.txt"),
      "slug=plan-a\nbranch=feat/prd-x\n",
    );

    const result = findPlansByBranch(wipDir, "feat/prd-x");
    expect(result).toEqual(["plan-a"]);
  });

  it("returns multiple matching slugs for the same branch", () => {
    const wipDir = join(ctx.dir, "in-progress");
    const dirA = join(wipDir, "plan-a");
    const dirB = join(wipDir, "plan-b");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    writeFileSync(
      join(dirA, "receipt.txt"),
      "slug=plan-a\nbranch=feat/prd-shared\n",
    );
    writeFileSync(
      join(dirB, "receipt.txt"),
      "slug=plan-b\nbranch=feat/prd-shared\n",
    );

    const result = findPlansByBranch(wipDir, "feat/prd-shared");
    expect(result).toHaveLength(2);
    expect(result).toContain("plan-a");
    expect(result).toContain("plan-b");
  });

  it("returns empty array when no receipts match the branch", () => {
    const wipDir = join(ctx.dir, "in-progress");
    const slugDir = join(wipDir, "plan-c");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(
      join(slugDir, "receipt.txt"),
      "slug=plan-c\nbranch=ralphai/plan-c\n",
    );

    const result = findPlansByBranch(wipDir, "feat/other-branch");
    expect(result).toEqual([]);
  });

  it("filters correctly with mixed receipts", () => {
    const wipDir = join(ctx.dir, "in-progress");
    const dirA = join(wipDir, "plan-a");
    const dirB = join(wipDir, "plan-b");
    const dirC = join(wipDir, "plan-c");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    mkdirSync(dirC, { recursive: true });
    writeFileSync(
      join(dirA, "receipt.txt"),
      "slug=plan-a\nbranch=feat/prd-target\n",
    );
    writeFileSync(
      join(dirB, "receipt.txt"),
      "slug=plan-b\nbranch=ralphai/plan-b\n",
    );
    writeFileSync(
      join(dirC, "receipt.txt"),
      "slug=plan-c\nbranch=feat/prd-target\n",
    );

    const result = findPlansByBranch(wipDir, "feat/prd-target");
    expect(result).toHaveLength(2);
    expect(result).toContain("plan-a");
    expect(result).toContain("plan-c");
  });

  it("skips directories without receipt files", () => {
    const wipDir = join(ctx.dir, "in-progress");
    const dirA = join(wipDir, "plan-a");
    const dirB = join(wipDir, "plan-b");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    writeFileSync(
      join(dirA, "receipt.txt"),
      "slug=plan-a\nbranch=feat/prd-x\n",
    );
    // plan-b has no receipt file

    const result = findPlansByBranch(wipDir, "feat/prd-x");
    expect(result).toEqual(["plan-a"]);
  });
});
