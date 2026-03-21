import { describe, it, expect, vi } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { useTempDir } from "./test-utils.ts";
import {
  parseReceipt,
  initReceipt,
  updateReceiptTurn,
  updateReceiptTasks,
  resolveReceiptPath,
  checkReceiptSource,
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
        "source=worktree",
        "worktree_path=/tmp/wt",
        "branch=feat/dark-mode",
        "slug=dark-mode",
        "plan_file=dark-mode.md",
        "turns_budget=10",
        "turns_completed=3",
        "tasks_completed=2",
        "outcome=success",
      ].join("\n") + "\n",
    );

    const receipt = parseReceipt(receiptPath);
    expect(receipt).not.toBeNull();
    expect(receipt!.started_at).toBe("2025-06-15T10:30:00Z");
    expect(receipt!.source).toBe("worktree");
    expect(receipt!.worktree_path).toBe("/tmp/wt");
    expect(receipt!.branch).toBe("feat/dark-mode");
    expect(receipt!.slug).toBe("dark-mode");
    expect(receipt!.plan_file).toBe("dark-mode.md");
    expect(receipt!.turns_budget).toBe(10);
    expect(receipt!.turns_completed).toBe(3);
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
    // Defaults for missing fields
    expect(receipt!.source).toBe("main");
    expect(receipt!.branch).toBe("");
    expect(receipt!.turns_budget).toBe(0);
    expect(receipt!.turns_completed).toBe(0);
    expect(receipt!.tasks_completed).toBe(0);
  });

  it("handles receipt without optional fields", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    writeFileSync(
      receiptPath,
      [
        "started_at=2025-01-01T00:00:00Z",
        "source=main",
        "branch=main",
        "slug=test",
        "turns_budget=5",
        "turns_completed=1",
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
      source: "main",
      branch: "feat/my-feature",
      slug: "my-feature",
      plan_file: "my-feature.md",
      turns_budget: 5,
    });

    const content = readFileSync(receiptPath, "utf-8");
    expect(content).toContain("started_at=");
    expect(content).toContain("source=main");
    expect(content).toContain("branch=feat/my-feature");
    expect(content).toContain("slug=my-feature");
    expect(content).toContain("plan_file=my-feature.md");
    expect(content).toContain("turns_budget=5");
    expect(content).toContain("turns_completed=0");
    expect(content).toContain("tasks_completed=0");
  });

  it("includes worktree_path when source is worktree", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    initReceipt(receiptPath, {
      source: "worktree",
      worktree_path: "/tmp/my-worktree",
      branch: "feat/wt",
      slug: "wt-plan",
      plan_file: "wt-plan.md",
      turns_budget: 3,
    });

    const content = readFileSync(receiptPath, "utf-8");
    expect(content).toContain("source=worktree");
    expect(content).toContain("worktree_path=/tmp/my-worktree");
  });

  it("omits worktree_path when source is main", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    initReceipt(receiptPath, {
      source: "main",
      branch: "main",
      slug: "test",
      plan_file: "test.md",
      turns_budget: 5,
    });

    const content = readFileSync(receiptPath, "utf-8");
    expect(content).not.toContain("worktree_path=");
  });

  it("generates a valid ISO timestamp", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    initReceipt(receiptPath, {
      source: "main",
      branch: "main",
      slug: "test",
      plan_file: "test.md",
      turns_budget: 0,
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
      source: "worktree",
      worktree_path: "/home/user/wt",
      branch: "feat/round-trip",
      slug: "round-trip",
      plan_file: "round-trip.md",
      turns_budget: 10,
    });

    const receipt = parseReceipt(receiptPath);
    expect(receipt).not.toBeNull();
    expect(receipt!.source).toBe("worktree");
    expect(receipt!.worktree_path).toBe("/home/user/wt");
    expect(receipt!.branch).toBe("feat/round-trip");
    expect(receipt!.slug).toBe("round-trip");
    expect(receipt!.plan_file).toBe("round-trip.md");
    expect(receipt!.turns_budget).toBe(10);
    expect(receipt!.turns_completed).toBe(0);
    expect(receipt!.tasks_completed).toBe(0);
    expect(receipt!.outcome).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// updateReceiptTurn
// ---------------------------------------------------------------------------

describe("updateReceiptTurn", () => {
  const ctx = useTempDir();

  it("increments turns_completed from 0 to 1", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    writeFileSync(receiptPath, "turns_completed=0\ntasks_completed=0\n");

    updateReceiptTurn(receiptPath);

    const content = readFileSync(receiptPath, "utf-8");
    expect(content).toContain("turns_completed=1");
  });

  it("increments turns_completed from 3 to 4", () => {
    const receiptPath = join(ctx.dir, "receipt.txt");
    writeFileSync(
      receiptPath,
      "slug=test\nturns_completed=3\ntasks_completed=1\n",
    );

    updateReceiptTurn(receiptPath);

    const content = readFileSync(receiptPath, "utf-8");
    expect(content).toContain("turns_completed=4");
    // Other fields should be unchanged
    expect(content).toContain("slug=test");
    expect(content).toContain("tasks_completed=1");
  });

  it("is a no-op when receipt file does not exist", () => {
    // Should not throw
    updateReceiptTurn(join(ctx.dir, "missing.txt"));
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
    writeFileSync(receiptPath, "slug=test\nturns_completed=1\n");
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

  it("returns true when no in-progress directory exists", () => {
    expect(checkReceiptSource(ctx.dir, false)).toBe(true);
  });

  it("returns true when receipt source matches (both main)", () => {
    const slugDir = join(ctx.dir, "pipeline", "in-progress", "test-plan");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(
      join(slugDir, "receipt.txt"),
      "source=main\nslug=test-plan\nbranch=main\n",
    );

    expect(checkReceiptSource(ctx.dir, false)).toBe(true);
  });

  it("returns true when receipt source matches (both worktree)", () => {
    const slugDir = join(ctx.dir, "pipeline", "in-progress", "test-plan");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(
      join(slugDir, "receipt.txt"),
      "source=worktree\nslug=test-plan\nbranch=feat/x\nworktree_path=/tmp/wt\n",
    );

    expect(checkReceiptSource(ctx.dir, true)).toBe(true);
  });

  it("blocks when receipt says worktree but running from main", () => {
    const slugDir = join(ctx.dir, "pipeline", "in-progress", "test-plan");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(
      join(slugDir, "receipt.txt"),
      [
        "source=worktree",
        "slug=test-plan",
        "branch=feat/x",
        "worktree_path=/tmp/wt",
        "started_at=2025-01-01T00:00:00Z",
      ].join("\n") + "\n",
    );

    // Suppress console.error output during test
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = checkReceiptSource(ctx.dir, false);
    spy.mockRestore();

    expect(result).toBe(false);
  });

  it("blocks when receipt says main but running from worktree", () => {
    const slugDir = join(ctx.dir, "pipeline", "in-progress", "test-plan");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(
      join(slugDir, "receipt.txt"),
      [
        "source=main",
        "slug=test-plan",
        "branch=main",
        "started_at=2025-01-01T00:00:00Z",
      ].join("\n") + "\n",
    );

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = checkReceiptSource(ctx.dir, true);
    spy.mockRestore();

    expect(result).toBe(false);
  });

  it("returns true when receipt has no source conflict", () => {
    const slugDir = join(ctx.dir, "pipeline", "in-progress", "plan-a");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(
      join(slugDir, "receipt.txt"),
      "source=main\nslug=plan-a\nbranch=main\n",
    );

    // Running from main, receipt says main: no conflict
    expect(checkReceiptSource(ctx.dir, false)).toBe(true);
  });
});
